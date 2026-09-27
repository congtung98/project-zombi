import type { XZ } from '../schema.ts'
import { sourceToWorld } from './coordinates.ts'
import { boundsOf } from './geometry.ts'
import type { GridFrame, LandUseZone, Polygon, RestrictedKind, RoadClass, WorldLayout } from './schema.ts'

/**
 * Preview of a layout as a standalone SVG (world generator WG1, Q1 "preview the snapping"), drawn in
 * the world frame with north up: land use, unbuildable areas, the source roads (thin, dashed), the
 * snapped network (road width), nodes and every located issue. The editor overlay comes in WG4;
 * this works now from the CLI (`--svg`) and needs no renderer.
 */

const ZONE_FILL: Record<LandUseZone, string> = {
  residential: '#f3d9a4',
  commercial: '#f2a7a7',
  industrial: '#c9b3d9',
  public: '#a9c8ef',
  forest: '#9cc79a',
  farmland: '#d9e3a0',
  empty: '#e4e4dc',
}
const RESTRICTED_FILL: Record<RestrictedKind, string> = { water: '#7fb6e6', railway: '#8a6d5a', 'no-build': '#9a9a9a' }
const ROAD_STROKE: Record<RoadClass, string> = { arterial: '#b8452f', collector: '#d0843a', local: '#3d3d44', service: '#6c6c75', track: '#9b7a52', path: '#7d9b6a' }

const f = (v: number) => (Math.round(v * 100) / 100).toString()

