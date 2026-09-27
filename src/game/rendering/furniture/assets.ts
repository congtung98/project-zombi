import type { SurfaceId } from '../surfaces/catalog'
import { FURNITURE_VARIANTS, type FurnitureId } from './catalog'

/**
 * G3a: the parts of every furniture asset, as boxes in the asset's own frame: x across the front
 * (−w/2…w/2), y up from the floor (0…h), z from the back (−d/2) to the front (+d/2). Every part lies
 * inside that box (tests hold it), so an asset never reaches past the collider it dresses.
 *
 * Sizes follow the box: proportions and counts (seat cushions, doors, shelves) come from the box, fixed
 * trims (handles, plinths) stay a physical size. Nothing is random: the same box always gives the same
 * parts (seeded variation belongs to the variants of G3b). Parts are sized for the gameplay camera (28
 * px/m): a handle is at least 2.5 cm, anything smaller would not show.
 *
 * `color` is the object's content colour: the main material (blanket, upholstery, cabinet fronts, wood
 * of a table); other parts are fixed accents or shades of it.
 */

export type V3 = [number, number, number]

export interface FurniturePart {
  /** Stable part name (`door-1`, `pillow-0`), for tests and the debug. */
  name: string
  min: V3
  max: V3
  color: string
  surface: SurfaceId
}

export interface Dims {
  /** Across the front. */
  w: number
  h: number
  /** Back to front. */
  d: number
}

const WOOD_DARK = '#5b4332'
const PLINTH = '#3b352f'
const LINEN = '#e2ddd2'
const PILLOW = '#eeeae3'
const COUNTERTOP = '#c8c1b3'
const STEEL = '#8e9398'
const HANDLE = '#4a4d51'
const CARDBOARD = '#a27b50'
const BOOKS = ['#7d3b32', '#3f5a6b', '#8a7a4e', '#4e6a4a', '#6b5a7a', '#a0673c']

/** Mix a colour towards white (k > 0) or black (k < 0) by |k|. */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const to = k > 0 ? 255 : 0
  const a = Math.min(1, Math.abs(k))
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * a))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

class Parts {
  readonly list: FurniturePart[] = []
  /** Names of parts that reached past the box (clipped); tests keep it empty for sensible sizes. */
  readonly clipped: string[] = []
  readonly dims: Dims
  constructor(dims: Dims) {
    this.dims = dims
  }
  /** A part from its bounds; clipped to the asset box, dropped when (nearly) empty. */
  box(name: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string, surface: SurfaceId): void {
    const { w, h, d } = this.dims
    const e = 1e-9
    if (x0 < -w / 2 - e || x1 > w / 2 + e || y0 < -e || y1 > h + e || z0 < -d / 2 - e || z1 > d / 2 + e) this.clipped.push(name)
    const min: V3 = [Math.max(x0, -w / 2), Math.max(y0, 0), Math.max(z0, -d / 2)]
    const max: V3 = [Math.min(x1, w / 2), Math.min(y1, h), Math.min(z1, d / 2)]
    if (max[0] - min[0] < 0.005 || max[1] - min[1] < 0.005 || max[2] - min[2] < 0.005) return
    this.list.push({ name, min, max, color, surface })
  }
}

/** `n` equal slots across [a, b] with `gap` between them. */
function slots(a: number, b: number, n: number, gap: number): [number, number][] {
  const size = (b - a - gap * (n - 1)) / n
  return Array.from({ length: n }, (_, i) => [a + i * (size + gap), a + i * (size + gap) + size])
}

/** Frame, mattress, blanket over the foot end with its drapes, pillows at the head. */
function bed(p: Parts, c: string, variant: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  const head = Math.min(0.08, d * 0.05)
  const baseTop = h * 0.45
  const mattressTop = h * 0.78
  const blanketTop = h * 0.85
  p.box('headboard', x0, x1, 0, h, z0, z0 + head, WOOD_DARK, 'wood')
  p.box('frame', x0, x1, 0, baseTop, z0 + head, z1, shade(WOOD_DARK, 0.12), 'wood')
  p.box('mattress', x0 + 0.03, x1 - 0.03, baseTop, mattressTop, z0 + head, z1 - 0.03, LINEN, 'fabric')
  const fold = z0 + head + (d - head) * 0.36
  const pillows = w >= 1.25 ? 2 : 1
  const pd = Math.min(0.34, (fold - z0 - head) * 0.8)
  const top = Math.min(h, mattressTop + Math.max(0.05, h * 0.13))
  if (variant === 'unmade') {
    // Unmade: the blanket thrown back into a heap on one side of the foot end, one pillow gone.
    const heap = x0 + (x1 - x0) * 0.6
    const from = z1 - (d - head) * 0.45
    p.box('blanket', x0 + 0.005, heap, mattressTop, top, from, z1 - 0.005, c, 'fabric')
    p.box('blanket-foot', x0 + 0.005, heap, baseTop, mattressTop, z1 - 0.03, z1 - 0.005, c, 'fabric')
    p.box('blanket-left', x0 + 0.005, x0 + 0.03, baseTop, mattressTop, from, z1 - 0.03, c, 'fabric')
    const [a, b] = slots(x0 + 0.1, x1 - 0.1, pillows, 0.08)[pillows - 1]
    const half = Math.min(0.32, (b - a) / 2)
    const cx = Math.max(x0 + 0.1 + half, (a + b) / 2 - 0.08)
    p.box('pillow-0', cx - half, cx + half, mattressTop, top, z0 + head + 0.12, z0 + head + 0.12 + pd, PILLOW, 'fabric')
    return
  }
  p.box('blanket', x0 + 0.005, x1 - 0.005, mattressTop, blanketTop, fold, z1 - 0.005, c, 'fabric')
  p.box('blanket-foot', x0 + 0.005, x1 - 0.005, baseTop, mattressTop, z1 - 0.03, z1 - 0.005, c, 'fabric')
  p.box('blanket-left', x0 + 0.005, x0 + 0.03, baseTop, mattressTop, fold, z1 - 0.03, c, 'fabric')
  p.box('blanket-right', x1 - 0.03, x1 - 0.005, baseTop, mattressTop, fold, z1 - 0.03, c, 'fabric')
  slots(x0 + 0.1, x1 - 0.1, pillows, 0.08).forEach(([a, b], i) => {
    const cx = (a + b) / 2
    const half = Math.min(0.32, (b - a) / 2)
    p.box(`pillow-${i}`, cx - half, cx + half, mattressTop, top, z0 + head + 0.04, z0 + head + 0.04 + pd, PILLOW, 'fabric')
  })
}

