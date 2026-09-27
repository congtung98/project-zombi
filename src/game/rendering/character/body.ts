import type { BufferGeometry } from 'three'
import type { BodyPreset, HairStyle, OutfitId } from '../../entities/appearance'
import { MeshBuilder, type Ring } from './loft'

/**
 * C1 (character plan): the one body shared by the player and every zombie. Model space: 1 unit = 1 m,
 * feet at y = 0, +Z forward, the character's right side is −X. The rig is a chain of bones
 * (pelvis → spine → head; shoulder → elbow per arm; hip → knee → ankle per leg); the mesh is built
 * once per shape (preset, hair, outfit) in the rest pose and shared; colours come from the palette
 * slots below (per-character material).
 */
export const BONES = ['hips', 'torso', 'head', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'hipL', 'kneeL', 'ankleL', 'hipR', 'kneeR', 'ankleR'] as const
export type BoneName = (typeof BONES)[number]
export const BONE_PARENT: Record<BoneName, BoneName | null> = {
  hips: null, torso: 'hips', head: 'torso',
  shoulderL: 'torso', elbowL: 'shoulderL', shoulderR: 'torso', elbowR: 'shoulderR',
  hipL: 'hips', kneeL: 'hipL', ankleL: 'kneeL', hipR: 'hips', kneeR: 'hipR', ankleR: 'kneeR',
}
const B = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>

/** Palette slots (index into the material's colour array). `eyes` glows (zombies hunting). */
export const SLOT = { skin: 0, top: 1, trim: 2, bottom: 3, shoes: 4, hair: 5, eyes: 6, belt: 7, sole: 8, stain: 9 } as const
export const SLOT_COUNT = 10

/** Joint positions and body widths of one preset (m). Same heights for every preset. */
export interface BodyFrame {
  /** Pelvis bone height; the spine bone sits `spine` above it. */
  hipY: number
  spine: number
  /** Neck (head bone) above the spine bone. */
  neck: number
  shoulderX: number
  /** Shoulder joints above the spine bone. */
  shoulderY: number
  upperArm: number
  foreArm: number
  /** Leg joints: hip x, hip below the pelvis, thigh and shin lengths (ankle at `ankleY`). */
  legX: number
  legDrop: number
  thigh: number
  shin: number
  /** Width/depth scale of the torso and limbs against the balanced preset. */
  bulk: number
  depth: number
}

export const BODY_HEIGHT = 1.8
/** Hand grip centre below the elbow (weapon socket). */
export const GRIP = 0.285

export const BODY_FRAMES: Record<BodyPreset, BodyFrame> = {
  balanced: { hipY: 0.93, spine: 0.07, neck: 0.5, shoulderX: 0.2, shoulderY: 0.42, upperArm: 0.29, foreArm: 0.25, legX: 0.092, legDrop: 0.03, thigh: 0.42, shin: 0.4, bulk: 1, depth: 1 },
  sturdy: { hipY: 0.93, spine: 0.07, neck: 0.5, shoulderX: 0.215, shoulderY: 0.42, upperArm: 0.29, foreArm: 0.25, legX: 0.1, legDrop: 0.03, thigh: 0.42, shin: 0.4, bulk: 1.1, depth: 1.14 },
  slim: { hipY: 0.93, spine: 0.07, neck: 0.5, shoulderX: 0.184, shoulderY: 0.42, upperArm: 0.29, foreArm: 0.25, legX: 0.085, legDrop: 0.03, thigh: 0.42, shin: 0.4, bulk: 0.9, depth: 0.9 },
}

export type Vec3 = [number, number, number]

