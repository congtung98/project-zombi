import type { SurfaceId } from '../surfaces/catalog'
import type { FurnitureId } from './catalog'

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
function bed(p: Parts, c: string): void {
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
  p.box('blanket', x0 + 0.005, x1 - 0.005, mattressTop, blanketTop, fold, z1 - 0.005, c, 'fabric')
  p.box('blanket-foot', x0 + 0.005, x1 - 0.005, baseTop, mattressTop, z1 - 0.03, z1 - 0.005, c, 'fabric')
  p.box('blanket-left', x0 + 0.005, x0 + 0.03, baseTop, mattressTop, fold, z1 - 0.03, c, 'fabric')
  p.box('blanket-right', x1 - 0.03, x1 - 0.005, baseTop, mattressTop, fold, z1 - 0.03, c, 'fabric')
  const pillows = w >= 1.25 ? 2 : 1
  const pd = Math.min(0.34, (fold - z0 - head) * 0.8)
  const top = Math.min(h, mattressTop + Math.max(0.05, h * 0.13))
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
function bookshelf(p: Parts, c: string): void {
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

/** Four posts, boards, goods on every level but the top. */
function shelving(p: Parts, c: string): void {
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
    for (const [j, [start, width, tall, kind]] of RACK_GOODS[k % RACK_GOODS.length].entries()) {
      const a = x0 + post + start * (w - 2 * post)
      const b = a + width * (w - 2 * post)
      const top = y + board + tall * clear
      if (kind === 'box') p.box(`goods-${k}-${j}`, a, b, y + board, top, z0 + 0.05, z1 - 0.08, CARDBOARD, 'matte')
      else p.box(`goods-${k}-${j}`, a, b, y + board, top, -0.08, 0.08, '#6c7d8a', 'paintedMetal')
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

const BUILDERS: Record<FurnitureId, (p: Parts, color: string) => void> = {
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
}

/** The parts of `asset` sized to `dims`, in the asset frame (`clipped`: parts cut back to the box). */
export function furnitureParts(asset: FurnitureId, dims: Dims, color: string): FurniturePart[] & { clipped?: string[] } {
  const p = new Parts(dims)
  BUILDERS[asset](p, color)
  return Object.assign(p.list, p.clipped.length ? { clipped: p.clipped } : {})
}