/** Legs, base, arms, back and one seat and back cushion per ~0.65 m (one: an armchair). */
function sofa(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  const arm = clamp(w * 0.12, 0.1, 0.2)
  const back = clamp(d * 0.22, 0.12, 0.22)
  const leg = Math.min(0.06, h * 0.08)
  const seat = h * 0.38
  for (const [i, [lx, lz]] of [[x0, z0], [x1 - 0.05, z0], [x0, z1 - 0.05], [x1 - 0.05, z1 - 0.05]].entries()) {
    p.box(`leg-${i}`, lx, lx + 0.05, 0, leg, lz, lz + 0.05, WOOD_DARK, 'wood')
  }
  p.box('base', x0, x1, leg, seat, z0, z1, shade(c, -0.15), 'fabric')
  p.box('arm-left', x0, x0 + arm, seat, h * 0.72, z0, z1, c, 'fabric')
  p.box('arm-right', x1 - arm, x1, seat, h * 0.72, z0, z1, c, 'fabric')
  p.box('back', x0 + arm, x1 - arm, seat, h, z0, z0 + back, c, 'fabric')
  const n = Math.max(1, Math.round((w - 2 * arm) / 0.65))
  const cushion = Math.min(0.14, d * 0.16)
  slots(x0 + arm, x1 - arm, n, 0.02).forEach(([a, b], i) => {
    p.box(`seat-${i}`, a, b, seat, h * 0.56, z0 + back, z1 - 0.02, shade(c, 0.1), 'fabric')
    p.box(`cushion-${i}`, a, b, h * 0.56, h * 0.92, z0 + back, z0 + back + cushion, shade(c, 0.06), 'fabric')
  })
}

/** Four legs at the corners (inset), for tables and desks. */
function legs(p: Parts, top: number, size: number, inset: number, color: string, which: readonly number[] = [0, 1, 2, 3]): void {
  const { w, d } = p.dims
  const xs = [-w / 2 + inset, w / 2 - inset - size]
  const zs = [-d / 2 + inset, d / 2 - inset - size]
  for (const i of which) {
    const x = xs[i & 1]
    const z = zs[i >> 1]
    p.box(`leg-${i}`, x, x + size, 0, top, z, z + size, color, 'wood')
  }
}

/** Top with its thickness, apron, legs; a low one (coffee table) also has a shelf. */
function table(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const t = Math.min(0.045, h * 0.08)
  const leg = clamp(Math.min(w, d) * 0.08, 0.04, 0.07)
  p.box('top', -w / 2, w / 2, h - t, h, -d / 2, d / 2, c, 'wood')
  p.box('apron', -w / 2 + 0.06, w / 2 - 0.06, h - t - 0.07, h - t, -d / 2 + 0.06, d / 2 - 0.06, shade(c, -0.12), 'wood')
  legs(p, h - t, leg, 0.04, shade(c, -0.12))
  if (h < 0.55) p.box('shelf', -w / 2 + 0.06, w / 2 - 0.06, 0.08, 0.1, -d / 2 + 0.06, d / 2 - 0.06, shade(c, -0.05), 'wood')
}

/** Drawer fronts (with a bar handle each) stacked in [y0, y1] across [x0, x1], on the front at `front`. */
function drawers(p: Parts, name: string, x0: number, x1: number, y0: number, y1: number, n: number, front: number, color: string): void {
  slots(y0, y1, n, 0.012).forEach(([a, b], i) => {
    p.box(`${name}-${i}`, x0, x1, a, b, front, front + 0.018, color, 'wood')
    const cx = (x0 + x1) / 2
    const half = Math.min(0.07, (x1 - x0) * 0.25)
    const cy = (a + b) / 2
    p.box(`${name}-handle-${i}`, cx - half, cx + half, cy - 0.0125, cy + 0.0125, front + 0.018, front + 0.03, HANDLE, 'paintedMetal')
  })
}

/** Top, a drawer pedestal on the right, two legs on the left, a modesty panel at the back. */
function desk(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  const t = Math.min(0.04, h * 0.07)
  const ped = Math.min(0.42, w * 0.35)
  const front = z1 - 0.03
  p.box('top', x0, x1, h - t, h, z0, z1, c, 'wood')
  p.box('pedestal', x1 - ped, x1, 0, h - t, z0 + 0.02, front, shade(c, -0.1), 'wood')
  drawers(p, 'drawer', x1 - ped + 0.01, x1 - 0.01, 0.03, h - t - 0.01, 3, front, c)
  legs(p, h - t, 0.05, 0.03, shade(c, -0.1), [0, 2])
  p.box('panel', x0 + 0.08, x1 - ped, h * 0.45, h - t, z0 + 0.03, z0 + 0.05, shade(c, -0.1), 'wood')
}

/** Seat on four legs, back posts with a top rail and a middle slat. */
function chair(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2
  const seat = h * 0.48
  const leg = clamp(w * 0.09, 0.03, 0.05)
  const t = 0.04
  legs(p, seat, leg, 0.01, shade(c, -0.08))
  p.box('seat', x0, x1, seat, seat + t, z0, d / 2, shade(c, 0.06), 'wood')
  p.box('post-left', x0 + 0.01, x0 + 0.01 + leg, seat + t, h, z0 + 0.01, z0 + 0.01 + leg, c, 'wood')
  p.box('post-right', x1 - 0.01 - leg, x1 - 0.01, seat + t, h, z0 + 0.01, z0 + 0.01 + leg, c, 'wood')
  p.box('rail', x0 + 0.01 + leg, x1 - 0.01 - leg, h - 0.13, h - 0.02, z0 + 0.015, z0 + 0.015 + 0.03, c, 'wood')
  p.box('slat', -0.03, 0.03, seat + t, h - 0.13, z0 + 0.02, z0 + 0.04, c, 'wood')
}

