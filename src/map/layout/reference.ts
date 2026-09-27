import type { XZ } from '../schema.ts'
import { quantize } from '../transform.ts'
import { controlResiduals, fitAffine, fitSimilarity, imageToWorld, invertImageTransform, type ControlPoint, type ImagePoint, type ImageTransform } from './coordinates.ts'
import { hashText, segmentIntersection } from './geometry.ts'
import { LAND_USE_ZONES, RESTRICTED_KINDS, ROAD_CLASSES, SIDEWALKS, type LandUseZone, type LayoutIssue, type RestrictedKind, type RoadClass, type Sidewalk } from './schema.ts'

/**
 * ReferenceImporter for images (world generator WG6, `docs/writing-block.md` §4B): a map picture the
 * author may use is shown under the editor viewport, calibrated with control points (or a measured
 * distance), and traced by hand: roads (junctions made where they meet or cross), junction marks,
 * land-use zones and unbuildable areas. Nothing about the picture is assumed: no geographic
 * coordinates, no scale — until the author gives them.
 *
 * The tracing lives in the world folder as `layout/reference.json` (editor only, like the layout).
 * Features are stored in image pixels, so recalibrating moves them with the picture. Extraction is a
 * replaceable module (`LayoutExtractor`): the hand tracer turns the features into GeoJSON in local
 * metres, which goes through the same importer as any GeoJSON; a future image-segmentation model
 * would produce the same GeoJSON and reach the same WorldLayout.
 */

export const REFERENCE_FILE = 'layout/reference.json'
export const REFERENCE_FORMAT = 'zombie-outbreak/layout-reference'
export const REFERENCE_FORMAT_VERSION = 1
/** Largest picture kept in a world (bytes of its data URL): drafts and packs stay reasonable. */
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024
/** Scale of a picture nobody calibrated yet (m per pixel). */
export const DEFAULT_METRES_PER_PIXEL = 0.5

export interface ReferenceImage {
  name: string
  mime: string
  width: number
  height: number
  /** `cyrb53:` hash of the data URL (the same picture is recognised when attached again). */
  hash: string
  dataUrl: string
}

export type TraceKind = 'road' | 'zone' | 'restricted'

export interface TracedRoad {
  class: RoadClass
  lanes: number
  sidewalk: Sidewalk
  /** Dirt surface (unpaved). */
  unpaved: boolean
  name?: string
}

export interface TracedFeature {
  /** `road-<n>`, `zone-<n>`, `area-<n>`: stable, never reused. */
  id: string
  kind: TraceKind
  /** Image pixels: a polyline (road), an open ring (zone, restricted). */
  points: ImagePoint[]
  road?: TracedRoad
  zone?: LandUseZone
  restricted?: RestrictedKind
}

export interface ReferenceCalibration {
  /** Image pixel ↔ world metres (X east, Z south). Fewer than 2: the default scale around the origin. */
  points: ControlPoint[]
  method: 'similarity' | 'affine'
}

export interface ReferenceTracing {
  format: typeof REFERENCE_FORMAT
  formatVersion: number
  /** Null: drawing by hand on an empty grid (1 pixel = 1 m). */
  image: ReferenceImage | null
  calibration: ReferenceCalibration
  features: TracedFeature[]
  /** Next feature number (IDs are never reused, like record IDs). */
  nextId: number
}

export function emptyTracing(image: ReferenceImage | null = null): ReferenceTracing {
  return { format: REFERENCE_FORMAT, formatVersion: REFERENCE_FORMAT_VERSION, image, calibration: { points: [], method: 'similarity' }, features: [], nextId: 1 }
}

export const ROAD_DEFAULTS: Record<RoadClass, Omit<TracedRoad, 'name'>> = {
  arterial: { class: 'arterial', lanes: 4, sidewalk: 'both', unpaved: false },
  collector: { class: 'collector', lanes: 2, sidewalk: 'both', unpaved: false },
  local: { class: 'local', lanes: 2, sidewalk: 'both', unpaved: false },
  service: { class: 'service', lanes: 1, sidewalk: 'none', unpaved: false },
  track: { class: 'track', lanes: 1, sidewalk: 'none', unpaved: true },
  path: { class: 'path', lanes: 1, sidewalk: 'none', unpaved: true },
}