/** Rest position of every bone relative to its parent. */
export function boneOffsets(f: BodyFrame): Record<BoneName, Vec3> {
  return {
    hips: [0, f.hipY, 0],
    torso: [0, f.spine, 0],
    head: [0, f.neck, 0],
    shoulderL: [f.shoulderX, f.shoulderY, 0],
    elbowL: [0, -f.upperArm, 0],
    shoulderR: [-f.shoulderX, f.shoulderY, 0],
    elbowR: [0, -f.upperArm, 0],
    hipL: [f.legX, -f.legDrop, 0],
    kneeL: [0, -f.thigh, 0],
    ankleL: [0, -f.shin, 0],
    hipR: [-f.legX, -f.legDrop, 0],
    kneeR: [0, -f.thigh, 0],
    ankleR: [0, -f.shin, 0],
  }
}

/** Rest position of every bone in model space. */
export function boneRest(f: BodyFrame): Record<BoneName, Vec3> {
  const local = boneOffsets(f)
  const out = {} as Record<BoneName, Vec3>
  for (const b of BONES) {
    const p = BONE_PARENT[b]
    const base = p ? out[p] : [0, 0, 0]
    out[b] = [base[0] + local[b][0], base[1] + local[b][1], base[2] + local[b][2]]
  }
  return out
}

export type { OutfitId }

export interface BodyShape {
  preset: BodyPreset
  hair: HairStyle
  outfit: OutfitId
}

/** Helper: a loft on a bone, rings relative to that bone's rest position. */
class Body {
  readonly m = new MeshBuilder()
  readonly rest: Record<BoneName, Vec3>
  readonly f: BodyFrame
  constructor(f: BodyFrame) {
    this.f = f
    this.rest = boneRest(f)
  }
  loft(bone: BoneName, slot: number, rings: Ring[], opts: { smooth?: boolean; c?: number; caps?: [boolean, boolean]; axis?: 'y' | 'z' } = {}): void {
    this.m.loft({ axis: opts.axis ?? 'y', rings, bone: B[bone], slot, origin: this.rest[bone], c: opts.c, smooth: opts.smooth, caps: opts.caps })
  }
  box(bone: BoneName, slot: number, centre: Vec3, size: Vec3): void {
    this.m.box(B[bone], slot, this.rest[bone], centre, size)
  }
  /** Both sides: `fn` receives the side sign (+1 = left, +X) and the side's bone names. */
  sides(fn: (s: 1 | -1, n: { shoulder: BoneName; elbow: BoneName; hip: BoneName; knee: BoneName; ankle: BoneName }) => void): void {
    fn(1, { shoulder: 'shoulderL', elbow: 'elbowL', hip: 'hipL', knee: 'kneeL', ankle: 'ankleL' })
    fn(-1, { shoulder: 'shoulderR', elbow: 'elbowR', hip: 'hipR', knee: 'kneeR', ankle: 'ankleR' })
  }
}

// ---------------------------------------------------------------------------------------------
// Body parts. Rings: `at` along the bone (y up), w × d, `o` = z offset (forward +), `x` = x offset.

function head(b: Body): void {
  // Neck from inside the collar to under the jaw; its base follows the spine.
  b.loft('head', SLOT.skin, [
    { at: -0.05, w: 0.1, d: 0.1, blend: [B.torso, 1] },
    { at: 0.0, w: 0.098, d: 0.098, blend: [B.torso, 0.4] },
    { at: 0.07, w: 0.092, d: 0.094, o: -0.005 },
  ], { smooth: true, c: 0.4 })
  // Head: narrow chin forward, jaw, cheeks, brow, crown; bevelled so it reads round at 28 px/m.
  b.loft('head', SLOT.skin, [
    { at: 0.045, w: 0.075, d: 0.06, o: 0.058, c: 0.45 },
    { at: 0.068, w: 0.135, d: 0.155, o: 0.024 },
    { at: 0.12, w: 0.162, d: 0.2, o: 0.006 },
    { at: 0.185, w: 0.172, d: 0.212, o: 0 },
    { at: 0.25, w: 0.152, d: 0.186, o: -0.008, c: 0.42 },
    { at: 0.288, w: 0.07, d: 0.085, o: -0.01, c: 0.5 },
  ], { smooth: true, c: 0.35 })
  // Nose, eyes, brows: the few face details that still read at gameplay zoom (facing).
  b.loft('head', SLOT.skin, [
    { at: 0.125, w: 0.032, d: 0.03, o: 0.108 },
    { at: 0.165, w: 0.026, d: 0.018, o: 0.105 },
  ], { c: 0.2 })
  for (const s of [1, -1]) {
    b.box('head', SLOT.eyes, [s * 0.038, 0.172, 0.1], [0.03, 0.018, 0.02])
    b.box('head', SLOT.hair, [s * 0.04, 0.194, 0.1], [0.042, 0.01, 0.022])
  }
}

