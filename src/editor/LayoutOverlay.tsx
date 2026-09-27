import { useMemo } from 'react'
import { LineBasicMaterial } from 'three'
import type { MapDocument } from '../map/editor/document'
import { sourceToWorld } from '../map/layout/coordinates'
import { parcelRect } from '../map/layout/parcels'
import type { GridFrame, WorldLayout } from '../map/layout/schema'
import { documentLayout, generatorStatus, type ParcelState } from '../map/layout/worldSync'
import type { XZ } from '../map/schema'
import { PARCEL_COLORS } from '../map/editor/generator'
import { useEditorStore } from './editorStore'
import { lineGeometry, outlinePoints, rectPoints } from './sceneHelpers'

/**
 * WG4: the world's layout drawn over the viewport (editor only): roads as imported, the snapped
 * network, blocks, water / railways / no-build land, and parcels coloured by the state of their
 * building (generated, modified by hand, locked, empty lot, open land). Lines draw over everything
 * (no depth test) so they read in the isometric view too.
 */

const line = (color: string, opacity = 1) => new LineBasicMaterial({ color, depthTest: false, transparent: opacity < 1, opacity })

const PARCEL_MATS = Object.fromEntries(Object.entries(PARCEL_COLORS).map(([k, c]) => [k, line(c, k === 'open' ? 0.6 : 0.95)])) as Record<ParcelState, LineBasicMaterial>
const SOURCE_MAT = line('#c9b8ff', 0.75)
const NETWORK_MAT = line('#00e5ff')
const BLOCK_MAT = line('#d0d0ff', 0.45)
const RESTRICTED_MAT: Record<string, LineBasicMaterial> = { water: line('#3fa9f5'), railway: line('#a0704a'), 'no-build': line('#ff5a5a') }
const PICKED_MAT = line('#ffffff')

function polyline(points: readonly XZ[], y: number): number[] {
  const out: number[] = []
  for (let i = 1; i < points.length; i++) out.push(points[i - 1].x, y, points[i - 1].z, points[i].x, y, points[i].z)
  return out
}

function sourceLayer(layout: WorldLayout, frame: GridFrame) {
  const w = (p: XZ) => sourceToWorld(frame, p)
  const roads = lineGeometry(layout.roads.flatMap((r) => polyline(r.points.map(w), 0.11)))
  const restricted = new Map<string, number[]>()
  for (const r of layout.restricted) {
    const pts = restricted.get(r.kind) ?? []
    if (r.geometry.type === 'line') pts.push(...polyline(r.geometry.points.map(w), 0.12))
    else for (const ring of [r.geometry.polygon.outer, ...r.geometry.polygon.holes]) pts.push(...outlinePoints(ring.map(w), 0.12))
    restricted.set(r.kind, pts)
  }
  return { roads, restricted: [...restricted].map(([kind, pts]) => ({ kind, geometry: lineGeometry(pts) })) }
}

export function LayoutOverlay({ doc }: { doc: MapDocument }) {
  const view = useEditorStore((s) => s.layoutView)
  const tab = useEditorStore((s) => s.paletteTab)
  const picked = useEditorStore((s) => s.selectedParcel)
  const layout = documentLayout(doc).layout
  const frame = layout?.normalized?.frame
  const source = useMemo(() => (layout && frame ? sourceLayer(layout, frame) : null), [layout, frame])
  const network = useMemo(() => (layout?.normalized ? lineGeometry(layout.normalized.edges.flatMap((e) => polyline(e.points, 0.13))) : null), [layout])
  const blocks = useMemo(() => (layout?.plan ? lineGeometry(layout.plan.blocks.flatMap((b) => b.rects.flatMap((r) => rectPoints(r, 0.1)))) : null), [layout])
  const status = layout ? generatorStatus(doc, layout) : null
  const parcels = useMemo(() => {
    if (!layout?.plan || !status) return []
    const by = new Map<ParcelState, number[]>()
    for (const q of layout.plan.parcels) {
      const st = status.parcels.get(q.id) ?? 'empty'
      const r = parcelRect(q)
      const pts = by.get(st) ?? []
      // Inset a little so neighbours' outlines stay apart.
      pts.push(...rectPoints({ minX: r.minX + 0.15, minZ: r.minZ + 0.15, maxX: r.maxX - 0.15, maxZ: r.maxZ - 0.15 }, 0.14))
      by.set(st, pts)
    }
    return [...by].map(([state, pts]) => ({ state, geometry: lineGeometry(pts) }))
  }, [layout, status])
  const pickedGeometry = useMemo(() => {
    const q = picked ? layout?.plan?.parcels.find((x) => x.id === picked) : null
    if (!q) return null
    const r = parcelRect(q)
    return lineGeometry([...rectPoints(r, 0.16), ...rectPoints({ minX: r.minX + 0.3, minZ: r.minZ + 0.3, maxX: r.maxX - 0.3, maxZ: r.maxZ - 0.3 }, 0.16)])
  }, [layout, picked])
  if (!layout) return null
  // Outside the Generator tab only the selected parcel stays drawn (the layers are a Generator tool).
  const on = tab === 'generator'
  return (
    <group>
      {on && view.source && source && <lineSegments geometry={source.roads} material={SOURCE_MAT} renderOrder={12} />}
      {on && view.restricted && source?.restricted.map((r) => <lineSegments key={r.kind} geometry={r.geometry} material={RESTRICTED_MAT[r.kind] ?? RESTRICTED_MAT['no-build']} renderOrder={12} />)}
      {on && view.blocks && blocks && <lineSegments geometry={blocks} material={BLOCK_MAT} renderOrder={12} />}
      {on && view.parcels && parcels.map((p) => <lineSegments key={p.state} geometry={p.geometry} material={PARCEL_MATS[p.state]} renderOrder={13} />)}
      {on && view.network && network && <lineSegments geometry={network} material={NETWORK_MAT} renderOrder={14} />}
      {pickedGeometry && <lineSegments geometry={pickedGeometry} material={PICKED_MAT} renderOrder={15} />}
    </group>
  )
}