// ---- Calibration ----

/**
 * Image → world metres. Two or more points: similarity (three or more with `affine`: a skewed scan);
 * one point: the default scale with that point where it belongs; none: the default scale centred on
 * the origin (1 px = 1 m without a picture).
 */
export function referenceTransform(ref: ReferenceTracing): ImageTransform {
  const pts = ref.calibration.points
  if (pts.length >= 3 && ref.calibration.method === 'affine') return fitAffine(pts)
  if (pts.length >= 2) return fitSimilarity(pts)
  const m = ref.image ? DEFAULT_METRES_PER_PIXEL : 1
  const w = ref.image?.width ?? 0
  const h = ref.image?.height ?? 0
  if (pts.length === 1) return { a: m, b: 0, c: 0, d: m, tx: pts[0].world.x - m * pts[0].image.u, tz: pts[0].world.z - m * pts[0].image.v }
  return { a: m, b: 0, c: 0, d: m, tx: -(m * w) / 2, tz: -(m * h) / 2 }
}

/** Metres per image pixel of a transform (geometric mean of its two axes). */
export function metresPerPixel(t: ImageTransform): number {
  return Math.sqrt(Math.abs(t.a * t.d - t.b * t.c))
}

export function pixelToMetres(ref: ReferenceTracing, p: ImagePoint): XZ {
  return imageToWorld(referenceTransform(ref), p)
}

export function metresToPixel(ref: ReferenceTracing, p: XZ): ImagePoint {
  const w = imageToWorld(invertImageTransform(referenceTransform(ref)), { u: p.x, v: p.z })
  return { u: w.x, v: w.z }
}

/** Calibration quality: residuals of the control points (m). */
export function calibrationError(ref: ReferenceTracing): { rms: number; max: number } | null {
  return ref.calibration.points.length >= 3 ? controlResiduals(referenceTransform(ref), ref.calibration.points) : null
}

/**
 * Scale from a measured distance: the picture keeps its position and direction, `a` and `b` (pixels)
 * end up `metres` apart. Replaces the control points by these two.
 */
export function measureScale(ref: ReferenceTracing, a: ImagePoint, b: ImagePoint, metres: number): ReferenceTracing {
  if (!(metres > 0)) throw new Error('khoảng cách phải lớn hơn 0')
  if (Math.hypot(a.u - b.u, a.v - b.v) < 1) throw new Error('hai điểm đo trùng nhau')
  const wa = pixelToMetres(ref, a)
  const wb = pixelToMetres(ref, b)
  const len = Math.hypot(wb.x - wa.x, wb.z - wa.z) || 1
  const dir = { x: (wb.x - wa.x) / len, z: (wb.z - wa.z) / len }
  const world = { x: quantize(wa.x + dir.x * metres), z: quantize(wa.z + dir.z * metres) }
  return { ...ref, calibration: { method: 'similarity', points: [{ image: a, world: { x: quantize(wa.x), z: quantize(wa.z) } }, { image: b, world }] } }
}

// ---- Editing (pure: tracing → tracing) ----

const dist = (a: ImagePoint, b: ImagePoint) => Math.hypot(a.u - b.u, a.v - b.v)
const q2 = (p: ImagePoint): ImagePoint => ({ u: Math.round(p.u * 100) / 100, v: Math.round(p.v * 100) / 100 })

function withFeature(ref: ReferenceTracing, f: Omit<TracedFeature, 'id'>, prefix: string): { ref: ReferenceTracing; id: string } {
  const id = `${prefix}-${ref.nextId}`
  return { ref: { ...ref, features: [...ref.features, { ...f, id, points: f.points.map(q2) }], nextId: ref.nextId + 1 }, id }
}

/** Nearest road vertex within `tol` pixels. */
export function nearestVertex(ref: ReferenceTracing, p: ImagePoint, tol: number, except?: string): ImagePoint | null {
  let best: ImagePoint | null = null
  let bd = tol
  for (const f of ref.features) {
    if (f.kind !== 'road' || f.id === except) continue
    for (const v of f.points) {
      const d = dist(v, p)
      if (d <= bd) {
        bd = d
        best = v
      }
    }
  }
  return best
}

