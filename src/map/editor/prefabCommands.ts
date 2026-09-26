import { MAP_SCHEMA_VERSION, type PrefabDocument, type PrefabObject, type QuarterTurns, type Rect, type RoomObject, type WallRunObject, type XZ } from '../schema.ts'
import { resolveInstance, type ResolvedRecord } from '../resolve.ts'
import { addQuarterTurns, PREFAB_ID, quantize, rotateXZ, SLUG } from '../transform.ts'
import type { CommandResult } from './commands.ts'
import { instancesOf, withExternalRefs, type AnyRecord, type MapDocument } from './document.ts'
import { presetPlacement, type RecordPreset } from './presets.ts'
import { axisEnd, DEFAULT_BUILDING, DEFAULT_ROOM, dragRect, findPrefabPreset } from './prefabPresets.ts'
import { distanceToOutline, outlineBounds, outlineCentre, outlineProblem, rectOutline } from '../polygon.ts'
import { cutOutlineCorner, outlineWallRuns, turnOutline } from './outlines.ts'

/**
 * Prefab editing commands (M5): pure functions document → document, like the world commands, so
 * they share the history (undo/redo restore prefab and world together). Items are addressed by
 * local ID (objects, rooms, lamps); the selection they return is local IDs of that prefab.
 *
 * Identity rules (docs/map-editor-m5.md):
 * - move/rotate/resize/recolour keep every local ID, so saves keep door/loot/lamp/curtain state;
 * - new items get a fresh `<base>-<n>` never used or retired in the prefab;
 * - delete and rename retire the old local ID (`retiredLocalIds`), so `<instance>/<old>` never
 *   comes back with another meaning.
 * Every instance of the prefab changes with it; external references are recomputed.
 */

const fail = (error: string): CommandResult => ({ ok: false, error })

export type PrefabItemKind = 'object' | 'room' | 'lamp'

export interface PrefabItem {
  key: string
  kind: PrefabItemKind
  /** Object kind (`wall`, `door`, …), `room` or `lamp`. */
  type: string
  /** Footprint in the prefab frame (picking, box select, selection outline). */
  bounds: Rect
  /** M11a: an L/T/U room's outline (picked near its edges or centre). */
  outline?: XZ[]
}

/** The prefab as one instance at its pivot, turned `q` quarter turns (a neutral resolved record). */
export function resolvePrefab(prefab: PrefabDocument, q: QuarterTurns): ResolvedRecord {
  const inst = { instanceId: 'prefab', prefabId: prefab.prefabId, position: { ...prefab.pivot }, quarterTurns: q }
  const r = resolveInstance(inst, prefab, { x: 0, z: 0 })
  return { id: 'prefab', category: 'instances', ownerChunkId: '', order: [0, 0, 0], bounds: r.bounds, entityIds: r.entityIds, parts: r.parts }
}

/** Lamp switches are points: picked within this radius. */
export const SWITCH_PICK = 0.35
/** Doors/windows are picked on a band this deep across their wall. */
const OPENING_DEPTH = 0.5

function rectAround(c: XZ, sx: number, sz: number): Rect {
  return { minX: quantize(c.x - sx / 2), minZ: quantize(c.z - sz / 2), maxX: quantize(c.x + sx / 2), maxZ: quantize(c.z + sz / 2) }
}

export function wallRunRect(o: WallRunObject): Rect {
  const h = o.thickness / 2
  return { minX: Math.min(o.from.x, o.to.x) - h, minZ: Math.min(o.from.z, o.to.z) - h, maxX: Math.max(o.from.x, o.to.x) + h, maxZ: Math.max(o.from.z, o.to.z) + h }
}

export function objectRect(o: PrefabObject): Rect {
  switch (o.kind) {
    case 'wallRun':
      return wallRunRect(o)
    case 'door':
    case 'window': {
      const alongX = (o.quarterTurns & 1) === 0
      const depth = o.kind === 'window' ? Math.max(o.thickness, OPENING_DEPTH) : OPENING_DEPTH
      return rectAround(o.position, alongX ? o.width : depth, alongX ? depth : o.width)
    }
    case 'tree':
      // Picked at the trunk and inner canopy (the whole canopy would cover the items under it).
      return rectAround(o.position, Math.max(2 * o.trunk, o.canopy), Math.max(2 * o.trunk, o.canopy))
    default:
      return rectAround(o.position, o.size[0], o.size[2])
  }
}