/**
 * Base cabinets in ~0.6 m modules (a drawer over a door, handles), toe kick, and a top: a stone-like
 * worktop with a sink when long enough (counter), or a wooden one (cabinet: doors only).
 */
function cabinets(p: Parts, c: string, worktop: boolean): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  const top = 0.04
  const kick = Math.min(0.1, h * 0.11)
  const front = z1 - (worktop ? 0.045 : 0.03)
  p.box('kick', x0, x1, 0, kick, z0, front - 0.05, PLINTH, 'matte')
  p.box('carcass', x0, x1, kick, h - top, z0, front, shade(c, -0.12), 'wood')
  const n = Math.max(1, Math.round(w / 0.6))
  const drawer = worktop && h - top - kick > 0.5
  slots(x0 + 0.004, x1 - 0.004, n, 0.008).forEach(([a, b], i) => {
    const doorTop = drawer ? h - top - 0.2 : h - top - 0.012
    if (drawer) drawers(p, `drawer-${i}`, a, b, h - top - 0.19, h - top - 0.012, 1, front, c)
    p.box(`door-${i}`, a, b, kick + 0.01, doorTop, front, front + 0.018, c, 'wood')
    // Handle near the edge the door opens from, alternating so pairs meet in the middle.
    const hx = i % 2 === 0 ? b - 0.05 : a + 0.025
    p.box(`door-handle-${i}`, hx, hx + 0.025, doorTop - 0.16, doorTop - 0.04, front + 0.018, front + 0.03, HANDLE, 'paintedMetal')
  })
  const y0 = h - top
  if (!worktop) {
    p.box('top', x0, x1, y0, h, z0, z1, shade(c, -0.05), 'wood')
    return
  }
  if (w < 1.6) {
    p.box('worktop', x0, x1, y0, h, z0, z1, COUNTERTOP, 'matte')
    return
  }
  // Sink a third of the way along, set into the worktop (four worktop pieces around the basin).
  const sw = 0.5
  const sx0 = clamp(x0 + w * 0.3 - sw / 2, x0 + 0.1, x1 - 0.1 - sw)
  const sx1 = sx0 + sw
  const sz0 = z0 + 0.08
  const sz1 = z1 - 0.1
  p.box('worktop-left', x0, sx0, y0, h, z0, z1, COUNTERTOP, 'matte')
  p.box('worktop-right', sx1, x1, y0, h, z0, z1, COUNTERTOP, 'matte')
  p.box('worktop-back', sx0, sx1, y0, h, z0, sz0, COUNTERTOP, 'matte')
  p.box('worktop-front', sx0, sx1, y0, h, sz1, z1, COUNTERTOP, 'matte')
  p.box('sink', sx0, sx1, y0 - 0.1, h - 0.02, sz0, sz1, STEEL, 'paintedMetal')
}

/** Body on a plinth, freezer door over the fridge door (the split shows), vertical handles. */
function fridge(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  const front = z1 - 0.03
  const split = h * 0.64
  p.box('plinth', x0 + 0.02, x1 - 0.02, 0, 0.05, z0, front - 0.03, PLINTH, 'matte')
  p.box('body', x0, x1, 0.05, h, z0, front, shade(c, -0.08), 'paintedMetal')
  p.box('door-lower', x0 + 0.005, x1 - 0.005, 0.06, split - 0.008, front, front + 0.018, c, 'paintedMetal')
  p.box('door-upper', x0 + 0.005, x1 - 0.005, split + 0.008, h - 0.008, front, front + 0.018, c, 'paintedMetal')
  const hx = x0 + 0.05
  p.box('handle-lower', hx, hx + 0.03, Math.max(0.12, split - 0.5), split - 0.06, front + 0.018, z1, HANDLE, 'paintedMetal')
  p.box('handle-upper', hx, hx + 0.03, split + 0.06, Math.min(h - 0.05, split + 0.36), front + 0.018, z1, HANDLE, 'paintedMetal')
}

/** Plinth, body, cornice, one to three doors with handles where they meet. */
function wardrobe(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  const front = z1 - 0.03
  p.box('plinth', x0 + 0.02, x1 - 0.02, 0, 0.07, z0, front - 0.03, shade(c, -0.35), 'wood')
  p.box('body', x0, x1, 0.07, h - 0.05, z0, front, shade(c, -0.1), 'wood')
  p.box('cornice', x0, x1, h - 0.05, h, z0, z1, shade(c, -0.18), 'wood')
  const n = w >= 1.7 ? 3 : w >= 0.8 ? 2 : 1
  const hh = Math.min(0.35, h * 0.2)
  const hy = h * 0.55
  slots(x0 + 0.005, x1 - 0.005, n, 0.012).forEach(([a, b], i) => {
    p.box(`door-${i}`, a, b, 0.09, h - 0.07, front, front + 0.018, c, 'wood')
    const left = n > 1 && i === n - 1
    const hx = left ? a + 0.03 : b - 0.055
    p.box(`handle-${i}`, hx, hx + 0.025, hy - hh / 2, hy + hh / 2, front + 0.018, front + 0.03, HANDLE, 'paintedMetal')
  })
}

/** Short legs, body, overhanging top, two drawers with handles. */
function nightstand(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  const top = 0.03
  const front = z1 - 0.03
  legs(p, 0.08, 0.035, 0.015, shade(c, -0.25))
  p.box('body', x0 + 0.01, x1 - 0.01, 0.08, h - top, z0 + 0.01, front, shade(c, -0.1), 'wood')
  p.box('top', x0, x1, h - top, h, z0, z1, c, 'wood')
  drawers(p, 'drawer', x0 + 0.02, x1 - 0.02, 0.1, h - top - 0.01, 2, front, c)
}

