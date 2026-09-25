import { describe, expect, it } from 'vitest'
import { GameRuntime } from './runtime'
import { GAME_CONFIG } from './config'
import { PerfMonitor, type PerfSnapshot } from './perf'
import { NEIGHBORHOOD_MAP, type MapData } from '../world/mapData'
import { buildStressMap } from '../world/stressMap'
import type { NavGrid } from '../world/navigation'
import type { Vec3 } from '../../types'

/**
 * R0 benchmark scenarios (simulation only, no WebGL): run with
 *   PERF_SCENARIOS=1 npx vitest run src/game/core/perf.scenarios.test.ts
 * Each scenario runs 20 s of game time at 60 ticks/s after a 2 s warm-up and prints one
 * `PERF SCENARIO <name> {json}` line (averages/worst per tick from `runtime.perf`, plus Node GC
 * pauses). Physics is the grid stand-in used by the soak test (fake bodies, LOS = nav line of walk),
 * so absolute numbers differ from the browser; they are comparable between R0, R1 and R2.
 */

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
const RUN = !!ENV.PERF_SCENARIOS
// Optional AI-rate override to compare defaults: PERF_AI_HZ=active,near,dormant (e.g. 60,60,60).
if (ENV.PERF_AI_HZ) {
  const [a, n, d] = ENV.PERF_AI_HZ.split(',').map(Number)
  Object.assign(GAME_CONFIG.simulation, { activeAiHz: a, nearAiHz: n, dormantAiHz: d })
}
const ONLY = ENV.PERF_ONLY
const DT = 1 / 60
const WARMUP_SEC = 2
const RUN_SEC = 20

function fakeBody(nav: NavGrid, x: number, z: number) {
  const pos = { x, y: 0.9, z }
  let vel = { x: 0, y: 0, z: 0 }
  let enabled = true
  return {
    translation: () => ({ ...pos }),
    linvel: () => ({ ...vel }),
    setLinvel: (v: { x: number; y: number; z: number }) => {
      vel = { ...v }
    },
    setTranslation: (p: { x: number; y: number; z: number }) => {
      pos.x = p.x
      pos.z = p.z
    },
    setNextKinematicTranslation: (p: { x: number; y: number; z: number }) => {
      pos.x = p.x
      pos.z = p.z
    },
    setEnabled: (e: boolean) => {
      enabled = e
    },
    step: (dt: number) => {
      if (!enabled) return
      const nx = pos.x + vel.x * dt
      const nz = pos.z + vel.z * dt
      if (nav.isWalkable(nx, nz)) {
        pos.x = nx
        pos.z = nz
      } else if (nav.isWalkable(nx, pos.z)) pos.x = nx
      else if (nav.isWalkable(pos.x, nz)) pos.z = nz
    },
  }
}
type FakeBody = ReturnType<typeof fakeBody>
const asBody = (b: FakeBody) => b as unknown as Parameters<GameRuntime['registerPlayerBody']>[0]

type Mode = 'standing' | 'moving' | 'crowd' | 'pathing'

interface ScenarioResult {
  name: string
  zombies: number
  snapshot: PerfSnapshot
  gc: { count: number; totalMs: number; maxMs: number }
  tickMs: { avg: number; p99: number; max: number }
}

/** Does the runtime still read zombie positions from their bodies (pre-R2)? */
function zombiesNeedBodies(rt: GameRuntime): boolean {
  return !(rt as unknown as { simulationOwnsZombies?: boolean }).simulationOwnsZombies
}

