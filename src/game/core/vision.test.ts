import { describe, expect, it } from 'vitest'
import { GameRuntime } from './runtime'
import { GAME_CONFIG } from './config'
import { generateBuildingWalls, generateDoorPlacements, type BuildingDef } from '../world/buildings'
import { NEIGHBORHOOD_MAP, type MapData } from '../world/mapData'
import type { NavGrid } from '../world/navigation'

/**
 * Player vision inside the runtime: it only decides what is drawn. Bodies are grid fakes as in
 * `siege.test.ts` (closed doors block like the Rapier collider).
 */
const DT = 1 / 30

const hut: BuildingDef = {
  id: 'hut', name: 'Hut', center: { x: 0, z: 0 }, size: { w: 6, d: 6 }, height: 3, wallThickness: 0.3,
  wallColor: '#fff', roofColor: '#000', floorColor: '#888',
  doors: [{ id: 'door-hut', name: 'Cửa', side: 'S', offset: 0, width: 1.4 }], containers: [],
}

function hutMap(playerSpawn: MapData['playerSpawn'], zombieSpawns: MapData['zombieSpawns']): MapData {
  return {
    id: 'vision-runtime-test', size: 40, playerSpawn, zombieSpawns, buildings: [hut],
    walls: generateBuildingWalls(hut), doors: generateDoorPlacements(hut), containers: [], roads: [],
  }
}

function fakeBody(nav: NavGrid, x: number, z: number) {
  const pos = { x, y: 0.9, z }
  let vel = { x: 0, y: 0, z: 0 }
  return {
    translation: () => ({ ...pos }),
    linvel: () => ({ ...vel }),
    setLinvel: (v: { x: number; y: number; z: number }) => { vel = { ...v } },
    setTranslation: (p: { x: number; z: number }) => { pos.x = p.x; pos.z = p.z },
    setEnabled: () => undefined,
    step: (dt: number) => {
      const nx = pos.x + vel.x * dt
      const nz = pos.z + vel.z * dt
      if (nav.isWalkable(nx, nz)) { pos.x = nx; pos.z = nz } else if (nav.isWalkable(nx, pos.z)) pos.x = nx
      else if (nav.isWalkable(pos.x, nz)) pos.z = nz
    },
  }
}
type FakeBody = ReturnType<typeof fakeBody>
const asBody = (b: FakeBody) => b as unknown as Parameters<GameRuntime['registerPlayerBody']>[0]

function world(map: MapData, seed = 11) {
  const rt = new GameRuntime(map)
  rt.newGame(seed)
  rt.registerPhysicsQuery({ isBlocked: (a, b, ignore) => (ignore.length > 0 ? false : !rt.nav.hasLineOfWalk(a, b)) })
  const player = fakeBody(rt.nav, rt.player.position.x, rt.player.position.z)
  rt.registerPlayerBody(asBody(player))
  // R2: zombies move in the simulation; only the player has a (grid) body.
  const step = (seconds: number, each?: () => void) => {
    for (let t = 0; t < seconds - 1e-9; t += DT) {
      rt.tick(DT)
      player.step(DT)
      each?.()
    }
  }
  return { rt, step }
}

