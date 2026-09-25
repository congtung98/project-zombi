import { Box3, MeshStandardMaterial, type Material, type Mesh } from 'three'
import { SpatialHash } from '../core/spatialHash'
import { fadedVariant } from './sharedResources'

/**
 * R1: things that may hide the player from the isometric camera (tall walls, roofs, door leaves)
 * register themselves instead of being found by a scene traversal. Their world-space bounds are
 * indexed on the ground plane so the fader only tests the few occluders around the player.
 *
 * R3b: an occluder is a box plus two callbacks, not necessarily a mesh: walls and roofs live inside
 * per-chunk batches (`StaticBatches`) and fade by hiding their instance and showing a faded copy.
 * Door leaves still register their own mesh (`occluderRef`), with bounds taken from the mesh.
 */

export interface Occluder {
  /** World-space bounds (filled on `refresh` for mesh occluders). */
  readonly box: Box3
  /** A hidden occluder (a roof over the player) never fades. */
  isVisible(): boolean
  setFaded(faded: boolean): void
}

interface Entry {
  occluder: Occluder
  /** Mesh whose bounds are not computed yet (it mounted this frame; parents may lack matrices). */
  mesh: Mesh | null
  key: string
}

const CELL = 4
/** Opacity of a faded occluder (unchanged since Phase 1). */
export const FADED_OPACITY = 0.28

class OcclusionRegistry {
  private readonly entries = new Map<object, Entry>()
  private readonly index = new SpatialHash<Occluder>(CELL)
  private readonly pending = new Set<Entry>()
  private nextKey = 0
  /** Highest top of any registered occluder (limits how far from the player a camera ray can hit one). */
  maxTop = 0

  get size(): number {
    return this.entries.size
  }

  /** Register an occluder with known bounds under `owner` (any object; used to unregister). */
  register(owner: object, occluder: Occluder): void {
    if (this.entries.has(owner)) return
    const e: Entry = { occluder, mesh: null, key: String(this.nextKey++) }
    this.entries.set(owner, e)
    this.insert(e)
  }

  /** Register a mesh; its bounds are read from its world matrix on the next `refresh`. */
  registerMesh(mesh: Mesh): void {
    if (this.entries.has(mesh)) return
    const e: Entry = { occluder: meshOccluder(mesh), mesh, key: String(this.nextKey++) }
    this.entries.set(mesh, e)
    this.pending.add(e)
  }

  unregister(owner: object): void {
    const e = this.entries.get(owner)
    if (!e) return
    this.entries.delete(owner)
    this.pending.delete(e)
    this.index.remove(e.key)
  }

  /** Compute bounds of meshes registered since the last call (once per mesh). */
  refresh(): void {
    if (this.pending.size === 0) return
    for (const e of Array.from(this.pending)) {
      const mesh = e.mesh!
      mesh.updateWorldMatrix(true, false)
      e.occluder.box.setFromObject(mesh)
      if (e.occluder.box.isEmpty()) continue
      this.pending.delete(e)
      this.insert(e)
    }
  }

  /** Occluders whose ground footprint overlaps the box, in registration order. */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: Occluder[]): Occluder[] {
    return this.index.queryAABB(minX, minZ, maxX, maxZ, out)
  }

  private insert(e: Entry): void {
    const b = e.occluder.box
    this.maxTop = Math.max(this.maxTop, b.max.y)
    this.index.insert(e.key, e.occluder, (b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2, (b.max.x - b.min.x) / 2, (b.max.z - b.min.z) / 2)
  }
}

export const occlusionRegistry = new OcclusionRegistry()

/** Fade a mesh: a shared material is swapped for its faded twin, an own material changed in place. */
function meshOccluder(mesh: Mesh): Occluder {
  return {
    box: new Box3(),
    isVisible: () => mesh.visible,
    setFaded(fade) {
      const current = mesh.material as Material
      if (current.userData.shared) {
        if (fade && !current.userData.fadedOf) mesh.material = fadedVariant(current, FADED_OPACITY)
        else if (!fade && current.userData.fadedOf) mesh.material = current.userData.fadedOf as Material
        return
      }
      if (!(current instanceof MeshStandardMaterial)) return
      current.transparent = fade
      current.opacity = fade ? FADED_OPACITY : 1
      current.depthWrite = !fade
      current.needsUpdate = true
    },
  }
}

/** Callback ref for an occluder mesh (React 19: the returned function runs on unmount). */
export function occluderRef(mesh: Mesh | null): (() => void) | undefined {
  if (!mesh) return undefined
  occlusionRegistry.registerMesh(mesh)
  return () => occlusionRegistry.unregister(mesh)
}