function hair(b: Body, style: HairStyle): void {
  if (style === 'mohawk') {
    b.loft('head', SLOT.hair, [
      { at: 0.085, w: 0.03, d: 0.03, o: 0.285 },
      { at: 0.04, w: 0.042, d: 0.07, o: 0.305 },
      { at: -0.04, w: 0.044, d: 0.075, o: 0.3 },
      { at: -0.105, w: 0.036, d: 0.06, o: 0.255 },
      { at: -0.125, w: 0.02, d: 0.03, o: 0.21 },
    ], { axis: 'z', c: 0.3 })
    return
  }
  // Cap over the crown, forehead left bare, down the back to the nape (short) or the shoulders (long).
  const rings: Ring[] = [
    { at: 0.302, w: 0.08, d: 0.092, o: -0.012 },
    { at: 0.278, w: 0.168, d: 0.198, o: -0.012 },
    { at: 0.236, w: 0.19, d: 0.23, o: -0.008 },
    { at: 0.2, w: 0.192, d: 0.17, o: -0.036 },
    { at: 0.15, w: 0.184, d: 0.105, o: -0.07 },
  ]
  if (style === 'long') {
    rings.push({ at: 0.06, w: 0.19, d: 0.085, o: -0.09 }, { at: -0.05, w: 0.17, d: 0.06, o: -0.11 }, { at: -0.09, w: 0.13, d: 0.04, o: -0.115 })
  } else {
    rings.push({ at: 0.108, w: 0.16, d: 0.075, o: -0.085 })
  }
  b.loft('head', SLOT.hair, rings, { smooth: true, c: 0.35 })
}

interface TorsoFit {
  /** Added to every width and depth (m): jackets sit over the body. */
  grow?: number
  /** Lowest ring along the spine: −0.12 untucked, −0.2 jacket, −0.015 tucked into the waistband. */
  hem?: number
  /** Waist width (balanced preset); a jacket hangs straighter. */
  waist?: number
}

/** Rings of the top from the hem to the collar; widths scale with the preset. */
function torsoRings(b: Body, fit: TorsoFit = {}): Ring[] {
  const k = b.f.bulk
  const q = b.f.depth
  const g = fit.grow ?? 0
  const hem = fit.hem ?? -0.12
  const rings: Ring[] = [{ at: hem, w: 0.345 * k + g, d: 0.218 * q + g, blend: [B.hips, hem < -0.15 ? 0.7 : hem > -0.08 ? 0.35 : 0.55] }]
  if (hem < -0.04) rings.push({ at: -0.02, w: (fit.waist ?? 0.338) * k + g, d: 0.214 * q + g, blend: [B.hips, 0.2] })
  rings.push(
    { at: 0.12, w: 0.338 * k + g, d: 0.216 * q + g, o: 0.004 },
    { at: 0.27, w: 0.38 * k + g, d: 0.23 * q + g, o: 0.008 },
    { at: 0.36, w: 0.405 * k + g, d: 0.215 * q + g, o: 0 },
    { at: 0.425, w: 0.4 * k + g, d: 0.19 * q + g, o: -0.006, c: 0.48 },
    { at: 0.465, w: 0.26 * k + g, d: 0.155 * q + g, o: -0.01, c: 0.45 },
    { at: 0.495, w: 0.15 + g, d: 0.13 + g, o: -0.008, c: 0.45 },
  )
  return rings
}