/** Every editable item of a prefab, objects first, then rooms and their lamps. */
export function prefabItems(prefab: PrefabDocument): PrefabItem[] {
  const out: PrefabItem[] = prefab.objects.map((o) => ({ key: o.localId, kind: 'object' as const, type: o.kind, bounds: objectRect(o) }))
  for (const r of prefab.rooms) {
    out.push({ key: r.localId, kind: 'room', type: 'room', bounds: { ...r.bounds }, ...(r.outline ? { outline: r.outline.map((q) => ({ ...q })) } : {}) })
    if (!r.lamp) continue
    out.push({ key: r.lamp.localId, kind: 'lamp', type: 'lamp', bounds: rectAround(r.lamp.switchAt, 2 * SWITCH_PICK, 2 * SWITCH_PICK) })
    // M7: a fixture moved off the room centre also picks its lamp (the centre picks the room).
    if (r.lamp.at) out.push({ key: r.lamp.localId, kind: 'lamp', type: 'lamp', bounds: rectAround(r.lamp.at, 2 * SWITCH_PICK, 2 * SWITCH_PICK) })
  }
  return out
}

/** Rooms fill the building, so like zones they are picked only near their outline or centre. */
const ROOM_EDGE = 0.4

/** Item under a point in the prefab frame: smallest footprint wins; rooms only at edge/centre. */
export function pickPrefabItem(items: readonly PrefabItem[], p: XZ): PrefabItem | null {
  let best: PrefabItem | null = null
  let bestArea = Infinity
  for (const it of items) {
    const b = it.bounds
    if (it.kind === 'room' && it.outline) {
      const nearEdge = distanceToOutline(it.outline, p.x, p.z) <= ROOM_EDGE
      const c = outlineCentre(it.outline)
      if (!(nearEdge || Math.hypot(p.x - c.x, p.z - c.z) <= 0.6)) continue
    } else if (it.kind === 'room') {
      const inX = p.x >= b.minX - ROOM_EDGE && p.x <= b.maxX + ROOM_EDGE
      const inZ = p.z >= b.minZ - ROOM_EDGE && p.z <= b.maxZ + ROOM_EDGE
      const nearEdge = Math.min(Math.abs(p.x - b.minX), Math.abs(p.x - b.maxX), Math.abs(p.z - b.minZ), Math.abs(p.z - b.maxZ)) <= ROOM_EDGE
      const nearCentre = Math.hypot(p.x - (b.minX + b.maxX) / 2, p.z - (b.minZ + b.maxZ) / 2) <= 0.6
      if (!(inX && inZ && (nearEdge || nearCentre))) continue
    } else if (p.x < b.minX || p.x > b.maxX || p.z < b.minZ || p.z > b.maxZ) continue
    const area = (b.maxX - b.minX) * (b.maxZ - b.minZ)
    if (area < bestArea) {
      best = it
      bestArea = area
    }
  }
  return best
}

export function itemsInRect(items: readonly PrefabItem[], r: Rect): string[] {
  const x0 = Math.min(r.minX, r.maxX)
  const x1 = Math.max(r.minX, r.maxX)
  const z0 = Math.min(r.minZ, r.maxZ)
  const z1 = Math.max(r.minZ, r.maxZ)
  return [...new Set(items.filter((it) => it.bounds.minX >= x0 && it.bounds.maxX <= x1 && it.bounds.minZ >= z0 && it.bounds.maxZ <= z1).map((it) => it.key))]
}

/** Every local ID in use (objects, rooms, lamps). */
export function usedLocalIds(prefab: PrefabDocument): Set<string> {
  const ids = new Set<string>()
  for (const o of prefab.objects) ids.add(o.localId)
  for (const r of prefab.rooms) {
    ids.add(r.localId)
    if (r.lamp) ids.add(r.lamp.localId)
  }
  return ids
}

/** First `<base>-<n>` not used, not retired, not in `taken`. */
export function freshLocalId(prefab: PrefabDocument, base: string, taken: ReadonlySet<string> = new Set()): string {
  const stem = base.replace(/-\d+$/, '') || 'item'
  const used = usedLocalIds(prefab)
  const retired = new Set(prefab.retiredLocalIds ?? [])
  for (let n = 1; ; n++) {
    const id = `${stem}-${n}`
    if (!used.has(id) && !retired.has(id) && !taken.has(id)) return id
  }
}

function retire(prefab: PrefabDocument, ids: readonly string[]): string[] | undefined {
  if (ids.length === 0) return prefab.retiredLocalIds
  return [...new Set([...(prefab.retiredLocalIds ?? []), ...ids])].sort()
}

function copyPrefab(p: PrefabDocument): PrefabDocument {
  return { ...p, objects: [...p.objects], rooms: [...p.rooms] }
}

/** Replace one prefab (and optionally the manifest), then recompute derived references. */
function withPrefab(doc: MapDocument, prefab: PrefabDocument, world = doc.world): MapDocument {
  const prefabs = new Map(doc.prefabs).set(prefab.prefabId, prefab)
  return withExternalRefs({ ...doc, world, prefabs })
}

function getPrefab(doc: MapDocument, prefabId: string): PrefabDocument | null {
  return doc.prefabs.get(prefabId) ?? null
}

