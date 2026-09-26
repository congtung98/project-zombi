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
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three'
import { runtime } from '../core/runtime'
import { mapChunkSize } from '../world/mapData'
import { cutaway, pieceShow, type PieceShow } from './cutaway'
import { FADED_OPACITY, occlusionRegistry } from './occlusionRegistry'
import { fadedVariant, sharedBox, sharedStandardMaterial } from './sharedResources'
import { collectStaticItems, groupByChunk, type Shape, type StaticItem } from './staticBatchData'
import { WIDE_KEY } from './viewChunks'
import { useViewChunks } from './viewChunkStore'

/**
 * R3b: static world geometry drawn as one `BatchedMesh` per chunk instead of one mesh per object
 * (M10: only for the chunks the camera sees, `ChunkStreamer`):
 * walls and props (from `runtime.staticColliders`), container bodies, building floors and roofs.
 * One multi-draw per visible chunk (plus its shadow pass) replaces hundreds of draw calls; three.js
 * still culls per instance. Colours are per instance on one shared white material, so the indoor
 * lighting patch (world position incl. the batching matrix) applies unchanged.
 *
 * Walls at least `OCCLUDER_MIN_HEIGHT` tall and roofs register as box occluders: the fader hides
 * the instance and shows a faded copy (a plain mesh with the shared faded material) in its place.
 *
 * M11c-1A: every piece of a building is a `BatchedPiece` too, and `CutawayController` gives it a
 * height limit from the cutaway (`cutaway.ts`): whole, cut down (the same instance with a shorter
 * matrix) or hidden. The piece composes both reasons in one place (`sync`): the cutaway first, the
 * fade only for a whole piece. A piece that is not whole keeps its full shadow: each chunk with
 * building pieces has a twin shadow-only batch (same instances, all off) where the piece's instance
 * is switched on, so cutting the view never lets sunlight in and adds no draw call per piece.
 */

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
/** Casts a shadow, draws nothing (a cut or hidden piece keeps its shadow). */
const SHADOW_ONLY = new MeshBasicMaterial({ colorWrite: false, depthWrite: false })
/** Dev switch for the browser check (shadows with and without the proxies); always on in the game. */
let shadowProxies = true

const pieceMatrix = new Matrix4()
const pieceCenter = new Vector3()
const pieceScale = new Vector3()

/** A batch instance whose visibility depends on the cutaway and the fader. */
class BatchedPiece {
  /** Height limit from the cutaway (Infinity: whole). */
  limit = Infinity
  show: PieceShow = 'full'
  faded = false
  private overlay: Mesh | null = null
  /** The instance's matrix is the shorter one of a cut piece. */
  private cutDrawn = false
  readonly batch: BatchedMesh
  /** The chunk's shadow-only twin (same instance numbers), or null (no building piece in it). */
  readonly shadowBatch: BatchedMesh | null
  readonly instance: number
  readonly item: StaticItem
  readonly overlays: Group

  constructor(batch: BatchedMesh, shadowBatch: BatchedMesh | null, instance: number, item: StaticItem, overlays: Group) {
    this.batch = batch
    this.shadowBatch = shadowBatch
    this.instance = instance
    this.item = item
    this.overlays = overlays
  }

  /** World box of the piece (the cutaway limits are heights). */
  get box(): { min: Vector3; max: Vector3 } {
    const { center, size, shape } = this.item
    const h = shape === 'floor' ? 0 : size[1] / 2
    return { min: new Vector3(center.x - size[0] / 2, center.y - h, center.z - size[2] / 2), max: new Vector3(center.x + size[0] / 2, center.y + h, center.z + size[2] / 2) }
  }

  setLimit(limit: number): void {
    if (this.limit === limit) return
    this.limit = limit
    this.show = limit === Infinity ? 'full' : pieceShow(this.box, limit)
    this.sync()
  }

  setFaded(faded: boolean): void {
    if (this.faded === faded) return
    this.faded = faded
    this.sync()
  }

  /** Re-apply (after the dev shadow switch). */
  refresh(): void {
    this.sync()
  }

  /** Detached: drop the fade copy and start whole again (a re-attach gets fresh limits). */
  dispose(): void {
    this.limit = Infinity
    this.show = 'full'
    this.faded = false
    this.sync()
  }

