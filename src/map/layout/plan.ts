import type { Rect, XZ } from '../schema.ts'
import { quantize } from '../transform.ts'
import { pointInOutline, signedArea } from '../polygon.ts'
import { sourceToWorld } from './coordinates.ts'
import { byString, hashText } from './geometry.ts'
import { bucketPairs } from './network.ts'
import { blockParcels, findBlocks, FRONT_PROBE, frontOf, parcelRect, rasterize, type BlockGrid } from './parcels.ts'
import { rectArea, rectCentre, rectsOverlap } from './rects.ts'
import { networkSegments, streetSurfaces, type Segment } from './streets.ts'
import type { AccessRoad, LandUseZone, LayoutIssue, LayoutParcel, LayoutPlan, PlanParams, Polygon, RoadClass, Side, WorldLayout, ZoneProfile } from './schema.ts'

/**
 * Street and parcel planner (world generator WG2): normalised network → street surfaces
 * (`streets.ts`) → access lanes into deep blocks → blocks and parcels (`parcels.ts`) → checks.
 * Reads the layout, never changes it: the plan is a new layer (`layout.plan`) that can be recomputed
 * with other parameters, keeping locked parcels exactly. Deterministic for the same layout, params and
 * kept parcels (seeded per block, sorted output, IDs from geometry).
 */

export const PLAN_VERSION = 1

export class LayoutPlanError extends Error {}

const OPEN: ZoneProfile = { subdivide: false, frontage: [10, 40, 200], depth: [10, 40, 200] }

/** Lot sizes per zone (Q5: flexible footprints). `default` fits the current prefabs (houses 6–12 m wide). */
export const PROFILES: Record<string, Record<LandUseZone, ZoneProfile>> = {
  default: {
    residential: { subdivide: true, frontage: [11, 15, 20], depth: [14, 22, 30] },
    commercial: { subdivide: true, frontage: [12, 18, 30], depth: [14, 24, 34] },
    industrial: { subdivide: true, frontage: [20, 32, 50], depth: [20, 34, 50] },
    public: { subdivide: true, frontage: [20, 36, 60], depth: [20, 36, 60] },
    forest: OPEN,
    farmland: OPEN,
    empty: OPEN,
  },
  // Vietnamese street: narrow deep tube-house lots, wide pavements.
  'vn-urban': {
    residential: { subdivide: true, frontage: [4, 5, 7], depth: [12, 16, 22] },
    commercial: { subdivide: true, frontage: [4, 6, 9], depth: [14, 18, 24] },
    industrial: { subdivide: true, frontage: [15, 25, 40], depth: [20, 30, 45] },
    public: { subdivide: true, frontage: [20, 30, 50], depth: [20, 30, 50] },
    forest: OPEN,
    farmland: OPEN,
    empty: OPEN,
  },
}

const SIDEWALKS: Record<string, Record<RoadClass, number>> = {
  default: { arterial: 2.5, collector: 2.2, local: 1.8, service: 1.2, track: 0, path: 0 },
  'vn-urban': { arterial: 4, collector: 3.5, local: 3, service: 1.5, track: 0, path: 0 },
}

export const DEFAULT_PLAN: PlanParams = { seed: 1, profile: 'default', sidewalk: null, accessRoads: true, accessWidth: 3.5, margin: 24, restrictedCell: 2, inset: 0.5 }

export interface PlanOptions {
  /** Parcels to keep exactly (locked ones, or every parcel outside the blocks being regenerated). */
  keep?: readonly LayoutParcel[]
}

interface WorldZone {
  zone: LandUseZone
  polygon: Polygon
  area: number
}

