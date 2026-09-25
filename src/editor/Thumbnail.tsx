import { memo, useMemo } from 'react'
import { resolvePrefab } from '../map/editor/prefabCommands'
import type { PrefabDocument } from '../map/schema'

/**
 * Palette thumbnail of a prefab (M6): a top-down SVG of the resolver's output (floor, walls,
 * containers, windows, door leaves), so it always matches what the game builds. Recomputed only
 * when the prefab object changes (documents are immutable).
 */
export const PrefabThumbnail = memo(function PrefabThumbnail({ prefab, size = 56 }: { prefab: PrefabDocument; size?: number }) {
  const shapes = useMemo(() => {
    const r = resolvePrefab(prefab, 0)
    const b = r.bounds
    const pad = 0.4
    const view = `${b.minX - pad} ${b.minZ - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxZ - b.minZ + 2 * pad}`
    const p = r.parts
    return { view, p }
  }, [prefab])
  const { view, p } = shapes
  return (
    <svg className="thumb" width={size} height={size} viewBox={view} aria-hidden data-thumb={prefab.prefabId}>
      {p.buildings?.map((b) => <rect key={b.id} x={b.center.x - b.size.w / 2} y={b.center.z - b.size.d / 2} width={b.size.w} height={b.size.d} fill={b.floorColor} />)}
      {p.walls?.map((w) => <rect key={w.id} x={w.position.x - w.size[0] / 2} y={w.position.z - w.size[2] / 2} width={w.size[0]} height={w.size[2]} fill={w.color ?? '#8a8580'} />)}
      {p.containers?.map((c) => <rect key={c.id} x={c.position.x - c.size[0] / 2} y={c.position.z - c.size[2] / 2} width={c.size[0]} height={c.size[2]} fill="#e0b040" />)}
      {p.windows?.map((w) => (
        <rect key={w.id} x={w.center.x - (w.alongX ? w.width : w.thickness) / 2} y={w.center.z - (w.alongX ? w.thickness : w.width) / 2} width={w.alongX ? w.width : w.thickness} height={w.alongX ? w.thickness : w.width} fill="#9fd3ff" />
      ))}
      {p.doors?.map((d) => (
        <line key={d.id} x1={d.hinge.x} y1={d.hinge.z} x2={d.hinge.x + Math.cos(d.closedAngle) * d.width} y2={d.hinge.z - Math.sin(d.closedAngle) * d.width} stroke="#c0392b" strokeWidth={0.3} />
      ))}
    </svg>
  )
})