/** Book runs per compartment: [start, width] as shares of the inner width, height share, colour. */
const BOOK_RUNS: readonly (readonly [number, number, number, number])[][] = [
  [[0.02, 0.28, 0.8, 0], [0.31, 0.16, 0.68, 1], [0.62, 0.3, 0.86, 2]],
  [[0.05, 0.4, 0.74, 3], [0.55, 0.14, 0.9, 0], [0.73, 0.2, 0.64, 4]],
  [[0.0, 0.22, 0.9, 1], [0.24, 0.3, 0.7, 5], [0.7, 0.26, 0.8, 3]],
  [[0.1, 0.48, 0.8, 4], [0.64, 0.3, 0.7, 2]],
]

/** Sides, top, plinth, back, shelves; runs of books on each shelf (a fixed pattern). */
function bookshelf(p: Parts, c: string, variant: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  const side = 0.03
  const back = 0.015
  const plinth = 0.07
  const board = 0.025
  p.box('side-left', x0, x0 + side, 0, h, z0, z1, c, 'wood')
  p.box('side-right', x1 - side, x1, 0, h, z0, z1, c, 'wood')
  p.box('top', x0 + side, x1 - side, h - side, h, z0, z1, c, 'wood')
  p.box('plinth', x0 + side, x1 - side, 0, plinth, z0, z1 - 0.02, shade(c, -0.2), 'wood')
  p.box('back', x0 + side, x1 - side, plinth, h - side, z0, z0 + back, shade(c, -0.22), 'wood')
  const n = Math.max(2, Math.round((h - plinth - side) / 0.36))
  const step = (h - plinth - side) / n
  const inner = w - 2 * side
  const bookDepth = Math.min(0.22, d - back - 0.05)
  for (let k = 0; k < n; k++) {
    const floor = plinth + k * step + (k > 0 ? board : 0)
    if (k > 0) p.box(`shelf-${k}`, x0 + side, x1 - side, floor - board, floor, z0 + back, z1 - 0.01, c, 'wood')
    const clear = plinth + (k + 1) * step - floor
    for (const [j, [start, width, tall, colour]] of BOOK_RUNS[k % BOOK_RUNS.length].entries()) {
      // Sparse: most runs taken, a few books left here and there.
      if (variant === 'sparse' && (k + j) % 3 !== 0) continue
      const a = x0 + side + start * inner
      p.box(`books-${k}-${j}`, a, a + width * inner, floor, floor + Math.min(0.3, tall * clear), z0 + back + 0.01, z0 + back + 0.01 + bookDepth, BOOKS[colour], 'matte')
    }
  }
}

/** What stands on each level of a storage rack: [start, width] shares, height share, cardboard box or cans. */
const RACK_GOODS: readonly (readonly [number, number, number, 'box' | 'cans'])[][] = [
  [[0.05, 0.36, 0.7, 'box'], [0.52, 0.22, 0.45, 'cans']],
  [[0.1, 0.26, 0.5, 'cans'], [0.46, 0.46, 0.8, 'box']],
  [[0.58, 0.32, 0.6, 'box']],
  [[0.04, 0.3, 0.55, 'box'], [0.4, 0.2, 0.45, 'cans']],
]

/** Tools on a rack, same shares as the goods: red toolboxes (`box`) and paint tins (`cans`). */
const RACK_TOOLS: readonly (readonly [number, number, number, 'box' | 'cans'])[][] = [
  [[0.06, 0.42, 0.45, 'box'], [0.56, 0.3, 0.55, 'cans']],
  [[0.08, 0.3, 0.6, 'cans'], [0.5, 0.38, 0.4, 'box']],
  [[0.1, 0.5, 0.35, 'box']],
  [[0.52, 0.34, 0.5, 'cans']],
]

/** Four posts, boards, goods on every level but the top (tools, or little left when sparse). */
function shelving(p: Parts, c: string, variant: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  const post = 0.04
  const board = 0.03
  for (const [i, [px, pz]] of [[x0, z0], [x1 - post, z0], [x0, z1 - post], [x1 - post, z1 - post]].entries()) {
    p.box(`post-${i}`, px, px + post, 0, h, pz, pz + post, shade(c, -0.3), 'paintedMetal')
  }
  const n = Math.max(3, Math.round(h / 0.45))
  const step = (h - 0.06 - board) / (n - 1)
  for (let k = 0; k < n; k++) {
    const y = 0.06 + k * step
    p.box(`board-${k}`, x0 + 0.005, x1 - 0.005, y, y + board, z0 + 0.005, z1 - 0.005, c, 'wood')
    if (k === n - 1) continue
    const clear = step - board
    const tools = variant === 'tools'
    const table = tools ? RACK_TOOLS : RACK_GOODS
    for (const [j, [start, width, tall, kind]] of table[k % table.length].entries()) {
      if (variant === 'sparse' && (k + j) % 3 !== 1) continue
      const a = x0 + post + start * (w - 2 * post)
      const b = a + width * (w - 2 * post)
      const top = y + board + tall * clear
      if (kind === 'box') p.box(`goods-${k}-${j}`, a, b, y + board, top, z0 + 0.05, z1 - 0.08, tools ? '#a3322a' : CARDBOARD, tools ? 'paintedMetal' : 'matte')
      else p.box(`goods-${k}-${j}`, a, b, y + board, top, -0.08, 0.08, tools ? '#5d6b52' : '#6c7d8a', 'paintedMetal')
    }
  }
}

/** A box of slats: core, three bands on every side, lid planks. */
function crate(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  const t = 0.02
  p.box('core', x0 + t, x1 - t, 0, h - t, z0 + t, z1 - t, shade(c, -0.25), 'wood')
  slots(0, h - t, 3, 0.03).forEach(([a, b], i) => {
    p.box(`slat-back-${i}`, x0, x1, a, b, z0, z0 + t, c, 'wood')
    p.box(`slat-front-${i}`, x0, x1, a, b, z1 - t, z1, c, 'wood')
    p.box(`slat-left-${i}`, x0, x0 + t, a, b, z0 + t, z1 - t, c, 'wood')
    p.box(`slat-right-${i}`, x1 - t, x1, a, b, z0 + t, z1 - t, c, 'wood')
  })
  slots(x0, x1, 3, 0.025).forEach(([a, b], i) => p.box(`lid-${i}`, a, b, h - t, h, z0, z1, shade(c, 0.05), 'wood'))
}

