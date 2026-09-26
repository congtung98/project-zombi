import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BatchedMesh,
  Box3,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  SphereGeometry,
  type BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three'
import { runtime } from '../core/runtime'
import { mapChunkSize } from '../world/mapData'
import { FADED_OPACITY, occlusionRegistry } from './occlusionRegistry'
import { fadedVariant, sharedBox, sharedStandardMaterial } from './sharedResources'
import { collectStaticItems, groupByChunk, type Shape, type StaticItem } from './staticBatchData'

/**
 * R3b: static world geometry drawn as one `BatchedMesh` per chunk instead of one mesh per object:
 * walls and props (from `runtime.staticColliders`), container bodies, building floors and roofs.
 * One multi-draw per visible chunk (plus its shadow pass) replaces hundreds of draw calls; three.js
 * still culls per instance. Colours are per instance on one shared white material, so the indoor
 * lighting patch (world position incl. the batching matrix) applies unchanged.
 *
 * Walls at least `OCCLUDER_MIN_HEIGHT` tall and roofs register as box occluders: the fader hides
 * the instance and shows a faded copy (a plain mesh with the shared faded material) in its place.
 * Roofs hide while the player is inside their building (`RoofController`).
 */

/** The roof hides once the player is this close inside the footprint (unchanged from before R1). */
const ROOF_HIDE_MARGIN = 0.4
const UNIT_BOX = new BoxGeometry(1, 1, 1)
/** Unit floor, already lying on XZ facing up. */
const UNIT_FLOOR = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
/** Unit shapes by item shape (M9 trees: trunk, round crown, pine cone), scaled per instance. */
const UNIT: Record<Shape, BufferGeometry> = {
  box: UNIT_BOX,
  floor: UNIT_FLOOR,
  trunk: new CylinderGeometry(0.5, 0.5, 1, 8),
  crown: new SphereGeometry(0.5, 9, 6),
  cone: new ConeGeometry(0.5, 1, 10),
}
/** One material for every batch: white, tinted per instance. */
const BATCH_MATERIAL = new MeshStandardMaterial({ color: '#ffffff' })

/** A batch instance whose visibility depends on the roof controller and the fader. */
class BatchedPiece {
  hidden = false
  faded = false
  private overlay: Mesh | null = null
  readonly batch: BatchedMesh
  readonly instance: number
  readonly item: StaticItem
  readonly overlays: Group

  constructor(batch: BatchedMesh, instance: number, item: StaticItem, overlays: Group) {
    this.batch = batch
    this.instance = instance
    this.item = item
    this.overlays = overlays
  }

  setHidden(hidden: boolean): void {
    if (this.hidden === hidden) return
    this.hidden = hidden
    this.sync()
  }

  setFaded(faded: boolean): void {
    if (this.faded === faded) return
    this.faded = faded
    this.sync()
  }

  dispose(): void {
    if (this.overlay) this.overlays.remove(this.overlay)
    this.overlay = null
  }

  private sync(): void {
    this.batch.setVisibleAt(this.instance, !this.hidden && !this.faded)
    const showOverlay = this.faded && !this.hidden
    if (showOverlay && !this.overlay) {
      const box = this.item.shape === 'box'
      const m = new Mesh(box ? sharedBox(this.item.size) : UNIT[this.item.shape], fadedVariant(sharedStandardMaterial(this.item.color), FADED_OPACITY))
      m.position.copy(this.item.center)
      if (!box) m.scale.set(...this.item.size)
      m.castShadow = true
      m.receiveShadow = true
      this.overlay = m
      this.overlays.add(m)
    } else if (!showOverlay && this.overlay) {
      this.overlays.remove(this.overlay)
      this.overlay = null
    }
  }
}

/** Roof pieces by building ID for the roof controller (bumped version = re-sync). */
const roofs = new Map<string, BatchedPiece>()
let roofsVersion = 0

interface ChunkBatch {
  mesh: BatchedMesh
  pieces: BatchedPiece[]
  /** Attached by a mounted `StaticBatches` (StrictMode detaches and re-attaches the same batches). */
  attached: boolean
  disposed: boolean
}