export function planLayout(layout: WorldLayout, params: Partial<PlanParams> = {}, opts: PlanOptions = {}): LayoutPlan {
  const p: PlanParams = { ...DEFAULT_PLAN, ...params }
  const net = layout.normalized
  if (!net) throw new LayoutPlanError('layout chưa có mạng đường đã nắn')
  if (!net.valid) throw new LayoutPlanError('mạng đường đã nắn không hợp lệ: sửa các lỗi nắn lưới trước')
  const preset = PROFILES[p.profile]
  if (!preset) throw new LayoutPlanError(`profile "${p.profile}" không có (${Object.keys(PROFILES).join(', ')})`)
  if (!Number.isInteger(p.seed)) throw new LayoutPlanError('seed phải là số nguyên')
  const profileOf = (z: LandUseZone): ZoneProfile => p.zones?.[z] ?? preset[z]
  const issues: LayoutIssue[] = []

  const b = net.bounds
  const area: Rect = { minX: Math.floor(b.minX - p.margin), minZ: Math.floor(b.minZ - p.margin), maxX: Math.ceil(b.maxX + p.margin), maxZ: Math.ceil(b.maxZ + p.margin) }

  // Land use and unbuildable land in the world frame.
  const w = (q: XZ) => sourceToWorld(net.frame, q)
  const worldPoly = (g: Polygon): Polygon => ({ outer: g.outer.map(w), holes: g.holes.map((h) => h.map(w)) })
  const zones: WorldZone[] = layout.zones.map((z) => ({ zone: z.zone, polygon: worldPoly(z.polygon), area: Math.abs(signedArea(z.polygon.outer)) })).sort((a, c) => a.area - c.area)
  const zoneAt = (q: XZ): LandUseZone => {
    for (const z of zones) if (pointInOutline(z.polygon.outer, q.x, q.z) && !z.polygon.holes.some((h) => pointInOutline(h, q.x, q.z))) return z.zone
    return layout.defaults.zone
  }
  const restricted = rasterize(
    layout.restricted.flatMap((r) => (r.geometry.type === 'polygon' ? [worldPoly(r.geometry.polygon)] : [])),
    layout.restricted.flatMap((r) => (r.geometry.type === 'line' ? [{ points: r.geometry.points.map(w), width: r.geometry.width }] : [])),
    area,
    p.restrictedCell,
  )

  const sidewalkByClass = SIDEWALKS[p.profile] ?? SIDEWALKS.default
  const reach = Math.max(p.sidewalk ?? 0, ...Object.values(sidewalkByClass)) + 1
  const keptAll = [...(opts.keep ?? [])].sort((a, c) => byString(a.id, c.id))
  const lanes: AccessRoad[] = []
  let segments: Segment[] = []
  let surfaces: LayoutPlan['surfaces'] = []
  let bg: BlockGrid | null = null
  let kept: LayoutParcel[] = keptAll

  for (let pass = 0; pass < 4; pass++) {
    segments = networkSegments(net, layout.network, layout.roads, lanes, { sidewalk: p.sidewalk, sidewalkByClass })
    surfaces = streetSurfaces(segments, area)
    // A kept parcel must still be clear of streets and unbuildable land (the layout may have changed).
    if (pass === 0) {
      kept = keptAll.filter((k) => {
        const r = parcelRect(k)
        const clash = surfaces.some((s) => rectsOverlap(s.rect, r)) || restricted.some((q) => rectsOverlap(q, r)) || r.minX < area.minX || r.maxX > area.maxX || r.minZ < area.minZ || r.maxZ > area.maxZ
        if (clash) issues.push({ severity: 'error', code: 'kept-parcel-conflict', message: `lô giữ lại ${k.id} nay chồng lên đường, vùng cấm hoặc ra ngoài vùng: không giữ được`, ids: [k.id], at: rectCentre(r) })
        return !clash
      })
    }
    bg = findBlocks(area, surfaces, restricted)
    if (!p.accessRoads || pass === 3) break
    const added = planAccessLanes(bg, segments, profileOf, zoneAt, reach, p.accessWidth, lanes, kept.map(parcelRect))
    if (!added.length) break
    lanes.push(...added)
  }
  const grid = bg!

  // Parcels.
  const ctx = { seed: p.seed, profileOf, zoneAt, segments, reach, inset: p.inset }
  const keptRects = kept.map(parcelRect)
  const blockOf = (r: Rect) => grid.blocks.find((bl) => bl.rects.some((q) => rectsOverlap(q, r)))?.id
  const parcels = [
    ...grid.blocks.flatMap((block) => blockParcels(grid.grid, block, ctx, keptRects.filter((r) => block.rects.some((q) => rectsOverlap(q, r))))),
    // Kept exactly; only the block reference follows the block now holding it (the same one while the streets are).
    ...kept.map((k, i) => ({ ...k, block: blockOf(keptRects[i]) ?? k.block })),
  ]
  const used = new Set<string>()
  for (const q of parcels) {
    let id = q.id
    for (let k = 2; used.has(id); k++) id = `${q.id}-${k}`
    used.add(id)
    q.id = id
  }
  parcels.sort((a, c) => a.polygon[0].z - c.polygon[0].z || a.polygon[0].x - c.polygon[0].x || byString(a.id, c.id))

  // Notes.
  if (lanes.length) issues.push({ severity: 'info', code: 'access-roads', message: `thêm ${lanes.length} đường vào khu dân cư cho khối sâu`, ids: lanes.map((l) => l.id) })
  if (grid.slivers) issues.push({ severity: 'info', code: 'sliver-land', message: `${grid.slivers} mảnh đất quá hẹp (< 3 m, tổng ${grid.sliverArea.toFixed(0)} m²) không thành lô` })
  const noAccess = grid.blocks.filter((bl) => parcels.every((q) => q.block !== bl.id || q.access === null))
  if (noAccess.length) issues.push({ severity: 'info', code: 'block-no-access', message: `${noAccess.length} khối không giáp đường nào (chỉ có lô bên trong)`, ids: noAccess.map((x) => x.id) })
  if (kept.length) issues.push({ severity: 'info', code: 'kept-parcels', message: `giữ nguyên ${kept.length} lô`, ids: kept.map((k) => k.id) })

  const plan: LayoutPlan = {
    version: PLAN_VERSION,
    params: p,
    area,
    surfaces,
    accessRoads: lanes,
    blocks: grid.blocks,
    parcels,
    metrics: {
      surfaces: surfaces.length,
      asphalt: surfaces.filter((s) => s.kind === 'asphalt').length,
      dirt: surfaces.filter((s) => s.kind === 'dirt').length,
      sidewalks: surfaces.filter((s) => s.kind === 'sidewalk').length,
      accessRoads: lanes.length,
      blocks: grid.blocks.length,
      parcels: parcels.length,
      lots: parcels.filter((q) => q.kind === 'lot').length,
      open: parcels.filter((q) => q.kind === 'open').length,
      interior: parcels.filter((q) => q.kind === 'interior').length,
      streetArea: quantize(surfaces.reduce((a, s) => a + rectArea(s.rect), 0)),
      parcelArea: quantize(parcels.reduce((a, q) => a + q.area, 0)),
    },
    issues,
  }
  issues.push(...checkPlan(layout, plan, restricted))
  return plan
}

