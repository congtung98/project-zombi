import type { Rect, XZ } from '../schema.ts'
import { quantize } from '../transform.ts'

/** Small plane geometry for the layout pipeline (pure, no Three.js). */

export function dist(a: XZ, b: XZ): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

export function polylineLength(points: readonly XZ[]): number {
  let n = 0
  for (let i = 1; i < points.length; i++) n += dist(points[i - 1], points[i])
  return n
}

export function distanceToSegment(p: XZ, a: XZ, b: XZ): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len2 = dx * dx + dz * dz
  if (len2 === 0) return dist(p, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz))
}

export function distanceToPolyline(p: XZ, line: readonly XZ[]): number {
  if (line.length === 1) return dist(p, line[0])
  let best = Infinity
  for (let i = 1; i < line.length; i++) best = Math.min(best, distanceToSegment(p, line[i - 1], line[i]))
  return best
}

/** Largest distance between two polylines, sampled every `step` metres along both (a discrete Hausdorff distance). */
export function polylineDeviation(a: readonly XZ[], b: readonly XZ[], step = 1): number {
  const one = (from: readonly XZ[], to: readonly XZ[]) => {
    let worst = 0
    for (const p of sample(from, step)) worst = Math.max(worst, distanceToPolyline(p, to))
    return worst
  }
  return Math.max(one(a, b), one(b, a))
}

function sample(line: readonly XZ[], step: number): XZ[] {
  const out: XZ[] = [line[0]]
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]
    const b = line[i]
    const n = Math.max(1, Math.ceil(dist(a, b) / step))
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n })
  }
  return out
}

/** Douglas–Peucker, endpoints kept (also for a closed loop whose endpoints coincide). */
export function simplify(points: readonly XZ[], tolerance: number): XZ[] {
  if (points.length <= 2 || tolerance <= 0) return [...points]
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [i, j] = stack.pop()!
    let worst = -1
    let at = -1
    for (let k = i + 1; k < j; k++) {
      const d = distanceToSegment(points[k], points[i], points[j])
      if (d > worst) {
        worst = d
        at = k
      }
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = 1
      stack.push([i, at], [at, j])
    }
  }
  return points.filter((_, k) => keep[k])
}

export function boundsOf(points: Iterable<XZ>): Rect | null {
  let r: Rect | null = null
  for (const p of points) {
    if (!r) r = { minX: p.x, minZ: p.z, maxX: p.x, maxZ: p.z }
    else {
      r.minX = Math.min(r.minX, p.x)
      r.minZ = Math.min(r.minZ, p.z)
      r.maxX = Math.max(r.maxX, p.x)
      r.maxZ = Math.max(r.maxZ, p.z)
    }
  }
  return r
}

export function qPoint(p: XZ): XZ {
  return { x: quantize(p.x), z: quantize(p.z) }
}

/**
 * Proper or touching intersection of segments ab and cd: the point, or null. Collinear overlaps
 * return null here (callers test them separately).
 */
export function segmentIntersection(a: XZ, b: XZ, c: XZ, d: XZ, eps = 1e-9): XZ | null {
  const rx = b.x - a.x
  const rz = b.z - a.z
  const sx = d.x - c.x
  const sz = d.z - c.z
  const den = rx * sz - rz * sx
  if (Math.abs(den) < eps) return null
  const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den
  const u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null
  return { x: a.x + t * rx, z: a.z + t * rz }
}

/**
 * Cut a polyline by a rectangle (Liang–Barsky per segment): the pieces inside, in order. A piece
 * that starts or ends on the rectangle edge reports it, so the network can mark a boundary node.
 */
export function clipPolyline(points: readonly XZ[], r: Rect): { points: XZ[]; cutStart: boolean; cutEnd: boolean }[] {
  const pieces: { points: XZ[]; cutStart: boolean; cutEnd: boolean }[] = []
  let current: { points: XZ[]; cutStart: boolean; cutEnd: boolean } | null = null
  for (let i = 1; i < points.length; i++) {
    const seg = clipSegment(points[i - 1], points[i], r)
    if (!seg) {
      if (current) {
        current.cutEnd = true
        pieces.push(current)
        current = null
      }
      continue
    }
    const [p, q, t0, t1] = seg
    if (!current) current = { points: [p], cutStart: t0 > 0, cutEnd: false }
    current.points.push(q)
    if (t1 < 1) {
      current.cutEnd = true
      pieces.push(current)
      current = null
    }
  }
  if (current) pieces.push(current)
  return pieces.filter((p) => p.points.length >= 2 && polylineLength(p.points) > 1e-6)
}

function clipSegment(a: XZ, b: XZ, r: Rect): [XZ, XZ, number, number] | null {
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dz = b.z - a.z
  const edges: [number, number][] = [
    [-dx, a.x - r.minX],
    [dx, r.maxX - a.x],
    [-dz, a.z - r.minZ],
    [dz, r.maxZ - a.z],
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null
      continue
    }
    const t = q / p
    if (p < 0) t0 = Math.max(t0, t)
    else t1 = Math.min(t1, t)
    if (t0 > t1) return null
  }
  const at = (t: number): XZ => (t === 0 ? a : t === 1 ? b : { x: a.x + t * dx, z: a.z + t * dz })
  return [at(t0), at(t1), t0, t1]
}

/** Sutherland–Hodgman against a rectangle (convex clip: exact for any ring). */
export function clipRing(ring: readonly XZ[], r: Rect): XZ[] {
  const planes: ((p: XZ) => number)[] = [(p) => p.x - r.minX, (p) => r.maxX - p.x, (p) => p.z - r.minZ, (p) => r.maxZ - p.z]
  let out: XZ[] = [...ring]
  for (const side of planes) {
    if (!out.length) break
    const input = out
    out = []
    for (let i = 0; i < input.length; i++) {
      const p = input[i]
      const q = input[(i + 1) % input.length]
      const dp = side(p)
      const dq = side(q)
      if (dp >= 0) out.push(p)
      if ((dp >= 0) !== (dq >= 0)) {
        const t = dp / (dp - dq)
        out.push({ x: p.x + t * (q.x - p.x), z: p.z + t * (q.z - p.z) })
      }
    }
  }
  return out
}

/** cyrb53: a 53-bit string hash, as 14 hex digits. Identity and change detection only, not security. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

/** Plain string order (not locale-dependent), for deterministic sorting. */
export function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