function torso(b: Body, slot: number, fit: TorsoFit = {}): Ring[] {
  const rings = torsoRings(b, fit)
  b.loft('torso', slot, rings, { smooth: true, c: 0.32 })
  return rings
}

/**
 * A flat band lying on the front (or back) of a loft between two heights: jacket opening, shirt
 * placket, overall bib and straps. Follows the loft's surface ring by ring, `lift` metres above it.
 */
function strip(b: Body, bone: BoneName, slot: number, under: readonly Ring[], o: { from: number; to: number; w: number; x?: number; back?: boolean; lift?: number }): void {
  const lift = o.lift ?? 0.004
  const pts: Ring[] = under.filter((r) => r.at > o.from + 1e-6 && r.at < o.to - 1e-6).map((r) => ({ ...r }))
  // Interpolated end rings so the band starts and stops exactly at `from` and `to`.
  for (const edge of [o.from, o.to]) {
    const hi = under.findIndex((r) => r.at >= edge - 1e-9)
    const a = under[Math.max(0, hi - 1)]
    const c = under[Math.max(0, hi)]
    const t = c.at === a.at ? 0 : (edge - a.at) / (c.at - a.at)
    const mix = (u: number, v: number) => u + (v - u) * t
    pts.push({ at: edge, w: mix(a.w, c.w), d: mix(a.d, c.d), o: mix(a.o ?? 0, c.o ?? 0), blend: t < 0.5 ? a.blend : c.blend })
  }
  pts.sort((u, v) => u.at - v.at)
  const side = o.back ? -1 : 1
  b.loft(bone, slot, pts.map((r) => ({
    at: r.at,
    w: o.w,
    d: 0.01,
    x: o.x ?? 0,
    o: (r.o ?? 0) + side * (r.d / 2 + lift - 0.005),
    blend: r.blend,
  })), { c: 0 })
}

interface PelvisFit {
  /** Waistband over a tucked top: taller and wider at the top. */
  tucked?: boolean
  /** Width scale of the trousers (baggy work trousers > 1). */
  fit?: number
}

function pelvis(b: Body, slot: number, fit: PelvisFit = {}): void {
  const k = b.f.bulk * (fit.fit ?? 1)
  const q = b.f.depth * (fit.fit ?? 1)
  const top: Ring[] = fit.tucked
    ? [{ at: 0.15, w: 0.366 * k, d: 0.238 * q }, { at: 0.06, w: 0.362 * k, d: 0.234 * q }]
    : [{ at: 0.13, w: 0.29 * k, d: 0.185 * q }]
  b.loft('hips', slot, [
    ...top,
    { at: 0.02, w: 0.325 * k, d: 0.204 * q },
    { at: -0.07, w: 0.322 * k, d: 0.2 * q },
    { at: -0.13, w: 0.2 * k, d: 0.16 * q, c: 0.45 },
  ].sort((u, v) => v.at - u.at), { smooth: true, c: 0.32 })
}

/** Belt over a tucked waistband, with a buckle. */
function belt(b: Body, fit = 1): void {
  const k = b.f.bulk * fit
  const q = b.f.depth * fit
  b.loft('hips', SLOT.belt, [
    { at: 0.1, w: 0.374 * k, d: 0.246 * q },
    { at: 0.135, w: 0.373 * k, d: 0.245 * q },
  ], { c: 0.32, caps: [false, false] })
  b.box('hips', SLOT.stain, [0, 0.117, 0.123 * q + 0.004], [0.045, 0.032, 0.01])
}

