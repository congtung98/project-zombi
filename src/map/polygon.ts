import type { Rect, XZ } from './schema.ts'

/**
 * Rectilinear polygons (M11a): building footprints and rooms shaped like an L, T, U or with a
 * notch. Every edge runs along X or Z, like every wall, collider and quarter-turn rotation in the
 * engine, so an outline always splits into axis-aligned rectangles (`outlineRects`) that the
 * rectangle-based systems (floors, roofs, the indoor lighting shader) keep using.
 * Vertices go around the outline in either direction; the last one connects back to the first.
 */

const EPS = 1e-6

export function rectOutline(r: Rect): XZ[] {
  return [
    { x: r.minX, z: r.minZ },
    { x: r.maxX, z: r.minZ },
    { x: r.maxX, z: r.maxZ },
    { x: r.minX, z: r.maxZ },
  ]
}

export function outlineBounds(poly: readonly XZ[]): Rect {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
  for (const p of poly) {
    minX = Math.min(minX, p.x)
    minZ = Math.min(minZ, p.z)
    maxX = Math.max(maxX, p.x)
    maxZ = Math.max(maxZ, p.z)
  }
  return { minX, minZ, maxX, maxZ }
}

/** Signed area (shoelace; positive = counter-clockwise in the x/z plane). */
export function signedArea(poly: readonly XZ[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p.x * q.z - q.x * p.z
  }
  return a / 2
}

/** Drop repeated points and points in the middle of a straight run (the same outline, fewer vertices). */
export function normalizeOutline(poly: readonly XZ[]): XZ[] {
  let pts = poly.filter((p, i) => {
    const q = poly[(i + 1) % poly.length]
    return Math.abs(p.x - q.x) > EPS || Math.abs(p.z - q.z) > EPS
  })
  for (let changed = true; changed && pts.length >= 3; ) {
    changed = false
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length]
      const b = pts[i]
      const c = pts[(i + 1) % pts.length]
      const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x)
      if (Math.abs(cross) < EPS) {
        pts = pts.filter((_, j) => j !== i)
        changed = true
        break
      }
    }
  }
  return pts
}

/** Every edge along X or Z with a length, at least 4 vertices. */
export function isRectilinear(poly: readonly XZ[]): boolean {
  if (poly.length < 4) return false
  return poly.every((p, i) => {
    const q = poly[(i + 1) % poly.length]
    const dx = Math.abs(p.x - q.x)
    const dz = Math.abs(p.z - q.z)
    return (dx < EPS) !== (dz < EPS)
  })
}

function segmentsTouch(a: XZ, b: XZ, c: XZ, d: XZ): boolean {
  // Axis-aligned segments: overlap of their bounding boxes is contact.
  return Math.min(a.x, b.x) <= Math.max(c.x, d.x) + EPS && Math.min(c.x, d.x) <= Math.max(a.x, b.x) + EPS && Math.min(a.z, b.z) <= Math.max(c.z, d.z) + EPS && Math.min(c.z, d.z) <= Math.max(a.z, b.z) + EPS
}

/** No two edges cross or touch except neighbours at their shared vertex. Rectilinear outlines only. */
export function isSimpleOutline(poly: readonly XZ[]): boolean {
  const n = poly.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue
      if (segmentsTouch(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false
    }
  }
  return true
}

/** Why an outline is not usable, or null: rectilinear, simple, non-empty. */
export function outlineProblem(poly: readonly XZ[]): string | null {
  if (poly.length < 4) return 'needs at least 4 vertices'
  if (!isRectilinear(poly)) return 'every edge must run along X or Z (no zero-length or diagonal edges)'
  if (!isSimpleOutline(poly)) return 'edges must not cross or touch'
  if (Math.abs(signedArea(poly)) < EPS) return 'encloses no area'
  return null
}

/** Point inside the outline or on its edge (even–odd rule). */
export function pointInOutline(poly: readonly XZ[], x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    // On the edge counts as inside (like the rectangle tests it replaces).
    if (Math.abs(a.z - b.z) < EPS && Math.abs(z - a.z) < EPS && x >= Math.min(a.x, b.x) - EPS && x <= Math.max(a.x, b.x) + EPS) return true
    if (Math.abs(a.x - b.x) < EPS && Math.abs(x - a.x) < EPS && z >= Math.min(a.z, b.z) - EPS && z <= Math.max(a.z, b.z) + EPS) return true
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
}

/** Distance from a point to the nearest edge. */
export function distanceToOutline(poly: readonly XZ[], x: number, z: number): number {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len2 = dx * dx + dz * dz
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0
    best = Math.min(best, Math.hypot(x - (a.x + t * dx), z - (a.z + t * dz)))
  }
  return best
}

/** Inside, or within `margin` of the edge (margin ≥ 0); a negative margin keeps that far inside. */
export function insideOutline(poly: readonly XZ[], x: number, z: number, margin = 0): boolean {
  const inside = pointInOutline(poly, x, z)
  if (margin >= 0) return inside || distanceToOutline(poly, x, z) <= margin
  return inside && distanceToOutline(poly, x, z) >= -margin
}

/**
 * Axis-aligned rectangles that exactly tile a rectilinear outline: vertical strips between the
 * distinct X coordinates, cut by the outline, then neighbouring strips with the same Z span merged.
 * Deterministic (sorted); a rectangle comes back as itself.
 */
export function outlineRects(poly: readonly XZ[]): Rect[] {
  const xs = [...new Set(poly.map((p) => p.x))].sort((a, b) => a - b)
  const strips: { x0: number; x1: number; spans: [number, number][] }[] = []
  for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i]
    const x1 = xs[i + 1]
    const mid = (x0 + x1) / 2
    const zs: number[] = []
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k]
      const b = poly[(k + 1) % poly.length]
      if (Math.abs(a.z - b.z) < EPS && Math.min(a.x, b.x) < mid && Math.max(a.x, b.x) > mid) zs.push(a.z)
    }
    zs.sort((a, b) => a - b)
    const spans: [number, number][] = []
    for (let k = 0; k + 1 < zs.length; k += 2) spans.push([zs[k], zs[k + 1]])
    strips.push({ x0, x1, spans })
  }
  const out: Rect[] = []
  // Merge runs of strips that share a span.
  const open = new Map<string, Rect>()
  for (const s of strips) {
    const seen = new Set<string>()
    for (const [z0, z1] of s.spans) {
      const key = `${z0}:${z1}`
      seen.add(key)
      const r = open.get(key)
      if (r && Math.abs(r.maxX - s.x0) < EPS) r.maxX = s.x1
      else {
        if (r) out.push(r)
        open.set(key, { minX: s.x0, minZ: z0, maxX: s.x1, maxZ: z1 })
      }
    }
    for (const [key, r] of open) {
      if (!seen.has(key)) {
        out.push(r)
        open.delete(key)
      }
    }
  }
  out.push(...open.values())
  return out.sort((a, b) => a.minX - b.minX || a.minZ - b.minZ)
}

/**
 * A point well inside the outline: the centre of its largest rectangle piece (the bounding box
 * centre of an L can lie in the notch, outside). Used for default lamp positions.
 */
export function outlineCentre(poly: readonly XZ[]): XZ {
  let best: Rect | null = null
  for (const r of outlineRects(poly)) if (!best || (r.maxX - r.minX) * (r.maxZ - r.minZ) > (best.maxX - best.minX) * (best.maxZ - best.minZ)) best = r
  const b = best ?? outlineBounds(poly)
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 }
}

/** Area of a rectilinear outline (absolute). */
export function outlineArea(poly: readonly XZ[]): number {
  return Math.abs(signedArea(poly))
}
