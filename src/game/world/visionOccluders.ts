import type { Vec3 } from '../../types'
import { mapWindows, type MapData } from './mapData'
import { doorLeafTransform, type DoorStatus } from './doors'

/**
 * What can block the player's line of sight. Kept apart from the Rapier colliders on purpose:
 * low fences, crates and cars are solid but do not hide a zombie, and the vision test must run
 * in the simulation without WASM.
 */
export type VisionOccluderKind = 'wall' | 'furniture' | 'door' | 'window'

export interface VisionOccluder {
  id: string
  kind: VisionOccluderKind
  /** Axis-aligned box in world space. */
  min: Vec3
  max: Vec3
  /**
   * Dynamic occluders (doors, later curtains/barricades) answer at query time, so opening a door
   * never rebuilds anything. Omitted = always blocks.
   */
  isBlocking?: () => boolean
}

const EPS = 1e-9

/**
 * Entry parameter t ∈ [0, 1] of the segment `o + t·d` into the box, or Infinity when it misses
 * (slab test). A segment starting inside the box enters at t = 0.
 */
export function segmentBoxEntry(o: Vec3, d: Vec3, min: Vec3, max: Vec3): number {
  let t0 = 0
  let t1 = 1
  for (const axis of AXES) {
    const oa = o[axis]
    const da = d[axis]
    if (Math.abs(da) < EPS) {
      if (oa < min[axis] || oa > max[axis]) return Infinity
      continue
    }
    const inv = 1 / da
    let ta = (min[axis] - oa) * inv
    let tb = (max[axis] - oa) * inv
    if (ta > tb) [ta, tb] = [tb, ta]
    if (ta > t0) t0 = ta
    if (tb < t1) t1 = tb
    if (t0 > t1) return Infinity
  }
  return t0
}

const AXES = ['x', 'y', 'z'] as const

/**
 * The occluder list the vision system raycasts against (and nothing else in the scene). Dynamic
 * entries can be added/removed by ID when the world changes (future barricades, rebuilt walls).
 */
export class VisionOccluderSet {
  private items: VisionOccluder[]

  constructor(items: VisionOccluder[] = []) {
    this.items = [...items]
  }

  get all(): readonly VisionOccluder[] {
    return this.items
  }

  add(occluder: VisionOccluder): void {
    this.remove(occluder.id)
    this.items.push(occluder)
  }

  remove(id: string): void {
    this.items = this.items.filter((o) => o.id !== id)
  }

  /** Any blocking occluder on the segment from → to (early exit); null when the view is clear. */
  firstBlocker(from: Vec3, to: Vec3): VisionOccluder | null {
    const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
    const minX = Math.min(from.x, to.x), maxX = Math.max(from.x, to.x)
    const minY = Math.min(from.y, to.y), maxY = Math.max(from.y, to.y)
    const minZ = Math.min(from.z, to.z), maxZ = Math.max(from.z, to.z)
    for (const o of this.items) {
      // Broad phase: the segment's bounding box must overlap the occluder.
      if (o.max.x < minX || o.min.x > maxX || o.max.y < minY || o.min.y > maxY || o.max.z < minZ || o.min.z > maxZ) continue
      if (o.isBlocking && !o.isBlocking()) continue
      if (segmentBoxEntry(from, d, o.min, o.max) <= 1) return o
    }
    return null
  }

  /** Fraction t ∈ [0, 1] of from → to reached before the nearest blocking occluder (1 = clear). */
  clearFraction(from: Vec3, to: Vec3): number {
    const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
    const minX = Math.min(from.x, to.x), maxX = Math.max(from.x, to.x)
    const minY = Math.min(from.y, to.y), maxY = Math.max(from.y, to.y)
    const minZ = Math.min(from.z, to.z), maxZ = Math.max(from.z, to.z)
    let best = 1
    for (const o of this.items) {
      if (o.max.x < minX || o.min.x > maxX || o.max.y < minY || o.min.y > maxY || o.max.z < minZ || o.min.z > maxZ) continue
      if (o.isBlocking && !o.isBlocking()) continue
      const t = segmentBoxEntry(from, d, o.min, o.max)
      if (t < best) best = t
    }
    return best
  }
}

function boxFromCenter(center: Vec3, size: readonly [number, number, number]): { min: Vec3; max: Vec3 } {
  const [sx, sy, sz] = size
  return {
    min: { x: center.x - sx / 2, y: center.y - sy / 2, z: center.z - sz / 2 },
    max: { x: center.x + sx / 2, y: center.y + sy / 2, z: center.z + sz / 2 },
  }
}

/**
 * Window occluder for a future window system: glass never blocks sight, a closed curtain does.
 * Registering it needs no change in the vision system.
 */
export function createWindowOccluder(id: string, min: Vec3, max: Vec3, isCurtainClosed: () => boolean): VisionOccluder {
  return { id, kind: 'window', min, max, isBlocking: isCurtainClosed }
}

/**
 * Occluders of a map: every wall piece whose top reaches `minHeight` (building walls, lintels, map
 * boundary, pillars), tall containers (shelves, wardrobes, fridge) and each door leaf while closed.
 * Lower props (fences, crates, cars, beds, counters) are solid but never hide a standing zombie.
 * The door state is read at query time through `doorStatus`.
 */
export function buildVisionOccluders(
  map: MapData,
  doorStatus: (id: string) => DoorStatus | undefined,
  minHeight: number,
  curtainClosed: (id: string) => boolean = () => false,
): VisionOccluderSet {
  const items: VisionOccluder[] = []
  for (const wall of map.walls) {
    if (wall.position.y + wall.size[1] / 2 < minHeight) continue
    items.push({ id: wall.id, kind: 'wall', ...boxFromCenter(wall.position, wall.size) })
  }
  for (const c of map.containers) {
    if (c.position.y + c.size[1] / 2 < minHeight) continue
    items.push({ id: c.id, kind: 'furniture', ...boxFromCenter(c.position, c.size) })
  }
  for (const door of map.doors) {
    const leaf = doorLeafTransform(door, 'closed')
    if (!leaf) continue
    const [hx, hy, hz] = leaf.halfExtents
    const c = Math.abs(Math.cos(leaf.angle))
    const s = Math.abs(Math.sin(leaf.angle))
    const ex = c * hx + s * hz
    const ez = s * hx + c * hz
    items.push({
      id: door.id,
      kind: 'door',
      min: { x: leaf.center.x - ex, y: leaf.center.y - hy, z: leaf.center.z - ez },
      max: { x: leaf.center.x + ex, y: leaf.center.y + hy, z: leaf.center.z + ez },
      // Open and destroyed doors do not block; only the closed leaf filling the doorway does.
      isBlocking: () => doorStatus(door.id) === 'closed',
    })
  }
  // Glass never blocks the player's sight; a closed curtain does (read live, no rebuild).
  for (const win of mapWindows(map)) {
    const hx = (win.alongX ? win.width : win.thickness) / 2
    const hz = (win.alongX ? win.thickness : win.width) / 2
    const hy = (win.head - win.sill) / 2
    items.push(createWindowOccluder(
      win.id,
      { x: win.center.x - hx, y: win.center.y - hy, z: win.center.z - hz },
      { x: win.center.x + hx, y: win.center.y + hy, z: win.center.z + hz },
      () => curtainClosed(win.id),
    ))
  }
  return new VisionOccluderSet(items)
}
