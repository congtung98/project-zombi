import type { Vec3 } from '../types/index.ts'
import {
  DOOR_HEIGHT,
  type BuildingInfo,
  type ContainerDef,
  type DoorPlacement,
  type RoomPlacement,
  type WallDef,
  type WindowPlacement,
} from '../game/world/buildings.ts'
import type { MapData, RoadDef, ZoneDef } from '../game/world/mapData.ts'
import { trunkWall, type TreeDef } from '../game/world/trees.ts'
import {
  RECORD_CATEGORIES,
  recordId,
  type BoxFields,
  type ChunkDocument,
  type InstanceRecord,
  type PrefabDocument,
  type PrefabObject,
  type RecordCategory,
  type Rect,
  type StandaloneObject,
  type TreeObject,
  type WallRunObject,
  type WindowObject,
  type WorldDocument,
  type XZ,
} from './schema.ts'
import { addQuarterTurns, chunkOrigin, playAreaRect, quantize, quarterAngle, rotateRect, rotateSize, rotateXZ, unionRect } from './transform.ts'

/**
 * Resolver: content documents → neutral descriptors in world space (the `MapData` pieces every
 * system already consumes). Pure and deterministic; the input must have passed `validate.ts`.
 */

export interface MapParts {
  buildings: BuildingInfo[]
  walls: WallDef[]
  doors: DoorPlacement[]
  windows: WindowPlacement[]
  containers: ContainerDef[]
  rooms: RoomPlacement[]
  roads: RoadDef[]
  zones: ZoneDef[]
  zombieSpawns: Vec3[]
  playerSpawns: { id: string; position: Vec3 }[]
  /** M9: trees (drawn); their trunks are also in `walls`. */
  trees: TreeDef[]
}

export interface ResolvedRecord {
  id: string
  category: RecordCategory
  ownerChunkId: string
  /** Manifest chunk index, category rank, index in the chunk list: load order never matters. */
  order: [number, number, number]
  /** World AABB after rotation (ownership references, streaming). */
  bounds: Rect
  /** Stable IDs this record creates (the record itself first). */
  entityIds: string[]
  parts: Partial<MapParts>
}

export type PrefabLookup = (prefabId: string) => PrefabDocument

/** Lamp fixture sits just under the ceiling. */
const LAMP_DROP = 0.08

function boxRect(position: XZ, size: readonly number[]): Rect {
  const hx = size[0] / 2
  const hz = size[size.length - 1] / 2
  return { minX: position.x - hx, minZ: position.z - hz, maxX: position.x + hx, maxZ: position.z + hz }
}

function emptyParts(): MapParts {
  return { buildings: [], walls: [], doors: [], windows: [], containers: [], rooms: [], roads: [], zones: [], zombieSpawns: [], playerSpawns: [], trees: [] }
}

/** An opening (door or window) cut into a wall run, as an interval along the run. */
export interface WallRunOpening {
  localId: string
  kind: 'door' | 'window'
  lo: number
  hi: number
}

/**
 * Boxes of a wall run in the prefab's own frame (M5): solid pieces between openings, a lintel
 * above each door (from `DOOR_HEIGHT`) and a sill + header around each window. A door/window is an
 * opening of the run when it has the run's axis and its centre lies on the run (within half the
 * thickness across, inside the run along it).
 */
