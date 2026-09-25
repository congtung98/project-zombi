import { Canvas, useThree, type RootState } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { LineBasicMaterial, Plane, Raycaster, Vector2, Vector3, type OrthographicCamera } from 'three'
import { chunkStatuses, resolvedRecords, type ChunkStatus, type MapDocument } from '../map/editor/document'
import { isHidden } from '../map/editor/layers'
import { snap } from '../map/editor/picking'
import type { Rect, XZ } from '../map/schema'
import { chunkIdOf, chunkOrigin } from '../map/transform'
import { useEditorStore } from './editorStore'
import { chunkClick, commitPlace, keysInRect, moveCommand, pickAt, snapPoint, updatePlacePreview } from './interaction'
import { PrefabScene } from './PrefabScene'
import { GRID_MAT, labelMaterial, lineGeometry, MARQUEE_MAT, rectPoints, SELECT_MAT } from './sceneHelpers'
import { RecordView } from './RecordView'

/**
 * Authoring viewport: orthographic top-down (north up) or isometric like the game camera.
 * Select tool: left click selects (Shift toggles), drags the selection (preview, one command on
 * release) or, from empty ground, draws a selection box. Place tool: click drops the ghost; a drag
 * sizes surfaces, walls, boxes and zones (M4). Chunk tool: click an empty cell to add a chunk.
 * Prefab mode (M5): the same tools act on the edited prefab in its own frame (`PrefabScene`).
 * Right/middle drag pans, wheel zooms, F focuses. Hidden/locked layers are never picked.
 * The player, AI and game loop never run here.
 */

const ISO_OFFSET = new Vector3(20, 24, 20)
const TOP_HEIGHT = 120
const GROUND = new Plane(new Vector3(0, 1, 0), 0)

const CHUNK_MAT = new LineBasicMaterial({ color: '#2b6cb0' })
const CHUNK_MODIFIED_MAT = new LineBasicMaterial({ color: '#e0a030' })
const CHUNK_INVALID_MAT = new LineBasicMaterial({ color: '#ff4040' })
const CHUNK_PICKED_MAT = new LineBasicMaterial({ color: '#ffffff' })
const CANDIDATE_MAT = new LineBasicMaterial({ color: '#8a939b', transparent: true, opacity: 0.6 })
const PLAY_MAT = new LineBasicMaterial({ color: '#e05050' })

function chunkMaterial(s: ChunkStatus | undefined, picked: boolean): LineBasicMaterial {
  if (picked) return CHUNK_PICKED_MAT
  if (s?.errors) return CHUNK_INVALID_MAT
  if (s?.modified) return CHUNK_MODIFIED_MAT
  return CHUNK_MAT
}

