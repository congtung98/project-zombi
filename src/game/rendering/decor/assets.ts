import type { SurfaceId } from '../surfaces/catalog'
import { shade } from '../furniture/assets'
import { DECOR, type DecorId } from './catalog'

/**
 * G3b: the parts of every decor asset, in its own frame: centred on its position in x and z, y up
 * from the surface it stands on. `cyl` parts are upright cylinders (the batches' round unit shape).
 * Every part, with its own small turn, stays inside the asset's `size` box (tests hold it), so the
 * editor outline shows all of it. Sizes are fixed (a cup is a cup); `color` tints the main part.
 */

export interface DecorPart {
  name: string
  /** `cyl` upright cylinder, `ball` sphere, `spike` upright cone (G4: planting). */
  shape: 'box' | 'cyl' | 'ball' | 'spike'
  center: [number, number, number]
  size: [number, number, number]
  /** Turn of the part about its centre (radians), on top of the decor's own yaw. */
  yaw?: number
  color: string
  surface: SurfaceId
}

const STEEL = '#8e9398'
const DARK = '#3a3a3c'
const PAPER = '#dcd6c6'
const CARDBOARD_TAPE = '#c9b58a'

type Build = (color: string) => DecorPart[]

const box = (name: string, center: [number, number, number], size: [number, number, number], color: string, surface: SurfaceId, yaw?: number): DecorPart => ({ name, shape: 'box', center, size, color, surface, ...(yaw ? { yaw } : {}) })
/** An upright cylinder standing on `y` (radius r, height h). */
const cyl = (name: string, x: number, y: number, z: number, r: number, h: number, color: string, surface: SurfaceId): DecorPart => ({ name, shape: 'cyl', center: [x, y + h / 2, z], size: [2 * r, h, 2 * r], color, surface })

/** A sphere (bush) centred at (x, y, z) with radii rx, ry, rz. */
const ball = (name: string, x: number, y: number, z: number, rx: number, ry: number, rz: number, color: string): DecorPart => ({ name, shape: 'ball', center: [x, y, z], size: [2 * rx, 2 * ry, 2 * rz], color, surface: 'foliage' })
/** An upright cone (a blade clump) standing on the ground. */
const spike = (name: string, x: number, z: number, r: number, h: number, color: string): DecorPart => ({ name, shape: 'spike', center: [x, h / 2, z], size: [2 * r, h, 2 * r], color, surface: 'foliage' })

