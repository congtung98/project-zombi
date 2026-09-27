import type { SurfaceDef, SurfacePattern } from './catalog'

/**
 * G1: procedural detail textures (pure, no DOM, no three.js). Every pattern is tileable (lattices
 * and brick/plank/tile layouts repeat exactly over the texture) and deterministic (its own seed), so
 * the same surface looks the same on every run, chunk load and machine.
 *
 * A pattern returns linear RGB multipliers around 1 (`Float32Array`, 3 per pixel, in the texture's own
 * u/v: u to the right, v up the wall). `encodeLayer` scales them under 1, encodes them as sRGB bytes
 * (8-bit precision where the eye needs it) and returns the gain that brings their average back to 1.
 */

export const TEXTURE_SIZE = 256

export interface EncodedLayer {
  /** RGBA bytes, sRGB-encoded, `size × size`, row 0 = v 0. */
  data: Uint8Array
  /** Multiply the decoded (linear) texel by this: average luminance 1. */
  gain: number
}

/** mulberry32: small, fast, deterministic. */
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

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

/**
 * Tileable value noise 0..1 with `pu × pv` lattice cells over the texture (periods divide the size, so
 * the last cell wraps to the first).
 */
export function noise(size: number, pu: number, pv: number, random: () => number): Float32Array {
  const lattice = new Float32Array(pu * pv)
  for (let i = 0; i < lattice.length; i++) lattice[i] = random()
  const out = new Float32Array(size * size)
  const cu = size / pu
  const cv = size / pv
  for (let y = 0; y < size; y++) {
    const fy = y / cv
    const y0 = Math.floor(fy)
    const ty = fade(fy - y0)
    const r0 = (y0 % pv) * pu
    const r1 = ((y0 + 1) % pv) * pu
    for (let x = 0; x < size; x++) {
      const fx = x / cu
      const x0 = Math.floor(fx)
      const tx = fade(fx - x0)
      const c0 = x0 % pu
      const c1 = (x0 + 1) % pu
      const a = lattice[r0 + c0] + (lattice[r0 + c1] - lattice[r0 + c0]) * tx
      const b = lattice[r1 + c0] + (lattice[r1 + c1] - lattice[r1 + c0]) * tx
      out[y * size + x] = a + (b - a) * ty
    }
  }
  return out
}

/** Octaves of square noise (periods), weighted, normalised to 0..1. */
export function fbm(size: number, periods: readonly number[], random: () => number, falloff = 0.55): Float32Array {
  const out = new Float32Array(size * size)
  let total = 0
  let w = 1
  for (const p of periods) {
    const n = noise(size, p, p, random)
    for (let i = 0; i < out.length; i++) out[i] += n[i] * w
    total += w
    w *= falloff
  }
  for (let i = 0; i < out.length; i++) out[i] /= total
  return out
}

type Rgb = Float32Array

function gray(size: number, value: (i: number, x: number, y: number) => number): Rgb {
  const out = new Float32Array(size * size * 3)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const v = value(i, x, y)
      out[i * 3] = v
      out[i * 3 + 1] = v
      out[i * 3 + 2] = v
    }
  }
  return out
}

/** Luminance times a slight per-pixel tint (r, g, b factors around 1). */
function tinted(size: number, value: (i: number, x: number, y: number) => [number, number, number, number]): Rgb {
  const out = new Float32Array(size * size * 3)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const [v, r, g, b] = value(i, x, y)
      out[i * 3] = v * r
      out[i * 3 + 1] = v * g
      out[i * 3 + 2] = v * b
    }
  }
  return out
}

/**
 * Running bond layout (bricks, shingles): `rows` courses over the texture, `cols` units per course,
 * odd courses shifted by half a unit. Returns the unit index, and the distance (px) to its nearest
 * joint horizontally and vertically, plus the position inside the unit (0..1 up the course).
 */
function bond(size: number, rows: number, cols: number, x: number, y: number, shift = 0.5) {
  const rowH = size / rows
  const colW = size / cols
  // Shifted half a course and a quarter unit, so the texture's own edges cross units, not joints.
  const ys = (y + rowH / 2) % size
  const row = Math.floor(ys / rowH)
  const offset = (row % 2 === 1 ? shift + 0.25 : 0.25) * colW
  const xs = (x + offset) % size
  const col = Math.floor(xs / colW)
  const inX = xs - col * colW
  const inY = ys - row * rowH
  return { id: row * cols + col, jointX: Math.min(inX, colW - inX), jointY: Math.min(inY, rowH - inY), up: inY / rowH }
}

