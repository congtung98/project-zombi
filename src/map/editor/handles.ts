import type { PrefabDocument, Rect, XZ } from '../schema.ts'
import { quantize } from '../transform.ts'
import { TREE_LIMITS } from '../../game/world/trees.ts'
import { moveRecords, updateRecord, type CommandResult } from './commands.ts'
import { findRecord, worldAnchor, type AnyRecord, type MapDocument } from './document.ts'
import { updatePrefab, updatePrefabItem } from './prefabCommands.ts'
import { dragOutlineEdge, dragOutlineVertex, outlineHandles, parseOutlineHandle, type OutlineHandleKey } from './outlines.ts'
import { outlineCentre } from '../polygon.ts'

/**
 * Resize handles (M7). Pure: the handles of the one selected record or prefab item, and the
 * command a handle drag commits (one history entry, IDs unchanged, so saves keep their state).
 *
 * - boxes (walls, props, containers), surfaces, rectangle zones and rooms: 4 edges + 4 corners;
 *   the opposite edge stays put and the size never drops below the kind's minimum (no flipping);
 * - circle zones: one radius handle east of the centre;
 * - wall runs (prefab): both ends, sliding along the run's axis;
 * - lamps (prefab): the ceiling fixture (`lamp.at`, default the room centre);
 * - M11a outlines (L/T/U rooms, the footprint `FOOTPRINT_KEY` when nothing is selected): every
 *   vertex (`v<i>`) and edge middle (`e<i>`), see `outlines.ts`.
 *
 * North is −Z: `n` is the `minZ` edge, `w` the `minX` edge. World handles are in world metres,
 * prefab handles in the prefab frame; the caller snaps the pointer before calling.
 */

export type HandleKey = 'n' | 's' | 'w' | 'e' | 'nw' | 'ne' | 'sw' | 'se' | 'radius' | 'from' | 'to' | 'fixture' | OutlineHandleKey

/** Pseudo item of the prefab footprint outline (M11a): its handles show when nothing is selected. */
export const FOOTPRINT_KEY = '@footprint'

export interface Handle {
  key: HandleKey
  at: XZ
}

const EDGE_KEYS = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'] as const

/** Smallest size a handle drag leaves (m). */
export const MIN_SIZE = { box: 0.1, surface: 0.5, zone: 1, room: 1, radius: 0.5, run: 0.5 } as const

const fail = (error: string): CommandResult => ({ ok: false, error })

function rectHandles(r: Rect): Handle[] {
  const cx = (r.minX + r.maxX) / 2
  const cz = (r.minZ + r.maxZ) / 2
  const at: Record<(typeof EDGE_KEYS)[number], XZ> = {
    n: { x: cx, z: r.minZ },
    s: { x: cx, z: r.maxZ },
    w: { x: r.minX, z: cz },
    e: { x: r.maxX, z: cz },
    nw: { x: r.minX, z: r.minZ },
    ne: { x: r.maxX, z: r.minZ },
    sw: { x: r.minX, z: r.maxZ },
    se: { x: r.maxX, z: r.maxZ },
  }
  return EDGE_KEYS.map((key) => ({ key, at: at[key] }))
}

/** The rectangle after dragging edge/corner `key` to `p`; the opposite side stays, `min` is kept. */
export function dragEdge(r: Rect, key: HandleKey, p: XZ, min: number): Rect {
  const out = { ...r }
  if (key.includes('w')) out.minX = Math.min(p.x, r.maxX - min)
  if (key.includes('e')) out.maxX = Math.max(p.x, r.minX + min)
  if (key.includes('n')) out.minZ = Math.min(p.z, r.maxZ - min)
  if (key.includes('s')) out.maxZ = Math.max(p.z, r.minZ + min)
  return { minX: quantize(out.minX), minZ: quantize(out.minZ), maxX: quantize(out.maxX), maxZ: quantize(out.maxZ) }
}

function centred(c: XZ, w: number, d: number): Rect {
  return { minX: c.x - w / 2, minZ: c.z - d / 2, maxX: c.x + w / 2, maxZ: c.z + d / 2 }
}

/** Width/depth indices of a record's `size`: boxes are [X, Y, Z], surfaces and zones [X, Z]. */
function planSize(size: number[]): [number, number] {
  return size.length === 3 ? [size[0], size[2]] : [size[0], size[1]]
}

function withPlanSize(size: number[], w: number, d: number): number[] {
  return size.length === 3 ? [quantize(w), size[1], quantize(d)] : [quantize(w), quantize(d)]
}

function recordMin(category: string, r: AnyRecord): number {
  if (category === 'objects') return MIN_SIZE.box
  if (category === 'roads') return MIN_SIZE.surface
  return r.shape === 'circle' ? MIN_SIZE.radius : MIN_SIZE.zone
}