async function runScenario(label: string, map: MapData, mode: Mode, extraZombies: number): Promise<ScenarioResult> {
  const rt = new GameRuntime(map)
  rt.newGame(20260925)
  const totalTicks = Math.round((WARMUP_SEC + RUN_SEC) / DT)
  const nav = rt.nav
  rt.registerPhysicsQuery({ isBlocked: (from, to, ignore) => (ignore.length > 0 ? false : !nav.hasLineOfWalk(from, to)) })

  // Crowd: the player stands at the first tile's crossroads, extra zombies spawn in a ring around it.
  // Pathing: the player starts inside the safehouse; the ring is around its yard.
  const start: Vec3 = mode === 'crowd'
    ? { x: map.playerSpawn.x + 12, y: 0, z: map.playerSpawn.z + 12 }
    : { ...map.playerSpawn }
  rt.player.position = { ...start }
  const player = fakeBody(nav, start.x, start.z)
  rt.registerPlayerBody(asBody(player))
  for (let i = 0; i < extraZombies; i++) {
    const a = (i / extraZombies) * Math.PI * 2
    const r = 4 + (i % 5) * 1.6
    const cell = nav.nearestWalkableCell(start.x + Math.cos(a) * r, start.z + Math.sin(a) * r, 6)
    if (cell) rt.spawnZombie(nav.cellToWorld(cell.cx, cell.cz))
  }
  rt.spawnTimer = 1e9

  const bodies = new Map<string, FakeBody>()
  const syncBodies = () => {
    if (!zombiesNeedBodies(rt)) return
    for (const z of rt.zombies.values()) {
      if (bodies.has(z.id)) continue
      const b = fakeBody(nav, z.position.x, z.position.z)
      bodies.set(z.id, b)
      rt.registerZombieBody(z.id, asBody(b))
    }
    for (const id of Array.from(bodies.keys())) if (!rt.zombies.has(id)) bodies.delete(id)
  }

  // Moving: a straight loop through the map at 6 m/s (teleported; the stand-in body ignores walls).
  const half = map.size / 2 - 4
  const loop: Vec3[] = [
    { x: -1, y: 0, z: -1 }, { x: half * 0.8, y: 0, z: -1 }, { x: half * 0.8, y: 0, z: half * 0.6 },
    { x: -half * 0.8, y: 0, z: half * 0.6 }, { x: -half * 0.8, y: 0, z: -half * 0.6 }, { x: -1, y: 0, z: -half * 0.6 },
  ]
  let leg = 0
  // Pathing: the player hops between the safehouse (door open) and the yard every 4 s; every zombie
  // is told where the player is once a second, so they keep requesting paths around the walls.
  const safehouseDoor = map.doors.find((d) => d.id.endsWith('c-1_-1/safehouse/door'))
  if (mode === 'pathing' && safehouseDoor) rt.setDoorState(safehouseDoor.id, 'open')
  const hops: Vec3[] = [{ ...start }, { x: start.x + 6, y: 0, z: start.z + 9 }]

  const perf = new PerfMonitor(Math.round(RUN_SEC / DT))
  const gcEvents: number[] = []
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) gcEvents.push(e.duration)
  })
  const tickTimes: number[] = []

  for (let i = 0; i < totalTicks; i++) {
    if (i === Math.round(WARMUP_SEC / DT)) {
      Object.assign(rt, { perf })
      obs.observe({ entryTypes: ['gc'] })
    }
    // Keep the player alive and still (crowd) or walking (moving); nothing else drives input.
    rt.player.health = 100
    rt.player.hunger = 100
    rt.player.thirst = 100
    if (mode === 'moving') {
      const pos = rt.player.position
      const wp = loop[leg]
      const dx = wp.x - pos.x
      const dz = wp.z - pos.z
      const d = Math.hypot(dx, dz)
      if (d < 0.5) leg = (leg + 1) % loop.length
      else player.setTranslation({ x: pos.x + (dx / d) * 6 * DT, y: 0.9, z: pos.z + (dz / d) * 6 * DT })
      rt.player.facing = Math.atan2(dx, dz)
    }
    if (mode === 'pathing') {
      if (i % 240 === 0) {
        const p = hops[(i / 240) % 2]
        player.setTranslation({ x: p.x, y: 0.9, z: p.z })
      }
      if (i % 60 === 0) {
        for (const z of rt.zombies.values()) {
          if (z.ai === 'DEAD') continue
          z.lastKnownTarget = { ...rt.player.position }
          z.memoryAge = 0
          z.memorySource = 'noise'
          if (z.ai === 'IDLE' || z.ai === 'WANDER' || z.ai === 'MIGRATE') z.ai = 'SEARCH'
        }
      }
    }
    syncBodies()
    const t0 = performance.now()
    rt.tick(DT)
    if (i >= Math.round(WARMUP_SEC / DT)) tickTimes.push(performance.now() - t0)
    player.step(DT)
    for (const b of bodies.values()) b.step(DT)
    // GC entries reach the observer through the event loop: yield once per game second.
    if (i % 60 === 59) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  // Entries are delivered asynchronously; the scenario is synchronous, so collect them explicitly.
  for (const e of obs.takeRecords()) gcEvents.push(e.duration)
  obs.disconnect()

  const sorted = [...tickTimes].sort((a, b) => a - b)
  const result: ScenarioResult = {
    name: label,
    zombies: rt.zombies.size,
    snapshot: perf.snapshot(),
    gc: {
      count: gcEvents.length,
      totalMs: +gcEvents.reduce((n, v) => n + v, 0).toFixed(2),
      maxMs: +Math.max(0, ...gcEvents).toFixed(2),
    },
    tickMs: {
      avg: +(tickTimes.reduce((n, v) => n + v, 0) / tickTimes.length).toFixed(3),
      p99: +sorted[Math.floor(sorted.length * 0.99)].toFixed(3),
      max: +sorted[sorted.length - 1].toFixed(3),
    },
  }
  return result
}

