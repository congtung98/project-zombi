import { Box3, type Mesh } from 'three'
import { SpatialHash } from '../core/spatialHash'

/**
 * R1: meshes that may hide the player from the isometric camera (tall walls, roofs, door leaves)
 * register themselves when they mount (`occluderRef`) instead of being found by a scene traversal.
 * Their world-space bounds are indexed on the ground plane so the fader only raycasts the few meshes
 * around the player.
 */

interface Entry {
  mesh: Mesh
  box: Box3
  /** Bounds not computed yet (the mesh mounted this frame; parents may not have their matrices). */
  dirty: boolean
}

const CELL = 4

class OcclusionRegistry {
  private readonly entries = new Map<Mesh, Entry>()
  private readonly index = new SpatialHash<Entry>(CELL)
  private readonly dirty = new Set<Entry>()
  /** Highest top of any registered occluder (limits how far from the player a camera ray can hit one). */
  maxTop = 0

  get size(): number {
    return this.entries.size
  }

  register(mesh: Mesh): void {
    if (this.entries.has(mesh)) return
    const e: Entry = { mesh, box: new Box3(), dirty: true }
    this.entries.set(mesh, e)
    this.dirty.add(e)
  }

  unregister(mesh: Mesh): void {
    const e = this.entries.get(mesh)
    if (!e) return
    this.entries.delete(mesh)
    this.dirty.delete(e)
    this.index.remove(mesh.uuid)
  }

  /** Compute bounds of meshes registered since the last call (once per mesh, from its world matrix). */
  refresh(): void {
    if (this.dirty.size === 0) return
    for (const e of this.dirty) {
      e.mesh.updateWorldMatrix(true, false)
      e.box.setFromObject(e.mesh)
      if (e.box.isEmpty()) continue
      e.dirty = false
      this.maxTop = Math.max(this.maxTop, e.box.max.y)
      const b = e.box
      this.index.insert(e.mesh.uuid, e, (b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2, (b.max.x - b.min.x) / 2, (b.max.z - b.min.z) / 2)
    }
    for (const e of Array.from(this.dirty)) if (!e.dirty) this.dirty.delete(e)
  }

  /** Registered meshes whose ground footprint overlaps the box, in registration order. */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: Mesh[]): Mesh[] {
    for (const e of this.index.queryAABB(minX, minZ, maxX, maxZ)) out.push(e.mesh)
    return out
  }
}

export const occlusionRegistry = new OcclusionRegistry()

/** Callback ref for an occluder mesh (React 19: the returned function runs on unmount). */
export function occluderRef(mesh: Mesh | null): (() => void) | undefined {
  if (!mesh) return undefined
  occlusionRegistry.register(mesh)
  return () => occlusionRegistry.unregister(mesh)
}
