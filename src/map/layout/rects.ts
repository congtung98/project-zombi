import type { Rect, XZ } from '../schema.ts'
import { quantize } from '../transform.ts'

/** Axis-aligned rectangle tools for the street and parcel planner (world generator WG2). */

export const EPS = 1e-6

export function rectArea(r: Rect): number {
  return Math.max(0, r.maxX - r.minX) * Math.max(0, r.maxZ - r.minZ)
}

/** Interiors overlap (touching edges do not count). */
export function rectsOverlap(a: Rect, b: Rect, eps = EPS): boolean {
  return a.minX < b.maxX - eps && b.minX < a.maxX - eps && a.minZ < b.maxZ - eps && b.minZ < a.maxZ - eps
}

export function intersectRect(a: Rect, b: Rect): Rect | null {
  const r = { minX: Math.max(a.minX, b.minX), minZ: Math.max(a.minZ, b.minZ), maxX: Math.min(a.maxX, b.maxX), maxZ: Math.min(a.maxZ, b.maxZ) }
  return r.maxX - r.minX > EPS && r.maxZ - r.minZ > EPS ? r : null
}

export function qRect(r: Rect): Rect {
  return { minX: quantize(r.minX), minZ: quantize(r.minZ), maxX: quantize(r.maxX), maxZ: quantize(r.maxZ) }
}

export function rectCentre(r: Rect): XZ {
  return { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 }
}

export function rectPolygon(r: Rect): XZ[] {
  return [
    { x: r.minX, z: r.minZ },
    { x: r.minX, z: r.maxZ },
    { x: r.maxX, z: r.maxZ },
    { x: r.maxX, z: r.minZ },
  ]
}

/** a − b as up to four rectangles (full-width bands above and below, then the sides). */
export function subtractRect(a: Rect, b: Rect): Rect[] {
  const i = intersectRect(a, b)
  if (!i) return [a]
  const out: Rect[] = []
  if (i.minZ > a.minZ + EPS) out.push({ minX: a.minX, minZ: a.minZ, maxX: a.maxX, maxZ: i.minZ })
  if (i.maxZ < a.maxZ - EPS) out.push({ minX: a.minX, minZ: i.maxZ, maxX: a.maxX, maxZ: a.maxZ })
  if (i.minX > a.minX + EPS) out.push({ minX: a.minX, minZ: i.minZ, maxX: i.minX, maxZ: i.maxZ })
  if (i.maxX < a.maxX - EPS) out.push({ minX: i.maxX, minZ: i.minZ, maxX: a.maxX, maxZ: i.maxZ })
  return out
}

export function subtractAll(a: Rect, cut: readonly Rect[]): Rect[] {
  let pieces = [a]
  for (const b of cut) {
    if (!rectsOverlap(a, b)) continue
    pieces = pieces.flatMap((p) => subtractRect(p, b))
  }
  return pieces
}

/**
 * Merge rectangles that share an exact band and touch or overlap along it: first same Z band along X,
 * then same X band along Z. Fewer pieces, same union.
 */
export function mergeRects(rects: readonly Rect[]): Rect[] {
  const pass = (list: Rect[], alongX: boolean): Rect[] => {
    const bands = new Map<string, Rect[]>()
    for (const r of list) {
      const key = alongX ? `${r.minZ}|${r.maxZ}` : `${r.minX}|${r.maxX}`
      const b = bands.get(key)
      if (b) b.push(r)
      else bands.set(key, [r])
    }
    const out: Rect[] = []
    for (const band of bands.values()) {
      band.sort((p, q) => (alongX ? p.minX - q.minX : p.minZ - q.minZ))
      let cur = { ...band[0] }
      for (let i = 1; i < band.length; i++) {
        const r = band[i]
        if (alongX ? r.minX <= cur.maxX + EPS : r.minZ <= cur.maxZ + EPS) {
          if (alongX) cur.maxX = Math.max(cur.maxX, r.maxX)
          else cur.maxZ = Math.max(cur.maxZ, r.maxZ)
        } else {
          out.push(cur)
          cur = { ...r }
        }
      }
      out.push(cur)
    }
    return out
  }
  return sortRects(pass(pass([...rects], true), false))
}