/** Nearest point on a road segment within `tol` pixels (and which road and segment). */
function nearestOnRoad(ref: ReferenceTracing, p: ImagePoint, tol: number): { id: string; seg: number; at: ImagePoint } | null {
  let best: { id: string; seg: number; at: ImagePoint } | null = null
  let bd = tol
  for (const f of ref.features) {
    if (f.kind !== 'road') continue
    for (let i = 1; i < f.points.length; i++) {
      const a = f.points[i - 1]
      const b = f.points[i]
      const L = dist(a, b) ** 2
      const t = L ? Math.max(0, Math.min(1, ((p.u - a.u) * (b.u - a.u) + (p.v - a.v) * (b.v - a.v)) / L)) : 0
      const at = { u: a.u + t * (b.u - a.u), v: a.v + t * (b.v - a.v) }
      const d = dist(at, p)
      if (d <= bd) {
        bd = d
        best = { id: f.id, seg: i, at }
      }
    }
  }
  return best
}

/** Put a vertex into a road at `at` (no-op when one is there already). */
function insertVertex(ref: ReferenceTracing, id: string, at: ImagePoint): ReferenceTracing {
  return {
    ...ref,
    features: ref.features.map((f) => {
      if (f.id !== id || f.points.some((v) => dist(v, at) < 0.01)) return f
      let seg = -1
      let bd = Infinity
      for (let i = 1; i < f.points.length; i++) {
        const a = f.points[i - 1]
        const b = f.points[i]
        const d = dist(a, at) + dist(at, b) - dist(a, b)
        if (d < bd) {
          bd = d
          seg = i
        }
      }
      return { ...f, points: [...f.points.slice(0, seg), q2(at), ...f.points.slice(seg)] }
    }),
  }
}

/**
 * Snap a point being traced: onto an existing road vertex, else onto a road (a vertex is inserted
 * there: a junction), else as it is. Returns the tracing with the insertion and the point to use.
 */
export function snapRoadPoint(ref: ReferenceTracing, p: ImagePoint, tol: number): { ref: ReferenceTracing; point: ImagePoint; snapped: boolean } {
  const v = nearestVertex(ref, p, tol)
  if (v) return { ref, point: v, snapped: true }
  const on = nearestOnRoad(ref, p, tol)
  if (on) {
    const at = q2(on.at)
    return { ref: insertVertex(ref, on.id, at), point: at, snapped: true }
  }
  return { ref, point: q2(p), snapped: false }
}

/**
 * Add a traced road. Its end points were snapped while tracing; where it crosses an existing road at
 * the same level a shared vertex is added to both (a junction: the importer never joins roads that
 * only cross). `autoJunctions` false keeps crossings as they are (a bridge the author will tag).
 */
export function addRoad(ref: ReferenceTracing, points: readonly ImagePoint[], road: TracedRoad, autoJunctions = true): { ref: ReferenceTracing; id: string } {
  const pts = points.filter((p, i) => i === 0 || dist(p, points[i - 1]) > 0.01)
  if (pts.length < 2) throw new Error('đường cần ít nhất 2 điểm')
  let out = ref
  let mine = [...pts]
  if (autoJunctions) {
    for (const f of ref.features) {
      if (f.kind !== 'road') continue
      for (let j = 1; j < f.points.length; j++) {
        for (let i = 1; i < mine.length; i++) {
          const a = mine[i - 1]
          const b = mine[i]
          const c = f.points[j - 1]
          const d = f.points[j]
          const x = segmentIntersection({ x: a.u, z: a.v }, { x: b.u, z: b.v }, { x: c.u, z: c.v }, { x: d.u, z: d.v })
          if (!x) continue
          const at = q2({ u: x.x, v: x.z })
          // Touching at an existing vertex is a junction already.
          if ([a, b].some((p) => dist(p, at) < 0.05) && [c, d].some((p) => dist(p, at) < 0.05)) continue
          out = insertVertex(out, f.id, at)
          if (!mine.some((p) => dist(p, at) < 0.05)) {
            mine = [...mine.slice(0, i), at, ...mine.slice(i)]
            i++
          }
        }
      }
    }
  }
  return withFeature(out, { kind: 'road', points: mine, road }, 'road')
}