/** Legs, a thick top a little under the box top, a vice and a tray of tools on it, a toolbox on the shelf. */
function workbench(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  const top = h - 0.1
  p.box('top', x0, x1, top - 0.06, top, z0, z1, c, 'wood')
  legs(p, top - 0.06, 0.07, 0.03, shade(c, -0.2))
  p.box('shelf', x0 + 0.05, x1 - 0.05, 0.12, 0.15, z0 + 0.05, z1 - 0.05, shade(c, -0.1), 'wood')
  p.box('toolbox', x0 + 0.15, x0 + 0.15 + Math.min(0.45, w * 0.35), 0.15, 0.33, z0 + 0.08, z0 + 0.08 + Math.min(0.22, d - 0.16), '#a3322a', 'paintedMetal')
  const vx = x1 - 0.22
  p.box('vice', vx, vx + 0.16, top, h, z1 - 0.2, z1 - 0.04, '#3f5a6b', 'paintedMetal')
  p.box('tray', x0 + 0.2, x0 + 0.5, top, top + 0.03, z0 + 0.1, z0 + 0.3, '#8e9398', 'paintedMetal')
}

/** G4: a car: wheels, lower body, glass cabin under a roof, bumpers, head and tail lights (front = +z). */
function car(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  const wr = Math.min(0.34, h * 0.25)
  const tyre = 0.22
  for (const [i, zc] of [z0 + d * 0.2, z1 - d * 0.2].entries()) {
    p.box(`wheel-l-${i}`, x0, x0 + tyre, 0, 2 * wr, zc - wr, zc + wr, '#1f1f21', 'matte')
    p.box(`wheel-r-${i}`, x1 - tyre, x1, 0, 2 * wr, zc - wr, zc + wr, '#1f1f21', 'matte')
  }
  const sill = wr * 0.8
  const belt = h * 0.55
  p.box('body', x0 + 0.04, x1 - 0.04, sill, belt, z0 + 0.05, z1 - 0.05, c, 'paintedMetal')
  p.box('bumper-front', x0 + 0.08, x1 - 0.08, sill - 0.05, sill + 0.12, z1 - 0.05, z1, '#2a2b2e', 'matte')
  p.box('bumper-rear', x0 + 0.08, x1 - 0.08, sill - 0.05, sill + 0.12, z0, z0 + 0.05, '#2a2b2e', 'matte')
  p.box('cabin', x0 + 0.12, x1 - 0.12, belt, h * 0.93, z0 + d * 0.2, z1 - d * 0.32, '#2c3a45', 'paintedMetal')
  p.box('roof', x0 + 0.15, x1 - 0.15, h * 0.93, h, z0 + d * 0.24, z1 - d * 0.36, c, 'paintedMetal')
  p.box('bonnet', x0 + 0.06, x1 - 0.06, belt, belt + 0.03, z1 - d * 0.32, z1 - 0.06, shade(c, -0.08), 'paintedMetal')
  for (const [i, [a, b]] of [[x0 + 0.14, x0 + 0.44], [x1 - 0.44, x1 - 0.14]].entries()) {
    p.box(`headlight-${i}`, a, b, belt - 0.14, belt - 0.05, z1 - 0.06, z1 - 0.045, '#e8e2c8', 'matte')
    p.box(`taillight-${i}`, a, b, belt - 0.14, belt - 0.05, z0 + 0.045, z0 + 0.06, '#8a2020', 'matte')
  }
}

/** G4: a board fence: posts about every 2 m, a board panel, top and bottom rails (along x). */
function fence(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2
  const post = Math.min(0.1, w / 4)
  const n = Math.max(2, Math.round(w / 2) + 1)
  for (let i = 0; i < n; i++) {
    const x = x0 + ((w - post) * i) / (n - 1)
    p.box(`post-${i}`, x, x + post, 0, h, -d / 2, d / 2, shade(c, -0.15), 'wood')
  }
  const t = Math.min(0.03, d * 0.3)
  p.box('panel', x0, x1, 0.06, h - 0.06, -t / 2, t / 2, c, 'wood')
  p.box('rail-top', x0, x1, h - 0.16, h - 0.08, -d * 0.35, d * 0.35, shade(c, -0.08), 'wood')
  p.box('rail-bottom', x0, x1, 0.14, 0.22, -d * 0.35, d * 0.35, shade(c, -0.08), 'wood')
}

/** G4: a wheelie bin: body, overhanging lid, handle and wheels at the back (front = +z). */
function bin(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  p.box('body', x0 + 0.03, x1 - 0.03, 0.06, h - 0.06, z0 + 0.06, z1 - 0.02, c, 'paintedMetal')
  p.box('lid', x0, x1, h - 0.06, h, z0 + 0.02, z1, shade(c, -0.12), 'paintedMetal')
  p.box('handle', x0 + w * 0.2, x1 - w * 0.2, h - 0.16, h - 0.08, z0, z0 + 0.05, '#2a2b2e', 'matte')
  p.box('wheel-l', x0 + 0.02, x0 + 0.1, 0, 0.16, z0 + 0.02, z0 + 0.18, '#1f1f21', 'matte')
  p.box('wheel-r', x1 - 0.1, x1 - 0.02, 0, 0.16, z0 + 0.02, z0 + 0.18, '#1f1f21', 'matte')
}

/** G4: a mailbox on a post, with its flag (front = +z). */
function mailbox(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  const post = Math.min(0.08, w * 0.3)
  p.box('post', -post / 2, post / 2, 0, h - 0.26, -post / 2, post / 2, '#5b4332', 'wood')
  p.box('box', x0 + 0.03, x1 - 0.03, h - 0.28, h - 0.05, z0, z1, c, 'paintedMetal')
  p.box('top', x0 + 0.05, x1 - 0.05, h - 0.05, h, z0, z1, shade(c, 0.1), 'paintedMetal')
  p.box('flag', x1 - 0.03, x1, h - 0.24, h - 0.1, z0 + 0.04, z0 + 0.1, '#b0352a', 'paintedMetal')
}

