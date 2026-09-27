import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, LineBasicMaterial, MeshBasicMaterial, SRGBColorSpace, TextureLoader, type Texture } from 'three'
import type { MapDocument } from '../map/editor/document'
import { documentReference } from '../map/editor/generator'
import { TRACE_COLORS } from '../map/editor/tracing'
import type { ImagePoint } from '../map/layout/coordinates'
import type { ReferenceTracing } from '../map/layout/reference'
import type { XZ } from '../map/schema'
import { pixelToWorld, useEditorStore } from './editorStore'
import { labelMaterial, lineGeometry } from './sceneHelpers'

/**
 * WG6: the reference picture under the tracing, and the tracing itself (editor only): roads coloured
 * by class, areas by land use or kind, the selected feature in white, the road or area being drawn
 * following the cursor, control points and the measured distance. Everything goes through the
 * picture's calibration (and the world layout's frame once a world was generated from it).
 */

const textures = new Map<string, Texture>()
const line = (color: string, opacity = 1) => new LineBasicMaterial({ color, depthTest: false, transparent: opacity < 1, opacity })
const mats = new Map<string, LineBasicMaterial>()
const mat = (color: string) => {
  let m = mats.get(color)
  if (!m) mats.set(color, (m = line(color)))
  return m
}
const SELECTED = line('#ffffff')
const DRAFT = line('#ff4fd8')
const CONTROL = line('#ff4fd8')
const MEASURE = line('#00e5ff')

function cross(p: XZ, r: number, y: number): number[] {
  return [p.x - r, y, p.z, p.x + r, y, p.z, p.x, y, p.z - r, p.x, y, p.z + r]
}

function path(points: readonly XZ[], y: number, closed = false): number[] {
  const out: number[] = []
  const pts = closed && points.length > 2 ? [...points, points[0]] : points
  for (let i = 1; i < pts.length; i++) out.push(pts[i - 1].x, y, pts[i - 1].z, pts[i].x, y, pts[i].z)
  return out
}

function ImagePlane({ doc, tracing: ref, opacity }: { doc: MapDocument; tracing: ReferenceTracing; opacity: number }) {
  const invalidate = useThree((s) => s.invalidate)
  const image = ref.image!
  const texture = useMemo(() => {
    let t = textures.get(image.hash)
    if (!t) {
      t = new TextureLoader().load(image.dataUrl, () => invalidate())
      t.colorSpace = SRGBColorSpace
      textures.set(image.hash, t)
    }
    return t
  }, [image.hash, image.dataUrl, invalidate])
  // A new material per opacity (the slider): cheap, and the old one is disposed.
  const material = useMemo(() => new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, opacity }), [texture, opacity])
  useEffect(() => () => material.dispose(), [material])
  const geometry = useMemo(() => {
    const corners: ImagePoint[] = [
      { u: 0, v: 0 },
      { u: image.width, v: 0 },
      { u: image.width, v: image.height },
      { u: 0, v: image.height },
    ]
    const w = corners.map((c) => pixelToWorld(doc, ref, c))
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(w.flatMap((p) => [p.x, 0.05, p.z])), 3))
    // Texture v runs up: the picture's top row (v = 0 in pixels) is uv v = 1.
    g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2))
    g.setIndex([0, 2, 1, 0, 3, 2])
    g.computeBoundingSphere()
    return g
  }, [doc, ref, image.width, image.height])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} material={material} renderOrder={1} />
}

export function ReferenceOverlay({ doc }: { doc: MapDocument }) {
  const tab = useEditorStore((s) => s.paletteTab)
  const trace = useEditorStore((s) => s.trace)
  const cursor = useEditorStore((s) => s.cursor)
  const tool = useEditorStore((s) => s.tool)
  const { ref } = documentReference(doc)
  const drawing = tab === 'reference'
  const toWorld = useMemo(() => (ref ? (p: ImagePoint) => pixelToWorld(doc, ref, p) : null), [doc, ref])
  const features = useMemo(() => {
    if (!ref || !toWorld) return []
    const by = new Map<string, number[]>()
    for (const f of ref.features) {
      const color = f.kind === 'road' ? TRACE_COLORS.road[f.road!.class] : f.kind === 'zone' ? TRACE_COLORS.zone[f.zone!] : TRACE_COLORS.restricted[f.restricted!]
      const pts = f.points.map(toWorld)
      const list = by.get(color) ?? []
      list.push(...path(pts, 0.2, f.kind !== 'road'))
      for (const p of pts) list.push(...cross(p, 0.6, 0.2))
      by.set(color, list)
    }
    return [...by].map(([color, pts]) => ({ color, geometry: lineGeometry(pts) }))
  }, [ref, toWorld])
  const selected = useMemo(() => {
    const f = ref && toWorld && trace.selected ? ref.features.find((x) => x.id === trace.selected) : null
    if (!f) return null
    const pts = f.points.map(toWorld!)
    return lineGeometry([...path(pts, 0.22, f.kind !== 'road'), ...pts.flatMap((p) => cross(p, 0.7, 0.22))])
  }, [ref, toWorld, trace.selected])
  const controls = useMemo(() => (ref && toWorld ? ref.calibration.points.map((c, i) => ({ i, at: toWorld(c.image), geometry: lineGeometry(cross(toWorld(c.image), 1.5, 0.24)) })) : []), [ref, toWorld])
  const draftTo = drawing && tool === 'trace' && cursor && trace.draft.length ? cursor : null
  const draft = useMemo(() => {
    if (!toWorld || !trace.draft.length) return null
    const pts = trace.draft.map(toWorld)
    const all = draftTo ? [...pts, draftTo] : pts
    const area = trace.mode === 'zone' || trace.mode === 'restricted'
    return lineGeometry([...path(all, 0.25, area && all.length > 2), ...pts.flatMap((p) => cross(p, 0.5, 0.25))])
  }, [toWorld, trace.draft, trace.mode, draftTo])
  const measure = useMemo(() => {
    if (!toWorld || !trace.measure.length) return null
    const pts = trace.measure.map(toWorld)
    return lineGeometry([...path(pts, 0.26), ...pts.flatMap((p) => cross(p, 1, 0.26))])
  }, [toWorld, trace.measure])
  if (!ref && !trace.draft.length) return null
  const showImage = !!ref?.image && trace.showImage && (tab === 'reference' || tab === 'generator')
  return (
    <group>
      {showImage && <ImagePlane doc={doc} tracing={ref!} opacity={trace.opacity} />}
      {drawing && features.map((f) => <lineSegments key={f.color} geometry={f.geometry} material={mat(f.color)} renderOrder={16} />)}
      {drawing && selected && <lineSegments geometry={selected} material={SELECTED} renderOrder={17} />}
      {drawing &&
        controls.map((c) => (
          <group key={c.i}>
            <lineSegments geometry={c.geometry} material={CONTROL} renderOrder={18} />
            <mesh position={[c.at.x + 2.2, 0.24, c.at.z - 0.8]} rotation={[-Math.PI / 2, 0, 0]} material={labelMaterial(`#${c.i + 1}`, '#ff4fd8')} renderOrder={18}>
              <planeGeometry args={[4, 1]} />
            </mesh>
          </group>
        ))}
      {drawing && draft && <lineSegments geometry={draft} material={DRAFT} renderOrder={19} />}
      {drawing && measure && <lineSegments geometry={measure} material={MEASURE} renderOrder={19} />}
    </group>
  )
}
