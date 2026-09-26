import { outlineRects } from '../../map/polygon'
import type { RoomBounds, RoomPlacement } from '../world/buildings'

/**
 * Shader slots of the indoor lighting (`indoorShading.ts`): one axis-aligned rectangle each. A
 * rectangular room takes one slot; an L/T/U room (M11a) one per rectangle tiling its outline, all
 * with the room's shade and ceiling.
 */
export interface RoomSlot {
  room: RoomPlacement
  rect: RoomBounds
}

const cache = new WeakMap<RoomPlacement, readonly RoomBounds[]>()

export function roomRects(room: RoomPlacement): readonly RoomBounds[] {
  let rects = cache.get(room)
  if (!rects) cache.set(room, (rects = room.outline ? outlineRects(room.outline) : [room.bounds]))
  return rects
}

/** Distance from a point to a room's bounding rectangle on the ground (0 inside). */
export function roomDistance(r: RoomPlacement, x: number, z: number): number {
  const dx = Math.max(r.bounds.minX - x, 0, x - r.bounds.maxX)
  const dz = Math.max(r.bounds.minZ - z, 0, z - r.bounds.maxZ)
  return Math.hypot(dx, dz)
}

export function slotCount(rooms: readonly RoomPlacement[]): number {
  return rooms.reduce((n, r) => n + roomRects(r).length, 0)
}

/**
 * Slots for the shader: every room when all fit (map order), else the rooms nearest the point, a
 * room only when all its rectangles fit (a half-lit room would show a seam).
 */
export function pickRoomSlots(rooms: readonly RoomPlacement[], x: number, z: number, max: number): RoomSlot[] {
  const ordered = slotCount(rooms) <= max ? rooms : rooms.map((r) => ({ r, d: roomDistance(r, x, z) })).sort((a, b) => a.d - b.d).map((e) => e.r)
  const out: RoomSlot[] = []
  for (const room of ordered) {
    const rects = roomRects(room)
    if (out.length + rects.length > max) continue
    for (const rect of rects) out.push({ room, rect })
  }
  return out
}