  /** The one place a piece's look is decided: cutaway (whole, cut, hidden), then the fade. */
  private sync(): void {
    const whole = this.show === 'full'
    this.drawCut(this.show === 'cut')
    this.batch.setVisibleAt(this.instance, this.show === 'cut' || (whole && !this.faded))
    this.shadowBatch?.setVisibleAt(this.instance, !whole && shadowProxies)
    const showOverlay = this.faded && whole
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

  /** Cut: the instance runs from its bottom up to the limit; otherwise its full box. */
  private drawCut(cut: boolean): void {
    if (cut === this.cutDrawn && !cut) return
    const { center, size, shape } = this.item
    if (cut) {
      const bottom = center.y - size[1] / 2
      const h = this.limit - bottom
      pieceCenter.set(center.x, bottom + h / 2, center.z)
      pieceScale.set(size[0], h, size[2])
    } else {
      pieceCenter.copy(center)
      pieceScale.set(size[0], shape === 'floor' ? 1 : size[1], size[2])
    }
    this.batch.setMatrixAt(this.instance, pieceMatrix.compose(pieceCenter, identity, pieceScale))
    this.cutDrawn = cut
  }

  get hasShadowProxy(): boolean {
    return this.shadowBatch !== null && this.show !== 'full' && shadowProxies
  }
}

/**
 * Pieces by building ID for the cutaway controller (bumped version = re-sync). M11a: an L/T/U
 * building's pieces may lie in different chunks; M11c-1A: every piece of a building, not only roofs.
 */
const members = new Map<string, Set<BatchedPiece>>()
let membersVersion = 0

interface ChunkBatch {
  mesh: BatchedMesh
  /** Shadow-only twin for building pieces that are cut or hidden (null: none in the chunk). */
  shadow: BatchedMesh | null
  pieces: BatchedPiece[]
  /** Attached by a mounted `StaticBatches` (StrictMode detaches and re-attaches the same batches). */
  attached: boolean
  disposed: boolean
}

const matrix = new Matrix4()
const identity = new Quaternion()
const scale = new Vector3()
const color = new Color()

/** One chunk's items as one batch. */
function buildBatch(list: readonly StaticItem[], overlays: Group): ChunkBatch {
  // Boxes first (the only shape before M9), then whatever other shapes the chunk has.
  const shapes = [...new Set<Shape>(['box', ...list.map((i) => i.shape)])]
  const verts = shapes.reduce((n, s) => n + UNIT[s].attributes.position.count, 0)
  const indices = shapes.reduce((n, s) => n + (UNIT[s].index?.count ?? 0), 0)
  const mesh = new BatchedMesh(list.length, verts, indices, BATCH_MATERIAL)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.sortObjects = false
  // M11c-1A: the same instances again, all off, drawn only into the shadow map when switched on.
  const shadow = list.some((i) => i.buildingId) ? new BatchedMesh(list.length, verts, indices, SHADOW_ONLY) : null
  if (shadow) {
    shadow.castShadow = true
    shadow.sortObjects = false
  }
  const geometry = new Map(shapes.map((s) => [s, mesh.addGeometry(UNIT[s])]))
  const shadowGeometry = shadow ? new Map(shapes.map((s) => [s, shadow.addGeometry(UNIT[s])])) : null
  const pieces: BatchedPiece[] = []
  for (const item of list) {
    const instance = mesh.addInstance(geometry.get(item.shape)!)
    scale.set(item.size[0], item.shape === 'floor' ? 1 : item.size[1], item.size[2])
    mesh.setMatrixAt(instance, matrix.compose(item.center, identity, scale))
    mesh.setColorAt(instance, color.set(item.color))
    if (shadow) {
      const twin = shadow.addInstance(shadowGeometry!.get(item.shape)!)
      shadow.setMatrixAt(twin, matrix)
      shadow.setVisibleAt(twin, false)
    }
    if (item.occluder || item.buildingId) pieces.push(new BatchedPiece(mesh, shadow, instance, item, overlays))
  }
  return { mesh, shadow, pieces, attached: false, disposed: false }
}

/** Hook the pieces up to the fader and the cutaway controller; the returned function undoes it and frees the batches. */
function attachBatches(batches: ChunkBatch[]): () => void {
  for (const b of batches) {
    b.attached = true
    for (const piece of b.pieces) {
      const { item } = piece
      if (item.buildingId) {
        let set = members.get(item.buildingId)
        if (!set) members.set(item.buildingId, (set = new Set()))
        set.add(piece)
      }
      if (!item.occluder) continue
      const half = new Vector3(item.size[0] / 2, item.size[1] / 2, item.size[2] / 2)
      occlusionRegistry.register(piece, {
        box: new Box3(item.center.clone().sub(half), item.center.clone().add(half)),
        // A cut or hidden piece is not in the way any more; only a whole one fades.
        isVisible: () => piece.show === 'full',
        setFaded: (f) => piece.setFaded(f),
      })
    }
  }
  membersVersion += 1
  return () => {
    for (const b of batches) {
      for (const p of b.pieces) {
        occlusionRegistry.unregister(p)
        p.dispose()
        const set = p.item.buildingId ? members.get(p.item.buildingId) : undefined
        if (set?.delete(p) && set.size === 0) members.delete(p.item.buildingId!)
      }
      b.attached = false
    }
    membersVersion += 1
    // Free GPU data only if nobody re-attached them right away (StrictMode's simulated remount).
    setTimeout(() => {
      for (const b of batches) {
        if (b.attached || b.disposed) continue
        b.disposed = true
        b.mesh.dispose()
        b.shadow?.dispose()
      }
    }, 0)
  }
}

/**
 * One chunk's batch, built when the chunk is shown and freed when it leaves the view (M10).
 * Registration happens in the effect so a discarded render (StrictMode) leaves nothing behind.
 */
function StaticChunk({ items, overlays }: { items: readonly StaticItem[]; overlays: Group }) {
  const batch = useMemo(() => buildBatch(items, overlays), [items, overlays])
  useEffect(() => attachBatches([batch]), [batch])
  return (
    <>
      <primitive object={batch.mesh} />
      {batch.shadow && <primitive object={batch.shadow} />}
    </>
  )
}

export function StaticBatches() {
  const registry = runtime.staticColliders
  const subscribe = useCallback((listener: () => void) => registry.subscribe(listener), [registry])
  const version = useSyncExternalStore(subscribe, () => registry.version)
  const overlays = useMemo(() => new Group(), [])
  // Items per chunk, regrouped when colliders are (un)registered (the version).
  const groups = useMemo(() => (version >= 0 ? groupByChunk(collectStaticItems(runtime.map, registry), mapChunkSize(runtime.map)) : new Map<string, StaticItem[]>()), [registry, version])
  // M10: the shown chunks (null = all) and the always-mounted wide group.
  const shown = useViewChunks()
  const keys = shown === null ? [...groups.keys()] : [WIDE_KEY, ...shown].filter((k) => groups.has(k))

  return (
    <>
      {keys.map((k) => (
        <StaticChunk key={`${k}@${version}`} items={groups.get(k)!} overlays={overlays} />
      ))}
      <primitive object={overlays} />
    </>
  )
}

/** Apply the cutaway to one building's pieces (whole again when it is not the view's). */
function applyCutaway(buildingId: string): void {
  const inView = cutaway.view?.buildingId === buildingId
  for (const piece of members.get(buildingId) ?? []) {
    const { item } = piece
    piece.setLimit(inView ? cutaway.limit(item.buildingId, piece.box, item.role ?? 'prop') : Infinity)
  }
}

function countCutaway(buildingId: string | undefined, ms: number): void {
  const stats = { hidden: 0, cut: 0, shadows: 0, ms }
  for (const piece of (buildingId ? members.get(buildingId) : undefined) ?? []) {
    if (piece.show === 'hidden') stats.hidden += 1
    if (piece.show === 'cut') stats.cut += 1
    if (piece.hasShadowProxy) stats.shadows += 1
  }
  cutaway.stats = stats
}

/**
 * M11c-1A (replaces the R1 roof controller): follows the player with the shared `cutaway` state
 * (one building lookup per frame) and re-limits the pieces of the building it leaves and the one it
 * enters, and the view building's again after chunks (un)mount (new pieces start whole, so no other
 * building needs a pass).
 */
export function CutawayController() {
  const last = useRef<{ building: string | null; version: number; members: number }>({ building: null, version: -1, members: -1 })

  useEffect(() => {
    cutaway.attach((p, margin) => {
      const id = runtime.buildingAt(p, margin)
      return id ? runtime.map.buildings.find((b) => b.id === id) ?? null : null
    }, runtime.config.camera.offset)
    if (import.meta.env.DEV) {
      ;(window as unknown as { __cutaway: object }).__cutaway = {
        state: cutaway,
        debugState: () => ({ building: cutaway.view?.buildingId ?? null, level: cutaway.view?.level ?? null, floorY: cutaway.view?.floorY ?? null, ceilingY: cutaway.view?.ceilingY ?? null, wallTopY: cutaway.view?.wallTopY ?? null, version: cutaway.version, ...cutaway.stats }),
        setShadowProxies: (on: boolean) => {
          shadowProxies = on
          for (const set of members.values()) for (const p of set) p.refresh()
        },
        pieces: (buildingId: string) => [...(members.get(buildingId) ?? [])].map((p) => ({ id: p.item.id, role: p.item.role, show: p.show, faded: p.faded, shadow: p.hasShadowProxy, min: p.box.min.toArray(), max: p.box.max.toArray() })),
      }
    }
    return () => cutaway.attach(() => null, runtime.config.camera.offset)
  }, [])

  useFrame(() => {
    cutaway.update(runtime.player.position)
    const s = last.current
    const building = cutaway.view?.buildingId ?? null
    if (cutaway.version === s.version && membersVersion === s.members) return
    const start = performance.now()
    if (s.building && s.building !== building) applyCutaway(s.building)
    if (building) applyCutaway(building)
    countCutaway(building ?? undefined, performance.now() - start)
    s.building = building
    s.version = cutaway.version
    s.members = membersVersion
  })

  return null
}