export function wallRunBoxes(run: WallRunObject, objects: readonly PrefabObject[]): { boxes: (BoxFields & { part: string })[]; openings: WallRunOpening[] } {
  const t = run.thickness
  const H = run.height
  const alongX = run.from.z === run.to.z
  const along = (p: XZ) => (alongX ? p.x : p.z)
  const across = (p: XZ) => (alongX ? p.z : p.x)
  const line = across(run.from)
  const a0 = Math.min(along(run.from), along(run.to)) - t / 2
  const a1 = Math.max(along(run.from), along(run.to)) + t / 2
  const openings: WallRunOpening[] = []
  for (const o of objects) {
    if (o.kind !== 'door' && o.kind !== 'window') continue
    if (((o.quarterTurns & 1) === 0) !== alongX) continue
    const c = along(o.position)
    if (Math.abs(across(o.position) - line) > t / 2 + 1e-6 || c < a0 || c > a1) continue
    const lo = Math.max(a0, c - o.width / 2)
    const hi = Math.min(a1, c + o.width / 2)
    if (hi > lo) openings.push({ localId: o.localId, kind: o.kind, lo, hi })
  }
  openings.sort((a, b) => a.lo - b.lo || a.hi - b.hi)
  const boxes: (BoxFields & { part: string })[] = []
  const piece = (part: string, s: number, e: number, y0: number, y1: number) => {
    if (e - s <= 1e-6 || y1 - y0 <= 1e-6) return
    const m = quantize((s + e) / 2)
    const len = quantize(e - s)
    boxes.push({
      part,
      position: alongX ? { x: m, y: quantize((y0 + y1) / 2), z: line } : { x: line, y: quantize((y0 + y1) / 2), z: m },
      size: alongX ? [len, quantize(y1 - y0), t] : [t, quantize(y1 - y0), len],
      color: run.color,
    })
  }
  let cursor = a0
  let n = 0
  for (const o of openings) {
    if (o.lo > cursor) piece(`${n++}`, cursor, o.lo, 0, H)
    cursor = Math.max(cursor, o.hi)
    if (o.kind === 'door') piece(`${o.localId}-lintel`, o.lo, o.hi, DOOR_HEIGHT, H)
    else {
      const w = objects.find((x) => x.localId === o.localId) as WindowObject
      piece(`${o.localId}-sill`, o.lo, o.hi, 0, Math.min(w.sill, H))
      piece(`${o.localId}-header`, o.lo, o.hi, w.head, H)
    }
  }
  if (a1 > cursor) piece(`${n}`, cursor, a1, 0, H)
  return { boxes, openings }
}