/**
 * Recompute the plan keeping the locked parcels, parcels whose building was chosen by hand (Q2: hand
 * edits are protected by default) and, when `blocks` is given, every parcel outside those blocks.
 * Kept parcels keep their building; the others come back undecided (`build` absent).
 */
export function replan(layout: WorldLayout, previous: LayoutPlan, params: Partial<PlanParams> = {}, blocks?: readonly string[]): LayoutPlan {
  const only = blocks ? new Set(blocks) : null
  const keep = previous.parcels.filter((q) => q.locked || q.build?.source === 'manual' || (only !== null && !only.has(q.block)))
  const next = planLayout(layout, { ...previous.params, ...params }, { keep })
  return previous.catalog ? { ...next, catalog: previous.catalog } : next
}

/**
 * Lanes into blocks too deep for street lots: a service lane through the middle of a residential or
 * commercial block rectangle, between the two streets on its opposite sides, when the rectangle has
 * room for three lot depths plus the lane across it.
 */
function planAccessLanes(bg: BlockGrid, segments: readonly Segment[], profileOf: (z: LandUseZone) => ZoneProfile, zoneAt: (p: XZ) => LandUseZone, reach: number, width: number, existing: readonly AccessRoad[], kept: readonly Rect[]): AccessRoad[] {
  const out: AccessRoad[] = []
  const ids = new Set(existing.map((l) => l.id))
  for (const block of bg.blocks) {
    for (const r of block.rects) {
      const zone = zoneAt(rectCentre(r))
      if (zone !== 'residential' && zone !== 'commercial') continue
      const pr = profileOf(zone)
      if (!pr.subdivide) continue
      const need = 3 * pr.depth[1] + width
      const W = r.maxX - r.minX
      const D = r.maxZ - r.minZ
      const front = (side: Side) => frontOf(bg.grid, r, side, segments, reach)
      const centreOf = (edge: string, axis: 'H' | 'V', at: number) => {
        const s = segments.find((g) => g.edge === edge && g.axis === axis && at >= Math.min(axis === 'V' ? g.a.z : g.a.x, axis === 'V' ? g.b.z : g.b.x) && at <= Math.max(axis === 'V' ? g.a.z : g.a.x, axis === 'V' ? g.b.z : g.b.x))
        return s ? (axis === 'V' ? s.a.x : s.a.z) : null
      }
      const options: { long: number; lane: AccessRoad }[] = []
      if (D >= need && W >= 2 * pr.depth[0]) {
        const wf = front('W')
        const ef = front('E')
        const z = Math.round((r.minZ + r.maxZ) / 2)
        const x0 = wf && centreOf(wf.edge, 'V', z)
        const x1 = ef && centreOf(ef.edge, 'V', z)
        if (wf && ef && x0 !== null && x1 !== null) options.push({ long: D, lane: lane([{ x: x0!, z }, { x: x1!, z }], width, [wf.edge, ef.edge]) })
      }
      if (W >= need && D >= 2 * pr.depth[0]) {
        const nf = front('N')
        const sf = front('S')
        const x = Math.round((r.minX + r.maxX) / 2)
        const z0 = nf && centreOf(nf.edge, 'H', x)
        const z1 = sf && centreOf(sf.edge, 'H', x)
        if (nf && sf && z0 !== null && z1 !== null) options.push({ long: W, lane: lane([{ x, z: z0! }, { x, z: z1! }], width, [nf.edge, sf.edge]) })
      }
      // Never through a kept parcel.
      const clear = (l: AccessRoad) => {
        const [a, c] = l.points
        const r = { minX: Math.min(a.x, c.x) - width / 2, maxX: Math.max(a.x, c.x) + width / 2, minZ: Math.min(a.z, c.z) - width / 2, maxZ: Math.max(a.z, c.z) + width / 2 }
        return !kept.some((k) => rectsOverlap(k, r))
      }
      const pick = options.filter((o) => clear(o.lane)).sort((a, c) => c.long - a.long)[0]
      if (pick && !ids.has(pick.lane.id)) {
        ids.add(pick.lane.id)
        out.push(pick.lane)
      }
    }
  }
  return out.sort((a, c) => byString(a.id, c.id))
}