function report(r: ScenarioResult): void {
  const s = r.snapshot
  const round = (o: Record<string, number>, d = 3) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(d)]))
  console.log(`PERF SCENARIO ${r.name} ` + JSON.stringify({
    zombies: r.zombies,
    tickMs: r.tickMs,
    avgMs: round(s.avgMs),
    maxMs: round(s.maxMs),
    perTick: round(s.avgCount, 2),
    maxPerTick: s.maxCount,
    gauges: { active: s.gauges.zombiesActive, near: s.gauges.zombiesNear, dormant: s.gauges.zombiesDormant, bodies: s.gauges.zombieBodies, pathQueue: s.gauges.pathQueue },
    gc: r.gc,
  }))
}

/**
 * Draw-call audit (R0): meshes each world category adds, from the map data and the view components
 * (one draw call per visible mesh and material, plus one per shadow-casting mesh in the shadow pass).
 */
function drawCallAudit(map: MapData): Record<string, number> {
  const walls = map.walls.length
  const containers = map.containers.length
  return {
    wallMeshes: walls,
    wallDistinctColors: new Set(map.walls.map((w) => w.color ?? 'default')).size,
    containerMeshes: containers * 2,
    doorMeshes: map.doors.length * 2,
    windowMeshes: mapWindowsCount(map) * 2,
    lampMeshes: (map.rooms?.filter((r) => r.lamp).length ?? 0) * 2,
    buildingFloorRoof: map.buildings.length * 2,
    roads: map.roads.length,
    zombieSpawnCharacters: map.zombieSpawns.length,
    /** Rig parts per character (see `rendering/character/rig.ts`), health bar hidden unless damaged. */
    meshesPerCharacter: 12,
  }
}
const mapWindowsCount = (map: MapData) => map.windows?.length ?? 0

describe.skipIf(!RUN)('R0 draw-call audit', () => {
  it('lists meshes per category for the normal and the stress map', () => {
    for (const [name, map] of [['normal', NEIGHBORHOOD_MAP], ['stress', buildStressMap(4)]] as const) {
      console.log(`PERF AUDIT ${name} ` + JSON.stringify(drawCallAudit(map)))
    }
  })
})

describe.skipIf(!RUN)('R0 performance scenarios', () => {
  const stress = buildStressMap(4)
  const cases: [string, MapData, Mode, number][] = [
    ['normal/standing', NEIGHBORHOOD_MAP, 'standing', 0],
    ['normal/moving', NEIGHBORHOOD_MAP, 'moving', 0],
    ['normal/crowd', NEIGHBORHOOD_MAP, 'crowd', 30],
    ['stress/standing', stress, 'standing', 0],
    ['stress/moving', stress, 'moving', 0],
    ['stress/crowd', stress, 'crowd', 100],
    ['normal/pathing', NEIGHBORHOOD_MAP, 'pathing', 30],
    ['stress/pathing', stress, 'pathing', 100],
  ]
  for (const [name, map, mode, extra] of cases) {
    if (ONLY && !name.includes(ONLY)) continue
    it(name, async () => {
      const r = await runScenario(name, map, mode, extra)
      report(r)
      expect(r.snapshot.ticks).toBeGreaterThan(0)
    }, 300_000)
  }
})