/** WG5: a post-top streetlight: base, tapered post, lantern with its glass and cap (decorative, no light). */
function streetlight(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  const post = Math.min(0.12, w * 0.4)
  const lantern = Math.min(0.55, h * 0.14)
  p.box('base', x0 + w * 0.15, x1 - w * 0.15, 0, 0.3, z0 + d * 0.15, z1 - d * 0.15, shade(c, -0.1), 'paintedMetal')
  p.box('post', -post / 2, post / 2, 0.3, h - lantern, -post / 2, post / 2, c, 'paintedMetal')
  p.box('collar', -post, post, h - lantern - 0.08, h - lantern, -post, post, shade(c, -0.1), 'paintedMetal')
  p.box('glass', x0 + w * 0.12, x1 - w * 0.12, h - lantern, h - 0.1, z0 + d * 0.12, z1 - d * 0.12, '#efe6c4', 'matte')
  p.box('cap', x0, x1, h - 0.1, h, z0, z1, shade(c, -0.15), 'paintedMetal')
}


// ---- Prefab library P2–P5: the pieces the new places needed (same box-built style) ----

/** A hospital bed: castors, steel frame, raised head section, mattress, side rails, a drip stand at the head. */
function hospitalBed(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  const wheel = Math.min(0.1, h * 0.14)
  for (const [i, [cx, cz]] of [[x0 + 0.04, z0 + 0.04], [x1 - 0.1, z0 + 0.04], [x0 + 0.04, z1 - 0.1], [x1 - 0.1, z1 - 0.1]].entries()) {
    p.box(`castor-${i}`, cx, cx + 0.06, 0, wheel, cz, cz + 0.06, '#2a2b2e', 'matte')
  }
  const frameTop = h * 0.5
  p.box('frame', x0 + 0.02, x1 - 0.02, wheel, frameTop, z0 + 0.1, z1 - 0.02, STEEL, 'paintedMetal')
  const mattress = h * 0.68
  p.box('mattress', x0 + 0.05, x1 - 0.05, frameTop, mattress, z0 + d * 0.35, z1 - 0.05, c, 'fabric')
  // Head section raised like a backrest.
  p.box('backrest', x0 + 0.05, x1 - 0.05, frameTop, h * 0.86, z0 + 0.12, z0 + d * 0.35, shade(c, -0.08), 'fabric')
  p.box('pillow', x0 + w * 0.2, x1 - w * 0.2, h * 0.86 - 0.02, h * 0.95, z0 + 0.14, z0 + 0.34, PILLOW, 'fabric')
  p.box('headboard', x0, x1, wheel, h * 0.9, z0, z0 + 0.06, shade(STEEL, 0.2), 'paintedMetal')
  p.box('footboard', x0, x1, wheel, h * 0.75, z1 - 0.05, z1, shade(STEEL, 0.2), 'paintedMetal')
  p.box('rail-left', x0, x0 + 0.03, mattress, h * 0.8, z0 + d * 0.3, z0 + d * 0.7, STEEL, 'paintedMetal')
  p.box('rail-right', x1 - 0.03, x1, mattress, h * 0.8, z0 + d * 0.3, z0 + d * 0.7, STEEL, 'paintedMetal')
  p.box('drip-pole', x1 - 0.06, x1 - 0.03, h * 0.9, h, z0 + 0.02, z0 + 0.05, STEEL, 'paintedMetal')
  p.box('drip-bag', x1 - 0.1, x1 - 0.02, h - 0.12, h - 0.02, z0 + 0.05, z0 + 0.09, '#dfe8e6', 'matte')
}

/** An operating table: pedestal, padded top, a head rest and an instrument tray on its arm. */
function operatingTable(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  p.box('base', -w * 0.25, w * 0.25, 0, 0.08, z0 + d * 0.2, z1 - d * 0.2, '#3f4448', 'paintedMetal')
  p.box('pedestal', -0.12, 0.12, 0.08, h - 0.15, -0.12, 0.12, STEEL, 'paintedMetal')
  p.box('frame', x0 + 0.05, x1 - 0.05, h - 0.15, h - 0.1, z0 + 0.1, z1 - 0.1, shade(STEEL, -0.1), 'paintedMetal')
  p.box('pad', x0 + 0.08, x1 - 0.2, h - 0.1, h - 0.02, z0 + 0.12, z1 - 0.12, c, 'fabric')
  p.box('head-rest', x1 - 0.2, x1 - 0.04, h - 0.1, h, -d * 0.18, d * 0.18, shade(c, -0.1), 'fabric')
  p.box('tray-arm', x0 + 0.02, x0 + 0.05, 0.08, h - 0.08, z1 - 0.1, z1 - 0.07, STEEL, 'paintedMetal')
  p.box('tray', x0, x0 + 0.3, h - 0.1, h - 0.07, z1 - 0.12, z1, shade(STEEL, 0.25), 'paintedMetal')
}

/** An industrial machine (a lathe): plinth, bed, head stock with its chuck, carriage, motor, control box. */
function machine(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  const bedTop = h * 0.62
  p.box('plinth', x0, x1, 0, 0.1, z0, z1, PLINTH, 'paintedMetal')
  p.box('cabinet-left', x0 + 0.05, x0 + w * 0.3, 0.1, bedTop - 0.1, z0 + 0.1, z1 - 0.1, c, 'paintedMetal')
  p.box('cabinet-right', x1 - w * 0.25, x1 - 0.05, 0.1, bedTop - 0.1, z0 + 0.1, z1 - 0.1, c, 'paintedMetal')
  p.box('bed', x0 + 0.05, x1 - 0.05, bedTop - 0.1, bedTop, z0 + 0.15, z1 - 0.15, shade(c, -0.25), 'paintedMetal')
  p.box('headstock', x0 + 0.05, x0 + w * 0.32, bedTop, h, z0 + 0.1, z1 - 0.1, c, 'paintedMetal')
  p.box('chuck', x0 + w * 0.32, x0 + w * 0.32 + 0.12, bedTop + 0.1, bedTop + 0.35, -0.13, 0.13, STEEL, 'paintedMetal')
  p.box('carriage', -w * 0.05, w * 0.15, bedTop, bedTop + 0.22, z0 + 0.1, z1 - 0.05, shade(c, 0.1), 'paintedMetal')
  p.box('tailstock', x1 - w * 0.18, x1 - 0.08, bedTop, bedTop + 0.3, -0.15, 0.15, c, 'paintedMetal')
  p.box('control-box', x0 + 0.08, x0 + 0.38, bedTop + 0.1, bedTop + 0.4, z1 - 0.08, z1, '#2e3336', 'paintedMetal')
  p.box('warning-stripe', x0, x1, 0.1, 0.16, z1 - 0.02, z1, '#d9b02f', 'matte')
}