function buildBatches(items: StaticItem[], chunkSize: number, overlays: Group): ChunkBatch[] {
  const byChunk = groupByChunk(items, chunkSize)
  const matrix = new Matrix4()
  const identity = new Quaternion()
  const scale = new Vector3()
  const color = new Color()
  const out: ChunkBatch[] = []
  for (const list of byChunk.values()) {
    // Boxes first (the only shape before M9), then whatever other shapes the chunk has.
    const shapes = [...new Set<Shape>(['box', ...list.map((i) => i.shape)])]
    const verts = shapes.reduce((n, s) => n + UNIT[s].attributes.position.count, 0)
    const indices = shapes.reduce((n, s) => n + (UNIT[s].index?.count ?? 0), 0)
    const mesh = new BatchedMesh(list.length, verts, indices, BATCH_MATERIAL)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.sortObjects = false
    const geometry = new Map(shapes.map((s) => [s, mesh.addGeometry(UNIT[s])]))
    const pieces: BatchedPiece[] = []
    for (const item of list) {
      const instance = mesh.addInstance(geometry.get(item.shape)!)
      scale.set(item.size[0], item.shape === 'floor' ? 1 : item.size[1], item.size[2])
      mesh.setMatrixAt(instance, matrix.compose(item.center, identity, scale))
      mesh.setColorAt(instance, color.set(item.color))
      if (item.occluder) pieces.push(new BatchedPiece(mesh, instance, item, overlays))
    }
    out.push({ mesh, pieces, attached: false, disposed: false })
  }
  return out
}

/** Hook the pieces up to the fader and the roof controller; the returned function undoes it and frees the batches. */
function attachBatches(batches: ChunkBatch[]): () => void {
  for (const b of batches) {
    b.attached = true
    for (const piece of b.pieces) {
      const { item } = piece
      if (item.roofOf) roofs.set(item.roofOf, piece)
      const half = new Vector3(item.size[0] / 2, item.size[1] / 2, item.size[2] / 2)
      occlusionRegistry.register(piece, {
        box: new Box3(item.center.clone().sub(half), item.center.clone().add(half)),
        isVisible: () => !piece.hidden,
        setFaded: (f) => piece.setFaded(f),
      })
    }
  }
  roofsVersion += 1
  return () => {
    for (const b of batches) {
      for (const p of b.pieces) {
        occlusionRegistry.unregister(p)
        p.dispose()
        if (p.item.roofOf && roofs.get(p.item.roofOf) === p) roofs.delete(p.item.roofOf)
      }
      b.attached = false
    }
    roofsVersion += 1
    // Free GPU data only if nobody re-attached them right away (StrictMode's simulated remount).
    setTimeout(() => {
      for (const b of batches) {
        if (b.attached || b.disposed) continue
        b.disposed = true
        b.mesh.dispose()
      }
    }, 0)
  }
}

export function StaticBatches() {
  const registry = runtime.staticColliders
  const subscribe = useCallback((listener: () => void) => registry.subscribe(listener), [registry])
  const version = useSyncExternalStore(subscribe, () => registry.version)
  const overlays = useMemo(() => new Group(), [])
  // Rebuilt when colliders are (un)registered (the version); registration happens in the effect so a
  // discarded render (StrictMode) leaves nothing behind.
  const batches = useMemo(() => (version >= 0 ? buildBatches(collectStaticItems(runtime.map, registry), mapChunkSize(runtime.map), overlays) : []), [overlays, registry, version])
  useEffect(() => attachBatches(batches), [batches])

  return (
    <>
      {batches.map((b) => (
        <primitive key={b.mesh.uuid} object={b.mesh} />
      ))}
      <primitive object={overlays} />
    </>
  )
}

/** Shows every roof except the one of the building the player stands in (one spatial query per frame). */
export function RoofController() {
  const last = useRef<{ hidden: string | null; version: number }>({ hidden: null, version: -1 })

  useFrame(() => {
    const hidden = runtime.buildingAt(runtime.player.position, ROOF_HIDE_MARGIN)
    const s = last.current
    if (hidden === s.hidden && roofsVersion === s.version) return
    if (roofsVersion !== s.version) {
      for (const [id, roof] of roofs) roof.setHidden(id === hidden)
    } else {
      if (s.hidden) roofs.get(s.hidden)?.setHidden(false)
      if (hidden) roofs.get(hidden)?.setHidden(true)
    }
    s.hidden = hidden
    s.version = roofsVersion
  })

  return null
}
