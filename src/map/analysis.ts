import { GameRuntime } from '../game/core/runtime'
import { INTERACT_RANGE } from '../game/systems/interaction'
import { isInsideBuilding, isInsideRoom } from '../game/world/buildings'
import type { MapData } from '../game/world/mapData'
import { ChunkLifecycle } from './loader'
import { resolveAll, type ValidationIssue, type WorldDocuments } from './validate'
import type { ResolvedRecord } from './resolve'

/**
 * Deep content checks (map editor M6): design warnings that need the game's own systems, so they
 * run where the game code is available (editor, tests, `npm run map:check -- --deep` through Vite)
 * rather than in the plain Node validator. Nothing here is a new rule set: reachability is the
 * runtime's NavGrid with every door open, interaction reach and line of sight are the runtime's
 * interactables and obstruction query, "indoors" is `isInsideBuilding`.
 *
 * All results are warnings: content can be valid and still be a design slip.
 */

/** Body centre height the runtime interacts from. */
const BODY_Y = 0.9
/** Low boxes (collide with bodies); overhead lintels and headers are ignored. */
const OVERHEAD_BOTTOM = 1.6
/** Overlap area that counts as suspicious (m²); touching or tiny overlaps are normal. */
const OVERLAP_AREA = 0.05
const SAMPLES = 16

export interface DeepCheckResult {
  issues: ValidationIssue[]
  /** Milliseconds spent (report). */
  ms: number
}

interface Box {
  id: string
  owner: string
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

/** Owner record of a stable/derived entity ID: `c0_0/house/door` → `c0_0/house`. */
function ownerOf(records: readonly ResolvedRecord[], id: string): ResolvedRecord | undefined {
  const base = id.split('#')[0]
  return records.find((r) => r.id === base || base.startsWith(`${r.id}/`))
}

export function deepCheck(docs: WorldDocuments): DeepCheckResult {
  const t0 = performance.now()
  const records = resolveAll(docs)
  const life = new ChunkLifecycle(docs)
  life.loadAll()
  const map = life.toMapData()
  const issues: ValidationIssue[] = []
  const chunkPath = (chunkId: string) => docs.world.chunks.find((c) => c.chunkId === chunkId)?.path ?? chunkId
  const add = (code: string, id: string, message: string) => {
    const r = ownerOf(records, id)
    const path = r ? `${chunkPath(r.ownerChunkId)}#/${r.category}/${r.order[2]}` : 'world.json'
    issues.push({ severity: 'warning', code, message, path, entityId: id })
  }
  const zombieSpawnIds = records.filter((r) => r.parts.zombieSpawns?.length).map((r) => r.id)
  reachability(map, zombieSpawnIds, add)
  overlaps(records, add)
  containersOutsideRooms(map, add)
  return { issues, ms: performance.now() - t0 }
}

type Add = (code: string, id: string, message: string) => void

function reachability(map: MapData, zombieSpawnIds: readonly string[], add: Add): void {
  const rt = new GameRuntime(map)
  rt.setLineOfSightOverride(null)
  for (const d of map.doors) rt.nav.setDoorState(d.id, 'open')
  const nav = rt.nav
  const start = map.playerSpawn
  const home = nav.componentAt(start.x, start.z)
  if (home < 0) {
    add('start-not-walkable', 'world/player-spawn', `the player spawn (${start.x}, ${start.z}) is not on a walkable cell`)
    return
  }
  const reachable = (x: number, z: number) => nav.isWalkable(x, z) && nav.componentAt(x, z) === home

  // Every interactable (doors, containers, lamp switches, curtains) needs a reachable spot within
  // the runtime's reach with a clear line to it, like `selectInteractable` + `isBlocked`.
  for (const item of rt.interactables) {
    let ok = false
    for (const r of [item.radius + 0.3, item.radius + INTERACT_RANGE * 0.5, item.radius + INTERACT_RANGE * 0.95]) {
      for (let i = 0; i < SAMPLES && !ok; i++) {
        const a = (i / SAMPLES) * Math.PI * 2
        const x = item.position.x + Math.cos(a) * r
        const z = item.position.z + Math.sin(a) * r
        if (!reachable(x, z)) continue
        if (!rt.isBlocked({ x, y: BODY_Y, z }, item.position, [item.id])) ok = true
      }
      if (ok) break
    }
    if (!ok) add('interaction-unreachable', item.id, `${item.kind} "${item.name}" cannot be reached from the player spawn (all doors open) within interaction range`)
  }

  for (let i = 0; i < map.zombieSpawns.length; i++) {
    const p = map.zombieSpawns[i]
    const id = zombieSpawnIds[i] ?? `zombie spawn #${i}`
    if (!reachable(p.x, p.z)) add('spawn-unreachable', id, `zombie spawn (${p.x}, ${p.z}) is not connected to the player's area (walls or fences in between)`)
    else if (map.buildings.some((b) => isInsideBuilding(b, p.x, p.z, 0.5))) add('spawn-indoors', id, `zombie spawn (${p.x}, ${p.z}) is inside a building: respawn never uses it`)
  }

  for (const z of map.zombieZones ?? []) {
    const cell = nav.nearestWalkableCell(z.center.x, z.center.z, 4)
    const c = cell ? nav.cellToWorld(cell.cx, cell.cz) : null
    if (!c || nav.componentAt(c.x, c.z) !== home) add('zone-unreachable', z.id, `zone "${z.name}" has no walkable ground near its centre connected to the player's area`)
  }
}

/** Solid boxes of different records overlapping: a prop inside a wall, two buildings on each other. */
function overlaps(records: readonly ResolvedRecord[], add: Add): void {
  const boxes: Box[] = []
  for (const r of records) {
    for (const b of [...(r.parts.walls ?? []), ...(r.parts.containers ?? [])]) {
      if (b.position.y - b.size[1] / 2 >= OVERHEAD_BOTTOM) continue
      boxes.push({ id: b.id, owner: r.id, minX: b.position.x - b.size[0] / 2, maxX: b.position.x + b.size[0] / 2, minZ: b.position.z - b.size[2] / 2, maxZ: b.position.z + b.size[2] / 2 })
    }
  }
  boxes.sort((a, b) => a.minX - b.minX)
  const reported = new Set<string>()
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]
    for (let j = i + 1; j < boxes.length && boxes[j].minX < a.maxX; j++) {
      const b = boxes[j]
      if (a.owner === b.owner) continue
      const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)
      const d = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ)
      if (w <= 0 || d <= 0 || w * d < OVERLAP_AREA) continue
      const key = [a.owner, b.owner].sort().join('|')
      if (reported.has(key)) continue
      reported.add(key)
      add('collider-overlap', b.id, `${b.id} overlaps ${a.id} (${(w * d).toFixed(2)} m²): records ${b.owner} and ${a.owner} collide`)
    }
  }
}

/** A building's container whose centre is in none of that building's rooms (lighting, design). */
function containersOutsideRooms(map: MapData, add: Add): void {
  const rooms = map.rooms ?? []
  for (const b of map.buildings) {
    const own = rooms.filter((r) => r.buildingId === b.id)
    if (own.length === 0) continue
    for (const c of map.containers) {
      if (!c.id.startsWith(`${b.id}/`)) continue
      const p = c.position
      if (!own.some((r) => isInsideRoom(r.bounds, p.x, p.z, r.outline))) {
        add('container-outside-room', c.id, `${c.name} (${c.id}) is in building ${b.id} but in none of its rooms`)
      }
    }
  }
}