/** A cash machine: cabinet, fascia with the screen, keypad and slot, a small canopy on top. */
function atm(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  p.box('cabinet', x0 + 0.02, x1 - 0.02, 0, h - 0.1, z0, z1 - 0.1, c, 'paintedMetal')
  p.box('fascia', x0 + 0.06, x1 - 0.06, h * 0.45, h - 0.2, z1 - 0.1, z1 - 0.04, shade(c, 0.2), 'paintedMetal')
  p.box('screen', x0 + 0.15, x1 - 0.15, h * 0.62, h * 0.8, z1 - 0.04, z1 - 0.02, '#2d4d5c', 'matte')
  p.box('keypad', -0.12, 0.12, h * 0.5, h * 0.58, z1 - 0.04, z1, '#3c3f42', 'matte')
  p.box('slot', x1 - 0.2, x1 - 0.1, h * 0.5, h * 0.53, z1 - 0.04, z1 - 0.01, '#1f1f21', 'matte')
  p.box('canopy', x0, x1, h - 0.1, h, z0, z1, '#b73a2f', 'paintedMetal')
}

/** A headstone: plinth, stone with a stepped top, a darker panel for the inscription. */
function tombstone(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  const plinth = Math.min(0.12, h * 0.15)
  p.box('plinth', x0, x1, 0, plinth, z0, z1, shade(c, -0.18), 'concrete')
  const t = Math.min(d * 0.7, 0.18)
  const zc = (z0 + z1) / 2
  p.box('stone', x0 + w * 0.08, x1 - w * 0.08, plinth, h * 0.82, zc - t / 2, zc + t / 2, c, 'concrete')
  p.box('shoulder', x0 + w * 0.16, x1 - w * 0.16, h * 0.82, h * 0.93, zc - t / 2, zc + t / 2, c, 'concrete')
  p.box('top', x0 + w * 0.3, x1 - w * 0.3, h * 0.93, h, zc - t / 2, zc + t / 2, c, 'concrete')
  p.box('panel', x0 + w * 0.2, x1 - w * 0.2, h * 0.38, h * 0.72, zc + t / 2, Math.min(z1, zc + t / 2 + 0.01), shade(c, -0.3), 'matte')
}

/** A park bench: iron legs, three seat slats, two back slats (front = +z). */
function bench(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  const seat = h * 0.85 > 0.45 ? 0.45 : h * 0.6
  for (const [i, x] of [x0 + 0.08, x1 - 0.13].entries()) {
    p.box(`leg-front-${i}`, x, x + 0.05, 0, seat, z1 - 0.12, z1 - 0.06, '#2f3336', 'paintedMetal')
    p.box(`leg-back-${i}`, x, x + 0.05, 0, h, z0 + 0.02, z0 + 0.07, '#2f3336', 'paintedMetal')
  }
  slots(z0 + 0.06, z1 - 0.02, 3, 0.02).forEach(([a, b], i) => p.box(`seat-${i}`, x0, x1, seat - 0.04, seat, a, b, c, 'wood'))
  for (const [i, y] of [seat + (h - seat) * 0.3, h - 0.06].entries()) p.box(`back-${i}`, x0, x1, y, Math.min(h, y + 0.06), z0, z0 + 0.04, c, 'wood')
}

/** A playground slide: ladder at the back, platform with rails, the chute stepping down to the front. */
function slide(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  const deck = h * 0.7
  const deckEnd = z0 + d * 0.3
  for (const [i, x] of [x0 + 0.05, x1 - 0.1].entries()) {
    p.box(`post-back-${i}`, x, x + 0.05, 0, h, z0, z0 + 0.05, '#3b6fa8', 'paintedMetal')
    p.box(`post-front-${i}`, x, x + 0.05, 0, h, deckEnd - 0.05, deckEnd, '#3b6fa8', 'paintedMetal')
  }
  for (let k = 1; k <= 4; k++) p.box(`rung-${k}`, x0 + 0.1, x1 - 0.1, (deck * k) / 5 - 0.02, (deck * k) / 5 + 0.02, z0, z0 + 0.04, '#e0c34a', 'paintedMetal')
  p.box('deck', x0 + 0.05, x1 - 0.05, deck - 0.05, deck, z0 + 0.05, deckEnd, '#d9c07a', 'wood')
  p.box('rail', x0 + 0.05, x1 - 0.05, h - 0.05, h, z0, deckEnd, '#3b6fa8', 'paintedMetal')
  const steps = 6
  for (let k = 0; k < steps; k++) {
    const za = deckEnd + ((z1 - deckEnd) * k) / steps
    const zb = deckEnd + ((z1 - deckEnd) * (k + 1)) / steps
    const top = deck * (1 - (k + 0.5) / steps)
    p.box(`chute-${k}`, x0 + w * 0.15, x1 - w * 0.15, Math.max(0, top - 0.08), Math.max(0.06, top), za, zb, c, 'paintedMetal')
  }
}

