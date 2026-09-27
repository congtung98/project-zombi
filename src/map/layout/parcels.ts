import type { Rect, XZ } from '../schema.ts'
import { quantize } from '../transform.ts'
import { pointInOutline } from '../polygon.ts'
import { distanceToPolyline, hashText } from './geometry.ts'
import { CellGrid, mergeRects, qRect, rectArea, rectCentre, rectPolygon, sortRects, subtractAll } from './rects.ts'
import type { Segment } from './streets.ts'
import type { LandUseZone, LayoutBlock, LayoutParcel, ParcelAccess, ParcelKind, Polygon, RoadClass, Side, StreetSurface, ZoneProfile } from './schema.ts'

/**
 * ParcelGenerator (world generator WG2): the land between the streets, cut into parcels.
 *
 * - Blocks: the plan area minus street surfaces, unbuildable land (water, railways, no-build: rasterised
 *   conservatively) and kept (locked) parcels, split into 4-connected pieces on an exact grid of the
 *   rectangle edges, each tiled by rectangles.
 * - Each block rectangle fronts the sides where a street runs outside it. Zones that subdivide get
 *   rows of lots along the fronted sides (north/south rows across the full width, east/west columns
 *   in between), cut to the zone's frontage with a little seeded jitter; the rest becomes an interior
 *   parcel. Zones that do not subdivide (forest, farmland, empty) keep one open parcel per rectangle.
 * - Parcels never overlap streets, unbuildable land or each other, and never change a street.
 */

export const CELL = { free: 0, road: 1, sidewalk: 2, restricted: 3 } as const
/** Parcel edges sit on this grid (the navigation cell size): block rectangles shrink inwards to it. */
export const PARCEL_GRID = 0.5
/** How far past a (grid-shrunk) side the street is looked for. */
export const FRONT_PROBE = PARCEL_GRID + 0.1

/** A rectangle shrunk inwards to the parcel grid, or null when nothing is left. */
export function snapInward(r: Rect, g = PARCEL_GRID): Rect | null {
  const e = 1e-6
  const s = { minX: Math.ceil(r.minX / g - e) * g, minZ: Math.ceil(r.minZ / g - e) * g, maxX: Math.floor(r.maxX / g + e) * g, maxZ: Math.floor(r.maxZ / g + e) * g }
  return s.maxX - s.minX > e && s.maxZ - s.minZ > e ? qRect(s) : null
}
const STREET = new Set<number>([CELL.road, CELL.sidewalk])

/** mulberry32. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a of a key mixed with a seed (same scheme as container loot seeds). */
export function hashSeed(seed: number, key: string): number {
  let h = (0x811c9dc5 ^ (seed >>> 0)) >>> 0
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

const rectKey = (r: Rect) => `${r.minX},${r.minZ},${r.maxX},${r.maxZ}`

/** World-frame unbuildable area as a raster of `cell`-metre squares, merged into rectangles. */
export function rasterize(polygons: readonly Polygon[], lines: readonly { points: XZ[]; width: number }[], area: Rect, cell: number): Rect[] {
  const hit = new Map<number, Set<number>>()
  const mark = (i: number, j: number) => {
    const row = hit.get(j) ?? new Set<number>()
    row.add(i)
    hit.set(j, row)
  }
  const span = (pts: readonly XZ[], pad: number) => {
    const i0 = Math.floor((Math.max(area.minX, Math.min(...pts.map((p) => p.x)) - pad)) / cell)
    const i1 = Math.floor((Math.min(area.maxX, Math.max(...pts.map((p) => p.x)) + pad)) / cell)
    const j0 = Math.floor((Math.max(area.minZ, Math.min(...pts.map((p) => p.z)) - pad)) / cell)
    const j1 = Math.floor((Math.min(area.maxZ, Math.max(...pts.map((p) => p.z)) + pad)) / cell)
    return { i0, i1, j0, j1 }
  }
  // A cell counts when its centre is inside, or within half a cell diagonal of the boundary.
  const reach = cell * Math.SQRT1_2
  for (const poly of polygons) {
    const { i0, i1, j0, j1 } = span(poly.outer, 0)
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const c = { x: (i + 0.5) * cell, z: (j + 0.5) * cell }
        const inside = pointInOutline(poly.outer, c.x, c.z) && !poly.holes.some((h) => pointInOutline(h, c.x, c.z))
        const near = [poly.outer, ...poly.holes].some((r) => distanceToPolyline(c, [...r, r[0]]) <= reach)
        if (inside || near) mark(i, j)
      }
  }
  for (const line of lines) {
    const { i0, i1, j0, j1 } = span(line.points, line.width / 2 + cell)
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const c = { x: (i + 0.5) * cell, z: (j + 0.5) * cell }
        if (distanceToPolyline(c, line.points) <= line.width / 2 + reach) mark(i, j)
      }
  }
  const out: Rect[] = []
  for (const [j, row] of [...hit].sort(([a], [b]) => a - b)) {
    const cols = [...row].sort((a, b) => a - b)
    let s = cols[0]
    for (let k = 1; k <= cols.length; k++) {
      if (k < cols.length && cols[k] === cols[k - 1] + 1) continue
      const r = { minX: Math.max(area.minX, s * cell), minZ: Math.max(area.minZ, j * cell), maxX: Math.min(area.maxX, (cols[k - 1] + 1) * cell), maxZ: Math.min(area.maxZ, (j + 1) * cell) }
      if (r.maxX > r.minX && r.maxZ > r.minZ) out.push(qRect(r))
      s = cols[k]
    }
  }
  return out
}

