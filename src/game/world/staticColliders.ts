import type { Vec3 } from '../../types'
import { SpatialHash } from '../core/spatialHash'
import { mapWindows, type MapData } from './mapData'
import { doorLeafTransform, type DoorStatus } from './doors'

/**
 * R2: the solid boxes zombies collide with, owned by the simulation (the same set Rapier gets:
 * walls/fences/props, containers, window panes, door leaves in their current pose). Zombie movement
 * reads it without WebGL or Rapier, so a zombie with no physics body (NEAR/DORMANT) still stops at
 * walls. Registration goes through `registerStaticCollider` / `unregisterStaticCollider`, which is the
 * hook chunk loading (R3) will use; `Walls.tsx` renders the wall colliders from here.
 */

export type StaticColliderKind = 'wall' | 'container' | 'window' | 'door'

export interface StaticCollider {
  id: string
  kind: StaticColliderKind
  min: Vec3
  max: Vec3
  /** Dynamic colliders (door leaves) answer at query time; omitted = always solid. */
  isSolid?: () => boolean
  /** Render data for colliders that also own their mesh (walls). */
  color?: string
}

const CELL = 4

export class StaticColliderRegistry {
  private readonly index = new SpatialHash<StaticCollider>(CELL)
  private readonly byId = new Map<string, StaticCollider>()
  /** Bumped on every register/unregister; views subscribe to re-render (`subscribe`). */
  version = 0
  private readonly listeners = new Set<() => void>()
  private readonly scratch: StaticCollider[] = []

  registerStaticCollider(c: StaticCollider): void {
    this.byId.set(c.id, c)
    this.index.insert(c.id, c, (c.min.x + c.max.x) / 2, (c.min.z + c.max.z) / 2, (c.max.x - c.min.x) / 2, (c.max.z - c.min.z) / 2)
    this.changed()
  }

  unregisterStaticCollider(id: string): void {
    if (!this.byId.delete(id)) return
    this.index.remove(id)
    this.changed()
  }

  get(id: string): StaticCollider | undefined {
    return this.byId.get(id)
  }

  /** All colliders of a kind, in registration order (for views). */
  list(kind: StaticColliderKind): StaticCollider[] {
    return Array.from(this.byId.values()).filter((c) => c.kind === kind)
  }

  get size(): number {
    return this.byId.size
  }

  /** Solid colliders whose footprint overlaps the box. The returned array is reused by the next call. */
  querySolid(minX: number, minZ: number, maxX: number, maxZ: number): readonly StaticCollider[] {
    const out = this.scratch
    out.length = 0
    this.index.queryAABB(minX, minZ, maxX, maxZ, out)
    let n = 0
    for (const c of out) if (!c.isSolid || c.isSolid()) out[n++] = c
    out.length = n
    return out
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed(): void {
    this.version += 1
    for (const l of this.listeners) l()
  }
}

function box(center: Vec3, size: readonly [number, number, number]): { min: Vec3; max: Vec3 } {
  return {
    min: { x: center.x - size[0] / 2, y: center.y - size[1] / 2, z: center.z - size[2] / 2 },
    max: { x: center.x + size[0] / 2, y: center.y + size[1] / 2, z: center.z + size[2] / 2 },
  }
}

/** Registers the colliders of a map (walls, containers, window panes, both poses of every door leaf). */
export function registerMapColliders(registry: StaticColliderRegistry, map: MapData, doorState: (id: string) => DoorStatus | undefined): void {
  for (const w of map.walls) registry.registerStaticCollider({ id: w.id, kind: 'wall', ...box(w.position, w.size), color: w.color })
  for (const c of map.containers) registry.registerStaticCollider({ id: c.id, kind: 'container', ...box(c.position, c.size) })
  for (const win of mapWindows(map)) {
    const size: [number, number, number] = win.alongX ? [win.width, win.head - win.sill, win.thickness] : [win.thickness, win.head - win.sill, win.width]
    registry.registerStaticCollider({ id: `${win.id}:pane`, kind: 'window', ...box(win.center, size) })
  }
  // A door leaf has a collider in its closed and in its open pose; only the current one is solid
  // (destroyed: neither). The leaf is axis-aligned in both poses (quarter turns).
  for (const door of map.doors) {
    for (const pose of ['closed', 'open'] as const) {
      const leaf = doorLeafTransform(door, pose)
      if (!leaf) continue
      const [hx, hy, hz] = leaf.halfExtents
      const c = Math.abs(Math.cos(leaf.angle))
      const s = Math.abs(Math.sin(leaf.angle))
      const ex = c * hx + s * hz
      const ez = s * hx + c * hz
      registry.registerStaticCollider({
        id: `${door.id}:${pose}`,
        kind: 'door',
        min: { x: leaf.center.x - ex, y: leaf.center.y - hy, z: leaf.center.z - ez },
        max: { x: leaf.center.x + ex, y: leaf.center.y + hy, z: leaf.center.z + ez },
        isSolid: () => doorState(door.id) === pose,
      })
    }
  }
}