export function layoutPreviewSvg(layout: WorldLayout, opts: { scale?: number; chunkSize?: number } = {}): string {
  const scale = opts.scale ?? 2
  const chunk = opts.chunkSize ?? 32
  const n = layout.normalized
  const frame: GridFrame = n?.frame ?? { rotationDeg: 0, offset: { x: 0, z: 0 } }
  const w = (p: XZ) => sourceToWorld(frame, p)
  const path = (pts: readonly XZ[], close = false) => `M${pts.map((p) => `${f(p.x)} ${f(p.z)}`).join('L')}${close ? 'Z' : ''}`
  const poly = (g: Polygon) => [g.outer, ...g.holes].map((r) => path(r.map(w), true)).join('')

  const all: XZ[] = []
  for (const r of layout.roads) all.push(...r.points.map(w))
  for (const z of layout.zones) all.push(...z.polygon.outer.map(w))
  for (const r of layout.restricted) all.push(...(r.geometry.type === 'line' ? r.geometry.points : r.geometry.polygon.outer).map(w))
  if (n) for (const e of n.edges) all.push(...e.points)
  const plan = layout.plan ?? null
  if (plan) all.push({ x: plan.area.minX, z: plan.area.minZ }, { x: plan.area.maxX, z: plan.area.maxZ })
  const b = boundsOf(all) ?? { minX: -50, minZ: -50, maxX: 50, maxZ: 50 }
  const pad = 20
  const vx = b.minX - pad
  const vz = b.minZ - pad - 30
  const vw = b.maxX - b.minX + pad * 2
  const vh = b.maxZ - b.minZ + pad * 2 + 30

  const out: string[] = []
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(vx)} ${f(vz)} ${f(vw)} ${f(vh)}" width="${Math.round(vw * scale)}" height="${Math.round(vh * scale)}" font-family="sans-serif">`)
  out.push(`<rect x="${f(vx)}" y="${f(vz)}" width="${f(vw)}" height="${f(vh)}" fill="#fafaf7"/>`)
  // Chunk grid.
  const grid: string[] = []
  for (let x = Math.ceil(vx / chunk) * chunk; x <= vx + vw; x += chunk) grid.push(`M${x} ${f(vz)}V${f(vz + vh)}`)
  for (let z = Math.ceil(vz / chunk) * chunk; z <= vz + vh; z += chunk) grid.push(`M${f(vx)} ${z}H${f(vx + vw)}`)
  out.push(`<path d="${grid.join('')}" stroke="#e2e2dc" stroke-width="0.4" fill="none"/>`)

  out.push('<g fill-rule="evenodd" fill-opacity="0.7">')
  for (const z of layout.zones) out.push(`<path d="${poly(z.polygon)}" fill="${ZONE_FILL[z.zone]}"><title>${esc(`${z.id}: ${z.zone} (${z.tag.key}=${z.tag.value})`)}</title></path>`)
  out.push('</g>')
  for (const r of layout.restricted) {
    const title = `<title>${esc(`${r.id}: ${r.kind} (${r.tag.key}=${r.tag.value})`)}</title>`
    if (r.geometry.type === 'polygon') out.push(`<path d="${poly(r.geometry.polygon)}" fill="${RESTRICTED_FILL[r.kind]}" fill-opacity="0.75" fill-rule="evenodd">${title}</path>`)
    else out.push(`<path d="${path(r.geometry.points.map(w))}" stroke="${RESTRICTED_FILL[r.kind]}" stroke-width="${f(r.geometry.width)}" fill="none" stroke-opacity="0.8"${r.kind === 'railway' ? ' stroke-dasharray="3 2"' : ''}>${title}</path>`)
  }
  for (const bh of layout.buildings) out.push(`<path d="${poly(bh.polygon)}" fill="#d8d0c4" stroke="#b8ad9c" stroke-width="0.3"/>`)

  // WG2 plan: parcels (zone fill, lots outlined, interior hatched grey), then the street surfaces.
  if (plan) {
    const a = plan.area
    out.push(`<rect x="${f(a.minX)}" y="${f(a.minZ)}" width="${f(a.maxX - a.minX)}" height="${f(a.maxZ - a.minZ)}" fill="none" stroke="#999" stroke-width="0.6" stroke-dasharray="4 2"/>`)
    for (const q of plan.parcels) {
      const fill = q.kind === 'interior' ? '#cfcfcf' : ZONE_FILL[q.zone]
      const stroke = q.locked ? '#1f6fd1' : q.kind === 'lot' ? '#7a6a4f' : '#9a9a9a'
      out.push(`<path d="${path(q.polygon, true)}" fill="${fill}" fill-opacity="0.9" stroke="${stroke}" stroke-width="${q.locked ? 0.9 : 0.35}"><title>${esc(`${q.id}: ${q.kind} ${q.zone}${q.access ? `, mặt tiền ${q.access.frontage} m hướng ${q.access.side} (${q.access.edge})` : ''}${q.locked ? ', khóa' : ''}`)}</title></path>`)
      if (q.access) {
        const c = { x: (q.polygon[0].x + q.polygon[2].x) / 2, z: (q.polygon[0].z + q.polygon[2].z) / 2 }
        const d = { N: { x: 0, z: -1 }, S: { x: 0, z: 1 }, E: { x: 1, z: 0 }, W: { x: -1, z: 0 } }[q.access.side]
        out.push(`<path d="M${f(c.x)} ${f(c.z)}l${f(d.x * 2.5)} ${f(d.z * 2.5)}" stroke="#7a6a4f" stroke-width="0.4"/>`)
      }
    }
    // WG3 buildings: footprint, prefab name, a tick on the entrance side (towards the street).
    for (const q of plan.parcels) {
      const b = q.build
      if (!b || b.prefabId === null) continue
      const r = b.footprint
      out.push(`<rect x="${f(r.minX)}" y="${f(r.minZ)}" width="${f(r.maxX - r.minX)}" height="${f(r.maxZ - r.minZ)}" fill="${b.source === 'manual' ? '#3f5f8a' : '#6b4f3a'}" fill-opacity="0.85" stroke="#2e2218" stroke-width="0.3"><title>${esc(`${q.id}: ${b.prefabId} (${b.source}, xoay ${b.quarterTurns * 90}°)`)}</title></rect>`)
      if (q.access) {
        const c = { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 }
        const e = { N: { x: c.x, z: r.minZ }, S: { x: c.x, z: r.maxZ }, W: { x: r.minX, z: c.z }, E: { x: r.maxX, z: c.z } }[q.access.side]
        out.push(`<circle cx="${f(e.x)}" cy="${f(e.z)}" r="0.7" fill="#f2c14e"/>`)
      }
    }
    const SURFACE_FILL = { asphalt: '#44444a', dirt: '#8a6a45', sidewalk: '#b9b5ac' }
    for (const sf of plan.surfaces) out.push(`<rect x="${f(sf.rect.minX)}" y="${f(sf.rect.minZ)}" width="${f(sf.rect.maxX - sf.rect.minX)}" height="${f(sf.rect.maxZ - sf.rect.minZ)}" fill="${SURFACE_FILL[sf.kind]}"><title>${esc(`${sf.id} (${sf.edges.join(', ')})`)}</title></rect>`)
  }

  // Snapped network at road width (thin centre lines once the streets are planned), then the source roads over it.
  if (n && plan) for (const e of n.edges) out.push(`<path d="${path(e.points)}" stroke="#f2f2f2" stroke-width="0.25" fill="none" stroke-dasharray="1.5 1.5"/>`)
  if (n && !plan) {
    const roadOf = new Map(layout.roads.map((r) => [r.id, r]))
    const edgeRoad = new Map(layout.network.edges.map((e) => [e.id, roadOf.get(e.roadId)!]))
    for (const e of n.edges) {
      const r = edgeRoad.get(e.id)!
      out.push(`<path d="${path(e.points)}" stroke="${ROAD_STROKE[r.class]}" stroke-width="${f(r.width)}" stroke-linecap="square" stroke-linejoin="miter" fill="none" stroke-opacity="0.85"><title>${esc(`${e.id} (${r.class}, ${r.width} m${r.name ? `, ${r.name}` : ''}): lệch ${e.deviation.toFixed(1)} m, ${e.sourceLength.toFixed(0)} → ${e.length.toFixed(0)} m`)}</title></path>`)
      if (e.staircase) out.push(`<path d="${path(e.points)}" stroke="#ff9d00" stroke-width="0.8" fill="none"/>`)
    }
  }
  for (const r of layout.roads) out.push(`<path d="${path(r.points.map(w))}" stroke="${r.network ? '#1f6fd1' : '#5e8f4c'}" stroke-width="0.6" fill="none" stroke-dasharray="${r.network ? '2 1.5' : '0.8 1'}"/>`)
  if (n) {
    for (const node of n.nodes) {
      const kind = layout.network.nodes.find((x) => x.id === node.id)?.kind
      out.push(`<circle cx="${f(node.position.x)}" cy="${f(node.position.z)}" r="${kind === 'junction' ? 1.2 : 0.8}" fill="${kind === 'boundary' ? '#1f6fd1' : '#111'}"/>`)
    }
  }
  // Issues.
  const issues = [...layout.issues, ...(n?.issues ?? []), ...(plan?.issues ?? [])]
  for (const i of issues) {
    if (!i.at || i.severity === 'info') continue
    const at = n && layout.issues.includes(i) ? w(i.at) : i.at
    const color = i.severity === 'error' ? '#e0112b' : '#f08c00'
    out.push(`<circle cx="${f(at.x)}" cy="${f(at.z)}" r="${i.severity === 'error' ? 4 : 3}" fill="none" stroke="${color}" stroke-width="0.8"><title>${esc(`${i.severity} ${i.code}: ${i.message}`)}</title></circle>`)
  }
  // Header.
  const m = n?.metrics
  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.filter((i) => i.severity === 'warning').length
  const head = `${layout.name} — ${layout.roads.length} đường, ${n ? `${m!.nodes} node, ${m!.edges} cạnh, xoay ${frame.rotationDeg}°, lệch tối đa ${m!.maxDeviation.toFixed(1)} m` : 'chưa nắn'} — ${errors} lỗi, ${warnings} cảnh báo${n && !n.valid ? ' — KHÔNG HỢP LỆ' : ''}`
  out.push(`<text x="${f(vx + 4)}" y="${f(vz + 10)}" font-size="7" fill="${n && !n.valid ? '#e0112b' : '#222'}">${esc(head)}</text>`)
  if (plan) {
    const pm = plan.metrics
    out.push(`<text x="${f(vx + 4)}" y="${f(vz + 18)}" font-size="5.5" fill="#222">${esc(`kế hoạch (profile ${plan.params.profile}, seed ${plan.params.seed}): ${pm.asphalt + pm.dirt} mặt đường, ${pm.sidewalks} vỉa hè, ${pm.accessRoads} đường vào, ${pm.blocks} khối, ${pm.lots} lô, ${pm.open} đất trống, ${pm.interior} lô trong`)}</text>`)
  }
  if (layout.source.attribution) out.push(`<text x="${f(vx + 4)}" y="${f(vz + 26)}" font-size="5" fill="#555">${esc(layout.source.attribution)}</text>`)
  out.push('</svg>')
  return out.join('\n') + '\n'
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