/** Place one prefab instance: every object, room and lamp gets `<instanceId>/<localId>`. */
export function resolveInstance(inst: InstanceRecord, prefab: PrefabDocument, origin: XZ): { parts: MapParts; bounds: Rect; entityIds: string[] } {
  const q = inst.quarterTurns
  const base = { x: origin.x + inst.position.x, y: inst.position.y, z: origin.z + inst.position.z }
  const point = (p: XZ): XZ => {
    const [rx, rz] = rotateXZ(p.x - prefab.pivot.x, p.z - prefab.pivot.z, q)
    return { x: quantize(base.x + rx), z: quantize(base.z + rz) }
  }
  const height = (y: number) => quantize(base.y + y - prefab.pivot.y)
  const rect = (r: Rect): Rect => {
    const local = rotateRect({ minX: r.minX - prefab.pivot.x, minZ: r.minZ - prefab.pivot.z, maxX: r.maxX - prefab.pivot.x, maxZ: r.maxZ - prefab.pivot.z }, q)
    return { minX: quantize(base.x + local.minX), minZ: quantize(base.z + local.minZ), maxX: quantize(base.x + local.maxX), maxZ: quantize(base.z + local.maxZ) }
  }
  const id = (localId: string) => `${inst.instanceId}/${localId}`
  const box = (o: BoxFields) => {
    const p = point(o.position)
    return { position: { x: p.x, y: height(o.position.y), z: p.z }, size: rotateSize(o.size, q) }
  }

  const parts = emptyParts()
  const footprint = rect(prefab.footprint)
  let bounds: Rect = footprint
  const entityIds = [inst.instanceId]
  const b = prefab.building
  if (b) {
    parts.buildings.push({
      id: inst.instanceId,
      name: prefab.name,
      center: { x: quantize((footprint.minX + footprint.maxX) / 2), z: quantize((footprint.minZ + footprint.maxZ) / 2) },
      size: { w: quantize(footprint.maxX - footprint.minX), d: quantize(footprint.maxZ - footprint.minZ) },
      height: b.height,
      wallThickness: b.wallThickness,
      wallColor: b.wallColor,
      roofColor: b.roofColor,
      floorColor: b.floorColor,
    })
  }

  for (const o of prefab.objects) {
    entityIds.push(id(o.localId))
    switch (o.kind) {
      case 'wallRun': {
        // Pieces are derived (no saved state): IDs `<entity>#<part>` never collide with slugs.
        for (const b of wallRunBoxes(o, prefab.objects).boxes) {
          const placed = box(b)
          parts.walls.push({ id: `${id(o.localId)}#${b.part}`, ...placed, color: b.color })
          bounds = unionRect(bounds, boxRect(placed.position, placed.size))
        }
        break
      }
      case 'wall':
      case 'prop': {
        const placed = box(o)
        parts.walls.push({ id: id(o.localId), ...placed, color: o.color })
        bounds = unionRect(bounds, boxRect(placed.position, placed.size))
        break
      }
      case 'tree': {
        const t = placeTree(id(o.localId), o, point(o.position))
        parts.trees.push(t.tree)
        parts.walls.push(t.trunk)
        bounds = unionRect(bounds, t.bounds)
        break
      }
      case 'container': {
        const placed = box(o)
        parts.containers.push({ id: id(o.localId), name: o.name, ...placed, color: o.color, ...(o.lootTableId ? { loot: o.lootTableId } : {}) })
        bounds = unionRect(bounds, boxRect(placed.position, placed.size))
        break
      }
      case 'door': {
        const total = addQuarterTurns(q, o.quarterTurns)
        const c = point(o.position)
        const [hx, hz] = rotateXZ(-o.width / 2, 0, o.quarterTurns)
        const hinge = point({ x: o.position.x + hx, z: o.position.z + hz })
        const y = height(0)
        parts.doors.push({
          id: id(o.localId),
          name: o.name,
          buildingId: inst.instanceId,
          width: o.width,
          height: DOOR_HEIGHT,
          center: { x: c.x, y, z: c.z },
          hinge: { x: hinge.x, y, z: hinge.z },
          closedAngle: quarterAngle(total),
          openAngle: quarterAngle(total + (o.openTowards > 0 ? -1 : 1)),
          ...(o.initialState ? { initialState: o.initialState } : {}),
        })
        bounds = unionRect(bounds, boxRect(c, [o.width * 2, o.width * 2]))
        break
      }
      case 'window': {
        const total = addQuarterTurns(q, o.quarterTurns)
        const c = point(o.position)
        const alongX = (total & 1) === 0
        const [ix, iz] = rotateXZ(0, 1, total)
        parts.windows.push({
          id: id(o.localId),
          name: o.name,
          buildingId: inst.instanceId,
          center: { x: c.x, y: height((o.sill + o.head) / 2), z: c.z },
          width: o.width,
          sill: o.sill,
          head: o.head,
          alongX,
          thickness: o.thickness,
          inward: { x: ix, z: iz },
        })
        bounds = unionRect(bounds, boxRect(c, alongX ? [o.width, o.thickness] : [o.thickness, o.width]))
        break
      }
    }
  }

  for (const r of prefab.rooms) {
    entityIds.push(id(r.localId))
    const rb = rect(r.bounds)
    const ceiling = b?.height ?? 0
    let lamp: RoomPlacement['lamp'] = null
    if (r.lamp) {
      entityIds.push(id(r.lamp.localId))
      const at = r.lamp.at ? point(r.lamp.at) : undefined
      lamp = {
        id: id(r.lamp.localId),
        name: r.lamp.name,
        intensity: r.lamp.intensity,
        color: r.lamp.color,
        requiresElectricity: r.lamp.requiresElectricity,
        switchAt: point(r.lamp.switchAt),
        ...(at ? { at } : {}),
        roomId: id(r.localId),
        position: {
          x: at?.x ?? quantize((rb.minX + rb.maxX) / 2),
          y: height(ceiling - LAMP_DROP),
          z: at?.z ?? quantize((rb.minZ + rb.maxZ) / 2),
        },
      }
    }
    parts.rooms.push({ id: id(r.localId), name: r.name, buildingId: inst.instanceId, bounds: rb, height: ceiling, lamp })
    bounds = unionRect(bounds, rb)
  }
  return { parts, bounds, entityIds }
}