function unitValues(count: number, random: () => number): Float32Array {
  const v = new Float32Array(count)
  for (let i = 0; i < count; i++) v[i] = random()
  return v
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const smooth = (e0: number, e1: number, v: number) => {
  const t = clamp01((v - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

/** The multipliers of one pattern (see the catalog for the tile sizes they are drawn for). */
export function generatePattern(pattern: SurfacePattern, seed: number, size = TEXTURE_SIZE): Rgb {
  const random = rng(seed)
  switch (pattern) {
    case 'plain': {
      const n = fbm(size, [4, 8, 16], random)
      return gray(size, (i) => 1 + 0.08 * (n[i] - 0.5))
    }
    case 'plaster': {
      const n = fbm(size, [4, 8, 16, 32], random)
      const speck = noise(size, 128, 128, random)
      return gray(size, (i) => 1 + 0.12 * (n[i] - 0.5) + 0.04 * (speck[i] - 0.5))
    }
    case 'brick': {
      // 1.5 m tile: 6 courses of 0.25 m, 3 bricks of 0.5 m; mortar ≈ 2.5 cm.
      const tone = unitValues(6 * 3, random)
      const n = fbm(size, [8, 16, 32], random)
      const mortar = size * (0.025 / 1.5)
      return tinted(size, (i, x, y) => {
        const b = bond(size, 6, 3, x, y)
        const t = tone[b.id]
        const edge = Math.min(b.jointX, b.jointY)
        if (edge < mortar / 2) return [1.18 + 0.04 * (n[i] - 0.5), 1, 1, 1]
        // Brick face: its own tone, slightly darker next to the joint, a little warmer or cooler.
        const face = 0.84 + 0.22 * t + 0.1 * (n[i] - 0.5) - 0.06 * (1 - smooth(mortar / 2, mortar * 1.5, edge))
        return [face, 1 + 0.05 * (t - 0.5), 1, 1 - 0.05 * (t - 0.5)]
      })
    }
    case 'planks': {
      // 2.4 m tile: 12 boards of 0.2 m across v, two 1.2 m lengths per board, joints staggered.
      const rows = 12
      const offsets = unitValues(rows, random)
      const tone = unitValues(rows * 2, random)
      const streak = noise(size, 4, 64, random)
      const fine = noise(size, 16, 128, random)
      const rowH = size / rows
      return tinted(size, (i, x, y) => {
        const row = Math.floor(y / rowH)
        const inY = y - row * rowH
        const xs = (x + offsets[row] * size) % size
        const piece = Math.floor(xs / (size / 2))
        const inX = xs - piece * (size / 2)
        const seam = Math.min(inY, rowH - inY) < 1 || Math.min(inX, size / 2 - inX) < 1
        const t = tone[row * 2 + piece]
        const v = 0.86 + 0.2 * t + 0.14 * (streak[i] - 0.5) + 0.05 * (fine[i] - 0.5)
        return [seam ? v * 0.72 : v, 1 + 0.03 * (t - 0.5), 1, 1 - 0.04 * (t - 0.5)]
      })
    }
    case 'grain': {
      const streak = noise(size, 2, 32, random)
      const fine = noise(size, 8, 128, random)
      const ring = noise(size, 4, 8, random)
      return gray(size, (i) => 1 + 0.16 * (streak[i] - 0.5) + 0.06 * (fine[i] - 0.5) + 0.08 * Math.sin(ring[i] * 18))
    }
    case 'tiles': {
      // 1.6 m tile: 4 × 4 tiles of 0.4 m, 2 cm grout.
      const tone = unitValues(16, random)
      const n = fbm(size, [8, 16], random)
      const grout = size * (0.02 / 1.6)
      const cell = size / 4
      return gray(size, (i, x, y) => {
        const cx = Math.floor(x / cell)
        const cy = Math.floor(y / cell)
        const edge = Math.min(x - cx * cell, (cx + 1) * cell - x, y - cy * cell, (cy + 1) * cell - y)
        if (edge < grout / 2) return 0.8
        return 1.02 + 0.05 * (tone[cy * 4 + cx] - 0.5) + 0.03 * (n[i] - 0.5)
      })
    }
    case 'concrete': {
      const n = fbm(size, [2, 4, 8, 16, 32], random)
      const stain = noise(size, 4, 4, random)
      const speck = noise(size, 128, 128, random)
      return gray(size, (i) => 1 + 0.12 * (n[i] - 0.5) - 0.08 * smooth(0.55, 0.85, stain[i]) + 0.06 * (speck[i] - 0.5))
    }
    case 'asphalt': {
      const n = fbm(size, [2, 4, 8], random)
      const grit = noise(size, 128, 128, random)
      const grit2 = noise(size, 64, 64, random)
      return gray(size, (i) => 1 + 0.1 * (n[i] - 0.5) + 0.16 * (grit[i] - 0.5) + 0.08 * (grit2[i] - 0.5))
    }
    case 'dirt': {
      const n = fbm(size, [2, 4, 8, 16], random)
      const pebble = noise(size, 64, 64, random)
      return tinted(size, (i) => {
        const p = smooth(0.72, 0.8, pebble[i]) * 0.14
        return [1 + 0.2 * (n[i] - 0.5) + p, 1 + 0.04 * (n[i] - 0.5), 1, 1 - 0.04 * (n[i] - 0.5)]
      })
    }
    case 'shingles': {
      // 2.4 m tile: 8 courses of 0.3 m, 6 shingles of 0.4 m, each course's lower edge in shadow.
      const tone = unitValues(8 * 6, random)
      const n = fbm(size, [8, 16, 32], random)
      return gray(size, (i, x, y) => {
        const b = bond(size, 8, 6, x, y)
        const gap = b.jointX < 0.8 ? 0.7 : 1
        return gap * (0.84 + 0.18 * tone[b.id] + 0.22 * b.up + 0.08 * (n[i] - 0.5))
      })
    }
    case 'grass': {
      // 8 m tile: broad drier and lusher patches, fine blades.
      const patch = fbm(size, [2, 4, 8], random)
      const blades = noise(size, 128, 128, random)
      const mid = noise(size, 32, 32, random)
      return tinted(size, (i) => {
        const dry = smooth(0.45, 0.7, patch[i])
        return [0.92 + 0.14 * (patch[i] - 0.5) + 0.14 * (blades[i] - 0.5) + 0.06 * (mid[i] - 0.5), 1 + 0.12 * dry, 1 + 0.02 * dry, 1 - 0.1 * dry]
      })
    }
    case 'bark': {
      const streak = noise(size, 16, 2, random)
      const fine = noise(size, 64, 16, random)
      return gray(size, (i) => 1 + 0.26 * (streak[i] - 0.5) + 0.12 * (fine[i] - 0.5))
    }
    case 'foliage': {
      const clump = fbm(size, [4, 8, 16], random)
      const leaf = noise(size, 64, 64, random)
      return tinted(size, (i) => {
        const light = smooth(0.4, 0.65, clump[i])
        return [0.8 + 0.34 * light + 0.12 * (leaf[i] - 0.5), 1 + 0.06 * light, 1 + 0.02 * light, 1 - 0.06 * light]
      })
    }
    case 'fabric': {
      const n = fbm(size, [4, 8], random)
      return gray(size, (i, x, y) => 1 + 0.05 * Math.sin((x / size) * Math.PI * 2 * 64) * Math.sin((y / size) * Math.PI * 2 * 64) + 0.08 * (n[i] - 0.5))
    }
    case 'metal': {
      const n = fbm(size, [2, 4, 8], random)
      const scratch = noise(size, 64, 2, random)
      return gray(size, (i) => 1 + 0.06 * (n[i] - 0.5) + 0.05 * smooth(0.8, 0.95, scratch[i]))
    }
    case 'water': {
      // 6 m tile: broad darker and lighter patches, thin bright ripple crests bent by the noise.
      const patch = fbm(size, [2, 4], random)
      const bend = noise(size, 4, 4, random)
      return tinted(size, (i, _x, y) => {
        const crest = smooth(0.82, 0.97, 0.5 + 0.5 * Math.sin((y / size) * Math.PI * 2 * 12 + bend[i] * 9))
        return [0.9 + 0.16 * (patch[i] - 0.5) + 0.12 * crest, 1 - 0.02 * crest, 1, 1 + 0.03 * crest]
      })
    }
  }
}

const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)

/** Scale under 1, encode as sRGB bytes, and the gain restoring an average luminance of 1. */
export function encodeLayer(rgb: Rgb, size = TEXTURE_SIZE): EncodedLayer {
  let peak = 0
  for (let i = 0; i < rgb.length; i++) if (rgb[i] > peak) peak = rgb[i]
  const data = new Uint8Array(size * size * 4)
  let lum = 0
  for (let i = 0; i < size * size; i++) {
    const r = clamp01(rgb[i * 3] / peak)
    const g = clamp01(rgb[i * 3 + 1] / peak)
    const b = clamp01(rgb[i * 3 + 2] / peak)
    lum += 0.2126 * r + 0.7152 * g + 0.0722 * b
    data[i * 4] = Math.round(toSrgb(r) * 255)
    data[i * 4 + 1] = Math.round(toSrgb(g) * 255)
    data[i * 4 + 2] = Math.round(toSrgb(b) * 255)
    data[i * 4 + 3] = 255
  }
  return { data, gain: (size * size) / lum }
}

export function generateSurface(surface: SurfaceDef, size = TEXTURE_SIZE): EncodedLayer {
  return encodeLayer(generatePattern(surface.source.pattern, surface.source.seed, size), size)
}