export interface BlockGrid {
  grid: CellGrid
  blocks: LayoutBlock[]
  /** Free pieces too small for a parcel (m² in total). */
  sliverArea: number
  slivers: number
}

/**
 * Paint streets and unbuildable land; the free components are the blocks. Kept parcels are not
 * painted: block IDs depend on the streets only, so a block keeps its ID when parcels in it are locked.
 */
export function findBlocks(area: Rect, surfaces: readonly StreetSurface[], restricted: readonly Rect[], minDim = 3): BlockGrid {
  const grid = new CellGrid(area, [...surfaces.map((s) => s.rect), ...restricted])
  for (const r of restricted) grid.paint(r, CELL.restricted)
  for (const s of surfaces) grid.paint(s.rect, s.kind === 'sidewalk' ? CELL.sidewalk : CELL.road)
  const blocks: LayoutBlock[] = []
  let sliverArea = 0
  let slivers = 0
  const used = new Set<string>()
  for (const comp of grid.components(CELL.free)) {
    const rects = grid.rectsOf(comp)
    const area2 = rects.reduce((a, r) => a + rectArea(r), 0)
    if (rects.every((r) => Math.min(r.maxX - r.minX, r.maxZ - r.minZ) < minDim)) {
      sliverArea += area2
      slivers++
      continue
    }
    const base = `block-${hashText(rects.map(rectKey).join(';')).slice(0, 10)}`
    let id = base
    for (let k = 2; used.has(id); k++) id = `${base}-${k}`
    used.add(id)
    const edge = rects.some((r) => r.minX <= area.minX + 1e-6 || r.maxX >= area.maxX - 1e-6 || r.minZ <= area.minZ + 1e-6 || r.maxZ >= area.maxZ - 1e-6)
    blocks.push({ id, rects, area: quantize(area2), edge })
  }
  return { grid, blocks: blocks.sort((a, b) => a.rects[0].minZ - b.rects[0].minZ || a.rects[0].minX - b.rects[0].minX), sliverArea, slivers }
}

const CLASS_RANK: Record<RoadClass, number> = { arterial: 5, collector: 4, local: 3, service: 2, track: 1, path: 0 }

/** The street a rectangle side fronts: the nearest parallel segment just outside it, or null. */
export function frontOf(grid: CellGrid, r: Rect, side: Side, segments: readonly Segment[], maxReach: number): ParcelAccess | null {
  if (grid.sideCoverage(r, side, STREET, FRONT_PROBE) < 0.5) return null
  const alongX = side === 'N' || side === 'S'
  const edgeLine = side === 'N' ? r.minZ : side === 'S' ? r.maxZ : side === 'W' ? r.minX : r.maxX
  const lo = alongX ? r.minX : r.minZ
  const hi = alongX ? r.maxX : r.maxZ
  let best: { s: Segment; d: number } | null = null
  for (const s of segments) {
    if (s.axis !== (alongX ? 'H' : 'V')) continue
    const c = alongX ? s.a.z : s.a.x
    const d = side === 'N' || side === 'W' ? edgeLine - c : c - edgeLine
    if (d <= 0 || d > s.width / 2 + maxReach) continue
    const a = alongX ? Math.min(s.a.x, s.b.x) : Math.min(s.a.z, s.b.z)
    const b = alongX ? Math.max(s.a.x, s.b.x) : Math.max(s.a.z, s.b.z)
    if (Math.min(hi, b + s.width) - Math.max(lo, a - s.width) <= 0) continue
    if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) < 1e-9 && (CLASS_RANK[s.roadClass] > CLASS_RANK[best.s.roadClass] || s.edge < best.s.edge))) best = { s, d }
  }
  if (!best) return null
  return { edge: best.s.edge, side, frontage: quantize(hi - lo), roadClass: best.s.roadClass }
}