/** A swing set: two A-frames, the top beam, two seats on their chains (along x). */
function swing(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  for (const [i, x] of [x0, x1 - 0.08].entries()) {
    p.box(`leg-a-${i}`, x, x + 0.08, 0, h - 0.08, z0, z0 + 0.08, c, 'paintedMetal')
    p.box(`leg-b-${i}`, x, x + 0.08, 0, h - 0.08, z1 - 0.08, z1, c, 'paintedMetal')
  }
  p.box('beam', x0, x1, h - 0.08, h, z0, z1, shade(c, -0.15), 'paintedMetal')
  for (const [i, cx] of [-w / 4, w / 4].entries()) {
    p.box(`chain-l-${i}`, cx - 0.22, cx - 0.2, 0.45, h - 0.08, -0.01, 0.01, '#8e9398', 'paintedMetal')
    p.box(`chain-r-${i}`, cx + 0.2, cx + 0.22, 0.45, h - 0.08, -0.01, 0.01, '#8e9398', 'paintedMetal')
    p.box(`seat-${i}`, cx - 0.24, cx + 0.24, 0.4, 0.45, -0.1, 0.1, '#2f2f31', 'matte')
  }
}

/** A sandbox: four wooden sides, sand inside, a forgotten bucket. */
function sandbox(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  const t = Math.min(0.12, w * 0.08)
  p.box('side-back', x0, x1, 0, h, z0, z0 + t, c, 'wood')
  p.box('side-front', x0, x1, 0, h, z1 - t, z1, c, 'wood')
  p.box('side-left', x0, x0 + t, 0, h, z0 + t, z1 - t, c, 'wood')
  p.box('side-right', x1 - t, x1, 0, h, z0 + t, z1 - t, c, 'wood')
  p.box('sand', x0 + t, x1 - t, 0, h * 0.7, z0 + t, z1 - t, '#d9c48f', 'dirt')
  p.box('bucket', x0 + w * 0.3, x0 + w * 0.3 + 0.18, h * 0.7, Math.min(h, h * 0.7 + 0.2), -0.09, 0.09, '#c8412f', 'paintedMetal')
}

/** A basketball hoop: base, pole at the back, the backboard on top, the rim in front of it (front = +z). */
function hoop(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  p.box('base', -w * 0.3, w * 0.3, 0, 0.15, z0, z0 + d * 0.5, '#3f4448', 'paintedMetal')
  p.box('pole', -0.06, 0.06, 0.15, h - 0.5, z0 + 0.05, z0 + 0.17, c, 'paintedMetal')
  p.box('arm', -0.05, 0.05, h - 0.75, h - 0.65, z0 + 0.05, z1 - 0.35, c, 'paintedMetal')
  p.box('board', x0, x1, h - 0.9, h, z1 - 0.37, z1 - 0.33, '#f2f2f0', 'matte')
  p.box('square', -0.2, 0.2, h - 0.7, h - 0.45, z1 - 0.33, z1 - 0.32, '#c8412f', 'matte')
  p.box('rim-front', -0.22, 0.22, h - 0.88, h - 0.85, z1 - 0.04, z1, '#d9582b', 'paintedMetal')
  p.box('rim-left', -0.22, -0.19, h - 0.88, h - 0.85, z1 - 0.32, z1, '#d9582b', 'paintedMetal')
  p.box('rim-right', 0.19, 0.22, h - 0.88, h - 0.85, z1 - 0.32, z1, '#d9582b', 'paintedMetal')
}

/** A flagpole: base, pole at one end of the box, the flag at the top of it (along x). */
function flagpole(p: Parts, c: string): void {
  const { w, h, d } = p.dims
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2
  const post = Math.min(0.1, d * 0.8)
  p.box('base', x0, x0 + Math.min(w, 0.3), 0, 0.2, z0, z1, shade(c, -0.3), 'concrete')
  p.box('pole', x0 + 0.1, x0 + 0.1 + post, 0.2, h - 0.08, -post / 2, post / 2, c, 'paintedMetal')
  p.box('finial', x0 + 0.08, x0 + 0.12 + post, h - 0.08, h, -post / 2, post / 2, '#d9b02f', 'paintedMetal')
  const fx = x0 + 0.1 + post
  const flagH = Math.min(0.6, h * 0.1)
  p.box('flag-top', fx, x1, h - 0.1 - flagH / 2, h - 0.1, -0.01, 0.01, '#c8342b', 'fabric')
  p.box('flag-bottom', fx, x1, h - 0.1 - flagH, h - 0.1 - flagH / 2, -0.01, 0.01, '#c8342b', 'fabric')
  p.box('star', fx + (x1 - fx) * 0.35, fx + (x1 - fx) * 0.55, h - 0.1 - flagH * 0.7, h - 0.1 - flagH * 0.3, 0.01, 0.015, '#e8c547', 'matte')
}

const BUILDERS: Record<FurnitureId, (p: Parts, color: string, variant: string) => void> = {
  'furniture/bed': bed,
  'furniture/sofa': sofa,
  'furniture/table': table,
  'furniture/desk': desk,
  'furniture/chair': chair,
  'furniture/counter': (p, c) => cabinets(p, c, true),
  'furniture/cabinet': (p, c) => cabinets(p, c, false),
  'furniture/fridge': fridge,
  'furniture/wardrobe': wardrobe,
  'furniture/nightstand': nightstand,
  'furniture/bookshelf': bookshelf,
  'furniture/shelving': shelving,
  'furniture/crate': crate,
  'furniture/workbench': workbench,
  'outdoor/car': car,
  'outdoor/fence': fence,
  'outdoor/bin': bin,
  'outdoor/mailbox': mailbox,
  'outdoor/streetlight': streetlight,
  'furniture/hospital-bed': hospitalBed,
  'furniture/operating-table': operatingTable,
  'furniture/machine': machine,
  'furniture/atm': atm,
  'outdoor/tombstone': tombstone,
  'outdoor/bench': bench,
  'outdoor/slide': slide,
  'outdoor/swing': swing,
  'outdoor/sandbox': sandbox,
  'outdoor/hoop': hoop,
  'outdoor/flagpole': flagpole,
}

/** The parts of `asset` sized to `dims`, in the asset frame (`clipped`: parts cut back to the box). */
export function furnitureParts(asset: FurnitureId, dims: Dims, color: string, variant?: string): FurniturePart[] & { clipped?: string[] } {
  const p = new Parts(dims)
  const offered = FURNITURE_VARIANTS[asset] ?? []
  BUILDERS[asset](p, color, variant && offered.includes(variant) ? variant : (offered[0] ?? ''))
  return Object.assign(p.list, p.clipped.length ? { clipped: p.clipped } : {})
}