export function sortRects(rects: Rect[]): Rect[] {
  return rects.sort((a, b) => a.minZ - b.minZ || a.minX - b.minX || a.maxZ - b.maxZ || a.maxX - b.maxX)
}

/**
 * A grid on the distinct edge coordinates of a set of rectangles: every rectangle is an exact union
 * of cells, so painting, flood fill and decomposition back into rectangles are exact.
 */
export class CellGrid {
  readonly xs: number[]
  readonly zs: number[]
  readonly nx: number
  readonly nz: number
  readonly cells: Uint8Array

  constructor(area: Rect, rects: Iterable<Rect>) {
    const xs = new Set([area.minX, area.maxX])
    const zs = new Set([area.minZ, area.maxZ])
    for (const r of rects) {
      for (const x of [r.minX, r.maxX]) if (x > area.minX && x < area.maxX) xs.add(x)
      for (const z of [r.minZ, r.maxZ]) if (z > area.minZ && z < area.maxZ) zs.add(z)
    }
    this.xs = [...xs].sort((a, b) => a - b)
    this.zs = [...zs].sort((a, b) => a - b)
    this.nx = this.xs.length - 1
    this.nz = this.zs.length - 1
    this.cells = new Uint8Array(this.nx * this.nz)
  }

  /** Index range of cells whose span lies inside [lo, hi]. */
  private range(axis: number[], lo: number, hi: number): [number, number] {
    const first = lowerBound(axis, lo - EPS)
    const last = lowerBound(axis, hi - EPS) - 1
    return [first, last]
  }

  /** Set every cell inside `r` to `value` (only cells currently in `onlyOver`, if given). */
  paint(r: Rect, value: number, onlyOver?: number): void {
    const [x0, x1] = this.range(this.xs, r.minX, r.maxX)
    const [z0, z1] = this.range(this.zs, r.minZ, r.maxZ)
    for (let j = z0; j <= z1 && j < this.nz; j++)
      for (let i = x0; i <= x1 && i < this.nx; i++) {
        const k = j * this.nx + i
        if (onlyOver === undefined || this.cells[k] === onlyOver) this.cells[k] = value
      }
  }

  cellRect(i: number, j: number): Rect {
    return { minX: this.xs[i], minZ: this.zs[j], maxX: this.xs[i + 1], maxZ: this.zs[j + 1] }
  }

  /** Cell containing a point, or −1 outside. */
  cellAt(x: number, z: number): number {
    const i = lowerBound(this.xs, x + EPS) - 1
    const j = lowerBound(this.zs, z + EPS) - 1
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1
    return j * this.nx + i
  }

  /** 4-connected components of cells with `value`, each as cell indices (row-major order). */
  components(value: number): number[][] {
    const seen = new Uint8Array(this.cells.length)
    const out: number[][] = []
    for (let start = 0; start < this.cells.length; start++) {
      if (seen[start] || this.cells[start] !== value) continue
      const comp: number[] = []
      const stack = [start]
      seen[start] = 1
      while (stack.length) {
        const k = stack.pop()!
        comp.push(k)
        const i = k % this.nx
        const j = (k - i) / this.nx
        const next = [i > 0 ? k - 1 : -1, i < this.nx - 1 ? k + 1 : -1, j > 0 ? k - this.nx : -1, j < this.nz - 1 ? k + this.nx : -1]
        for (const n of next) {
          if (n < 0 || seen[n] || this.cells[n] !== value) continue
          seen[n] = 1
          stack.push(n)
        }
      }
      out.push(comp.sort((a, b) => a - b))
    }
    return out
  }