interface Piece {
  rect: Rect
  kind: ParcelKind
  access: ParcelAccess | null
}

/** Split `total` into `n` parts with ±15 % seeded jitter, cut positions on half metres. */
function cuts(lo: number, hi: number, n: number, random: () => number): number[] {
  const raw = [...Array(n).keys()].map(() => 0.85 + random() * 0.3)
  const sum = raw.reduce((a, c) => a + c, 0)
  const out = [lo]
  let acc = lo
  for (let i = 0; i < n - 1; i++) {
    acc += ((hi - lo) * raw[i]) / sum
    out.push(Math.round(acc * 2) / 2)
  }
  out.push(hi)
  // Jitter or rounding must never produce an empty lot.
  for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1]) return [...Array(n + 1).keys()].map((k) => lo + ((hi - lo) * k) / n)
  return out
}

function lotCount(length: number, p: ZoneProfile): number {
  const [fMin, fT, fMax] = p.frontage
  let n = Math.max(1, Math.round(length / fT))
  n = Math.max(n, Math.ceil(length / fMax))
  n = Math.min(n, Math.max(1, Math.floor(length / fMin)))
  return n
}

/** Depth of a row from one side: a lot deep, or all of it when the rest would be too shallow. */
function rowDepth(avail: number, both: boolean, p: ZoneProfile): number {
  const [dMin, dT] = p.depth
  if (both) {
    const d = Math.min(dT, avail / 2)
    return avail - 2 * d < dMin ? avail / 2 : d
  }
  const d = Math.min(dT, avail)
  return avail - d < dMin ? avail : d
}

/** Parcels of one block rectangle with its fronted sides. */
export function subdivide(r: Rect, fronts: ReadonlyMap<Side, ParcelAccess>, p: ZoneProfile, random: () => number): Piece[] {
  if (!fronts.size) return [{ rect: r, kind: 'interior', access: null }]
  const best = [...fronts.values()].sort((a, b) => CLASS_RANK[b.roadClass] - CLASS_RANK[a.roadClass] || b.frontage - a.frontage || (a.side < b.side ? -1 : 1))[0]
  if (!p.subdivide) return [{ rect: r, kind: 'open', access: best }]
  const W = r.maxX - r.minX
  const D = r.maxZ - r.minZ
  const [dMin] = p.depth
  const out: Piece[] = []
  let n = fronts.get('N') ?? null
  let s = fronts.get('S') ?? null
  let w = fronts.get('W') ?? null
  let e = fronts.get('E') ?? null
  // Too shallow for two rows (or two columns): one row, facing the better street.
  if (n && s && D < 2 * dMin) [n, s] = CLASS_RANK[s.roadClass] > CLASS_RANK[n.roadClass] ? [null, s] : [n, null]
  if (w && e && W < 2 * dMin) [w, e] = CLASS_RANK[e.roadClass] > CLASS_RANK[w.roadClass] ? [null, e] : [w, null]
  // Rows only when their side is long enough for a lot; columns only in the span the rows leave.
  const dN = n ? rowDepth(D, !!s, p) : 0
  const dS = s ? rowDepth(D, !!n, p) : 0
  const z0 = r.minZ + dN
  const z1 = r.maxZ - dS
  const midD = z1 - z0
  const useCols = midD >= Math.max(dMin, p.frontage[0]) - 1e-6
  const dW = useCols && w ? rowDepth(W, !!e, p) : 0
  const dE = useCols && e ? rowDepth(W, !!w, p) : 0
  const row = (rect: Rect, access: ParcelAccess, alongX: boolean) => {
    const lo = alongX ? rect.minX : rect.minZ
    const hi = alongX ? rect.maxX : rect.maxZ
    const c = cuts(lo, hi, lotCount(hi - lo, p), random)
    for (let i = 1; i < c.length; i++) {
      const lot = alongX ? { ...rect, minX: c[i - 1], maxX: c[i] } : { ...rect, minZ: c[i - 1], maxZ: c[i] }
      out.push({ rect: qRect(lot), kind: 'lot', access: { ...access, frontage: quantize(c[i] - c[i - 1]) } })
    }
  }
  if (n && dN > 0) row({ minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.minZ + dN }, n, true)
  if (s && dS > 0) row({ minX: r.minX, maxX: r.maxX, minZ: r.maxZ - dS, maxZ: r.maxZ }, s, true)
  if (midD > 1e-6) {
    if (w && dW > 0) row({ minX: r.minX, maxX: r.minX + dW, minZ: z0, maxZ: z1 }, w, false)
    if (e && dE > 0) row({ minX: r.maxX - dE, maxX: r.maxX, minZ: z0, maxZ: z1 }, e, false)
    const inner = { minX: r.minX + dW, maxX: r.maxX - dE, minZ: z0, maxZ: z1 }
    if (inner.maxX - inner.minX > 1e-6 && inner.maxZ - inner.minZ > 1e-6) out.push({ rect: qRect(inner), kind: 'interior', access: null })
  }
  return out
}