// ---------------------------------------------------------------------------------------------
// Prefab documents

export interface NewPrefabOptions {
  prefabId: string
  name: string
  /** Outer size of the starter house (wall centre lines), metres. */
  width?: number
  depth?: number
  /** M11a: `L` = the north-east quarter cut away (L-shaped footprint, walls and room). */
  shape?: 'rect' | 'L'
}

function uniquePrefabPath(doc: MapDocument, prefabId: string): string {
  const base = prefabId.split('/').pop()!
  const used = new Set([...doc.world.prefabs.map((e) => e.path), ...doc.world.chunks.map((e) => e.path), ...doc.extras.keys()])
  for (let n = 1; ; n++) {
    const path = `prefabs/${n === 1 ? base : `${base}-${n}`}.json`
    if (!used.has(path)) return path
  }
}

/**
 * Starter house: footprint on the wall centre lines, four wall runs, a door in the south wall that
 * opens inward, one room with a lamp whose switch sits beside the door. Valid and playable as is.
 */
export function starterHouse(prefabId: string, name: string, width = 8, depth = 6): PrefabDocument {
  const b = DEFAULT_BUILDING
  const hx = width / 2
  const hz = depth / 2
  const run = (localId: string, from: XZ, to: XZ): WallRunObject => ({ kind: 'wallRun', localId, from, to, height: b.height, thickness: b.wallThickness, color: b.wallColor })
  return {
    schemaVersion: MAP_SCHEMA_VERSION,
    prefabId,
    contentVersion: 1,
    name,
    pivot: { x: 0, y: 0, z: 0 },
    footprint: { minX: -hx, minZ: -hz, maxX: hx, maxZ: hz },
    building: { ...b },
    objects: [
      run('wall-n', { x: -hx, z: -hz }, { x: hx, z: -hz }),
      run('wall-s', { x: -hx, z: hz }, { x: hx, z: hz }),
      run('wall-w', { x: -hx, z: -hz }, { x: -hx, z: hz }),
      run('wall-e', { x: hx, z: -hz }, { x: hx, z: hz }),
      { kind: 'door', localId: 'door', name: `Cửa ${name}`, position: { x: 0, z: hz }, quarterTurns: 2, width: 1.2, openTowards: 1 },
    ],
    rooms: [
      {
        localId: 'room-1',
        name: 'Phòng chính',
        bounds: { minX: -hx, minZ: -hz, maxX: hx, maxZ: hz },
        lamp: { localId: 'lamp-1', name: 'Đèn phòng chính', intensity: 0.8, color: '#ffd9a0', requiresElectricity: true, switchAt: { x: 1, z: quantize(hz - 0.25) } },
      },
    ],
  }
}

/**
 * M11a starter L house: the starter house with its north-east quarter cut away. The footprint
 * outline, one wall run per outline edge, the south door and one L-shaped room with its lamp.
 */
export function starterLHouse(prefabId: string, name: string, width = 10, depth = 8): PrefabDocument {
  const base = starterHouse(prefabId, name, width, depth)
  const b = DEFAULT_BUILDING
  const hx = width / 2
  const hz = depth / 2
  const outline = cutOutlineCorner(rectOutline(base.footprint), 1)!
  const walls = outlineWallRuns(outline, { height: b.height, thickness: b.wallThickness, color: b.wallColor }, (n) => `wall-${n + 1}`)
  return {
    ...base,
    outline,
    objects: [...walls, { kind: 'door', localId: 'door', name: `Cửa ${name}`, position: { x: quantize(-hx / 2), z: hz }, quarterTurns: 2, width: 1.2, openTowards: 1 }],
    rooms: [{ ...base.rooms[0], outline: outline.map((p) => ({ ...p })), lamp: { ...base.rooms[0].lamp!, switchAt: { x: quantize(-hx / 2 + 1), z: quantize(hz - 0.25) } } }],
  }
}

/** Add a new prefab to the world's library (manifest + file). */
export function createPrefab(doc: MapDocument, opts: NewPrefabOptions): CommandResult {
  if (!PREFAB_ID.test(opts.prefabId)) return fail(`prefabId "${opts.prefabId}": chữ thường, số, gạch nối, phân cách bằng /`)
  if (doc.prefabs.has(opts.prefabId)) return fail(`Prefab ${opts.prefabId} đã có`)
  if (!opts.name.trim()) return fail('Tên prefab trống')
  const w = opts.width ?? 8
  const d = opts.depth ?? 6
  if (!(w >= 2 && d >= 2)) return fail('Nhà mẫu cần ít nhất 2 × 2 m')
  const prefab = opts.shape === 'L' ? starterLHouse(opts.prefabId, opts.name.trim(), w, d) : starterHouse(opts.prefabId, opts.name.trim(), w, d)
  const world = { ...doc.world, prefabs: [...doc.world.prefabs, { prefabId: prefab.prefabId, contentVersion: 1, path: uniquePrefabPath(doc, prefab.prefabId) }] }
  return { ok: true, doc: withPrefab(doc, prefab, world), selection: [], note: `Tạo prefab ${prefab.prefabId}` }
}