/** Empty cells next to the world's chunks: where the chunk tool can add one. */
function candidateCells(doc: MapDocument): { cx: number; cz: number }[] {
  const out = new Map<string, { cx: number; cz: number }>()
  for (const c of doc.world.chunks) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const id = chunkIdOf(c.cx + dx, c.cz + dz)
        if (!doc.chunks.has(id)) out.set(id, { cx: c.cx + dx, cz: c.cz + dz })
      }
    }
  }
  return [...out.values()]
}
function Grid({ doc, statuses, pickedChunk, candidates }: { doc: MapDocument; statuses: ChunkStatus[]; pickedChunk: string | null; candidates: boolean }) {
  const { world } = doc
  const geometry = useMemo(() => {
    const S = world.chunkSize
    const b = world.chunkBounds
    const x0 = b.minCx * S
    const x1 = (b.maxCx + 1) * S
    const z0 = b.minCz * S
    const z1 = (b.maxCz + 1) * S
    const pts: number[] = []
    for (let x = x0; x <= x1; x++) pts.push(x, 0.005, z0, x, 0.005, z1)
    for (let z = z0; z <= z1; z++) pts.push(x0, 0.005, z, x1, 0.005, z)
    return lineGeometry(pts)
  }, [world.chunkSize, world.chunkBounds])
  const chunks = useMemo(() => {
    const S = world.chunkSize
    return world.chunks.map((c) => {
      const o = chunkOrigin(c.cx, c.cz, S)
      return { id: c.chunkId, o, geometry: lineGeometry(rectPoints({ minX: o.x, minZ: o.z, maxX: o.x + S, maxZ: o.z + S }, 0.03)) }
    })
  }, [world.chunkSize, world.chunks])
  const play = useMemo(() => {
    const h = world.playArea.size / 2
    return lineGeometry(rectPoints({ minX: -h, minZ: -h, maxX: h, maxZ: h }, 0.04))
  }, [world.playArea.size])
  const empty = useMemo(() => {
    if (!candidates) return null
    const S = world.chunkSize
    const pts = candidateCells(doc).flatMap(({ cx, cz }) => {
      const o = chunkOrigin(cx, cz, S)
      return rectPoints({ minX: o.x + 0.5, minZ: o.z + 0.5, maxX: o.x + S - 0.5, maxZ: o.z + S - 0.5 }, 0.03)
    })
    return pts.length ? lineGeometry(pts) : null
  }, [candidates, doc, world.chunkSize])
  const byId = new Map(statuses.map((s) => [s.chunkId, s]))
  const size = (world.chunkBounds.maxCx - world.chunkBounds.minCx + 1) * world.chunkSize
  const cx = ((world.chunkBounds.minCx + world.chunkBounds.maxCx + 1) * world.chunkSize) / 2
  const cz = ((world.chunkBounds.minCz + world.chunkBounds.maxCz + 1) * world.chunkSize) / 2
  const sizeZ = (world.chunkBounds.maxCz - world.chunkBounds.minCz + 1) * world.chunkSize
  return (
    <group>
      <mesh position={[cx, -0.01, cz]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[size, sizeZ]} />
        <meshStandardMaterial color="#6f7d5c" />
      </mesh>
      <lineSegments geometry={geometry} material={GRID_MAT} />
      {chunks.map((c) => {
        const st = byId.get(c.id)
        const label = `${c.id}${st?.errors ? ' ✕' : st?.modified ? ' ●' : ''}`
        return (
          <group key={c.id}>
            <lineSegments geometry={c.geometry} material={chunkMaterial(st, c.id === pickedChunk)} renderOrder={c.id === pickedChunk ? 5 : 0} />
            <mesh position={[c.o.x + 3.6, 0.02, c.o.z + 0.9]} rotation={[-Math.PI / 2, 0, 0]} material={labelMaterial(label)}>
              <planeGeometry args={[6, 1.5]} />
            </mesh>
          </group>
        )
      })}
      {empty && <lineSegments geometry={empty} material={CANDIDATE_MAT} />}
      <lineSegments geometry={play} material={PLAY_MAT} />
    </group>
  )
}

function Selection({ doc, ids }: { doc: MapDocument; ids: string[] }) {
  const geometry = useMemo(() => {
    const wanted = new Set(ids)
    const pts = resolvedRecords(doc)
      .filter((r) => wanted.has(r.id))
      .flatMap((r) => {
        const pad = r.category === 'spawns' ? 0.6 : 0.1
        const b = r.bounds
        return rectPoints({ minX: b.minX - pad, minZ: b.minZ - pad, maxX: b.maxX + pad, maxZ: b.maxZ + pad }, 0.08)
      })
    return pts.length ? lineGeometry(pts) : null
  }, [doc, ids])
  return geometry ? <lineSegments geometry={geometry} material={SELECT_MAT} renderOrder={10} /> : null
}

/** Box select in progress. */
export function Marquee() {
  const rect = useEditorStore((s) => s.marquee)
  const geometry = useMemo(() => (rect ? lineGeometry(rectPoints(rect, 0.1)) : null), [rect])
  return geometry ? <lineSegments geometry={geometry} material={MARQUEE_MAT} renderOrder={11} /> : null
}

function EditorScene() {
  const edit = useEditorStore((s) => s.edit)
  const preview = useEditorStore((s) => s.preview)
  const layers = useEditorStore((s) => s.layers)
  const savedDoc = useEditorStore((s) => s.savedDoc)
  const issues = useEditorStore((s) => s.issues)
  const tool = useEditorStore((s) => s.tool)
  const pickedChunk = useEditorStore((s) => s.selectedChunk)
  const prefabMode = useEditorStore((s) => s.prefabMode)
  if (!edit) return null
  if (prefabMode) {
    return (
      <group>
        <ambientLight intensity={0.75} />
        <directionalLight position={[30, 60, 20]} intensity={1.6} />
        <PrefabScene prefabId={prefabMode} />
        <Marquee />
      </group>
    )
  }
  const doc = preview?.doc ?? edit.doc
  const ghosts = new Set(preview?.ghostIds ?? [])
  const records = resolvedRecords(doc).filter((r) => ghosts.has(r.id) || !isHidden(r, layers))
  const statuses = chunkStatuses(edit.doc, savedDoc, issues)
  return (
    <group>
      <ambientLight intensity={0.75} />
      <directionalLight position={[30, 60, 20]} intensity={1.6} />
      <Grid doc={doc} statuses={statuses} pickedChunk={tool === 'chunk' ? pickedChunk : null} candidates={tool === 'chunk'} />
      {records.map((r) => (
        <RecordView key={r.id} record={r} ghost={ghosts.has(r.id)} />
      ))}
      <Selection doc={doc} ids={preview?.ghostIds.length ? preview.ghostIds : edit.selection} />
      <Marquee />
    </group>
  )
}