/** Handles of one world record (none for instances and spawns). */
export function recordHandles(doc: MapDocument, id: string): Handle[] {
  const loc = findRecord(doc, id)
  if (!loc || loc.category === 'instances' || loc.category === 'spawns') return []
  const c = worldAnchor(doc, loc)
  const r = loc.record
  if (loc.category === 'zones' && r.shape === 'circle') return [{ key: 'radius', at: { x: quantize(c.x + (r.radius as number)), z: c.z } }]
  if (r.kind === 'tree') return [{ key: 'radius', at: { x: quantize(c.x + (r.canopy as number)), z: c.z } }]
  const [w, d] = planSize(r.size as number[])
  return rectHandles(centred(c, w, d))
}

/** Commit a handle drag on a world record: new size, and a move of the centre (re-homed across chunks if needed). */
export function dragRecordHandle(doc: MapDocument, id: string, key: HandleKey, p: XZ): CommandResult {
  const loc = findRecord(doc, id)
  if (!loc) return fail(`Không tìm thấy ${id}`)
  const r = loc.record
  const c = worldAnchor(doc, loc)
  const min = recordMin(loc.category, r)
  if (key === 'radius' && r.kind === 'tree') return updateRecord(doc, id, { canopy: treeCanopy(r as { trunk: number }, c, p) })
  if (key === 'radius') {
    if (loc.category !== 'zones' || r.shape !== 'circle') return fail('Chỉ zone tròn và cây có tay cầm bán kính')
    const radius = quantize(Math.max(min, Math.hypot(p.x - c.x, p.z - c.z)))
    return updateRecord(doc, id, { radius })
  }
  if (!Array.isArray(r.size) || loc.category === 'instances' || loc.category === 'spawns') return fail(`${id} không đổi kích thước bằng tay cầm được`)
  const size = r.size as number[]
  const [w, d] = planSize(size)
  const next = dragEdge(centred(c, w, d), key, p, min)
  const resized = updateRecord(doc, id, { size: withPlanSize(size, next.maxX - next.minX, next.maxZ - next.minZ) })
  if (!resized.ok) return resized
  const delta = { x: quantize((next.minX + next.maxX) / 2 - c.x), z: quantize((next.minZ + next.maxZ) / 2 - c.z) }
  if (delta.x === 0 && delta.z === 0) return resized
  return moveRecords(resized.doc, [id], delta)
}

/** Handles of one prefab item, in the prefab frame (boxes, wall runs, rooms, lamp fixtures). */
export function prefabItemHandles(prefab: PrefabDocument, key: string): Handle[] {
  if (key === FOOTPRINT_KEY) return prefab.outline ? outlineHandles(prefab.outline) : []
  const o = prefab.objects.find((x) => x.localId === key)
  if (o) {
    if (o.kind === 'wallRun') return [{ key: 'from', at: { ...o.from } }, { key: 'to', at: { ...o.to } }]
    if (o.kind === 'door' || o.kind === 'window' || o.kind === 'stairs') return []
    if (o.kind === 'tree') return [{ key: 'radius', at: { x: quantize(o.position.x + o.canopy), z: o.position.z } }]
    return rectHandles(centred(o.position, o.size[0], o.size[2]))
  }
  const room = prefab.rooms.find((r) => r.localId === key)
  if (room) return room.outline ? outlineHandles(room.outline) : rectHandles(room.bounds)
  const lampRoom = prefab.rooms.find((r) => r.lamp?.localId === key)
  if (lampRoom?.lamp) return [{ key: 'fixture', at: lampRoom.lamp.at ?? roomCentre(lampRoom.bounds, lampRoom.outline) }]
  return []
}

/** Default lamp position: the room centre (M11a: of the biggest part of an L room, like the resolver). */
function roomCentre(b: Rect, outline?: readonly XZ[]): XZ {
  const c = outline ? outlineCentre(outline) : { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 }
  return { x: quantize(c.x), z: quantize(c.z) }
}

/** New outline after dragging handle `key` to `p`, or an error. */
function dragOutline(outline: readonly XZ[], key: HandleKey, p: XZ): XZ[] | string {
  const h = parseOutlineHandle(key)
  if (!h) return 'Hình đa giác chỉ có tay cầm đỉnh và cạnh'
  const next = h.kind === 'v' ? dragOutlineVertex(outline, h.index, p) : dragOutlineEdge(outline, h.index, p)
  return next ?? 'Các cạnh sẽ cắt nhau hoặc chồng lên nhau'
}