function legs(b: Body, slot: number, fit = 1): void {
  const k = b.f.bulk * fit
  const hem = fit > 1 ? 1.08 : 1
  b.sides((_, n) => {
    b.loft(n.hip, slot, [
      { at: 0.05, w: 0.15 * k, d: 0.16 * k },
      { at: -0.08, w: 0.16 * k, d: 0.17 * k },
      { at: -0.28, w: 0.135 * k, d: 0.14 * k },
      { at: -b.f.thigh, w: 0.112 * k, d: 0.118 * k, blend: [B[n.knee], 0.5] },
    ], { smooth: true, c: 0.35 })
    b.loft(n.knee, slot, [
      { at: 0, w: 0.112 * k, d: 0.118 * k, blend: [B[n.hip], 0.5] },
      { at: -0.11, w: 0.112 * k, d: 0.124 * k, o: -0.006 },
      { at: -0.3, w: 0.09 * k, d: 0.092 * k },
      { at: -b.f.shin + 0.015, w: 0.086 * k * hem, d: 0.088 * k * hem },
    ], { smooth: true, c: 0.35, caps: [false, true] })
  })
}

function shoes(b: Body, style: 'low' | 'boots'): void {
  const big = style === 'boots' ? 1.08 : 1
  b.sides((_, n) => {
    // Upper: heel, instep over the ankle, toe box; then a slightly wider flat sole.
    b.loft(n.ankle, SLOT.shoes, [
      { at: -0.07, w: 0.08 * big, d: 0.07, o: -0.035 },
      { at: -0.03, w: 0.094 * big, d: 0.1, o: -0.022 },
      { at: 0.04, w: 0.1 * big, d: 0.088 * big, o: -0.03 },
      { at: 0.12, w: 0.098 * big, d: 0.06 * big, o: -0.044 },
      { at: 0.17, w: 0.07 * big, d: 0.034 * big, o: -0.056 },
    ], { axis: 'z', smooth: true, c: 0.3 })
    b.loft(n.ankle, SLOT.sole, [
      { at: -0.078, w: 0.078 * big, d: 0.022 * big, o: -0.069 },
      { at: 0.0, w: 0.098 * big, d: 0.022 * big, o: -0.069 },
      { at: 0.13, w: 0.104 * big, d: 0.022 * big, o: -0.069 },
      { at: 0.182, w: 0.066 * big, d: 0.02 * big, o: -0.07 },
    ], { axis: 'z', c: 0.3 })
    if (style === 'boots') {
      // Shaft up the shin; the trousers tuck into it.
      b.loft(n.ankle, SLOT.shoes, [
        { at: -0.03, w: 0.108, d: 0.118, o: -0.006 },
        { at: 0.06, w: 0.106, d: 0.114, o: -0.004 },
        { at: 0.115, w: 0.108, d: 0.116, o: -0.004 },
      ], { smooth: true, c: 0.38, caps: [false, true] })
    }
  })
}

type Sleeve = 'short' | 'long' | 'rolled'