/** A tree at a world point: the drawn tree, its trunk wall and the canopy square as bounds. */
function placeTree(id: string, o: Omit<TreeObject, 'localId'>, at: XZ): { tree: TreeDef; trunk: WallDef; bounds: Rect } {
  const tree: TreeDef = { id, position: { x: at.x, z: at.z }, height: o.height, canopy: o.canopy, trunk: o.trunk, color: o.color, style: o.style }
  return { tree, trunk: trunkWall(tree), bounds: boxRect(at, [2 * o.canopy, 2 * o.canopy]) }
}

function resolveStandalone(o: StandaloneObject, origin: XZ): { parts: Partial<MapParts>; bounds: Rect } {
  if (o.kind === 'tree') {
    const t = placeTree(o.objectId, o, { x: quantize(origin.x + o.position.x), z: quantize(origin.z + o.position.z) })
    return { parts: { trees: [t.tree], walls: [t.trunk] }, bounds: t.bounds }
  }
  const position = { x: quantize(origin.x + o.position.x), y: o.position.y, z: quantize(origin.z + o.position.z) }
  const bounds = boxRect(position, o.size)
  if (o.kind === 'container') {
    return { parts: { containers: [{ id: o.objectId, name: o.name, position, size: [...o.size], color: o.color, ...(o.lootTableId ? { loot: o.lootTableId } : {}) }] }, bounds }
  }
  return { parts: { walls: [{ id: o.objectId, position, size: [...o.size], color: o.color }] }, bounds }
}

/** Resolve one record of a chunk (the unit the chunk lifecycle adds and removes). */
export function resolveRecord(world: WorldDocument, chunk: ChunkDocument, category: RecordCategory, index: number, prefabs: PrefabLookup): ResolvedRecord {
  const chunkRank = world.chunks.findIndex((c) => c.chunkId === chunk.chunkId)
  const origin = chunkOrigin(chunk.cx, chunk.cz, world.chunkSize)
  const at = (p: XZ): XZ => ({ x: quantize(origin.x + p.x), z: quantize(origin.z + p.z) })
  const record = chunk[category][index]
  const id = recordId(category, record)
  const order: [number, number, number] = [chunkRank, RECORD_CATEGORIES.indexOf(category), index]
  const base = { id, category, ownerChunkId: chunk.chunkId, order }
  switch (category) {
    case 'instances': {
      const inst = record as InstanceRecord
      const r = resolveInstance(inst, prefabs(inst.prefabId), origin)
      return { ...base, bounds: r.bounds, entityIds: r.entityIds, parts: r.parts }
    }
    case 'objects': {
      const r = resolveStandalone(record as StandaloneObject, origin)
      return { ...base, bounds: r.bounds, entityIds: [id], parts: r.parts }
    }
    case 'roads': {
      const road = chunk.roads[index]
      const p = at(road.position)
      return { ...base, bounds: boxRect(p, road.size), entityIds: [id], parts: { roads: [{ id, position: p, size: [...road.size], color: road.color, ...(road.layer ? { layer: road.layer } : {}) }] } }
    }
    case 'zones': {
      const z = chunk.zones[index]
      const c = at(z.center)
      const center = { x: c.x, y: 0, z: c.z }
      if (z.shape === 'rect') {
        const halfSize = { x: z.size[0] / 2, z: z.size[1] / 2 }
        const zone = { id, name: z.name, center, radius: quantize(Math.hypot(halfSize.x, halfSize.z)), halfSize }
        return { ...base, bounds: boxRect(c, z.size), entityIds: [id], parts: { zones: [zone] } }
      }
      const bounds = { minX: c.x - z.radius, minZ: c.z - z.radius, maxX: c.x + z.radius, maxZ: c.z + z.radius }
      return { ...base, bounds, entityIds: [id], parts: { zones: [{ id, name: z.name, center, radius: z.radius }] } }
    }
    case 'spawns': {
      const s = chunk.spawns[index]
      const p = at(s.position)
      const position = { x: p.x, y: 0, z: p.z }
      const parts: Partial<MapParts> = s.kind === 'player' ? { playerSpawns: [{ id, position }] } : { zombieSpawns: [position] }
      return { ...base, bounds: { minX: p.x, minZ: p.z, maxX: p.x, maxZ: p.z }, entityIds: [id], parts }
    }
  }
}