interface Drag {
  /** move: selection; pan: camera; box: selection rectangle; place: sizing a new record. */
  kind: 'move' | 'pan' | 'box' | 'place'
  start: XZ
  ids: string[]
  delta: XZ
  /** box: Shift held (add to the selection). */
  additive?: boolean
}

/** A box smaller than this (m) is a plain click on empty ground. */
const MIN_BOX = 0.3

/** Place the camera for the current view around the target (session state, never saved). */
function applyCamera(state: RootState, t: Vector3): void {
  const camera = state.camera as OrthographicCamera
  if (useEditorStore.getState().view === 'top') {
    camera.up.set(0, 0, -1)
    camera.position.set(t.x, TOP_HEIGHT, t.z)
  } else {
    camera.up.set(0, 1, 0)
    camera.position.copy(t).add(ISO_OFFSET)
  }
  camera.lookAt(t)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  state.invalidate()
}

function Controls() {
  const get = useThree((s) => s.get)
  const view = useEditorStore((s) => s.view)
  const focusRequest = useEditorStore((s) => s.focusRequest)
  const target = useRef(new Vector3())
  const drag = useRef<Drag | null>(null)

  useEffect(() => applyCamera(get(), target.current), [view, get])

  // Focus: the selection, or the whole world when nothing is selected.
  useEffect(() => {
    const state = get()
    const camera = state.camera as OrthographicCamera
    const s = useEditorStore.getState()
    if (!s.edit) return
    const doc = s.edit.doc
    const wanted = new Set(s.edit.selection)
    const picked = s.prefabMode ? [] : resolvedRecords(doc).filter((r) => wanted.has(r.id))
    const prefab = s.prefabMode ? doc.prefabs.get(s.prefabMode) : null
    let rect: Rect
    if (s.focusRect) {
      rect = s.focusRect
    } else if (prefab) {
      // Prefab mode: its footprint (in its own frame) with some room around.
      const f = prefab.footprint
      rect = { minX: f.minX - 2, minZ: f.minZ - 2, maxX: f.maxX + 2, maxZ: f.maxZ + 2 }
    } else if (picked.length) {
      rect = picked.map((r) => r.bounds).reduce((a, b) => ({ minX: Math.min(a.minX, b.minX), minZ: Math.min(a.minZ, b.minZ), maxX: Math.max(a.maxX, b.maxX), maxZ: Math.max(a.maxZ, b.maxZ) }))
    } else {
      const h = doc.world.playArea.size / 2
      rect = { minX: -h, minZ: -h, maxX: h, maxZ: h }
    }
    target.current.set((rect.minX + rect.maxX) / 2, 0, (rect.minZ + rect.maxZ) / 2)
    const extent = Math.max(rect.maxX - rect.minX, rect.maxZ - rect.minZ, 8) * 1.3
    const px = Math.min(state.gl.domElement.clientWidth, state.gl.domElement.clientHeight) || 600
    camera.zoom = Math.max(2, Math.min(120, px / extent))
    applyCamera(state, target.current)
  }, [focusRequest, get])

  // Dev: browser checks read the camera to aim clicks at world points.
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __editorThree: typeof get }).__editorThree = get
  }, [get])

  useEffect(() => {
    const el = get().gl.domElement
    const camera = () => get().camera as OrthographicCamera
    const apply = { current: () => applyCamera(get(), target.current) }
    const raycaster = new Raycaster()
    const ndc = new Vector2()
    const hit = new Vector3()
    const groundAt = (e: PointerEvent | WheelEvent): XZ | null => {
      const r = el.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera())
      return raycaster.ray.intersectPlane(GROUND, hit) ? { x: hit.x, z: hit.z } : null
    }
    const store = useEditorStore.getState

    const down = (e: PointerEvent) => {
      const g = groundAt(e)
      if (!g) return
      el.setPointerCapture(e.pointerId)
      if (e.button === 1 || e.button === 2) {
        drag.current = { kind: 'pan', start: g, ids: [], delta: { x: 0, z: 0 } }
        return
      }
      if (e.button !== 0) return
      const s = store()
      if (!s.edit) return
      if (s.tool === 'play') {
        s.startPlaytest(snapPoint(g))
        return
      }
      if (s.tool === 'chunk') {
        chunkClick(g)
        return
      }
      if (s.tool === 'place') {
        if (s.place?.kind === 'prefab') {
          commitPlace(snapPoint(g))
          updatePlacePreview(g)
          return
        }
        const from = snapPoint(g)
        drag.current = { kind: 'place', start: from, ids: [], delta: { x: 0, z: 0 } }
        updatePlacePreview(g, from)
        return
      }
      if (s.prefabMode && s.prefabView !== 0) {
        s.setStatus('Đang xem prefab xoay: về 0° (Inspector → Xem xoay) để sửa', 'error')
        return
      }
      const pickedId = pickAt(g)
      const selection = s.edit.selection
      if (!pickedId) {
        drag.current = { kind: 'box', start: g, ids: [], delta: { x: 0, z: 0 }, additive: e.shiftKey }
        return
      }
      if (e.shiftKey) {
        s.select(selection.includes(pickedId) ? selection.filter((id) => id !== pickedId) : [...selection, pickedId])
        return
      }
      const ids = selection.includes(pickedId) ? selection : [pickedId]
      if (ids !== selection) s.select(ids)
      drag.current = { kind: 'move', start: g, ids, delta: { x: 0, z: 0 } }
    }

    const move = (e: PointerEvent) => {
      const g = groundAt(e)
      if (!g) return
      const s = store()
      s.set({ cursor: g })
      const d = drag.current
      if (d?.kind === 'pan') {
        target.current.x += d.start.x - g.x
        target.current.z += d.start.z - g.z
        apply.current()
        return
      }
      if (d?.kind === 'box') {
        s.set({ marquee: { minX: Math.min(d.start.x, g.x), minZ: Math.min(d.start.z, g.z), maxX: Math.max(d.start.x, g.x), maxZ: Math.max(d.start.z, g.z) } })
        return
      }
      if (d?.kind === 'place') {
        updatePlacePreview(g, d.start)
        return
      }
      if (d?.kind === 'move' && s.edit) {
        const delta = { x: snap(g.x - d.start.x, s.snapStep), z: snap(g.z - d.start.z, s.snapStep) }
        if (delta.x === d.delta.x && delta.z === d.delta.z) return
        d.delta = delta
        if (delta.x === 0 && delta.z === 0) {
          s.setPreview(null)
          return
        }
        const r = moveCommand(s.edit.doc, d.ids, delta)
        if (r.ok) s.setPreview({ doc: r.doc, ghostIds: [] })
        else {
          s.setPreview(null)
          s.setStatus(r.error, 'error')
        }
        return
      }
      if (s.tool === 'place') updatePlacePreview(g)
    }

    const up = (e: PointerEvent) => {
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      const d = drag.current
      drag.current = null
      const s = store()
      if (d?.kind === 'place') {
        const g = groundAt(e)
        commitPlace(d.start, g ? snapPoint(g) : null)
        updatePlacePreview(g)
        return
      }
      if (d?.kind === 'box') {
        s.set({ marquee: null })
        const g = groundAt(e)
        if (!s.edit || !g) return
        if (Math.abs(g.x - d.start.x) < MIN_BOX && Math.abs(g.z - d.start.z) < MIN_BOX) {
          if (!d.additive) s.select([])
          return
        }
        const rect = { minX: d.start.x, minZ: d.start.z, maxX: g.x, maxZ: g.z }
        const inside = keysInRect(rect)
        s.select(d.additive ? [...new Set([...s.edit.selection, ...inside])] : inside)
        return
      }
      if (d?.kind !== 'move') return
      const { x, z } = d.delta
      if (x === 0 && z === 0) return
      s.run('Di chuyển', (doc) => moveCommand(doc, d.ids, { x, z }))
    }

    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const before = groundAt(e)
      const cam = camera()
      cam.zoom = Math.max(2, Math.min(120, cam.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
      cam.updateProjectionMatrix()
      cam.updateMatrixWorld()
      // Keep the point under the cursor fixed.
      const after = groundAt(e)
      if (before && after) {
        target.current.x += before.x - after.x
        target.current.z += before.z - after.z
      }
      apply.current()
    }
    const leave = () => useEditorStore.getState().set({ cursor: null })
    const menu = (e: MouseEvent) => e.preventDefault()

    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('pointerleave', leave)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('contextmenu', menu)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('contextmenu', menu)
    }
  }, [get])

  return null
}

export function Viewport() {
  return (
    <Canvas orthographic frameloop="demand" camera={{ position: [0, TOP_HEIGHT, 0], zoom: 10, near: 0.1, far: 1000 }} dpr={[1, 2]}>
      <color attach="background" args={['#23272b']} />
      <EditorScene />
      <Controls />
    </Canvas>
  )
}
