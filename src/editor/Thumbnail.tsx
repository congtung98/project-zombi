import { memo, useMemo } from 'react'
import { resolvePrefab } from '../map/editor/prefabCommands'
import { compoundRecords, type SharedLibrary } from '../map/editor/library'
import type { MapParts } from '../map/resolve'
import type { CompoundDocument, PrefabDocument, Rect } from '../map/schema'

/**
 * Palette thumbnail of a prefab (M6): a top-down SVG of the resolver's output (P1: ground surfaces,
 * floor, walls, containers, windows, door leaves, tree canopies), so it always matches what the game
 * builds. Recomputed only when the prefab object changes (documents are immutable). P1: a compound
 * of the shared library is drawn the same way from all its members.
 */
function PartsSvg({ parts: p, bounds: b, size, id }: { parts: Partial<MapParts>; bounds: Rect; size: number; id: string }) {
  const pad = 0.4
  const view = `${b.minX - pad} ${b.minZ - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxZ - b.minZ + 2 * pad}`
  return (
    <svg className="thumb" width={size} height={size} viewBox={view} aria-hidden data-thumb={id}>
      {p.surfaces?.map((s) =>
        s.shape === 'ellipse' ? (
          <ellipse key={s.id} cx={s.position.x} cy={s.position.z} rx={s.size[0] / 2} ry={s.size[1] / 2} fill={s.color} />
        ) : (
          <rect key={s.id} x={s.position.x - s.size[0] / 2} y={s.position.z - s.size[1] / 2} width={s.size[0]} height={s.size[1]} fill={s.color} />
        ),
      )}
      {p.buildings?.map((b) =>
        b.outline ? (
          <polygon key={b.id} points={b.outline.map((q) => `${q.x},${q.z}`).join(' ')} fill={b.floorColor} />
        ) : (
          <rect key={b.id} x={b.center.x - b.size.w / 2} y={b.center.z - b.size.d / 2} width={b.size.w} height={b.size.d} fill={b.floorColor} />
        ),
      )}
      {p.walls?.filter((w) => !w.hidden).map((w) => <rect key={w.id} x={w.position.x - w.size[0] / 2} y={w.position.z - w.size[2] / 2} width={w.size[0]} height={w.size[2]} fill={w.color ?? '#8a8580'} />)}
      {p.containers?.map((c) => <rect key={c.id} x={c.position.x - c.size[0] / 2} y={c.position.z - c.size[2] / 2} width={c.size[0]} height={c.size[2]} fill="#e0b040" />)}
      {p.windows?.map((w) => (
        <rect key={w.id} x={w.center.x - (w.alongX ? w.width : w.thickness) / 2} y={w.center.z - (w.alongX ? w.thickness : w.width) / 2} width={w.alongX ? w.width : w.thickness} height={w.alongX ? w.thickness : w.width} fill="#9fd3ff" />
      ))}
      {p.doors?.map((d) => (
        <line key={d.id} x1={d.hinge.x} y1={d.hinge.z} x2={d.hinge.x + Math.cos(d.closedAngle) * d.width} y2={d.hinge.z - Math.sin(d.closedAngle) * d.width} stroke="#c0392b" strokeWidth={0.3} />
      ))}
      {p.trees?.map((t) => <circle key={t.id} cx={t.position.x} cy={t.position.z} r={t.canopy} fill={t.color} opacity={0.8} />)}
    </svg>
  )
}

export const PrefabThumbnail = memo(function PrefabThumbnail({ prefab, size = 56 }: { prefab: PrefabDocument; size?: number }) {
  const r = useMemo(() => resolvePrefab(prefab, 0), [prefab])
  return <PartsSvg parts={r.parts} bounds={r.bounds} size={size} id={prefab.prefabId} />
})

/** P1: a library compound (every member resolved with the library's prefabs). */
export const CompoundThumbnail = memo(function CompoundThumbnail({ compound, library, size = 56 }: { compound: CompoundDocument; library: SharedLibrary; size?: number }) {
  const r = useMemo(() => {
    const records = compoundRecords(compound, library)
    const parts: Partial<MapParts> = {}
    for (const rec of records) for (const [k, v] of Object.entries(rec.parts)) ((parts as Record<string, unknown[]>)[k] ??= []).push(...(v as unknown[]))
    const bounds = records.reduce<Rect>((a, x) => ({ minX: Math.min(a.minX, x.bounds.minX), minZ: Math.min(a.minZ, x.bounds.minZ), maxX: Math.max(a.maxX, x.bounds.maxX), maxZ: Math.max(a.maxZ, x.bounds.maxZ) }), compound.footprint)
    return { parts, bounds }
  }, [compound, library])
  return <PartsSvg parts={r.parts} bounds={r.bounds} size={size} id={compound.compoundId} />
})