/** Copy a prefab under a new ID (a variant): same content, fresh identity, no retired IDs. */
export function duplicatePrefab(doc: MapDocument, prefabId: string, newPrefabId: string, name: string): CommandResult {
  const src = getPrefab(doc, prefabId)
  if (!src) return fail(`Không có prefab ${prefabId}`)
  if (!PREFAB_ID.test(newPrefabId)) return fail(`prefabId "${newPrefabId}" không hợp lệ`)
  if (doc.prefabs.has(newPrefabId)) return fail(`Prefab ${newPrefabId} đã có`)
  const copy: PrefabDocument = { ...structuredClone(src), prefabId: newPrefabId, name: name.trim() || src.name, contentVersion: 1 }
  delete copy.retiredLocalIds
  const world = { ...doc.world, prefabs: [...doc.world.prefabs, { prefabId: newPrefabId, contentVersion: 1, path: uniquePrefabPath(doc, newPrefabId) }] }
  return { ok: true, doc: withPrefab(doc, copy, world), selection: [], note: `Nhân bản ${prefabId} → ${newPrefabId}` }
}

/** Remove a prefab that no instance uses. */
export function deletePrefab(doc: MapDocument, prefabId: string): CommandResult {
  if (!doc.prefabs.has(prefabId)) return fail(`Không có prefab ${prefabId}`)
  const used = instancesOf(doc, prefabId)
  if (used.length) return fail(`${prefabId} đang được dùng bởi ${used.length} instance — xóa chúng trước`)
  const prefabs = new Map(doc.prefabs)
  prefabs.delete(prefabId)
  const world = { ...doc.world, prefabs: doc.world.prefabs.filter((e) => e.prefabId !== prefabId) }
  return { ok: true, doc: { ...doc, world, prefabs }, selection: [], note: `Xóa prefab ${prefabId}` }
}

export interface PrefabPatch {
  name?: string
  contentVersion?: number
  pivot?: PrefabDocument['pivot']
  footprint?: Rect
  /** M11a: the footprint outline (the footprint becomes its bounding box); null = back to the rectangle. */
  outline?: XZ[] | null
  building?: Partial<NonNullable<PrefabDocument['building']>>
}

/** Prefab properties. `contentVersion` also updates the manifest pin, so they never disagree. */
export function updatePrefab(doc: MapDocument, prefabId: string, patch: PrefabPatch, selection: string[] = []): CommandResult {
  const src = getPrefab(doc, prefabId)
  if (!src) return fail(`Không có prefab ${prefabId}`)
  const next: PrefabDocument = { ...src }
  if (patch.name !== undefined) {
    if (!patch.name.trim()) return fail('Tên prefab trống')
    next.name = patch.name.trim()
  }
  if (patch.footprint) {
    const f = patch.footprint
    if (!(f.minX < f.maxX && f.minZ < f.maxZ)) return fail('Footprint: min phải nhỏ hơn max')
    if (src.outline && patch.outline === undefined) return fail('Footprint đang theo outline: sửa đỉnh/cạnh, hoặc bỏ outline')
    next.footprint = { ...f }
  }
  if (patch.outline === null) delete next.outline
  else if (patch.outline) {
    const problem = outlineProblem(patch.outline)
    if (problem) return fail(`Outline không hợp lệ: ${problem}`)
    next.outline = patch.outline.map((p) => ({ x: quantize(p.x), z: quantize(p.z) }))
    next.footprint = outlineBounds(next.outline)
  }
  if (patch.pivot) next.pivot = { ...patch.pivot }
  if (patch.building) {
    if (!src.building) return fail('Prefab không phải công trình')
    const b = { ...src.building, ...patch.building }
    if (!(b.height > 0 && b.wallThickness > 0)) return fail('Chiều cao và độ dày tường phải > 0')
    next.building = b
  }
  let world = doc.world
  if (patch.contentVersion !== undefined) {
    if (!(Number.isInteger(patch.contentVersion) && patch.contentVersion >= 1)) return fail('contentVersion phải là số nguyên ≥ 1')
    next.contentVersion = patch.contentVersion
    world = { ...world, prefabs: world.prefabs.map((e) => (e.prefabId === prefabId ? { ...e, contentVersion: patch.contentVersion! } : e)) }
  }
  return { ok: true, doc: withPrefab(doc, next, world), selection }
}

/**
 * M11a: a wall run along every footprint outline edge that has none yet (same end points, either
 * direction), with the building's height, thickness and colour. Existing walls are left alone.
 */