export interface ParcelContext {
  seed: number
  profileOf: (zone: LandUseZone) => ZoneProfile
  zoneAt: (p: XZ) => LandUseZone
  segments: readonly Segment[]
  /** Farthest a street centre line can be from a fronted side, beyond half its width (the widest sidewalk + slack). */
  reach: number
  inset: number
}

/**
 * Cut block rectangles where a street starts or stops along a side, so every piece either fronts a
 * street along its whole side or not at all (a row of lots never runs past the end of its street).
 */
export function splitByFrontage(grid: CellGrid, rects: readonly Rect[], minRun = 1): Rect[] {
  const queue = [...rects]
  const out: Rect[] = []
  let guard = 0
  while (queue.length) {
    const r = queue.shift()!
    let split: Rect[] | null = null
    for (const side of ['N', 'S', 'W', 'E'] as const) {
      const alongX = side === 'N' || side === 'S'
      const lo = alongX ? r.minX : r.minZ
      const hi = alongX ? r.maxX : r.maxZ
      const runs = grid.sideRuns(r, side, STREET, FRONT_PROBE).filter(([a, b]) => b - a >= minRun)
      if (!runs.length) continue
      const at = [...new Set(runs.flat())].filter((v) => v > lo + minRun && v < hi - minRun).sort((a, b) => a - b)
      if (!at.length) continue
      const edges = [lo, ...at, hi]
      split = edges.slice(1).map((v, i) => (alongX ? { ...r, minX: edges[i], maxX: v } : { ...r, minZ: edges[i], maxZ: v }))
      break
    }
    if (split && guard++ < 10000) queue.push(...split)
    else out.push(r)
  }
  return sortRects(out)
}

/** Parcels of a block around the kept parcels in it (their land is left out, they are not changed). */
export function blockParcels(grid: CellGrid, block: LayoutBlock, ctx: ParcelContext, kept: readonly Rect[] = []): LayoutParcel[] {
  const pieces: Piece[] = []
  // On the parcel grid, so buildings line up with the navigation cells (kept parcels are cut out first).
  const free = block.rects.flatMap((r) => subtractAll(r, kept)).map((r) => snapInward(r)).filter((r): r is Rect => r !== null)
  for (const r of splitByFrontage(grid, free)) {
    const zone = ctx.zoneAt(rectCentre(r))
    const fronts = new Map<Side, ParcelAccess>()
    for (const side of ['N', 'S', 'W', 'E'] as const) {
      const a = frontOf(grid, r, side, ctx.segments, ctx.reach)
      if (a) fronts.set(side, a)
    }
    const random = rng(hashSeed(ctx.seed, `${block.id}:${rectKey(r)}`))
    pieces.push(...subdivide(r, fronts, ctx.profileOf(zone), random))
  }
  // Interior land left by neighbouring pieces is one parcel where the pieces line up exactly.
  const interior = mergeRects(pieces.filter((q) => q.kind === 'interior').map((q) => q.rect)).map((rect): Piece => ({ rect, kind: 'interior', access: null }))
  return [...pieces.filter((q) => q.kind !== 'interior'), ...interior].map((piece) => makeParcel(piece, block.id, ctx))
}

function makeParcel(piece: Piece, block: string, ctx: ParcelContext): LayoutParcel {
  const r = piece.rect
  const id = `lot-${hashText(rectKey(r)).slice(0, 10)}`
  const inset = { minX: r.minX + ctx.inset, minZ: r.minZ + ctx.inset, maxX: r.maxX - ctx.inset, maxZ: r.maxZ - ctx.inset }
  const buildable = inset.maxX - inset.minX >= 2 && inset.maxZ - inset.minZ >= 2 ? qRect(inset) : null
  return {
    id,
    block,
    polygon: rectPolygon(r),
    area: quantize(rectArea(r)),
    zone: ctx.zoneAt(rectCentre(r)),
    kind: piece.kind,
    access: piece.access,
    buildable,
    seed: hashSeed(ctx.seed, id),
    locked: false,
  }
}

export function parcelRect(p: LayoutParcel): Rect {
  const xs = p.polygon.map((q) => q.x)
  const zs = p.polygon.map((q) => q.z)
  return { minX: Math.min(...xs), minZ: Math.min(...zs), maxX: Math.max(...xs), maxZ: Math.max(...zs) }
}

export { sortRects }
