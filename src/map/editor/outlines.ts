import type { WallRunObject, XZ } from '../schema.ts'
import { normalizeOutline, outlineProblem, pointInOutline } from '../polygon.ts'
import { quantize, rotateXZ } from '../transform.ts'

/**
 * Editing rectilinear outlines (M11a), pure: building footprints and rooms shaped like an L, T or
 * U. Every operation keeps every edge along X or Z and returns null when the result would not be a
 * usable outline (crossing edges, no area), so a drag simply stops at the last valid shape.
 *
 * - a vertex drag moves the vertex and the two edges meeting there (each keeps its axis);
 * - an edge drag moves one edge sideways (its two vertices);
 * - "cut corner" turns a corner into a notch (a rectangle becomes an L), or fills a notch back;
 * - "notch edge" pushes the middle third of an edge inwards (a rectangle becomes a U).
 */

/** Handle keys: `v<i>` = vertex i, `e<i>` = edge from vertex i to i + 1. */
export type OutlineHandleKey = `v${number}` | `e${number}`

export function outlineHandles(poly: readonly XZ[]): { key: OutlineHandleKey; at: XZ }[] {
  const n = poly.length
  const vertices = poly.map((p, i) => ({ key: `v${i}` as OutlineHandleKey, at: { ...p } }))
  const edges = poly.map((p, i) => {
    const q = poly[(i + 1) % n]
    return { key: `e${i}` as OutlineHandleKey, at: { x: quantize((p.x + q.x) / 2), z: quantize((p.z + q.z) / 2) } }
  })
  return [...vertices, ...edges]
}

export function parseOutlineHandle(key: string): { kind: 'v' | 'e'; index: number } | null {
  const m = /^([ve])(\d+)$/.exec(key)
  return m ? { kind: m[1] as 'v' | 'e', index: Number(m[2]) } : null
}

const horizontal = (a: XZ, b: XZ) => a.z === b.z
/** Cuts and notches land on the editor's finest snap step, so their vertices stay round numbers. */
const STEP = 0.25
const snap = (v: number) => Math.round(v / STEP) * STEP

function finish(poly: XZ[]): XZ[] | null {
  const out = normalizeOutline(poly.map((p) => ({ x: quantize(p.x), z: quantize(p.z) })))
  return outlineProblem(out) ? null : out
}

/** Vertex `i` to `p`; its neighbours follow along their shared edges. */
export function dragOutlineVertex(poly: readonly XZ[], i: number, p: XZ): XZ[] | null {
  const n = poly.length
  const out = poly.map((v) => ({ ...v }))
  const prev = (i + n - 1) % n
  const next = (i + 1) % n
  if (horizontal(poly[prev], poly[i])) out[prev].z = p.z
  else out[prev].x = p.x
  if (horizontal(poly[i], poly[next])) out[next].z = p.z
  else out[next].x = p.x
  out[i] = { x: p.x, z: p.z }
  return finish(out)
}

/** Edge `i` (vertex i to i + 1) moved sideways to pass through `p`. */
export function dragOutlineEdge(poly: readonly XZ[], i: number, p: XZ): XZ[] | null {
  const n = poly.length
  const j = (i + 1) % n
  const out = poly.map((v) => ({ ...v }))
  if (horizontal(poly[i], poly[j])) {
    out[i].z = p.z
    out[j].z = p.z
  } else {
    out[i].x = p.x
    out[j].x = p.x
  }
  return finish(out)
}

/**
 * An outer corner `i` becomes a notch half as deep as each of its edges (or `size` along both):
 * [a, v, c] → [a', inner, c']. The inner corner of a notch fills the notch back (its whole edges).
 */
export function cutOutlineCorner(poly: readonly XZ[], i: number, size?: number): XZ[] | null {
  const n = poly.length
  const a = poly[(i + n - 1) % n]
  const v = poly[i]
  const c = poly[(i + 1) % n]
  const la = Math.hypot(a.x - v.x, a.z - v.z)
  const lc = Math.hypot(c.x - v.x, c.z - v.z)
  // Between the two edges, just off the corner: inside for an outer corner, outside for a notch's.
  const inner = !pointInOutline(poly, v.x + ((a.x - v.x) / la + (c.x - v.x) / lc) * 0.01, v.z + ((a.z - v.z) / la + (c.z - v.z) / lc) * 0.01)
  const da = inner ? la : (size ?? snap(la / 2))
  const dc = inner ? lc : (size ?? snap(lc / 2))
  if (!(da > 0 && dc > 0 && da <= la && dc <= lc) || (!inner && (da === la || dc === lc))) return null
  const p1 = { x: v.x + ((a.x - v.x) / la) * da, z: v.z + ((a.z - v.z) / la) * da }
  const p3 = { x: v.x + ((c.x - v.x) / lc) * dc, z: v.z + ((c.z - v.z) / lc) * dc }
  const p2 = { x: p1.x + p3.x - v.x, z: p1.z + p3.z - v.z }
  return finish([...poly.slice(0, i), p1, p2, p3, ...poly.slice(i + 1)])
}

/**
 * The middle third of edge `i` pushed inwards by `depth` (default: a third of the edge, halved
 * until it fits); points on the 0.25 m grid.
 */
export function notchOutlineEdge(poly: readonly XZ[], i: number, depth?: number): XZ[] | null {
  const n = poly.length
  const a = poly[i]
  const b = poly[(i + 1) % n]
  const len = Math.hypot(b.x - a.x, b.z - a.z)
  const ux = (b.x - a.x) / len
  const uz = (b.z - a.z) / len
  // Inwards: the side of the edge where the outline is.
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }
  const inward = pointInOutline(poly, mid.x - uz * 0.01, mid.z + ux * 0.01) && !pointInOutline(poly, mid.x + uz * 0.01, mid.z - ux * 0.01) ? { x: -uz, z: ux } : { x: uz, z: -ux }
  const t1 = snap(len / 3)
  const t2 = snap((2 * len) / 3)
  if (!(t1 > 0 && t2 > t1 && t2 < len)) return null
  const p1 = { x: a.x + ux * t1, z: a.z + uz * t1 }
  const p4 = { x: a.x + ux * t2, z: a.z + uz * t2 }
  for (let d = depth ?? snap(len / 3); d >= STEP; d = d / 2 >= STEP ? snap(d / 2) : 0) {
    const p2 = { x: p1.x + inward.x * d, z: p1.z + inward.z * d }
    const p3 = { x: p4.x + inward.x * d, z: p4.z + inward.z * d }
    const out = finish([...poly.slice(0, i + 1), p1, p2, p3, p4, ...poly.slice(i + 1)])
    if (out) return out
    if (depth !== undefined) break
  }
  return null
}

/** Rotate an outline by quarter turns about a point (like every rotation in the editor). */
export function turnOutline(poly: readonly XZ[], c: XZ, q: number): XZ[] {
  return poly.map((p) => {
    const [x, z] = rotateXZ(p.x - c.x, p.z - c.z, q)
    return { x: quantize(c.x + x), z: quantize(c.z + z) }
  })
}

/** One wall run per outline edge (the building's walls along an L/T/U footprint). */
export function outlineWallRuns(poly: readonly XZ[], props: { height: number; thickness: number; color: string }, localId: (n: number) => string): WallRunObject[] {
  return poly.map((p, i) => {
    const q = poly[(i + 1) % poly.length]
    return { kind: 'wallRun', localId: localId(i), from: { ...p }, to: { ...q }, height: props.height, thickness: props.thickness, color: props.color }
  })
}
