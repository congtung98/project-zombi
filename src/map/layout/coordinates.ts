import type { XZ } from '../schema.ts'
import { chunkIdOf, chunkIndex, chunkOrigin, quantize, rotateXZ } from '../transform.ts'
import type { GeoPoint, GridFrame } from './schema.ts'

/**
 * WorldCoordinateTransformer (world generator WG1): every conversion between a reference and the
 * game, pure and testable.
 *
 * - geographic (WGS84 lon/lat) → local metres: a local tangent plane at an origin (ECEF → ENU).
 *   Exact on the ellipsoid; the only error is the plane itself (scale error (d/R)²/2, 3·10⁻⁷ at 5 km),
 *   far below anything a street layout can show. Web Mercator (EPSG:3857) sources are unprojected
 *   first; longitude/latitude are never used as mesh coordinates.
 * - local metres → world: the grid frame of the normalisation (rotation, then offset).
 * - reference image (pixels, v down) → world: a similarity or affine transform fitted to control points.
 * - world → editor: the owning chunk and chunk-local position (the editor works in world metres).
 *
 * Axes follow the game (docs/map-content-format.md §2): X east, Y up, Z south (north is −Z).
 */

const A = 6378137
const F = 1 / 298.257223563
const E2 = F * (2 - F)
const DEG = Math.PI / 180

interface Ecef {
  x: number
  y: number
  z: number
}

function toEcef(latRad: number, lonRad: number, h = 0): Ecef {
  const s = Math.sin(latRad)
  const n = A / Math.sqrt(1 - E2 * s * s)
  const c = Math.cos(latRad)
  return { x: (n + h) * c * Math.cos(lonRad), y: (n + h) * c * Math.sin(lonRad), z: (n * (1 - E2) + h) * s }
}

function fromEcef(p: Ecef): { latRad: number; lonRad: number } {
  const lonRad = Math.atan2(p.y, p.x)
  const r = Math.hypot(p.x, p.y)
  let latRad = Math.atan2(p.z, r * (1 - E2))
  for (let i = 0; i < 8; i++) {
    const s = Math.sin(latRad)
    const n = A / Math.sqrt(1 - E2 * s * s)
    const h = r / Math.cos(latRad) - n
    latRad = Math.atan2(p.z, r * (1 - (E2 * n) / (n + h)))
  }
  return { latRad, lonRad }
}

/** Geographic ↔ local metres around `origin` (X east, Z south). */
export class LocalTangentProjection {
  readonly origin: GeoPoint
  private readonly o: Ecef
  private readonly sinLat: number
  private readonly cosLat: number
  private readonly sinLon: number
  private readonly cosLon: number
  /** Gaussian radius of curvature at the origin, for the inverse's height guess. */
  private readonly radius: number

  constructor(origin: GeoPoint) {
    if (!isGeoPoint(origin)) throw new Error(`origin ngoài phạm vi lon/lat: ${JSON.stringify(origin)}`)
    this.origin = { lon: origin.lon, lat: origin.lat }
    const lat = origin.lat * DEG
    const lon = origin.lon * DEG
    this.o = toEcef(lat, lon)
    this.sinLat = Math.sin(lat)
    this.cosLat = Math.cos(lat)
    this.sinLon = Math.sin(lon)
    this.cosLon = Math.cos(lon)
    // √(M·N): meridional M = A(1−e²)/w^1.5, prime vertical N = A/w^0.5.
    const w = 1 - E2 * this.sinLat * this.sinLat
    this.radius = (A * Math.sqrt(1 - E2)) / w
  }

  toLocal(p: GeoPoint): XZ {
    const q = toEcef(p.lat * DEG, p.lon * DEG)
    const dx = q.x - this.o.x
    const dy = q.y - this.o.y
    const dz = q.z - this.o.z
    const east = -this.sinLon * dx + this.cosLon * dy
    const north = -this.sinLat * this.cosLon * dx - this.sinLat * this.sinLon * dy + this.cosLat * dz
    return { x: east + 0, z: -north + 0 }
  }