function arms(b: Body, sleeve: Sleeve, topSlot: number, o: { grow?: number; cuff?: number } = {}): void {
  const k = b.f.bulk
  const g = o.grow ?? 0
  b.sides((s, n) => {
    // Upper arm: rounded top inside the shoulder, tapering to the elbow (blended with the forearm).
    b.loft(n.shoulder, SLOT.skin, [
      { at: 0.03, w: 0.08 * k, d: 0.085 * k, c: 0.5 },
      { at: -0.01, w: 0.116 * k, d: 0.12 * k },
      { at: -0.14, w: 0.102 * k, d: 0.108 * k },
      { at: -b.f.upperArm, w: 0.082 * k, d: 0.086 * k, blend: [B[n.elbow], 0.5] },
    ], { smooth: true, c: 0.38 })
    b.loft(n.elbow, SLOT.skin, [
      { at: 0.0, w: 0.082 * k, d: 0.086 * k, blend: [B[n.shoulder], 0.5] },
      { at: -0.07, w: 0.088 * k, d: 0.094 * k },
      { at: -0.225, w: 0.062 * k, d: 0.06 * k },
    ], { smooth: true, c: 0.38, caps: [false, true] })
    // Fist: palm toward the body, thumb forward.
    b.loft(n.elbow, SLOT.skin, [
      { at: -0.225, w: 0.05, d: 0.066, x: -s * 0.004 },
      { at: -0.265, w: 0.06, d: 0.088, x: -s * 0.006, o: 0.006 },
      { at: -0.315, w: 0.054, d: 0.08, x: -s * 0.006, o: 0.008 },
      { at: -0.335, w: 0.036, d: 0.05, x: -s * 0.004, o: 0.006 },
    ], { smooth: true, c: 0.4 })
    if (sleeve === 'short') {
      b.loft(n.shoulder, topSlot, [
        { at: 0.035, w: 0.09 * k, d: 0.1 * k, c: 0.5 },
        { at: 0.0, w: 0.128 * k, d: 0.134 * k },
        { at: -0.13, w: 0.124 * k, d: 0.13 * k },
      ], { smooth: true, c: 0.4 })
      return
    }
    b.loft(n.shoulder, topSlot, [
      { at: 0.035, w: 0.09 * k + g, d: 0.1 * k + g, c: 0.5 },
      { at: 0.0, w: 0.128 * k + g, d: 0.134 * k + g },
      { at: -0.15, w: 0.12 * k + g, d: 0.126 * k + g },
      { at: -b.f.upperArm, w: 0.096 * k + g, d: 0.1 * k + g, blend: [B[n.elbow], 0.5] },
    ], { smooth: true, c: 0.36, caps: [true, false] })
    if (sleeve === 'rolled') {
      // Pushed up the forearm with a thick roll.
      b.loft(n.elbow, topSlot, [
        { at: 0.0, w: 0.096 * k, d: 0.1 * k, blend: [B[n.shoulder], 0.5] },
        { at: -0.05, w: 0.1 * k, d: 0.105 * k },
      ], { smooth: true, c: 0.36, caps: [false, false] })
      b.loft(n.elbow, o.cuff ?? topSlot, [
        { at: -0.045, w: 0.108 * k, d: 0.114 * k },
        { at: -0.1, w: 0.104 * k, d: 0.11 * k },
      ], { c: 0.4 })
      return
    }
    b.loft(n.elbow, topSlot, [
      { at: 0.0, w: 0.096 * k + g, d: 0.1 * k + g, blend: [B[n.shoulder], 0.5] },
      { at: -0.1, w: 0.098 * k + g, d: 0.104 * k + g },
      { at: -0.2, w: 0.084 * k + g, d: 0.086 * k + g },
    ], { smooth: true, c: 0.36, caps: [false, true] })
    if (o.cuff !== undefined) {
      b.loft(n.elbow, o.cuff, [
        { at: -0.2, w: 0.09 * k + g, d: 0.092 * k + g },
        { at: -0.226, w: 0.088 * k + g, d: 0.09 * k + g },
      ], { c: 0.4 })
    }
  })
}

/** T-shirt over trousers and trainers: crew neck, short sleeves, untucked hem. */
function outfitTee(b: Body): void {
  torso(b, SLOT.top)
  b.loft('torso', SLOT.trim, [
    { at: 0.465, w: 0.2, d: 0.165, o: -0.006 },
    { at: 0.5, w: 0.152, d: 0.132, o: -0.008 },
  ], { c: 0.45, caps: [false, false] })
  // Hem band, a touch wider than the shirt: keeps the edge crisp.
  const k = b.f.bulk
  const q = b.f.depth
  b.loft('torso', SLOT.top, [
    { at: -0.125, w: 0.352 * k, d: 0.224 * q, blend: [B.hips, 0.55] },
    { at: -0.085, w: 0.35 * k, d: 0.222 * q, blend: [B.hips, 0.4] },
  ], { c: 0.32, caps: [false, false] })
  pelvis(b, SLOT.bottom)
  legs(b, SLOT.bottom)
  arms(b, 'short', SLOT.top)
  shoes(b, 'low')
}

