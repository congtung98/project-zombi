import type { PrefabDocument, PrefabObject, QuarterTurns, RoomObject, StairsObject, XZ } from '../schema.ts'
import { quantize, rotateXZ } from '../transform.ts'
import { STAIR_LIMITS } from '../validate.ts'

/**
 * M11c-2: storeys in the prefab editor, pure. The editor works on one storey at a time (the
 * "active floor"): only its items are drawn whole, picked and placed on; the storey below shows as
 * a ghost to line walls up. A flight belongs to the storey it starts on (`level`) and also shows on
 * the storey it reaches (its stairwell).
 */

/** Storey of an object or room (0 = ground; trees have none). */
export function levelOf(item: PrefabObject | RoomObject): number {
  return 'level' in item ? (item.level ?? 0) : 0
}

/** Storeys of a prefab (1 without building or `storeys`). */
export function storeysOf(prefab: PrefabDocument): number {
  return prefab.building?.storeys ?? 1
}

/** The `level` field for a new item on `floor` (omitted on the ground floor, like hand-written files). */
export function levelField(floor: number): { level?: number } {
  return floor > 0 ? { level: floor } : {}
}

/**
 * The prefab as seen on one storey: its objects and rooms, plus the flights that climb onto it
 * (their stairwell and rail). Everything else is left out (resolving this draws that storey only).
 */
export function prefabFloorView(prefab: PrefabDocument, floor: number): PrefabDocument {
  const objects = prefab.objects.filter((o) => levelOf(o) === floor || (o.kind === 'stairs' && levelOf(o) === floor - 1))
  const rooms = prefab.rooms.filter((r) => levelOf(r) === floor)
  return { ...prefab, objects, rooms }
}

/** Items (objects and rooms) of a prefab on storeys ≥ `from`, as local IDs (a storey can go only when empty). */
export function itemsFromStorey(prefab: PrefabDocument, from: number): string[] {
  const objects = prefab.objects.filter((o) => levelOf(o) >= from || (o.kind === 'stairs' && levelOf(o) >= from - 1)).map((o) => o.localId)
  const rooms = prefab.rooms.filter((r: RoomObject) => levelOf(r) >= from).map((r) => r.localId)
  return [...objects, ...rooms]
}

/** Climb direction of a flight turned `q` quarter turns (it climbs +X at 0). */
export function climbDirection(q: QuarterTurns): XZ {
  const [x, z] = rotateXZ(1, 0, q)
  return { x: Math.round(x), z: Math.round(z) }
}

/** Foot (bottom end, where one steps on) and top end of a flight, on its centre line. */
export function stairEnds(o: Pick<StairsObject, 'position' | 'quarterTurns' | 'length'>): { foot: XZ; top: XZ } {
  const d = climbDirection(o.quarterTurns)
  const h = o.length / 2
  return {
    foot: { x: quantize(o.position.x - d.x * h), z: quantize(o.position.z - d.z * h) },
    top: { x: quantize(o.position.x + d.x * h), z: quantize(o.position.z + d.z * h) },
  }
}

/** Default run of a flight for a storey height: about 37° (4 m for 3 m), in half metres, within limits. */
export function defaultStairLength(storeyHeight: number): number {
  const run = Math.ceil(((storeyHeight * 4) / 3) * 2) / 2
  return Math.min(STAIR_LIMITS.length[1], Math.max(STAIR_LIMITS.length[0], run))
}

/**
 * A flight from a drag: pressed at its foot `from`, released towards its top `to` (null = click:
 * climbing +X from the click). The drag's dominant axis gives the direction; its length the run,
 * never steeper than 45° (at least the storey height) and within the limits.
 */
export function stairFromDrag(from: XZ, to: XZ | null, storeyHeight: number): Pick<StairsObject, 'position' | 'quarterTurns' | 'length'> {
  const dx = to ? to.x - from.x : 0
  const dz = to ? to.z - from.z : 0
  const dragged = Math.max(Math.abs(dx), Math.abs(dz))
  const alongX = Math.abs(dx) >= Math.abs(dz)
  const dir: XZ = dragged < 0.5 ? { x: 1, z: 0 } : alongX ? { x: Math.sign(dx), z: 0 } : { x: 0, z: Math.sign(dz) }
  const quarterTurns = ([0, 1, 2, 3] as const).find((q) => {
    const c = climbDirection(q)
    return c.x === dir.x && c.z === dir.z
  })!
  const min = Math.max(STAIR_LIMITS.length[0], Math.ceil(storeyHeight * 2) / 2)
  const length = dragged < 0.5 ? defaultStairLength(storeyHeight) : Math.min(STAIR_LIMITS.length[1], Math.max(min, quantize(dragged)))
  return { position: { x: quantize(from.x + (dir.x * length) / 2), z: quantize(from.z + (dir.z * length) / 2) }, quarterTurns, length }
}

/**
 * A flight after dragging one end (`foot` or `top`) to `p`: the other end stays, the run follows
 * the pointer along the flight's axis (never past the other end, within the limits, ≤ 45°).
 */
export function dragStairEnd(o: StairsObject, end: 'foot' | 'top', p: XZ, storeyHeight: number): Pick<StairsObject, 'position' | 'length'> {
  const d = climbDirection(o.quarterTurns)
  const { foot, top } = stairEnds(o)
  const fixed = end === 'foot' ? top : foot
  // Signed distance from the fixed end to the pointer along the climb (towards the moving end).
  const toward = end === 'foot' ? -1 : 1
  const along = ((p.x - fixed.x) * d.x + (p.z - fixed.z) * d.z) * toward
  const min = Math.max(STAIR_LIMITS.length[0], Math.ceil(storeyHeight * 2) / 2)
  const length = Math.min(STAIR_LIMITS.length[1], Math.max(min, quantize(along)))
  const c = { x: fixed.x + d.x * toward * (length / 2), z: fixed.z + d.z * toward * (length / 2) }
  return { position: { x: quantize(c.x), z: quantize(c.z) }, length }
}

/** Whether an object may carry `level` (trees cannot: they grow from the ground). */
export function levelled(o: PrefabObject): boolean {
  return o.kind !== 'tree'
}