  toGeo(p: XZ): GeoPoint {
    const east = p.x
    const north = -p.z
    // A point of the plane lies above the ellipsoid by about d²/2R: aim for the surface point.
    const up = -(east * east + north * north) / (2 * this.radius)
    const dx = -this.sinLon * east - this.sinLat * this.cosLon * north + this.cosLat * this.cosLon * up
    const dy = this.cosLon * east - this.sinLat * this.sinLon * north + this.cosLat * this.sinLon * up
    const dz = this.cosLat * north + this.sinLat * up
    const g = fromEcef({ x: this.o.x + dx, y: this.o.y + dy, z: this.o.z + dz })
    return { lon: g.lonRad / DEG, lat: g.latRad / DEG }
  }
}

export function isGeoPoint(p: GeoPoint): boolean {
  return Number.isFinite(p.lon) && Number.isFinite(p.lat) && Math.abs(p.lon) <= 180 && Math.abs(p.lat) <= 90
}

/** Great-circle distance on the WGS84 mean sphere (m); a check for the projection, not used by it. */
export function haversine(a: GeoPoint, b: GeoPoint): number {
  const R = 6371008.8
  const dLat = (b.lat - a.lat) * DEG
  const dLon = (b.lon - a.lon) * DEG
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

const MERCATOR_R = 6378137

/** EPSG:3857 metres → WGS84. */
export function webMercatorToGeo(x: number, y: number): GeoPoint {
  return { lon: (x / MERCATOR_R) / DEG, lat: (2 * Math.atan(Math.exp(y / MERCATOR_R)) - Math.PI / 2) / DEG }
}

/** WGS84 → EPSG:3857 metres. */
export function geoToWebMercator(p: GeoPoint): { x: number; y: number } {
  return { x: MERCATOR_R * p.lon * DEG, y: MERCATOR_R * Math.log(Math.tan(Math.PI / 4 + (p.lat * DEG) / 2)) }
}

/** Rotate about +Y by `deg` in `rotateXZ`'s sense (90° maps (x, z) to (z, −x)); exact for quarter turns. */
export function rotateDeg(p: XZ, deg: number): XZ {
  const q = deg / 90
  if (Number.isInteger(q)) {
    const [x, z] = rotateXZ(p.x, p.z, ((q % 4) + 4) % 4)
    return { x, z }
  }
  const t = deg * DEG
  const c = Math.cos(t)
  const s = Math.sin(t)
  return { x: p.x * c + p.z * s + 0, z: -p.x * s + p.z * c + 0 }
}

/** Source frame → world. */
export function sourceToWorld(frame: GridFrame, p: XZ): XZ {
  const r = rotateDeg(p, frame.rotationDeg)
  return { x: quantize(r.x + frame.offset.x), z: quantize(r.z + frame.offset.z) }
}

/** World → source frame. */
export function worldToSource(frame: GridFrame, p: XZ): XZ {
  const r = rotateDeg({ x: p.x - frame.offset.x, z: p.z - frame.offset.z }, -frame.rotationDeg)
  return { x: quantize(r.x), z: quantize(r.z) }
}

/** World → editor: the chunk that owns the point (half-open, like content records) and the chunk-local position. */
export function worldToEditor(p: XZ, chunkSize = 32): { chunkId: string; cx: number; cz: number; local: XZ } {
  const cx = chunkIndex(p.x, chunkSize)
  const cz = chunkIndex(p.z, chunkSize)
  const o = chunkOrigin(cx, cz, chunkSize)
  return { chunkId: chunkIdOf(cx, cz), cx, cz, local: { x: quantize(p.x - o.x), z: quantize(p.z - o.z) } }
}

// ---- Reference images (the tracing UI is WG6; the transform is here so every conversion lives in one place) ----

/** Pixel position in a reference image: u to the right, v down. No geographic meaning is assumed. */
export interface ImagePoint {
  u: number
  v: number
}

export interface ControlPoint {
  image: ImagePoint
  world: XZ
}

/** X = a·u + b·v + tx, Z = c·u + d·v + tz. */
export interface ImageTransform {
  a: number
  b: number
  c: number
  d: number
  tx: number
  tz: number
}

export function imageToWorld(t: ImageTransform, p: ImagePoint): XZ {
  return { x: t.a * p.u + t.b * p.v + t.tx + 0, z: t.c * p.u + t.d * p.v + t.tz + 0 }
}

export function invertImageTransform(t: ImageTransform): ImageTransform {
  const det = t.a * t.d - t.b * t.c
  if (Math.abs(det) < 1e-12) throw new Error('phép biến đổi ảnh suy biến')
  const a = t.d / det
  const b = -t.b / det
  const c = -t.c / det
  const d = t.a / det
  return { a, b, c, d, tx: -(a * t.tx + b * t.tz), tz: -(c * t.tx + d * t.tz) }
}

function centroids(points: readonly ControlPoint[]) {
  const n = points.length
  const u = points.reduce((s, p) => s + p.image.u, 0) / n
  const v = points.reduce((s, p) => s + p.image.v, 0) / n
  const x = points.reduce((s, p) => s + p.world.x, 0) / n
  const z = points.reduce((s, p) => s + p.world.z, 0) / n
  return { u, v, x, z }
}

/**
 * Scale + rotation + translation (no shear, no mirror; image v down matches world Z south), least
 * squares over ≥ 2 control points. Two points are enough to set position, north and world scale.
 */
export function fitSimilarity(points: readonly ControlPoint[]): ImageTransform {
  if (points.length < 2) throw new Error('cần ít nhất 2 điểm hiệu chỉnh')
  const m = centroids(points)
  let s = 0
  let p = 0
  let q = 0
  for (const cp of points) {
    const u = cp.image.u - m.u
    const v = cp.image.v - m.v
    const x = cp.world.x - m.x
    const z = cp.world.z - m.z
    s += u * u + v * v
    p += x * u + z * v
    q += z * u - x * v
  }
  if (s < 1e-12) throw new Error('các điểm hiệu chỉnh trùng nhau trên ảnh')
  p /= s
  q /= s
  return { a: p, b: -q, c: q, d: p, tx: m.x - p * m.u + q * m.v, tz: m.z - q * m.u - p * m.v }
}

/** General affine (allows a skewed or unevenly scaled scan), least squares over ≥ 3 non-collinear points. */
export function fitAffine(points: readonly ControlPoint[]): ImageTransform {
  if (points.length < 3) throw new Error('cần ít nhất 3 điểm hiệu chỉnh')
  const m = centroids(points)
  let uu = 0
  let uv = 0
  let vv = 0
  let ux = 0
  let vx = 0
  let uz = 0
  let vz = 0
  for (const cp of points) {
    const u = cp.image.u - m.u
    const v = cp.image.v - m.v
    const x = cp.world.x - m.x
    const z = cp.world.z - m.z
    uu += u * u
    uv += u * v
    vv += v * v
    ux += u * x
    vx += v * x
    uz += u * z
    vz += v * z
  }
  const det = uu * vv - uv * uv
  if (Math.abs(det) < 1e-9 * Math.max(1, uu * vv)) throw new Error('các điểm hiệu chỉnh thẳng hàng')
  const a = (ux * vv - vx * uv) / det
  const b = (vx * uu - ux * uv) / det
  const c = (uz * vv - vz * uv) / det
  const d = (vz * uu - uz * uv) / det
  return { a, b, c, d, tx: m.x - a * m.u - b * m.v, tz: m.z - c * m.u - d * m.v }
}

/** Distance (m) between each control point's world position and where the transform puts it. */
export function controlResiduals(t: ImageTransform, points: readonly ControlPoint[]): { rms: number; max: number } {
  let sum = 0
  let max = 0
  for (const cp of points) {
    const w = imageToWorld(t, cp.image)
    const e = Math.hypot(w.x - cp.world.x, w.z - cp.world.z)
    sum += e * e
    max = Math.max(max, e)
  }
  return { rms: points.length ? Math.sqrt(sum / points.length) : 0, max }
}