function lane(points: [XZ, XZ], width: number, joins: [string, string]): AccessRoad {
  const pts: [XZ, XZ] = [{ x: quantize(points[0].x), z: quantize(points[0].z) }, { x: quantize(points[1].x), z: quantize(points[1].z) }]
  return { id: `access-${hashText(JSON.stringify(pts)).slice(0, 8)}`, points: pts, width, joins }
}

/**
 * Invariants of a plan, as issues (errors mean a planner bug or a changed layout): parcels are
 * disjoint, clear of streets and unbuildable land and inside the area; every edge's centre line and
 * every access lane lies on carriageway (connectivity kept); lots touch a street on their access side.
 */
export function checkPlan(layout: WorldLayout, plan: LayoutPlan, restricted: readonly Rect[]): LayoutIssue[] {
  const issues: LayoutIssue[] = []
  const rects = plan.parcels.map((q) => ({ id: q.id, r: parcelRect(q) }))
  const items = rects.map((x) => ({ a: { x: x.r.minX, z: x.r.minZ }, b: { x: x.r.maxX, z: x.r.maxZ }, id: x.id, r: x.r }))
  const found: string[] = []
  bucketPairs(items, (s, t) => {
    if (rectsOverlap(s.r, t.r)) found.push([s.id, t.id].sort(byString).join(' '))
  })
  for (const pair of [...new Set(found)].sort(byString)) issues.push({ severity: 'error', code: 'parcel-overlap', message: `hai lô chồng nhau: ${pair}`, ids: pair.split(' ') })
  const road = plan.surfaces
  for (const x of rects) {
    const s = road.find((q) => rectsOverlap(q.rect, x.r))
    if (s) issues.push({ severity: 'error', code: 'parcel-on-street', message: `lô ${x.id} chồng lên ${s.id}`, ids: [x.id, s.id], at: rectCentre(x.r) })
    if (restricted.some((q) => rectsOverlap(q, x.r))) issues.push({ severity: 'error', code: 'parcel-on-restricted', message: `lô ${x.id} chồng lên vùng cấm xây`, ids: [x.id], at: rectCentre(x.r) })
    const a = plan.area
    if (x.r.minX < a.minX - 1e-6 || x.r.maxX > a.maxX + 1e-6 || x.r.minZ < a.minZ - 1e-6 || x.r.maxZ > a.maxZ + 1e-6) issues.push({ severity: 'error', code: 'parcel-outside', message: `lô ${x.id} ra ngoài vùng`, ids: [x.id] })
  }
  // Connectivity: sample every snapped edge and every lane.
  const carriage = road.filter((q) => q.kind !== 'sidewalk').map((q) => q.rect)
  const onRoad = (p: XZ) => carriage.some((r) => p.x >= r.minX - 1e-6 && p.x <= r.maxX + 1e-6 && p.z >= r.minZ - 1e-6 && p.z <= r.maxZ + 1e-6)
  const lines: { id: string; points: XZ[] }[] = [...(layout.normalized?.edges ?? []).map((e) => ({ id: e.id, points: e.points })), ...plan.accessRoads.map((l) => ({ id: l.id, points: l.points as XZ[] }))]
  for (const l of lines) {
    for (let i = 1; i < l.points.length; i++) {
      const a = l.points[i - 1]
      const b = l.points[i]
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)))
      for (let k = 0; k <= n; k++) {
        const q = { x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n }
        if (!onRoad(q)) {
          issues.push({ severity: 'error', code: 'street-gap', message: `${l.id} có đoạn không nằm trên mặt đường`, ids: [l.id], at: { x: quantize(q.x), z: quantize(q.z) } })
          k = n + 1
          i = l.points.length
        }
      }
    }
  }
  // Lots reach their street.
  const probe = new Set<string>()
  for (const q of plan.parcels) {
    if (q.kind !== 'lot' || !q.access) continue
    const r = parcelRect(q)
    const side = q.access.side
    const alongX = side === 'N' || side === 'S'
    const mid = rectCentre(r)
    const d = FRONT_PROBE
    const p = side === 'N' ? { x: mid.x, z: r.minZ - d } : side === 'S' ? { x: mid.x, z: r.maxZ + d } : side === 'W' ? { x: r.minX - d, z: mid.z } : { x: r.maxX + d, z: mid.z }
    const hit = road.some((s) => p.x >= s.rect.minX && p.x <= s.rect.maxX && p.z >= s.rect.minZ && p.z <= s.rect.maxZ)
    if (!hit && !probe.has(q.id)) {
      probe.add(q.id)
      issues.push({ severity: 'warning', code: 'lot-off-street', message: `lô ${q.id} không chạm đường ở giữa cạnh ${alongX ? 'bắc/nam' : 'đông/tây'} của nó`, ids: [q.id], at: mid })
    }
  }
  return issues
}