/** Close an area (zone or unbuildable land). */
export function addArea(ref: ReferenceTracing, points: readonly ImagePoint[], area: { zone: LandUseZone } | { restricted: RestrictedKind }): { ref: ReferenceTracing; id: string } {
  if (points.length < 3) throw new Error('vùng cần ít nhất 3 điểm')
  return 'zone' in area ? withFeature(ref, { kind: 'zone', points: [...points], zone: area.zone }, 'zone') : withFeature(ref, { kind: 'restricted', points: [...points], restricted: area.restricted }, 'area')
}

/**
 * Junction mark: every road vertex within `radius` pixels of `at` moves onto one point, and roads
 * passing within it get a vertex there. Fixes near misses of a hand trace (or of a picture).
 */
export function markJunction(ref: ReferenceTracing, at: ImagePoint, radius: number): { ref: ReferenceTracing; roads: number } {
  const target = nearestVertex(ref, at, radius) ?? q2(at)
  let out: ReferenceTracing = {
    ...ref,
    features: ref.features.map((f) => (f.kind === 'road' ? { ...f, points: f.points.map((v) => (dist(v, target) <= radius ? target : v)) } : f)),
  }
  for (const f of out.features) {
    if (f.kind !== 'road' || f.points.some((v) => dist(v, target) < 0.01)) continue
    const on = nearestOnRoad({ ...out, features: [f] }, target, radius)
    if (on) out = insertVertex(out, f.id, target)
  }
  // A road may now repeat the point (two vertices merged): drop repeats.
  out = { ...out, features: out.features.map((f) => (f.kind === 'road' ? { ...f, points: f.points.filter((p, i) => i === 0 || dist(p, f.points[i - 1]) > 0.01) } : f)) }
  const roads = out.features.filter((f) => f.kind === 'road' && f.points.some((v) => dist(v, target) < 0.01)).length
  return { ref: out, roads }
}

export function updateFeature(ref: ReferenceTracing, id: string, patch: Partial<Omit<TracedFeature, 'id' | 'kind'>>): ReferenceTracing {
  if (!ref.features.some((f) => f.id === id)) throw new Error(`không có ${id}`)
  return { ...ref, features: ref.features.map((f) => (f.id === id ? { ...f, ...patch, ...(patch.points ? { points: patch.points.map(q2) } : {}) } : f)) }
}

export function removeFeatures(ref: ReferenceTracing, ids: readonly string[]): ReferenceTracing {
  const gone = new Set(ids)
  return { ...ref, features: ref.features.filter((f) => !gone.has(f.id)) }
}

/**
 * Move a vertex. On a road, every road vertex at the same point moves too (a junction stays a
 * junction); the new place snaps onto another road vertex within `tol`.
 */
export function moveVertex(ref: ReferenceTracing, id: string, index: number, to: ImagePoint, tol = 0): ReferenceTracing {
  const f = ref.features.find((x) => x.id === id)
  if (!f || !f.points[index]) throw new Error(`không có đỉnh ${index} của ${id}`)
  const from = f.points[index]
  const target = f.kind === 'road' && tol > 0 ? (nearestVertex({ ...ref, features: ref.features.map((x) => (x.id === id ? { ...x, points: x.points.filter((_, i) => i !== index) } : x)) }, to, tol) ?? q2(to)) : q2(to)
  return {
    ...ref,
    features: ref.features.map((x) => {
      if (x.id === id) return { ...x, points: x.points.map((v, i) => (i === index ? target : v)) }
      if (f.kind === 'road' && x.kind === 'road') return { ...x, points: x.points.map((v) => (dist(v, from) < 0.01 ? target : v)) }
      return x
    }),
  }
}

/** Nearest feature to a point (vertices and edges; areas also by containment), within `tol` pixels. */
export function featureAt(ref: ReferenceTracing, p: ImagePoint, tol: number): { id: string; vertex: number | null } | null {
  let best: { id: string; vertex: number | null; d: number } | null = null
  for (const f of ref.features) {
    f.points.forEach((v, i) => {
      const d = dist(v, p)
      if (d <= tol && (!best || d < best.d - 1e-9 || (best.vertex === null && d <= best.d))) best = { id: f.id, vertex: i, d }
    })
    const ring = f.kind === 'road' ? f.points : [...f.points, f.points[0]]
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1]
      const b = ring[i]
      const L = dist(a, b) ** 2
      const t = L ? Math.max(0, Math.min(1, ((p.u - a.u) * (b.u - a.u) + (p.v - a.v) * (b.v - a.v)) / L)) : 0
      const d = dist({ u: a.u + t * (b.u - a.u), v: a.v + t * (b.v - a.v) }, p)
      if (d <= tol && (!best || d < best.d)) best = { id: f.id, vertex: null, d }
    }
  }
  if (best) return { id: (best as { id: string }).id, vertex: (best as { vertex: number | null }).vertex }
  // Inside an area (the smallest).
  const inside = ref.features.filter((f) => f.kind !== 'road' && pointInRing(p, f.points)).sort((a, b) => ringArea(a.points) - ringArea(b.points))[0]
  return inside ? { id: inside.id, vertex: null } : null
}

