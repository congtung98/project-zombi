import type { BuildingDef, ContainerDef, DoorPlacement, RoomPlacement, WallDef, WindowPlacement } from '../../game/world/buildings.ts'
import type { RoadDef, ZoneDef } from '../../game/world/mapData.ts'
import type { Vec3 } from '../../types/index.ts'
import {
  MAP_SCHEMA_VERSION,
  type ChunkDocument,
  type DoorObject,
  type PrefabDocument,
  type PrefabObject,
  type QuarterTurns,
  type RoomObject,
  type StandaloneObject,
  type WindowObject,
  type WorldDocument,
  type XZ,
} from '../schema.ts'
import { chunkIdOf, chunkIndex, chunkOrigin, chunksOverlapping, quantize, rotateXZ } from '../transform.ts'
import { boundaryWalls } from '../resolve.ts'
import { computeExternalRefs } from '../validate.ts'

/**
 * Import a hand-coded (legacy) resolved map into prefab + chunk documents: one prefab per
 * building (pivot = footprint centre), everything else as chunk records, IDs mapped by
 * `localIdFor`. Used once for the neighbourhood (from the frozen `legacy-v7-map.json`) and
 * reusable for other hand-made maps. Throws when something cannot be represented exactly.
 */

export interface LegacyMap {
  id: string
  size: number
  playerSpawn: Vec3
  zombieSpawns: Vec3[]
  zombieZones?: ZoneDef[]
  buildings: BuildingDef[]
  walls: WallDef[]
  doors: DoorPlacement[]
  containers: ContainerDef[]
  roads: RoadDef[]
  windows?: WindowPlacement[]
  rooms?: RoomPlacement[]
  maxActiveZombies?: number
}

/** Legacy ID → stable ID per kind (the persisted kinds drive save migration). */
export interface LegacyIdMap {
  worldId: string
  /** Last save schema that stored legacy IDs; newer saves use stable IDs. */
  legacySaveVersion: number
  doors: Record<string, string>
  containers: Record<string, string>
  /** Window IDs (curtain state). */
  windows: Record<string, string>
  lamps: Record<string, string>
  rooms: Record<string, string>
  zones: Record<string, string>
  walls: Record<string, string>
  roads: Record<string, string>
  buildings: Record<string, string>
}

export interface ImportOptions {
  worldId: string
  name: string
  chunkSize: number
  legacySaveVersion: number
}

export interface ImportedWorld {
  world: WorldDocument
  prefabs: PrefabDocument[]
  chunks: ChunkDocument[]
  ids: LegacyIdMap
}

const SIDES = new Set(['n', 's', 'e', 'w'])

/**
 * Local ID from a legacy ID: lower-case, drop the `ct` prefix and the building's own name, and
 * call bare wall pieces `wall-…`: `ct-store-shelf-1` → `shelf-1`, `door-house-bedroom` →
 * `door-bedroom`, `safehouse-N-0` → `wall-n-0`, `win-safehouse-n-sill` → `win-n-sill`.
 */
export function localIdFor(legacyId: string, buildingId: string): string {
  let tokens = legacyId.toLowerCase().split(/[-:]/)
  if (tokens[0] === 'ct') tokens = tokens.slice(1)
  const own = buildingId.toLowerCase().split('-')
  const at = tokens.findIndex((_, i) => own.every((t, j) => tokens[i + j] === t))
  if (at >= 0 && tokens.length > own.length) tokens.splice(at, own.length)
  if (SIDES.has(tokens[0])) tokens.unshift('wall')
  return tokens.join('-')
}