/** Open jacket over a light T-shirt, jeans: longer, straighter and thicker, a fold-down collar. */
function outfitJacket(b: Body): void {
  const rings = torso(b, SLOT.top, { grow: 0.03, hem: -0.2, waist: 0.36 })
  // Open front: the T-shirt shows between the zip edges.
  strip(b, 'torso', SLOT.trim, rings, { from: -0.19, to: 0.44, w: 0.085, lift: 0.002 })
  for (const x of [0.047, -0.047]) strip(b, 'torso', SLOT.belt, rings, { from: -0.2, to: 0.44, w: 0.012, x, lift: 0.004 })
  b.loft('torso', SLOT.top, [
    { at: 0.44, w: 0.27, d: 0.215, o: -0.01 },
    { at: 0.478, w: 0.26, d: 0.205, o: -0.012 },
    { at: 0.525, w: 0.2, d: 0.168, o: -0.014 },
  ], { c: 0.45, caps: [false, false] })
  pelvis(b, SLOT.bottom)
  legs(b, SLOT.bottom)
  arms(b, 'long', SLOT.top, { grow: 0.018 })
  shoes(b, 'low')
}

/** Button shirt tucked into office trousers with a belt: collar points, placket, cuffs. */
function outfitShirt(b: Body): void {
  const rings = torso(b, SLOT.top, { hem: -0.015 })
  strip(b, 'torso', SLOT.trim, rings, { from: -0.015, to: 0.45, w: 0.026, lift: 0.002 })
  b.loft('torso', SLOT.top, [
    { at: 0.46, w: 0.19, d: 0.16, o: -0.006 },
    { at: 0.515, w: 0.162, d: 0.14, o: -0.01 },
  ], { c: 0.45, caps: [false, false] })
  for (const s of [1, -1]) b.box('torso', SLOT.top, [s * 0.036, 0.468, 0.078], [0.052, 0.03, 0.02])
  pelvis(b, SLOT.bottom, { tucked: true, fit: 0.97 })
  belt(b, 0.97)
  legs(b, SLOT.bottom, 0.95)
  arms(b, 'long', SLOT.top, { cuff: SLOT.trim })
  shoes(b, 'low')
}

/** Work clothes: shirt with rolled sleeves under bib overalls with straps and buckles, boots. */
function outfitWork(b: Body): void {
  const rings = torso(b, SLOT.top, { hem: -0.015 })
  pelvis(b, SLOT.bottom, { tucked: true, fit: 1.05 })
  strip(b, 'torso', SLOT.bottom, rings, { from: -0.015, to: 0.3, w: 0.25, lift: 0.006 })
  for (const x of [0.085, -0.085]) {
    strip(b, 'torso', SLOT.bottom, rings, { from: 0.28, to: 0.47, w: 0.042, x, lift: 0.006 })
    strip(b, 'torso', SLOT.bottom, rings, { from: -0.015, to: 0.47, w: 0.042, x, back: true, lift: 0.006 })
    b.box('torso', SLOT.belt, [x, 0.29, 0.125 * b.f.depth + 0.012], [0.03, 0.028, 0.01])
  }
  legs(b, SLOT.bottom, 1.08)
  arms(b, 'rolled', SLOT.top, { cuff: SLOT.trim })
  shoes(b, 'boots')
}

const OUTFIT_BUILDERS: Record<OutfitId, (b: Body) => void> = { tee: outfitTee, jacket: outfitJacket, shirt: outfitShirt, work: outfitWork }

const cache = new Map<string, BufferGeometry>()

/**
 * Shared geometry of one body shape (never disposed: a handful of shapes, reused by every character
 * and every session).
 */
export function bodyGeometry(shape: BodyShape): BufferGeometry {
  const key = `${shape.preset}/${shape.hair}/${shape.outfit}`
  let g = cache.get(key)
  if (!g) {
    const b = new Body(BODY_FRAMES[shape.preset])
    head(b)
    hair(b, shape.hair)
    OUTFIT_BUILDERS[shape.outfit](b)
    g = b.m.build()
    g.name = `character:${key}`
    cache.set(key, g)
  }
  return g
}

/** Number of shapes built so far (lifecycle checks). */
export function bodyGeometryCount(): number {
  return cache.size
}
