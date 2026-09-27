import type { Rect, XZ } from '../schema.ts'
import { formatJson } from '../format.ts'
import { SLUG } from '../transform.ts'
import { boundsOf, hashText } from './geometry.ts'
import { LayoutImportError, readGeoJson, type GeoJsonReadOptions } from './geojson.ts'
import { buildRoadNetwork, type NetworkOptions } from './network.ts'
import { orthogonalize } from './orthogonalize.ts'
import {
  GRADES,
  LAND_USE_ZONES,
  LAYOUT_FORMAT,
  LAYOUT_FORMAT_VERSION,
  RESTRICTED_KINDS,
  ROAD_CLASSES,
  SIDEWALKS,
  SOURCE_CRS,
  type LandUseZone,
  type LayoutIssue,
  type OrthogonalParams,
  type Polygon,
  type WorldLayout,
} from './schema.ts'

/**
 * GeoJSON → WorldLayout (world generator WG1): read and classify (`geojson.ts`), build the road
 * topology (`network.ts`), normalise it (`orthogonalize.ts`). Deterministic: the same text and options
 * give the same document byte for byte (no time, no randomness, sorted IDs).
 */

export const IMPORTER_NAME = 'geojson-importer'
export const IMPORTER_VERSION = 1
/** Owner decision Q5: MVP test size (m), not an architecture limit. Larger layouts import with a warning. */
export const MVP_EXTENT = 500
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors (ODbL)'

export interface LayoutImportOptions extends GeoJsonReadOptions, NetworkOptions {
  layoutId: string
  name: string
  /** Source file name, recorded for traceability. */
  file?: string
  /** Credit line; OpenStreetMap-looking data gets `OSM_ATTRIBUTION` when none is given. */
  attribution?: string
  /** Land use where no zone covers the ground (default `residential`). */
  defaultZone?: LandUseZone
  /** Warn above this extent (m, default `MVP_EXTENT`). */
  maxExtent?: number
  /** Normalisation parameters, or false to import the source layer only. */
  normalize?: Partial<OrthogonalParams> | false
}

export { LayoutImportError }

export function importGeoJsonLayout(input: string | unknown, opts: LayoutImportOptions): WorldLayout {
  if (!SLUG.test(opts.layoutId)) throw new LayoutImportError(`layoutId "${opts.layoutId}" phải là slug (chữ thường, số, gạch nối)`)
  let data: unknown
  let text: string
  if (typeof input === 'string') {
    text = input.replace(/\r\n/g, '\n')
    try {
      data = JSON.parse(text)
    } catch (e) {
      throw new LayoutImportError(`JSON không hợp lệ: ${(e as Error).message}`)
    }
  } else {
    data = input
    text = JSON.stringify(input)
  }

  const read = readGeoJson(data, opts)
  const issues: LayoutIssue[] = [...read.issues]
  const { network, issues: networkIssues } = buildRoadNetwork(read.roads, read.cutEnds, opts)
  issues.push(...networkIssues)

  const extent = boundsOf(allPoints(read)) ?? { minX: 0, minZ: 0, maxX: 0, maxZ: 0 }
  const maxExtent = opts.maxExtent ?? MVP_EXTENT
  const w = extent.maxX - extent.minX
  const d = extent.maxZ - extent.minZ
  if (w > maxExtent || d > maxExtent) issues.push({ severity: 'warning', code: 'extent-over-limit', message: `layout rộng ${w.toFixed(0)} × ${d.toFixed(0)} m, vượt giới hạn thử nghiệm ${maxExtent} × ${maxExtent} m (dùng clip để cắt bớt)` })
  if (!network.edges.length) issues.push({ severity: 'error', code: 'no-roads', message: 'không có đường nào thuộc mạng lưới: chưa sinh được world từ layout này' })
  const defaultZone = opts.defaultZone ?? 'residential'
  if (!read.zones.length) issues.push({ severity: 'warning', code: 'no-landuse', message: `dữ liệu không có vùng sử dụng đất: mọi khu đất ngoài đường và vùng cấm dùng zone mặc định "${defaultZone}"` })
  if (!read.parcels.length) issues.push({ severity: 'info', code: 'no-parcels', message: 'dữ liệu không có lô đất: WG2 chia lô từ các khối giữa đường' })
  let attribution = opts.attribution ?? null
  if (!attribution && read.osm) {
    attribution = OSM_ATTRIBUTION
    issues.push({ severity: 'info', code: 'attribution', message: `dữ liệu OpenStreetMap: ghi công "${OSM_ATTRIBUTION}" trong credit của game` })
  }

  const layout: WorldLayout = {
    format: LAYOUT_FORMAT,
    formatVersion: LAYOUT_FORMAT_VERSION,
    layoutId: opts.layoutId,
    name: opts.name,
    source: { kind: 'geojson', file: opts.file, hash: `cyrb53:${hashText(text)}`, crs: read.crs, attribution, features: read.features },
    importer: { name: IMPORTER_NAME, version: IMPORTER_VERSION },
    projection: read.projection,
    clip: read.clip,
    extent,
    defaults: { zone: defaultZone },
    roads: read.roads,
    network,
    zones: read.zones,
    restricted: read.restricted,
    buildings: read.buildings,
    parcels: read.parcels,
    issues,
    normalized: null,
  }
  return opts.normalize === false ? layout : renormalize(layout, opts.normalize ?? {})
}