describe('player vision in the runtime', () => {
  it('a zombie chasing from behind stays hidden (AI unaffected) until it enters the near radius', () => {
    // Player at the origin facing +Z; the zombie 8 m behind faces the player's back and sees it.
    const { rt, step } = world(hutMap({ x: 0, y: 0, z: 12 }, [{ x: 0, y: 0, z: 4.5 }]))
    rt.pickWanderPoint = () => null
    rt.player.facing = 0
    const zombie = rt.zombies.get('zombie-1')!
    zombie.facing = 0
    const states = new Set<string>()
    let hiddenWhileChasing = 0
    let firstVisibleDistance = -1
    step(6, () => {
      const d = Math.hypot(zombie.position.x - rt.player.position.x, zombie.position.z - rt.player.position.z)
      const v = rt.vision.get(zombie.id)!
      states.add(zombie.ai)
      if (zombie.ai === 'CHASE' && !v.isVisibleToPlayer) hiddenWhileChasing += 1
      if (v.isVisibleToPlayer && firstVisibleDistance < 0) firstVisibleDistance = d
    })
    expect(states.has('CHASE')).toBe(true)
    expect(hiddenWhileChasing).toBeGreaterThan(30) // chased for over a second while not drawn
    expect(firstVisibleDistance).toBeGreaterThan(0)
    expect(firstVisibleDistance).toBeLessThanOrEqual(GAME_CONFIG.playerVision.nearDetectionRadius + 0.2)
    expect(rt.vision.get(zombie.id)!.reason).toBe('NEAR_DETECTION')
  })

  it('opening and closing the door toggles sight without rebuilding the occluders', () => {
    // Player inside facing the door; the zombie outside in front of it (does not see through the door).
    const { rt, step } = world(hutMap({ x: 0, y: 0, z: -1 }, [{ x: 0, y: 0, z: 9 }]))
    rt.pickWanderPoint = () => null
    rt.player.facing = 0
    const occluders = rt.visionOccluders
    step(0.3)
    expect(rt.vision.get('zombie-1')!.reason).toBe('BLOCKED_BY_OCCLUDER')
    expect(rt.vision.isVisible('zombie-1')).toBe(false)
    rt.setDoorState('door-hut', 'open')
    step(0.1)
    expect(rt.vision.get('zombie-1')!.reason).toBe('VISIBLE')
    expect(rt.vision.isVisible('zombie-1')).toBe(true)
    rt.setDoorState('door-hut', 'closed')
    step(0.4)
    expect(rt.vision.isVisible('zombie-1')).toBe(false)
    expect(rt.visionOccluders).toBe(occluders)
  })

  it('the simulation is identical with the vision system switched off (it never feeds the AI)', () => {
    const run = (withVision: boolean) => {
      const rt = new GameRuntime(NEIGHBORHOOD_MAP)
      rt.newGame(4242)
      if (!withVision) rt.vision.update = () => undefined
      const player = fakeBody(rt.nav, rt.player.position.x, rt.player.position.z)
      rt.registerPlayerBody(asBody(player))
      rt.registerPhysicsQuery({ isBlocked: (a, b, ignore) => (ignore.length > 0 ? false : !rt.nav.hasLineOfWalk(a, b)) })
      for (let t = 0; t < 40; t += DT) {
        rt.tick(DT)
        player.step(DT)
      }
      return { zombies: Array.from(rt.zombies.values(), (z) => [z.id, z.ai, z.position.x, z.position.z]), vision: rt.vision.stats.passes }
    }
    const on = run(true)
    const off = run(false)
    expect(on.vision).toBeGreaterThan(700)
    expect(off.vision).toBe(0)
    expect(on.zombies).toEqual(off.zombies)
  })

  it('new game and load start with no visibility state; removed zombies are forgotten', () => {
    const { rt, step } = world(hutMap({ x: 0, y: 0, z: 12 }, [{ x: 0, y: 0, z: 16 }]))
    step(0.2)
    expect(rt.vision.states.size).toBe(1)
    // Corpse cleanup removes the zombie and its visibility state.
    const corpse = rt.zombies.get('zombie-1')!
    corpse.ai = 'DEAD'
    corpse.deadTimer = GAME_CONFIG.spawn.corpseLifetime + 1
    step(0.1)
    expect(rt.zombies.has('zombie-1')).toBe(false)
    expect(rt.vision.states.size).toBe(0)
    rt.spawnZombie({ x: 0, y: 0, z: 16 })
    step(0.2)
    expect(rt.vision.states.size).toBe(1)
    const save = rt.createSnapshot()
    rt.loadSnapshot(save)
    expect(rt.vision.states.size).toBe(0)
    rt.newGame(3)
    expect(rt.vision.states.size).toBe(0)
  })
})