function standaloneName(legacyId: string, strip: string): string {
  const id = legacyId.toLowerCase().replace(/:/g, '-')
  return id.startsWith(strip) ? id.slice(strip.length) : id
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9

function doorQuarter(angle: number): QuarterTurns {
  const q = [0, Math.PI / 2, Math.PI, -Math.PI / 2].findIndex((a) => near(a, angle) || (a === Math.PI && near(-Math.PI, angle)))
  if (q < 0) throw new Error(`Door angle ${angle} is not a quarter turn`)
  return q as QuarterTurns
}

function inwardQuarter(v: { x: number; z: number }): QuarterTurns {
  for (const q of [0, 1, 2, 3] as const) {
    const [x, z] = rotateXZ(0, 1, q)
    if (near(x, v.x) && near(z, v.z)) return q
  }
  throw new Error(`Window inward ${JSON.stringify(v)} is not axis-aligned`)
}

function inside(b: { center: XZ; size: { w: number; d: number } }, p: XZ, margin: number): boolean {
  return Math.abs(p.x - b.center.x) <= b.size.w / 2 + margin && Math.abs(p.z - b.center.z) <= b.size.d / 2 + margin
}

export function importLegacyMap(legacy: LegacyMap, opts: ImportOptions): ImportedWorld {
  const S = opts.chunkSize
  const ids: LegacyIdMap = { worldId: opts.worldId, legacySaveVersion: opts.legacySaveVersion, doors: {}, containers: {}, windows: {}, lamps: {}, rooms: {}, zones: {}, walls: {}, roads: {}, buildings: {} }
  const half = legacy.size / 2
  const chunkIds = chunksOverlapping({ minX: -half, minZ: -half, maxX: half, maxZ: half }, S)
  const chunks = new Map<string, ChunkDocument>()
  for (const { cx, cz } of chunkIds) {
    const chunkId = chunkIdOf(cx, cz)
    chunks.set(chunkId, { schemaVersion: MAP_SCHEMA_VERSION, contentVersion: 1, chunkId, cx, cz, instances: [], objects: [], roads: [], zones: [], spawns: [], externalRefs: [] })
  }
  /** Owner chunk of a world point and the point in its local coordinates. */
  const own = (p: XZ) => {
    const cx = chunkIndex(p.x, S)
    const cz = chunkIndex(p.z, S)
    const chunk = chunks.get(chunkIdOf(cx, cz))
    if (!chunk) throw new Error(`(${p.x}, ${p.z}) lies outside the imported chunks`)
    const o = chunkOrigin(cx, cz, S)
    return { chunk, local: { x: quantize(p.x - o.x), z: quantize(p.z - o.z) } }
  }

  // World boundary: must be exactly what `boundaryWalls` rebuilds from world.json.
  const bounds = legacy.walls.filter((w) => w.id.startsWith('bound-'))
  const boundary = bounds.length ? { height: bounds[0].size[1], thickness: bounds[0].size[2] } : null
  const world: WorldDocument = {
    schemaVersion: MAP_SCHEMA_VERSION,
    worldId: opts.worldId,
    name: opts.name,
    contentVersion: 1,
    chunkSize: S,
    coordinateSystem: 'y-up-xz-meters',
    playArea: { size: legacy.size },
    boundary,
    chunkBounds: {
      minCx: Math.min(...chunkIds.map((c) => c.cx)),
      maxCx: Math.max(...chunkIds.map((c) => c.cx)),
      minCz: Math.min(...chunkIds.map((c) => c.cz)),
      maxCz: Math.max(...chunkIds.map((c) => c.cz)),
    },
    chunks: [...chunks.values()].map((c) => ({ chunkId: c.chunkId, cx: c.cx, cz: c.cz, path: `chunks/${c.chunkId}.json` })),
    prefabs: [],
    playerSpawn: '',
    ...(legacy.maxActiveZombies !== undefined ? { gameplay: { maxActiveZombies: legacy.maxActiveZombies } } : {}),
  }
  const rebuilt = boundaryWalls(world)
  for (const w of bounds) {
    const side = w.id.slice('bound-'.length)
    const twin = rebuilt.find((r) => r.id === `world/boundary-${side}`)
    if (!twin || !near(twin.position.x, w.position.x) || !near(twin.position.z, w.position.z) || twin.size.some((s, i) => !near(s, w.size[i]))) {
      throw new Error(`Boundary wall ${w.id} does not match the world boundary rule`)
    }
    ids.walls[w.id] = twin.id
  }

  const usedWalls = new Set(bounds.map((w) => w.id))
  const usedContainers = new Set<string>()
  const prefabs: PrefabDocument[] = []
  const windows = legacy.windows ?? []
  const rooms = legacy.rooms ?? []

  for (const b of legacy.buildings) {
    const { chunk, local } = own(b.center)
    const instanceId = `${chunk.chunkId}/${b.id}`
    const localPoint = (p: XZ): XZ => ({ x: quantize(p.x - b.center.x), z: quantize(p.z - b.center.z) })
    const entity = (legacyId: string) => {
      const localId = localIdFor(legacyId, b.id)
      return { localId, stable: `${instanceId}/${localId}` }
    }
    const objects: PrefabObject[] = []
    const structural = (id: string) =>
      new RegExp(`^${b.id}-[NSWE]-`).test(id) ||
      (b.partitions ?? []).some((p) => id.startsWith(`${p.id}-`)) ||
      (b.windows ?? []).some((w) => id.startsWith(`${w.id}-`))
    for (const w of legacy.walls) {
      if (usedWalls.has(w.id) || !inside(b, w.position, b.wallThickness)) continue
      usedWalls.add(w.id)
      const e = entity(w.id)
      ids.walls[w.id] = e.stable
      const p = localPoint(w.position)
      objects.push({ kind: structural(w.id) ? 'wall' : 'prop', localId: e.localId, position: { x: p.x, y: w.position.y, z: p.z }, size: w.size.map(quantize) as [number, number, number], color: w.color ?? b.wallColor })
    }
    for (const c of legacy.containers) {
      if (!inside(b, c.position, 0)) continue
      usedContainers.add(c.id)
      const e = entity(c.id)
      ids.containers[c.id] = e.stable
      const p = localPoint(c.position)
      objects.push({ kind: 'container', localId: e.localId, name: c.name, position: { x: p.x, y: c.position.y, z: p.z }, size: [...c.size], color: c.color, ...(c.loot ? { lootTableId: c.loot } : {}) })
    }
    for (const d of legacy.doors.filter((x) => x.buildingId === b.id)) {
      const q = doorQuarter(d.closedAngle)
      const open = doorQuarter(d.openAngle)
      const openTowards = open === (q + 3) % 4 ? 1 : open === (q + 1) % 4 ? -1 : 0
      if (openTowards === 0) throw new Error(`Door ${d.id} does not swing a quarter turn`)
      const [hx, hz] = rotateXZ(-d.width / 2, 0, q)
      if (!near(d.center.x + hx, d.hinge.x) || !near(d.center.z + hz, d.hinge.z)) throw new Error(`Door ${d.id} hinge is not at its local −X end`)
      const e = entity(d.id)
      ids.doors[d.id] = e.stable
      const door: DoorObject = { kind: 'door', localId: e.localId, name: d.name, position: localPoint(d.center), quarterTurns: q, width: d.width, openTowards, ...(d.initialState ? { initialState: d.initialState === 'open' ? 'open' : 'closed' } : {}) }
      objects.push(door)
    }
    for (const w of windows.filter((x) => x.buildingId === b.id)) {
      if (!near(w.center.y, (w.sill + w.head) / 2)) throw new Error(`Window ${w.id} pane is not centred between sill and head`)
      const q = inwardQuarter(w.inward)
      if (w.alongX !== (q % 2 === 0)) throw new Error(`Window ${w.id} orientation disagrees with its inward direction`)
      const e = entity(w.id)
      ids.windows[w.id] = e.stable
      const win: WindowObject = { kind: 'window', localId: e.localId, name: w.name, position: localPoint(w.center), quarterTurns: q, width: w.width, sill: w.sill, head: w.head, thickness: w.thickness }
      objects.push(win)
    }
    const roomDocs: RoomObject[] = rooms.filter((r) => r.buildingId === b.id).map((r) => {
      const e = entity(r.id)
      ids.rooms[r.id] = e.stable
      const min = localPoint({ x: r.bounds.minX, z: r.bounds.minZ })
      const max = localPoint({ x: r.bounds.maxX, z: r.bounds.maxZ })
      const room: RoomObject = { localId: e.localId, name: r.name, bounds: { minX: min.x, minZ: min.z, maxX: max.x, maxZ: max.z } }
      if (r.lamp) {
        const l = entity(r.lamp.id)
        ids.lamps[r.lamp.id] = l.stable
        room.lamp = { localId: l.localId, name: r.lamp.name, intensity: r.lamp.intensity, color: r.lamp.color, requiresElectricity: r.lamp.requiresElectricity, switchAt: localPoint(r.lamp.switchAt), ...(r.lamp.at ? { at: localPoint(r.lamp.at) } : {}) }
      }
      return room
    })
    const prefabId = `building/${b.id}`
    prefabs.push({
      schemaVersion: MAP_SCHEMA_VERSION,
      prefabId,
      contentVersion: 1,
      name: b.name,
      pivot: { x: 0, y: 0, z: 0 },
      footprint: { minX: -b.size.w / 2, minZ: -b.size.d / 2, maxX: b.size.w / 2, maxZ: b.size.d / 2 },
      building: { height: b.height, wallThickness: b.wallThickness, wallColor: b.wallColor, roofColor: b.roofColor, floorColor: b.floorColor },
      objects,
      rooms: roomDocs,
    })
    world.prefabs.push({ prefabId, contentVersion: 1, path: `prefabs/${b.id}.json` })
    ids.buildings[b.id] = instanceId
    chunk.instances.push({ instanceId, prefabId, position: { x: local.x, y: 0, z: local.z }, quarterTurns: 0 })
  }

  for (const w of legacy.walls) {
    if (usedWalls.has(w.id)) continue
    const { chunk, local } = own(w.position)
    const objectId = `${chunk.chunkId}/objects/${standaloneName(w.id, '')}`
    ids.walls[w.id] = objectId
    const o: StandaloneObject = { kind: 'prop', objectId, position: { x: local.x, y: w.position.y, z: local.z }, size: [...w.size], color: w.color ?? '#808080' }
    chunk.objects.push(o)
  }
  for (const c of legacy.containers) {
    if (usedContainers.has(c.id)) continue
    const { chunk, local } = own(c.position)
    const objectId = `${chunk.chunkId}/objects/${standaloneName(c.id, 'ct-')}`
    ids.containers[c.id] = objectId
    chunk.objects.push({ kind: 'container', objectId, name: c.name, position: { x: local.x, y: c.position.y, z: local.z }, size: [...c.size], color: c.color, ...(c.loot ? { lootTableId: c.loot } : {}) })
  }
  for (const r of legacy.roads) {
    const { chunk, local } = own(r.position)
    const roadId = `${chunk.chunkId}/roads/${standaloneName(r.id, 'road-')}`
    ids.roads[r.id] = roadId
    chunk.roads.push({ roadId, position: local, size: [...r.size], color: r.color })
  }
  for (const z of legacy.zombieZones ?? []) {
    const { chunk, local } = own(z.center)
    const zoneId = `${chunk.chunkId}/zones/${standaloneName(z.id, 'zone-')}`
    ids.zones[z.id] = zoneId
    chunk.zones.push({ zoneId, kind: 'zombiePopulation', name: z.name, shape: 'circle', center: local, radius: z.radius })
  }
  {
    const { chunk, local } = own(legacy.playerSpawn)
    world.playerSpawn = `${chunk.chunkId}/spawns/player-start`
    chunk.spawns.push({ spawnId: world.playerSpawn, kind: 'player', position: local })
  }
  legacy.zombieSpawns.forEach((p, i) => {
    const { chunk, local } = own(p)
    chunk.spawns.push({ spawnId: `${chunk.chunkId}/spawns/zombie-${i + 1}`, kind: 'zombie', position: local })
  })

  for (const d of legacy.doors) if (!ids.doors[d.id]) throw new Error(`Door ${d.id} has no building`)
  for (const w of windows) if (!ids.windows[w.id]) throw new Error(`Window ${w.id} has no building`)
  for (const r of rooms) if (!ids.rooms[r.id]) throw new Error(`Room ${r.id} has no building`)

  const docs = { world, prefabs: new Map(prefabs.map((p) => [p.prefabId, p])), chunks }
  for (const [chunkId, refs] of computeExternalRefs(docs)) chunks.get(chunkId)!.externalRefs = refs
  return { world, prefabs, chunks: [...chunks.values()], ids }
}