export function buildOutlineWalls(doc: MapDocument, prefabId: string): CommandResult {
  const p = getPrefab(doc, prefabId)
  if (!p) return fail(`Không có prefab ${prefabId}`)
  if (!p.outline || !p.building) return fail('Cần một công trình có outline')
  const same = (a: XZ, b: XZ) => a.x === b.x && a.z === b.z
  const has = (r: WallRunObject) => p.objects.some((o) => o.kind === 'wallRun' && ((same(o.from, r.from) && same(o.to, r.to)) || (same(o.from, r.to) && same(o.to, r.from))))
  const taken = new Set<string>()
  const runs = outlineWallRuns(p.outline, { height: p.building.height, thickness: p.building.wallThickness, color: p.building.wallColor }, () => '').filter((r) => !has(r))
  if (runs.length === 0) return fail('Mọi cạnh outline đã có tường')
  const next = copyPrefab(p)
  for (const r of runs) {
    const localId = freshLocalId(p, 'wall', taken)
    taken.add(localId)
    next.objects.push({ ...r, localId })
  }
  return { ok: true, doc: withPrefab(doc, next), selection: [...taken] }
}

/** Footprint = bounding box of the wall-run centre lines (else of every object). */
export function fitFootprint(doc: MapDocument, prefabId: string, selection: string[] = []): CommandResult {
  const p = getPrefab(doc, prefabId)
  if (!p) return fail(`Không có prefab ${prefabId}`)
  if (p.outline) return fail('Footprint đang theo outline (bounding box của nó)')
  const runs = p.objects.filter((o): o is WallRunObject => o.kind === 'wallRun')
  const rects = runs.length ? runs.flatMap((r) => [r.from, r.to].map((q) => ({ minX: q.x, minZ: q.z, maxX: q.x, maxZ: q.z }))) : p.objects.map(objectRect)
  if (!rects.length) return fail('Prefab chưa có object')
  const f = rects.reduce((a, b) => ({ minX: Math.min(a.minX, b.minX), minZ: Math.min(a.minZ, b.minZ), maxX: Math.max(a.maxX, b.maxX), maxZ: Math.max(a.maxZ, b.maxZ) }))
  return updatePrefab(doc, prefabId, { footprint: f }, selection)
}

// ---------------------------------------------------------------------------------------------
// Items

/** Nearest wall run whose line passes within `reach` of `p` (projection inside the run). */
export function nearestWallRun(prefab: PrefabDocument, p: XZ, reach = 1): { run: WallRunObject; at: XZ; alongX: boolean } | null {
  let best: { run: WallRunObject; at: XZ; alongX: boolean } | null = null
  let bestD = reach
  for (const o of prefab.objects) {
    if (o.kind !== 'wallRun') continue
    const alongX = o.from.z === o.to.z
    const lo = alongX ? Math.min(o.from.x, o.to.x) : Math.min(o.from.z, o.to.z)
    const hi = alongX ? Math.max(o.from.x, o.to.x) : Math.max(o.from.z, o.to.z)
    const a = alongX ? p.x : p.z
    if (a < lo || a > hi) continue
    const d = Math.abs(alongX ? p.z - o.from.z : p.x - o.from.x)
    if (d <= bestD) {
      bestD = d
      best = { run: o, at: alongX ? { x: p.x, z: o.from.z } : { x: o.from.x, z: p.z }, alongX }
    }
  }
  return best
}

/**
 * Quarter turns that put an opening on a wall with its inside (+Z of its frame) towards `inside`:
 * q = 0 → +Z, 1 → +X, 2 → −Z, 3 → −X.
 */
function facingInside(alongX: boolean, at: XZ, inside: XZ): 0 | 1 | 2 | 3 {
  if (alongX) return inside.z >= at.z ? 0 : 2
  return inside.x >= at.x ? 1 : 3
}

/**
 * Put a palette item into a prefab: pressed at `from`, released at `to` (null = click). Doors and
 * windows snap onto the nearest wall run and face the footprint centre (open inward); elsewhere
 * they take `turns`. Wall runs follow the drag's dominant axis; rooms are the dragged rectangle.
 */