function pointInRing(p: ImagePoint, ring: readonly ImagePoint[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.v > p.v !== b.v > p.v && p.u < ((b.u - a.u) * (p.v - a.v)) / (b.v - a.v) + a.u) inside = !inside
  }
  return inside
}

function ringArea(ring: readonly ImagePoint[]): number {
  let s = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j].u + ring[i].u) * (ring[j].v - ring[i].v)
  return Math.abs(s / 2)
}

// ---- Extraction (replaceable) ----

/** GeoJSON in local metres (x east, y north), the importer's input. */
export interface LayoutGeoJson {
  type: 'FeatureCollection'
  'worldgen:crs': 'local-metres'
  features: { type: 'Feature'; id: string; properties: Record<string, string>; geometry: { type: 'LineString'; coordinates: [number, number][] } | { type: 'Polygon'; coordinates: [number, number][][] } }[]
}

/**
 * Image Layout Extraction (§4B): turns a reference into GeoJSON the importer understands. The hand
 * tracer below is the first implementation; an image-segmentation model would be another one with
 * the same output, so the rest of the pipeline never changes.
 */
export interface LayoutExtractor<Input> {
  id: string
  label: string
  extract(input: Input): { geojson: LayoutGeoJson; issues: LayoutIssue[] }
}

const r3 = (v: number) => Math.round(v * 1000) / 1000

export const HAND_TRACING: LayoutExtractor<ReferenceTracing> = {
  id: 'hand-tracing',
  label: 'Vẽ tay trên ảnh tham chiếu',
  extract(ref) {
    const issues: LayoutIssue[] = []
    const t = referenceTransform(ref)
    const xy = (p: ImagePoint): [number, number] => {
      const w = imageToWorld(t, p)
      return [r3(w.x), r3(-w.z)]
    }
    const features: LayoutGeoJson['features'] = []
    for (const f of ref.features) {
      const id = `trace/${f.id}`
      if (f.kind === 'road' && f.road) {
        if (f.points.length < 2) {
          issues.push({ severity: 'warning', code: 'trace-short', message: `${f.id}: đường chỉ có một điểm, bỏ qua`, ids: [f.id] })
          continue
        }
        const props: Record<string, string> = { 'worldgen:road': f.road.class, lanes: String(f.road.lanes), sidewalk: f.road.sidewalk === 'none' ? 'no' : f.road.sidewalk }
        if (f.road.unpaved) props.surface = 'unpaved'
        if (f.road.name) props.name = f.road.name
        features.push({ type: 'Feature', id, properties: props, geometry: { type: 'LineString', coordinates: f.points.map(xy) } })
      } else if (f.points.length >= 3 && (f.zone || f.restricted)) {
        const ring = f.points.map(xy)
        const props: Record<string, string> = f.kind === 'zone' ? { 'worldgen:zone': f.zone! } : { 'worldgen:restricted': f.restricted! }
        features.push({ type: 'Feature', id, properties: props, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } })
      }
    }
    if (!features.some((f) => f.geometry.type === 'LineString')) issues.push({ severity: 'error', code: 'trace-no-roads', message: 'chưa vẽ đường nào: cần ít nhất một đường để sinh world' })
    if (!ref.image && ref.calibration.points.length < 2) issues.push({ severity: 'info', code: 'trace-no-image', message: 'vẽ tay không có ảnh: 1 ô = 1 m' })
    else if (ref.image && ref.calibration.points.length < 2) issues.push({ severity: 'warning', code: 'trace-uncalibrated', message: `ảnh chưa hiệu chỉnh: dùng tỷ lệ mặc định ${DEFAULT_METRES_PER_PIXEL} m/pixel (Đo tỷ lệ hoặc thêm điểm hiệu chỉnh)` })
    return { geojson: { type: 'FeatureCollection', 'worldgen:crs': 'local-metres', features }, issues }
  },
}