const BUILDERS: Record<DecorId, Build> = {
  'decor/cup': (c) => [cyl('cup', 0, 0, 0, 0.04, 0.095, c, 'matte'), box('handle', [0.042, 0.05, 0], [0.006, 0.05, 0.012], c, 'matte')],
  'decor/plate': (c) => [cyl('plate', 0, 0, 0, 0.12, 0.015, c, 'matte'), cyl('food', 0.02, 0.015, -0.01, 0.06, 0.015, '#8a6a3a', 'matte')],
  'decor/pot': (c) => [
    cyl('pot', 0, 0, 0, 0.13, 0.14, c, 'paintedMetal'),
    cyl('lid', 0, 0.14, 0, 0.125, 0.012, shade(c, 0.12), 'paintedMetal'),
    cyl('knob', 0, 0.152, 0, 0.02, 0.018, DARK, 'matte'),
    box('handle-l', [-0.16, 0.11, 0], [0.06, 0.02, 0.05], DARK, 'matte'),
    box('handle-r', [0.16, 0.11, 0], [0.06, 0.02, 0.05], DARK, 'matte'),
  ],
  'decor/cutting-board': (c) => [
    box('board', [0, 0.01, 0], [0.4, 0.02, 0.26], c, 'wood'),
    box('bread', [-0.06, 0.05, 0.01], [0.2, 0.07, 0.1], '#b98a4e', 'fabric', 0.2),
    box('knife', [0.1, 0.024, -0.04], [0.2, 0.008, 0.025], STEEL, 'paintedMetal', -0.3),
  ],
  'decor/food-boxes': (c) => [
    box('cereal', [-0.12, 0.14, 0], [0.16, 0.28, 0.07], c, 'matte'),
    box('crackers', [0.04, 0.09, 0.02], [0.13, 0.18, 0.09], '#c9a441', 'matte', 0.15),
    box('rice', [0.14, 0.06, -0.03], [0.12, 0.12, 0.1], '#e0d6bd', 'fabric', -0.2),
  ],
  'decor/cans': (c) => [cyl('can-0', -0.07, 0, 0, 0.035, 0.11, c, 'paintedMetal'), cyl('can-1', 0.005, 0, 0.005, 0.035, 0.11, '#a0432f', 'paintedMetal'), cyl('can-2', 0.075, 0, -0.01, 0.035, 0.11, c, 'paintedMetal')],
  'decor/bottle': (c) => [cyl('bottle', 0, 0, 0, 0.037, 0.19, c, 'matte'), cyl('neck', 0, 0.19, 0, 0.014, 0.085, c, 'matte')],
  'decor/books': (c) => [
    box('book-0', [0, 0.02, 0], [0.26, 0.04, 0.19], c, 'matte', 0.05),
    box('book-1', [0.01, 0.06, 0.005], [0.24, 0.04, 0.18], '#3f5a6b', 'matte', -0.12),
    box('book-2', [-0.005, 0.1, -0.005], [0.22, 0.035, 0.16], '#8a7a4e', 'matte', 0.2),
  ],
  'decor/papers': (c) => [
    // Each sheet a little higher than the last: overlapping sheets never share a top face.
    box('sheet-0', [-0.25, 0.002, -0.15], [0.21, 0.004, 0.3], c, 'matte', 0.4),
    box('sheet-1', [0.05, 0.0035, -0.05], [0.21, 0.004, 0.3], shade(c, 0.05), 'matte', -0.7),
    box('sheet-2', [0.26, 0.005, 0.18], [0.21, 0.004, 0.3], PAPER, 'matte', 1.1),
    box('sheet-3', [-0.2, 0.0065, 0.2], [0.21, 0.004, 0.3], shade(c, -0.06), 'matte', -0.2),
    box('folder', [0.22, 0.009, -0.2], [0.24, 0.006, 0.32], '#6a7f8e', 'matte', 0.9),
  ],
  'decor/clothes': (c) => [
    box('shirt', [-0.07, 0.02, 0], [0.34, 0.04, 0.28], c, 'fabric', 0.3),
    box('trousers', [0.1, 0.05, 0.03], [0.3, 0.03, 0.18], '#3d4250', 'fabric', -0.4),
    box('towel', [0.02, 0.075, -0.04], [0.22, 0.025, 0.16], '#c9c2b0', 'fabric', 0.1),
  ],
  'decor/rug': (c) => [box('rug', [0, 0.004, 0], [2, 0.008, 1.4], shade(c, -0.1), 'fabric'), box('field', [0, 0.009, 0], [1.76, 0.003, 1.16], c, 'fabric')],
  'decor/carton': (c) => [box('carton', [0, 0.18, 0], [0.46, 0.36, 0.36], c, 'matte'), box('tape', [0, 0.361, 0], [0.46, 0.002, 0.06], CARDBOARD_TAPE, 'matte')],
  'decor/duffel-bag': (c) => [
    box('bag', [0, 0.13, 0], [0.58, 0.26, 0.3], c, 'fabric'),
    box('strap', [0, 0.27, 0], [0.34, 0.03, 0.05], shade(c, -0.3), 'fabric'),
    box('end-l', [-0.3, 0.13, 0], [0.02, 0.2, 0.24], shade(c, -0.15), 'fabric'),
    box('end-r', [0.3, 0.13, 0], [0.02, 0.2, 0.24], shade(c, -0.15), 'fabric'),
  ],
  'decor/backpack': (c) => [
    box('pack', [0, 0.2, -0.02], [0.3, 0.4, 0.16], c, 'fabric'),
    box('pocket', [0, 0.12, 0.08], [0.22, 0.16, 0.05], shade(c, -0.15), 'fabric'),
    box('flap', [0, 0.41, -0.02], [0.28, 0.03, 0.17], shade(c, 0.1), 'fabric'),
  ],
  'decor/jerrycan': (c) => [
    box('can', [0, 0.16, 0], [0.18, 0.32, 0.3], c, 'paintedMetal'),
    box('handle', [0, 0.34, -0.03], [0.05, 0.04, 0.16], shade(c, -0.2), 'paintedMetal'),
    cyl('spout', 0, 0.32, 0.11, 0.022, 0.04, DARK, 'paintedMetal'),
  ],
  'decor/toolbox': (c) => [
    box('box', [0, 0.08, 0], [0.44, 0.16, 0.2], c, 'paintedMetal'),
    box('lid', [0, 0.17, 0], [0.46, 0.02, 0.22], shade(c, -0.15), 'paintedMetal'),
    box('handle', [0, 0.2, 0], [0.2, 0.03, 0.03], DARK, 'paintedMetal'),
  ],
  'decor/tires': (c) => [cyl('tire-0', 0, 0, 0, 0.31, 0.2, c, 'matte'), cyl('tire-1', 0.01, 0.2, 0.005, 0.31, 0.2, c, 'matte'), cyl('rim', 0.01, 0.4, 0.005, 0.17, 0.012, STEEL, 'paintedMetal')],
  'decor/bush': (c) => [
    ball('ball-0', -0.05, 0.36, 0, 0.45, 0.36, 0.43, c),
    ball('ball-1', 0.3, 0.27, 0.17, 0.3, 0.27, 0.3, shade(c, 0.08)),
    ball('ball-2', -0.3, 0.25, -0.2, 0.28, 0.25, 0.28, shade(c, -0.06)),
  ],
  'decor/grass': (c) => [
    spike('blade-0', 0, 0, 0.07, 0.34, c),
    spike('blade-1', 0.12, 0.08, 0.06, 0.26, shade(c, 0.08)),
    spike('blade-2', -0.12, 0.06, 0.06, 0.3, shade(c, -0.05)),
    spike('blade-3', 0.05, -0.13, 0.05, 0.24, shade(c, 0.12)),
    spike('blade-4', -0.1, -0.11, 0.05, 0.28, c),
  ],
  'decor/oil-stain': (c) => [
    cyl('stain-0', 0, 0, 0, 0.36, 0.002, c, 'matte'),
    cyl('stain-1', 0.3, 0, 0.12, 0.22, 0.003, shade(c, 0.06), 'matte'),
    cyl('stain-2', -0.3, 0, -0.14, 0.2, 0.0025, shade(c, 0.1), 'matte'),
  ],
}

/** The parts of a decor asset (`color`: the content's, else the asset's own). */
export function decorParts(asset: DecorId, color?: string): DecorPart[] {
  return BUILDERS[asset](color ?? DECOR[asset].color).map((p) => ({ ...p, center: [...p.center] as [number, number, number], size: [...p.size] as [number, number, number] }))
}