export function placePrefabItem(doc: MapDocument, prefabId: string, presetId: string, from: XZ, to: XZ | null = null, turns = 0): CommandResult {
  const prefab = getPrefab(doc, prefabId)
  if (!prefab) return fail(`Không có prefab ${prefabId}`)
  const preset = findPrefabPreset(presetId)
  if (!preset) return fail(`Không có mẫu ${presetId}`)
  const b = prefab.building ?? DEFAULT_BUILDING
  const next = copyPrefab(prefab)
  const t = preset.template
  let key: string

  if (preset.group === 'rooms') {
    if (!prefab.building) return fail('Phòng cần prefab là công trình (có building)')
    const bounds = dragRect(from, to, DEFAULT_ROOM)
    key = freshLocalId(prefab, preset.name)
    const n = key.split('-').pop()
    const room: RoomObject = { localId: key, name: `${String(t.name)} ${n}`, bounds }
    if (t.lamp) {
      const lampId = freshLocalId(prefab, 'lamp', new Set([key]))
      const l = t.lamp as AnyRecord
      room.lamp = {
        localId: lampId,
        name: `Đèn ${room.name.toLowerCase()}`,
        intensity: l.intensity as number,
        color: l.color as string,
        requiresElectricity: l.requiresElectricity as boolean,
        switchAt: { x: quantize(bounds.minX + 0.4), z: quantize(bounds.minZ + 0.4) },
      }
    }
    next.rooms.push(room)
    return { ok: true, doc: withPrefab(doc, next), selection: [key] }
  }

  key = freshLocalId(prefab, preset.name)
  let object: AnyRecord
  if (t.kind === 'wallRun') {
    let end = to ? axisEnd(from, to) : from
    if (end.x === from.x && end.z === from.z) end = { x: quantize(from.x + 4), z: from.z }
    object = { kind: 'wallRun', localId: key, from: { ...from }, to: end, height: b.height, thickness: b.wallThickness, color: b.wallColor }
  } else if (t.kind === 'door' || t.kind === 'window') {
    const snapped = nearestWallRun(prefab, from)
    const centre = { x: (prefab.footprint.minX + prefab.footprint.maxX) / 2, z: (prefab.footprint.minZ + prefab.footprint.maxZ) / 2 }
    const position = snapped ? snapped.at : { ...from }
    const q = snapped ? facingInside(snapped.alongX, snapped.at, centre) : (((turns % 4) + 4) % 4 as 0 | 1 | 2 | 3)
    const { kind, name, ...rest } = structuredClone(t)
    object = { kind, localId: key, name, ...rest, position: { x: quantize(position.x), z: quantize(position.z) }, quarterTurns: q }
    if (kind === 'window') object.thickness = snapped ? snapped.run.thickness : b.wallThickness
  } else {
    const { at, fields } = presetPlacement({ drag: preset.drag, template: t } as RecordPreset, from, to)
    const { kind, ...rest } = { ...structuredClone(t), ...fields }
    object = { kind, localId: key, ...rest, position: { ...(rest.position as AnyRecord), x: at.x, z: at.z } }
  }
  next.objects.push(object as unknown as PrefabObject)
  return { ok: true, doc: withPrefab(doc, next), selection: [key] }
}

function shift(p: XZ, d: XZ): XZ {
  return { x: quantize(p.x + d.x), z: quantize(p.z + d.z) }
}

function shiftRect(r: Rect, d: XZ): Rect {
  return { minX: quantize(r.minX + d.x), minZ: quantize(r.minZ + d.z), maxX: quantize(r.maxX + d.x), maxZ: quantize(r.maxZ + d.z) }
}

function moveObject(o: PrefabObject, d: XZ): PrefabObject {
  if (o.kind === 'wallRun') return { ...o, from: shift(o.from, d), to: shift(o.to, d) }
  const moved = shift(o.position, d)
  return { ...o, position: { ...o.position, x: moved.x, z: moved.z } } as PrefabObject
}

/** Move items by a delta in the prefab frame; a moved room carries its lamp. */
export function movePrefabItems(doc: MapDocument, prefabId: string, keys: readonly string[], d: XZ): CommandResult {
  const prefab = getPrefab(doc, prefabId)
  if (!prefab) return fail(`Không có prefab ${prefabId}`)
  const want = new Set(keys)
  if (want.size === 0) return fail('Chưa chọn gì')
  const next = copyPrefab(prefab)
  next.objects = prefab.objects.map((o) => (want.has(o.localId) ? moveObject(o, d) : o))
  next.rooms = prefab.rooms.map((r) => {
    const moveRoom = want.has(r.localId)
    const moveLamp = r.lamp && (moveRoom || want.has(r.lamp.localId))
    if (!moveRoom && !moveLamp) return r
    const lamp = r.lamp && moveLamp ? { ...r.lamp, switchAt: shift(r.lamp.switchAt, d), ...(r.lamp.at ? { at: shift(r.lamp.at, d) } : {}) } : r.lamp
    return { ...r, ...(moveRoom ? { bounds: shiftRect(r.bounds, d), ...(r.outline ? { outline: r.outline.map((p) => shift(p, d)) } : {}) } : {}), ...(lamp ? { lamp } : {}) }
  })
  return { ok: true, doc: withPrefab(doc, next), selection: [...want] }
}