/** Commit a handle drag on a prefab item (one `updatePrefabItem`, local ID unchanged). */
export function dragPrefabHandle(doc: MapDocument, prefabId: string, key: string, handle: HandleKey, p: XZ): CommandResult {
  const prefab = doc.prefabs.get(prefabId)
  if (!prefab) return fail(`Không có prefab ${prefabId}`)
  if (key === FOOTPRINT_KEY) {
    if (!prefab.outline) return fail('Footprint chưa có outline')
    const outline = dragOutline(prefab.outline, handle, p)
    return typeof outline === 'string' ? fail(outline) : updatePrefab(doc, prefabId, { outline })
  }
  const o = prefab.objects.find((x) => x.localId === key)
  if (o?.kind === 'wallRun') {
    if (handle !== 'from' && handle !== 'to') return fail('Tường chạy chỉ có tay cầm hai đầu')
    const alongX = o.from.z === o.to.z
    const other = handle === 'from' ? o.to : o.from
    // Slide along the run's axis; never shorter than the minimum or past the other end.
    const want = alongX ? p.x : p.z
    const fixed = alongX ? other.x : other.z
    const mine = alongX ? o[handle].x : o[handle].z
    const side = Math.sign(mine - fixed) || 1
    const v = quantize(side > 0 ? Math.max(want, fixed + MIN_SIZE.run) : Math.min(want, fixed - MIN_SIZE.run))
    const end = alongX ? { x: v, z: o[handle].z } : { x: o[handle].x, z: v }
    return updatePrefabItem(doc, prefabId, key, { [handle]: end })
  }
  if (o) {
    if (o.kind === 'door' || o.kind === 'window') return fail('Cửa/cửa sổ đổi bề rộng ở Inspector')
    if (o.kind === 'stairs') return fail('Cầu thang đổi kích thước ở Inspector')
    if (o.kind === 'tree') return updatePrefabItem(doc, prefabId, key, { canopy: treeCanopy(o, o.position, p) })
    const next = dragEdge(centred(o.position, o.size[0], o.size[2]), handle, p, MIN_SIZE.box)
    const position = { ...o.position, x: quantize((next.minX + next.maxX) / 2), z: quantize((next.minZ + next.maxZ) / 2) }
    return updatePrefabItem(doc, prefabId, key, { position, size: [quantize(next.maxX - next.minX), o.size[1], quantize(next.maxZ - next.minZ)] })
  }
  const room = prefab.rooms.find((r) => r.localId === key)
  if (room?.outline) {
    const outline = dragOutline(room.outline, handle, p)
    return typeof outline === 'string' ? fail(outline) : updatePrefabItem(doc, prefabId, key, { outline })
  }
  if (room) return updatePrefabItem(doc, prefabId, key, { bounds: dragEdge(room.bounds, handle, p, MIN_SIZE.room) })
  const lampRoom = prefab.rooms.find((r) => r.lamp?.localId === key)
  if (lampRoom?.lamp) {
    if (handle !== 'fixture') return fail('Đèn chỉ có tay cầm vị trí')
    const b = lampRoom.bounds
    const at = { x: quantize(Math.min(b.maxX, Math.max(b.minX, p.x))), z: quantize(Math.min(b.maxZ, Math.max(b.minZ, p.z))) }
    const centre = roomCentre(b, lampRoom.outline)
    // Back at the centre: drop `at` (the default), so the file stays as before.
    return updatePrefabItem(doc, prefabId, key, { at: at.x === centre.x && at.z === centre.z ? undefined : at })
  }
  return fail(`Không tìm thấy ${key} trong ${prefabId}`)
}

/**
 * Whether handles are usable at this zoom (px per metre): the item must be at least `minPx` on
 * screen, otherwise the handles would cover it and a press on it would resize instead of move
 * (zoom in to resize small things). A lamp fixture handle is always usable.
 */
export function handlesUsable(handles: readonly Handle[], pxPerMetre: number, minPx = 36): boolean {
  if (!handles.length) return false
  if (handles.every((h) => h.key === 'fixture')) return true
  const xs = handles.map((h) => h.at.x)
  const zs = handles.map((h) => h.at.z)
  const w = Math.max(...xs) - Math.min(...xs)
  const d = Math.max(...zs) - Math.min(...zs)
  if (handles.length === 1) return true
  // Wall run ends: its length; rectangles: the shorter side.
  const size = handles.length === 2 ? Math.max(w, d) : Math.min(w, d)
  return size * pxPerMetre >= minPx
}

/** Canopy radius from a handle drag: distance to the trunk, within the tree limits, wider than the trunk. */
function treeCanopy(t: { trunk: number }, c: XZ, p: XZ): number {
  const [min, max] = TREE_LIMITS.canopy
  return quantize(Math.min(max, Math.max(min, t.trunk + 0.1, Math.hypot(p.x - c.x, p.z - c.z))))
}

/** Nearest handle within `reach` metres of `p`, or null. */
export function handleAt(handles: readonly Handle[], p: XZ, reach: number): Handle | null {
  let best: Handle | null = null
  let bestD = reach
  for (const h of handles) {
    const d = Math.hypot(h.at.x - p.x, h.at.z - p.z)
    if (d <= bestD) {
      best = h
      bestD = d
    }
  }
  return best
}