/** Recompute the normalised layer with new parameters; the source layer is shared, never changed. */
export function renormalize(layout: WorldLayout, params: Partial<OrthogonalParams> = {}): WorldLayout {
  return { ...layout, normalized: layout.network.edges.length ? orthogonalize(layout.network, layout.roads, params) : null }
}

export function serializeWorldLayout(layout: WorldLayout): string {
  return formatJson(layout)
}

/** Parse and check a layout file; throws `LayoutImportError` listing the errors. */
export function parseWorldLayout(text: string): WorldLayout {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new LayoutImportError(`JSON không hợp lệ: ${(e as Error).message}`)
  }
  const errors = checkWorldLayout(data).filter((i) => i.severity === 'error')
  if (errors.length) throw new LayoutImportError(`layout không hợp lệ: ${errors.slice(0, 5).map((e) => e.message).join('; ')}`, errors)
  return data as WorldLayout
}

function allPoints(r: { roads: { points: XZ[] }[]; zones: { polygon: Polygon }[]; restricted: WorldLayout['restricted']; buildings: { polygon: Polygon }[]; parcels: { polygon: Polygon }[] }): XZ[] {
  const out: XZ[] = []
  for (const x of r.roads) out.push(...x.points)
  for (const x of [...r.zones, ...r.buildings, ...r.parcels]) out.push(...x.polygon.outer)
  for (const x of r.restricted) out.push(...(x.geometry.type === 'line' ? x.geometry.points : x.geometry.polygon.outer))
  return out
}

// ---- Validation of a stored layout (structure and references; the importer's own output always passes) ----

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isXZ = (v: unknown): v is XZ => !!v && typeof v === 'object' && isNum((v as XZ).x) && isNum((v as XZ).z)
const isRect = (v: unknown): v is Rect => !!v && typeof v === 'object' && ['minX', 'minZ', 'maxX', 'maxZ'].every((k) => isNum((v as Record<string, unknown>)[k]))