function turnAbout(p: XZ, c: XZ, q: number): XZ {
  const [x, z] = rotateXZ(p.x - c.x, p.z - c.z, q)
  return { x: quantize(c.x + x), z: quantize(c.z + z) }
}

/**
 * Turn items by quarter turns: doors/windows about their centre (quarterTurns), boxes swap X/Z,
 * wall runs and rooms turn about their centre. Lamps have no orientation.
 */
export function rotatePrefabItems(doc: MapDocument, prefabId: string, keys: readonly string[], turns: number): CommandResult {
  const prefab = getPrefab(doc, prefabId)
  if (!prefab) return fail(`Không có prefab ${prefabId}`)
  const want = new Set(keys)
  const odd = (turns & 1) === 1
  let count = 0
  const next = copyPrefab(prefab)
  next.objects = prefab.objects.map((o) => {
    if (!want.has(o.localId)) return o
    if (o.kind === 'door' || o.kind === 'window') {
      count++
      return { ...o, quarterTurns: addQuarterTurns(o.quarterTurns, turns) }
    }
    if (o.kind === 'wallRun') {
      const c = { x: (o.from.x + o.to.x) / 2, z: (o.from.z + o.to.z) / 2 }
      count++
      return { ...o, from: turnAbout(o.from, c, turns), to: turnAbout(o.to, c, turns) }
    }
    if (o.kind === 'tree' || !odd || o.size[0] === o.size[2]) return o
    count++
    return { ...o, size: [o.size[2], o.size[1], o.size[0]] as [number, number, number] }
  })
  next.rooms = prefab.rooms.map((r) => {
    if (want.has(r.localId) && r.outline && turns % 4 !== 0) {
      // M11a: an L room turns about its bounding box centre (any quarter turn changes it).
      const outline = turnOutline(r.outline, { x: (r.bounds.minX + r.bounds.maxX) / 2, z: (r.bounds.minZ + r.bounds.maxZ) / 2 }, turns)
      count++
      return { ...r, outline, bounds: outlineBounds(outline) }
    }
    if (!want.has(r.localId) || !odd) return r
    const cx = (r.bounds.minX + r.bounds.maxX) / 2
    const cz = (r.bounds.minZ + r.bounds.maxZ) / 2
    const hw = (r.bounds.maxX - r.bounds.minX) / 2
    const hd = (r.bounds.maxZ - r.bounds.minZ) / 2
    if (hw === hd) return r
    count++
    return { ...r, bounds: { minX: quantize(cx - hd), minZ: quantize(cz - hw), maxX: quantize(cx + hd), maxZ: quantize(cz + hw) } }
  })
  if (count === 0) return fail('Không có gì để xoay')
  return { ok: true, doc: withPrefab(doc, next), selection: [...want] }
}

/** Delete items; their local IDs (and a deleted room's lamp) are retired. */
export function deletePrefabItems(doc: MapDocument, prefabId: string, keys: readonly string[]): CommandResult {
  const prefab = getPrefab(doc, prefabId)
  if (!prefab) return fail(`Không có prefab ${prefabId}`)
  const want = new Set(keys)
  if (want.size === 0) return fail('Chưa chọn gì')
  const gone: string[] = []
  const next = copyPrefab(prefab)
  next.objects = prefab.objects.filter((o) => {
    if (!want.has(o.localId)) return true
    gone.push(o.localId)
    return false
  })
  next.rooms = []
  for (const r of prefab.rooms) {
    if (want.has(r.localId)) {
      gone.push(r.localId)
      if (r.lamp) gone.push(r.lamp.localId)
      continue
    }
    if (r.lamp && want.has(r.lamp.localId)) {
      gone.push(r.lamp.localId)
      const { lamp: _removed, ...rest } = r
      next.rooms.push(rest)
      continue
    }
    next.rooms.push(r)
  }
  if (gone.length === 0) return fail('Không tìm thấy mục đã chọn')
  next.retiredLocalIds = retire(prefab, gone)
  return { ok: true, doc: withPrefab(doc, next), selection: [] }
}

/** Copy objects and rooms `offset` away with fresh local IDs (a room copy gets its own lamp ID). */
export function duplicatePrefabItems(doc: MapDocument, prefabId: string, keys: readonly string[], offset: XZ): CommandResult {
  const prefab = getPrefab(doc, prefabId)
  if (!prefab) return fail(`Không có prefab ${prefabId}`)
  const next = copyPrefab(prefab)
  const taken = new Set<string>()
  const fresh = (base: string) => {
    const id = freshLocalId(prefab, base, taken)
    taken.add(id)
    return id
  }
  const created: string[] = []
  for (const o of prefab.objects) {
    if (!keys.includes(o.localId)) continue
    const copy = moveObject({ ...structuredClone(o), localId: fresh(o.localId) }, offset)
    next.objects.push(copy)
    created.push(copy.localId)
  }
  for (const r of prefab.rooms) {
    if (!keys.includes(r.localId)) continue
    const copy: RoomObject = { ...structuredClone(r), localId: fresh(r.localId), bounds: shiftRect(r.bounds, offset), ...(r.outline ? { outline: r.outline.map((p) => shift(p, offset)) } : {}) }
    if (copy.lamp) copy.lamp = { ...copy.lamp, localId: fresh(copy.lamp.localId), switchAt: shift(copy.lamp.switchAt, offset), ...(copy.lamp.at ? { at: shift(copy.lamp.at, offset) } : {}) }
    next.rooms.push(copy)
    created.push(copy.localId)
  }
  if (created.length === 0) return fail('Chỉ object và phòng nhân bản được')
  return { ok: true, doc: withPrefab(doc, next), selection: created }
}