  /** Rectangles exactly tiling a set of cells: runs per row, stacked while the run repeats. */
  rectsOf(cellsOf: readonly number[]): Rect[] {
    const inSet = new Set(cellsOf)
    const out: Rect[] = []
    let open = new Map<string, Rect>()
    for (let j = 0; j < this.nz; j++) {
      const runs: [number, number][] = []
      let i = 0
      while (i < this.nx) {
        if (!inSet.has(j * this.nx + i)) {
          i++
          continue
        }
        const s = i
        while (i < this.nx && inSet.has(j * this.nx + i)) i++
        runs.push([s, i])
      }
      const next = new Map<string, Rect>()
      for (const [s, e] of runs) {
        const key = `${s}|${e}`
        const r = open.get(key)
        if (r) {
          r.maxZ = this.zs[j + 1]
          next.set(key, r)
          open.delete(key)
        } else next.set(key, { minX: this.xs[s], minZ: this.zs[j], maxX: this.xs[e], maxZ: this.zs[j + 1] })
      }
      out.push(...open.values())
      open = next
    }
    out.push(...open.values())
    return sortRects(out)
  }

  /** Covered intervals (merged) along a rectangle side, just outside it, by cells of `values`. */
  sideRuns(r: Rect, side: 'N' | 'S' | 'E' | 'W', values: ReadonlySet<number>, probe = 0.05): [number, number][] {
    const alongX = side === 'N' || side === 'S'
    const lo = alongX ? r.minX : r.minZ
    const hi = alongX ? r.maxX : r.maxZ
    const fixed = side === 'N' ? r.minZ - probe : side === 'S' ? r.maxZ + probe : side === 'W' ? r.minX - probe : r.maxX + probe
    const axis = alongX ? this.xs : this.zs
    const runs: [number, number][] = []
    const first = Math.max(0, lowerBound(axis, lo + EPS) - 1)
    for (let k = first; k < axis.length - 1 && axis[k] < hi - EPS; k++) {
      const a = Math.max(lo, axis[k])
      const b = Math.min(hi, axis[k + 1])
      if (b <= a) continue
      const mid = (a + b) / 2
      const cell = alongX ? this.cellAt(mid, fixed) : this.cellAt(fixed, mid)
      if (cell < 0 || !values.has(this.cells[cell])) continue
      const last = runs[runs.length - 1]
      if (last && Math.abs(last[1] - a) < EPS) last[1] = b
      else runs.push([a, b])
    }
    return runs
  }

  /** Fraction of a straight run just outside a rectangle side covered by cells of `values`. */
  sideCoverage(r: Rect, side: 'N' | 'S' | 'E' | 'W', values: ReadonlySet<number>, probe = 0.05): number {
    const alongX = side === 'N' || side === 'S'
    const lo = alongX ? r.minX : r.minZ
    const hi = alongX ? r.maxX : r.maxZ
    const fixed = side === 'N' ? r.minZ - probe : side === 'S' ? r.maxZ + probe : side === 'W' ? r.minX - probe : r.maxX + probe
    const axis = alongX ? this.xs : this.zs
    let covered = 0
    const first = Math.max(0, lowerBound(axis, lo + EPS) - 1)
    for (let k = first; k < axis.length - 1 && axis[k] < hi - EPS; k++) {
      const a = Math.max(lo, axis[k])
      const b = Math.min(hi, axis[k + 1])
      if (b <= a) continue
      const mid = (a + b) / 2
      const cell = alongX ? this.cellAt(mid, fixed) : this.cellAt(fixed, mid)
      if (cell >= 0 && values.has(this.cells[cell])) covered += b - a
    }
    return hi > lo ? covered / (hi - lo) : 0
  }
}

/** First index with axis[i] ≥ v. */
function lowerBound(axis: readonly number[], v: number): number {
  let lo = 0
  let hi = axis.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (axis[m] < v) lo = m + 1
    else hi = m
  }
  return lo
}