// ---- Storage checks ----

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isPx = (p: unknown): p is ImagePoint => !!p && typeof p === 'object' && isNum((p as ImagePoint).u) && isNum((p as ImagePoint).v)

export function checkReference(data: unknown): LayoutIssue[] {
  const issues: LayoutIssue[] = []
  const err = (message: string, ids?: string[]) => issues.push({ severity: 'error', code: 'schema', message, ids })
  const r = data as Partial<ReferenceTracing> | null
  if (!r || typeof r !== 'object' || r.format !== REFERENCE_FORMAT) return [{ severity: 'error', code: 'format', message: `reference phải có format "${REFERENCE_FORMAT}"` }]
  if (r.formatVersion !== REFERENCE_FORMAT_VERSION) return [{ severity: 'error', code: 'unsupported-version', message: `reference formatVersion ${String(r.formatVersion)} không hỗ trợ` }]
  if (r.image !== null) {
    const i = r.image
    if (!i || typeof i.dataUrl !== 'string' || !i.dataUrl.startsWith('data:image/') || !isNum(i.width) || !isNum(i.height) || i.width <= 0 || i.height <= 0 || typeof i.hash !== 'string') err('ảnh tham chiếu không hợp lệ')
    else if (i.dataUrl.length > MAX_IMAGE_BYTES * 1.4) err('ảnh tham chiếu quá lớn')
  }
  if (!r.calibration || !Array.isArray(r.calibration.points) || !['similarity', 'affine'].includes(r.calibration.method)) err('hiệu chỉnh không hợp lệ')
  else if (!r.calibration.points.every((p) => p && isPx(p.image) && isNum(p.world?.x) && isNum(p.world?.z))) err('điểm hiệu chỉnh không hợp lệ')
  if (!Array.isArray(r.features) || !Number.isInteger(r.nextId)) err('danh sách nét vẽ không hợp lệ')
  else {
    const seen = new Set<string>()
    for (const f of r.features) {
      if (!f || typeof f.id !== 'string' || seen.has(f.id) || !['road', 'zone', 'restricted'].includes(f.kind) || !Array.isArray(f.points) || !f.points.every(isPx)) {
        err(`nét vẽ ${JSON.stringify(f?.id)} không hợp lệ`)
        continue
      }
      seen.add(f.id)
      if (f.kind === 'road' && (!f.road || !(ROAD_CLASSES as readonly string[]).includes(f.road.class) || !(SIDEWALKS as readonly string[]).includes(f.road.sidewalk) || !Number.isInteger(f.road.lanes) || f.road.lanes < 1)) err(`đường ${f.id}: thuộc tính không hợp lệ`, [f.id])
      if (f.kind === 'zone' && !(LAND_USE_ZONES as readonly string[]).includes(f.zone ?? '')) err(`vùng ${f.id}: zone không hợp lệ`, [f.id])
      if (f.kind === 'restricted' && !(RESTRICTED_KINDS as readonly string[]).includes(f.restricted ?? '')) err(`vùng cấm ${f.id}: loại không hợp lệ`, [f.id])
    }
  }
  if (!issues.length) {
    try {
      referenceTransform(r as ReferenceTracing)
    } catch (e) {
      issues.push({ severity: 'error', code: 'calibration', message: `hiệu chỉnh suy biến: ${(e as Error).message}` })
    }
  }
  return issues
}

/** A reference image record from a loaded file (the editor decodes it to know its size). */
export function referenceImage(name: string, mime: string, dataUrl: string, width: number, height: number): ReferenceImage {
  if (!dataUrl.startsWith('data:image/')) throw new Error('không phải ảnh')
  if (dataUrl.length > MAX_IMAGE_BYTES * 1.4) throw new Error(`ảnh quá lớn (tối đa ${MAX_IMAGE_BYTES / 1024 / 1024} MB)`)
  return { name, mime, width, height, hash: `cyrb53:${hashText(dataUrl)}`, dataUrl }
}