/**
 * Change one item's fields (inspector). `localId` in the patch renames it: the old ID is retired
 * (a save's state for `<instance>/<old>` is not carried over). Rooms: `lamp: null` removes the lamp
 * (retired), `lamp: {}` adds one with a fresh ID and default values.
 */
export function updatePrefabItem(doc: MapDocument, prefabId: string, key: string, patch: AnyRecord): CommandResult {
  const prefab = getPrefab(doc, prefabId)
  if (!prefab) return fail(`Không có prefab ${prefabId}`)
  const next = copyPrefab(prefab)
  const rename = typeof patch.localId === 'string' && patch.localId !== key ? (patch.localId as string) : null
  if (rename) {
    if (!SLUG.test(rename)) return fail(`"${rename}": chữ thường, số, gạch nối`)
    if (usedLocalIds(prefab).has(rename)) return fail(`Local ID ${rename} đã được dùng`)
    if ((prefab.retiredLocalIds ?? []).includes(rename)) return fail(`Local ID ${rename} đã bị xóa trước đây, không dùng lại được`)
  }
  const apply = <T extends AnyRecord>(item: T): T => {
    const out: AnyRecord = { ...item }
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'lamp') continue
      if (v === undefined) delete out[k]
      else out[k] = v
    }
    return out as T
  }
  const retired: string[] = rename ? [key] : []
  let found = false
  let problem: string | null = null
  next.objects = prefab.objects.map((o) => {
    if (o.localId !== key) return o
    found = true
    return apply(o as unknown as AnyRecord) as unknown as PrefabObject
  })
  next.rooms = prefab.rooms.map((r) => {
    if (r.localId === key) {
      found = true
      if (r.outline && patch.bounds !== undefined && !('outline' in patch)) {
        problem = 'Phòng đa giác: sửa bằng đỉnh/cạnh, hoặc bỏ outline'
        return r
      }
      let room = apply(r as unknown as AnyRecord) as unknown as RoomObject
      if (room.outline) {
        // M11a: the rectangle always follows the outline (its bounding box).
        const bad = outlineProblem(room.outline)
        if (bad) {
          problem = `Outline không hợp lệ: ${bad}`
          return r
        }
        room = { ...room, outline: room.outline.map((p) => ({ x: quantize(p.x), z: quantize(p.z) })), bounds: outlineBounds(room.outline) }
      }
      if (patch.lamp === null && r.lamp) {
        retired.push(r.lamp.localId)
        const { lamp: _removed, ...rest } = room
        room = rest
      } else if (patch.lamp && !r.lamp) {
        const b = room.bounds
        room = {
          ...room,
          lamp: { localId: freshLocalId(prefab, 'lamp', new Set(rename ? [rename] : [])), name: `Đèn ${room.name.toLowerCase()}`, intensity: 0.8, color: '#ffd9a0', requiresElectricity: true, switchAt: { x: quantize(b.minX + 0.4), z: quantize(b.minZ + 0.4) } },
        }
      }
      return room
    }
    if (r.lamp?.localId === key) {
      found = true
      return { ...r, lamp: apply(r.lamp as unknown as AnyRecord) as unknown as NonNullable<RoomObject['lamp']> }
    }
    return r
  })
  if (!found) return fail(`Không tìm thấy ${key} trong ${prefabId}`)
  if (problem) return fail(problem)
  next.retiredLocalIds = retire(prefab, retired)
  if (next.retiredLocalIds === undefined) delete next.retiredLocalIds
  return { ok: true, doc: withPrefab(doc, next), selection: [rename ?? key] }
}

/** Stateful kinds: their `<instance>/<localId>` is kept in saves (doors, containers, windows, lamps). */
export function isStatefulItem(prefab: PrefabDocument, key: string): boolean {
  const o = prefab.objects.find((x) => x.localId === key)
  if (o) return o.kind === 'door' || o.kind === 'container' || o.kind === 'window'
  return prefab.rooms.some((r) => r.lamp?.localId === key || (r.localId === key && !!r.lamp))
}