/** Every record of a chunk, in document order. */
export function resolveChunk(world: WorldDocument, chunk: ChunkDocument, prefabs: PrefabLookup): ResolvedRecord[] {
  const out: ResolvedRecord[] = []
  for (const category of RECORD_CATEGORIES) {
    for (let i = 0; i < chunk[category].length; i++) out.push(resolveRecord(world, chunk, category, i, prefabs))
  }
  return out
}

export function compareRecords(a: ResolvedRecord, b: ResolvedRecord): number {
  return a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.order[2] - b.order[2]
}

/** Fence around the play area (world-level, not owned by a chunk). */
export function boundaryWalls(world: WorldDocument): WallDef[] {
  if (!world.boundary) return []
  const r = playAreaRect(world.playArea)
  const cx = (r.minX + r.maxX) / 2
  const cz = (r.minZ + r.maxZ) / 2
  const { height: h, thickness: t } = world.boundary
  const alongX = r.maxX - r.minX + 2 * t
  const alongZ = r.maxZ - r.minZ + 2 * t
  return [
    { id: 'world/boundary-n', position: { x: cx, y: h / 2, z: r.minZ - t / 2 }, size: [alongX, h, t] },
    { id: 'world/boundary-s', position: { x: cx, y: h / 2, z: r.maxZ + t / 2 }, size: [alongX, h, t] },
    { id: 'world/boundary-w', position: { x: r.minX - t / 2, y: h / 2, z: cz }, size: [t, h, alongZ] },
    { id: 'world/boundary-e', position: { x: r.maxX + t / 2, y: h / 2, z: cz }, size: [t, h, alongZ] },
  ]
}

/**
 * Build the runtime `MapData` from resolved records (any load order; sorted here). The player
 * spawn named by the manifest must be among them.
 */
export function assembleMapData(world: WorldDocument, records: Iterable<ResolvedRecord>): MapData {
  const sorted = [...records].sort(compareRecords)
  const all = emptyParts()
  for (const r of sorted) {
    for (const key of Object.keys(r.parts) as (keyof MapParts)[]) {
      const list = r.parts[key] as unknown[]
      ;(all[key] as unknown[]).push(...list)
    }
  }
  const spawn = all.playerSpawns.find((s) => s.id === world.playerSpawn)
  if (!spawn) throw new Error(`Player spawn ${world.playerSpawn} is not loaded`)
  const maxActive = world.gameplay?.maxActiveZombies
  return {
    id: world.worldId,
    contentVersion: world.contentVersion,
    chunkSize: world.chunkSize,
    size: world.playArea.size,
    ...(world.playArea.depth !== undefined ? { depth: world.playArea.depth } : {}),
    ...(world.playArea.center ? { center: { ...world.playArea.center } } : {}),
    playerSpawn: { ...spawn.position },
    zombieSpawns: all.zombieSpawns,
    zombieZones: all.zones,
    buildings: all.buildings,
    walls: [...boundaryWalls(world), ...all.walls],
    doors: all.doors,
    containers: all.containers,
    roads: all.roads,
    windows: all.windows,
    rooms: all.rooms,
    ...(all.trees.length ? { trees: all.trees } : {}),
    ...(maxActive !== undefined ? { maxActiveZombies: maxActive } : {}),
  }
}