export function checkWorldLayout(data: unknown): LayoutIssue[] {
  const issues: LayoutIssue[] = []
  const err = (code: string, message: string, ids?: string[]) => issues.push({ severity: 'error', code, message, ids })
  if (!data || typeof data !== 'object') {
    err('schema', 'layout phải là một object')
    return issues
  }
  const l = data as Partial<WorldLayout>
  if (l.format !== LAYOUT_FORMAT) err('format', `format phải là "${LAYOUT_FORMAT}"`)
  if (l.formatVersion !== LAYOUT_FORMAT_VERSION) {
    err('unsupported-version', `formatVersion ${String(l.formatVersion)} không hỗ trợ (hiện là ${LAYOUT_FORMAT_VERSION})`)
    return issues
  }
  if (typeof l.layoutId !== 'string' || !SLUG.test(l.layoutId)) err('invalid-id', 'layoutId phải là slug')
  if (typeof l.name !== 'string') err('schema', 'thiếu name')
  if (!l.source || l.source.kind !== 'geojson' || !(SOURCE_CRS as readonly string[]).includes(l.source.crs)) err('schema', 'source không hợp lệ')
  if (!l.projection || (l.projection.method !== 'local-tangent-plane' && l.projection.method !== 'local-metres')) err('schema', 'projection không hợp lệ')
  if (!isRect(l.extent)) err('schema', 'extent không hợp lệ')
  if (!l.defaults || !(LAND_USE_ZONES as readonly string[]).includes(l.defaults.zone)) err('schema', 'defaults.zone không hợp lệ')
  const lists = ['roads', 'zones', 'restricted', 'buildings', 'parcels', 'issues'] as const
  for (const k of lists) if (!Array.isArray(l[k])) err('schema', `thiếu mảng ${k}`)
  if (!l.network || !Array.isArray(l.network.nodes) || !Array.isArray(l.network.edges) || !Array.isArray(l.network.crossings)) err('schema', 'network không hợp lệ')
  if (issues.length) return issues

  const ids = new Set<string>()
  const unique = (id: unknown, what: string) => {
    if (typeof id !== 'string' || !SLUG.test(id)) return void err('invalid-id', `${what}: ID ${JSON.stringify(id)} không phải slug`)
    if (ids.has(id)) err('duplicate-id', `${what}: ID ${id} bị trùng`, [id])
    ids.add(id)
  }
  const line = (pts: unknown, min: number, what: string) => {
    if (!Array.isArray(pts) || pts.length < min || !pts.every(isXZ)) err('geometry', `${what}: cần ít nhất ${min} điểm hữu hạn`)
  }
  const polygon = (p: unknown, what: string) => {
    const g = p as Polygon | undefined
    if (!g || !Array.isArray(g.holes)) return void err('geometry', `${what}: polygon không hợp lệ`)
    line(g.outer, 3, what)
    g.holes.forEach((h, i) => line(h, 3, `${what} lỗ ${i}`))
  }
  const L = l as WorldLayout
  for (const r of L.roads) {
    unique(r.id, 'đường')
    line(r.points, 2, `đường ${r.id}`)
    if (!(ROAD_CLASSES as readonly string[]).includes(r.class) || !(SIDEWALKS as readonly string[]).includes(r.sidewalk) || !(GRADES as readonly string[]).includes(r.grade)) err('schema', `đường ${r.id}: thuộc tính không hợp lệ`, [r.id])
    if (!isNum(r.width) || r.width <= 0 || !Number.isInteger(r.lanes) || r.lanes < 1) err('schema', `đường ${r.id}: bề rộng/số làn không hợp lệ`, [r.id])
  }
  for (const z of L.zones) {
    unique(z.id, 'vùng')
    polygon(z.polygon, `vùng ${z.id}`)
    if (!(LAND_USE_ZONES as readonly string[]).includes(z.zone)) err('schema', `vùng ${z.id}: zone không hợp lệ`, [z.id])
  }
  for (const r of L.restricted) {
    unique(r.id, 'vùng cấm')
    if (!(RESTRICTED_KINDS as readonly string[]).includes(r.kind)) err('schema', `vùng cấm ${r.id}: loại không hợp lệ`, [r.id])
    if (r.geometry?.type === 'line') {
      line(r.geometry.points, 2, `vùng cấm ${r.id}`)
      if (!isNum(r.geometry.width) || r.geometry.width <= 0) err('schema', `vùng cấm ${r.id}: bề rộng không hợp lệ`, [r.id])
    } else if (r.geometry?.type === 'polygon') polygon(r.geometry.polygon, `vùng cấm ${r.id}`)
    else err('geometry', `vùng cấm ${r.id}: geometry không hợp lệ`, [r.id])
  }
  for (const b of L.buildings) {
    unique(b.id, 'nhà')
    polygon(b.polygon, `nhà ${b.id}`)
  }
  for (const p of L.parcels) {
    unique(p.id, 'lô')
    polygon(p.polygon, `lô ${p.id}`)
  }

  // Network: references and endpoint positions.
  const roadIds = new Set(L.roads.map((r) => r.id))
  const nodes = new Map<string, XZ>()
  for (const n of L.network.nodes) {
    unique(n.id, 'node')
    if (!isXZ(n.position)) err('geometry', `node ${n.id}: vị trí không hợp lệ`, [n.id])
    nodes.set(n.id, n.position)
  }
  const same = (a: XZ | undefined, b: XZ | undefined) => !!a && !!b && a.x === b.x && a.z === b.z
  for (const e of L.network.edges) {
    unique(e.id, 'cạnh')
    line(e.points, 2, `cạnh ${e.id}`)
    if (!roadIds.has(e.roadId)) err('reference', `cạnh ${e.id}: đường ${e.roadId} không tồn tại`, [e.id])
    if (!nodes.has(e.from) || !nodes.has(e.to)) err('reference', `cạnh ${e.id}: node đầu/cuối không tồn tại`, [e.id])
    else if (Array.isArray(e.points) && (!same(e.points[0], nodes.get(e.from)) || !same(e.points[e.points.length - 1], nodes.get(e.to)))) err('geometry', `cạnh ${e.id}: đầu mút không trùng node`, [e.id])
  }

  const n = L.normalized
  if (n !== null && n !== undefined) {
    if (n.method !== 'orthogonal' || !n.frame || !isNum(n.frame.rotationDeg) || !isXZ(n.frame.offset)) err('schema', 'normalized: method/frame không hợp lệ')
    const sourceEdges = new Map(L.network.edges.map((e) => [e.id, e]))
    const pos = new Map((n.nodes ?? []).map((x) => [x.id, x.position]))
    if ((n.nodes ?? []).length !== L.network.nodes.length || (n.nodes ?? []).some((x) => !nodes.has(x.id))) err('reference', 'normalized: tập node khác mạng lưới gốc')
    if ((n.edges ?? []).length !== L.network.edges.length) err('reference', 'normalized: tập cạnh khác mạng lưới gốc')
    for (const e of n.edges ?? []) {
      const src = sourceEdges.get(e.id)
      if (!src || src.from !== e.from || src.to !== e.to) {
        err('reference', `normalized: cạnh ${e.id} không khớp mạng lưới gốc`, [e.id])
        continue
      }
      line(e.points, 2, `normalized ${e.id}`)
      if (!Array.isArray(e.points) || !e.points.every(isXZ)) continue
      for (let i = 1; i < e.points.length; i++) {
        const a = e.points[i - 1]
        const b = e.points[i]
        if (a.x !== b.x && a.z !== b.z) err('geometry', `normalized ${e.id}: đoạn ${i} không song song trục`, [e.id])
      }
      if (!same(e.points[0], pos.get(e.from)) || !same(e.points[e.points.length - 1], pos.get(e.to))) err('geometry', `normalized ${e.id}: đầu mút không trùng node`, [e.id])
    }
  }

  // WG2 plan (optional): structure, IDs and references.
  const plan = L.plan
  if (plan !== null && plan !== undefined) {
    if (!n) err('reference', 'plan: cần lớp normalized')
    if (!isRect(plan.area) || !Array.isArray(plan.surfaces) || !Array.isArray(plan.accessRoads) || !Array.isArray(plan.blocks) || !Array.isArray(plan.parcels) || !Array.isArray(plan.issues) || !plan.params) {
      err('schema', 'plan không hợp lệ')
      return issues
    }
    const planIds = new Set<string>()
    const planUnique = (id: unknown, what: string) => {
      if (typeof id !== 'string' || !SLUG.test(id)) return void err('invalid-id', `plan ${what}: ID ${JSON.stringify(id)} không phải slug`)
      if (planIds.has(id)) err('duplicate-id', `plan ${what}: ID ${id} bị trùng`, [id])
      planIds.add(id)
    }
    for (const s of plan.surfaces) {
      planUnique(s.id, 'mặt đường')
      if (!['asphalt', 'dirt', 'sidewalk'].includes(s.kind) || !isRect(s.rect) || s.rect.maxX <= s.rect.minX || s.rect.maxZ <= s.rect.minZ) err('schema', `plan mặt đường ${s.id} không hợp lệ`, [s.id])
    }
    const edgeIds = new Set([...(n?.edges ?? []).map((e) => e.id), ...plan.accessRoads.map((a) => a.id)])
    for (const a of plan.accessRoads) {
      planUnique(a.id, 'đường vào')
      line(a.points, 2, `plan đường vào ${a.id}`)
      if (!Array.isArray(a.joins) || a.joins.some((j) => !edgeIds.has(j))) err('reference', `plan đường vào ${a.id}: nối vào cạnh không tồn tại`, [a.id])
    }
    const blockIds = new Set<string>()
    for (const b of plan.blocks) {
      planUnique(b.id, 'khối')
      blockIds.add(b.id)
      if (!Array.isArray(b.rects) || !b.rects.every(isRect)) err('schema', `plan khối ${b.id} không hợp lệ`, [b.id])
    }
    for (const q of plan.parcels) {
      planUnique(q.id, 'lô')
      line(q.polygon, 4, `plan lô ${q.id}`)
      if (!(LAND_USE_ZONES as readonly string[]).includes(q.zone) || !['lot', 'open', 'interior'].includes(q.kind) || typeof q.locked !== 'boolean' || !Number.isInteger(q.seed)) err('schema', `plan lô ${q.id}: thuộc tính không hợp lệ`, [q.id])
      if (q.access && (!['N', 'S', 'E', 'W'].includes(q.access.side) || !edgeIds.has(q.access.edge))) err('reference', `plan lô ${q.id}: lối ra đường không hợp lệ`, [q.id])
      if (q.buildable !== null && !isRect(q.buildable)) err('schema', `plan lô ${q.id}: buildable không hợp lệ`, [q.id])
      if (!blockIds.has(q.block)) err('reference', `plan lô ${q.id}: khối ${q.block} không tồn tại`, [q.id])
    }
  }
  return issues
}
