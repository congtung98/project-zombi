import type { PlayerVisionConfig, VisionOverlayConfig } from '../core/config'
import type { VisionOccluderSet } from '../world/visionOccluders'
import type { Vec3 } from '../../types'

/**
 * VisionOverlay math: a subtle perception shade, NOT lighting. `rendering/VisionOverlay.tsx` runs
 * the same formula per pixel in one full-screen shader (keep both in sync); this copy is used by
 * tests and the debug readout. Inputs: player position, the (smoothed) character facing, the
 * vision cone/near radius/distance from `playerVision`, the daylight factor (read only) and an
 * optional LOS sector mask. Output: alpha of a black layer, clamped to `maxOpacity`.
 */

export interface OverlayView {
  x: number
  z: number
  /** Character yaw (forward = sin, cos), smoothed; never the camera direction. */
  facing: number
  /** Overlay strength from `overlayStrength` (world light is only read). */
  strength: number
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Day → full strength, night → `nighttimeStrength` (night is already dark). `daylight` ∈ [0, 1]. */
export function overlayStrength(daylight: number, cfg: VisionOverlayConfig): number {
  return cfg.nighttimeStrength + (cfg.daytimeStrength - cfg.nighttimeStrength) * Math.min(1, Math.max(0, daylight))
}

/** Longest distance a sector ray measures (a little past the vision distance). */
export function sectorRange(vision: PlayerVisionConfig): number {
  return vision.visionDistance * 1.25
}

/** Yaw of sector i: centre of the i-th slice of 360°, same convention as `atan(x, z)`. */
export function sectorAngle(i: number, count: number): number {
  return ((i + 0.5) / count) * Math.PI * 2
}

/**
 * LOS sector mask: clear distance around the player per yaw slice, cut at the first vision
 * occluder (horizontal ray between eye and zombie-target height). `count` rays per call, no
 * per-pixel raycast; the shader interpolates between slices.
 */
export function computeSectorDistances(
  position: Vec3,
  occluders: VisionOccluderSet,
  vision: PlayerVisionConfig,
  out: Float32Array,
): Float32Array {
  const range = sectorRange(vision)
  const y = (vision.playerEyeHeight + vision.zombieTargetHeight) / 2
  const from: Vec3 = { x: position.x, y, z: position.z }
  const to: Vec3 = { x: 0, y, z: 0 }
  for (let i = 0; i < out.length; i++) {
    const a = sectorAngle(i, out.length)
    to.x = from.x + Math.sin(a) * range
    to.z = from.z + Math.cos(a) * range
    out[i] = occluders.clearFraction(from, to) * range
  }
  return out
}

/** Linear lookup in the sector mask at a yaw (wraps around like the shader's repeat texture). */
export function sectorDistanceAt(sectors: Float32Array, yaw: number): number {
  const n = sectors.length
  let u = (yaw / (Math.PI * 2)) % 1
  if (u < 0) u += 1
  const f = u * n - 0.5
  const i0 = Math.floor(f)
  const t = f - i0
  const a = sectors[((i0 % n) + n) % n]
  const b = sectors[(((i0 + 1) % n) + n) % n]
  return a + (b - a) * t
}

/** Overlay alpha at a ground point (the shader's formula). */
export function overlayAlphaAt(
  point: { x: number; z: number },
  view: OverlayView,
  vision: PlayerVisionConfig,
  cfg: VisionOverlayConfig,
  sectors?: Float32Array,
): number {
  const ox = point.x - view.x
  const oz = point.z - view.z
  const d = Math.hypot(ox, oz)
  const fx = Math.sin(view.facing)
  const fz = Math.cos(view.facing)
  const dirX = d > 1e-4 ? ox / d : fx
  const dirZ = d > 1e-4 ? oz / d : fz
  const cosHalf = Math.cos(((vision.fieldOfView / 2) * Math.PI) / 180)
  // Soft cone edge and soft end of the vision distance: no hard fan shape.
  const edge = smoothstep(cosHalf - cfg.edgeSoftness, cosHalf + cfg.edgeSoftness, dirX * fx + dirZ * fz)
  const inRange = 1 - smoothstep(vision.visionDistance * 0.85, vision.visionDistance * 1.15, d)
  const seen = edge * inRange
  let alpha = cfg.outsideOpacity + (cfg.insideOpacity - cfg.outsideOpacity) * seen
  if (cfg.losAware && sectors) {
    const clear = sectorDistanceAt(sectors, Math.atan2(dirX, dirZ))
    const blocked = smoothstep(clear, clear + 1.5, d)
    alpha += (cfg.blockedOpacity - alpha) * blocked * seen
  }
  // Nothing inside the near radius (it is not a light, it only removes the shade), then a gentle
  // ramp with distance: ≈ 35 % of the value just outside the near radius, 100 % far away. Not fog.
  const nearFade = smoothstep(vision.nearDetectionRadius * 0.8, vision.nearDetectionRadius * 1.3, d)
  const distShape = cfg.nearDistanceShare + (1 - cfg.nearDistanceShare) * smoothstep(vision.nearDetectionRadius, vision.visionDistance * 1.25, d)
  return Math.min(alpha * nearFade * distShape * view.strength, cfg.maxOpacity)
}

/** Latest overlay values for the F3/F4 debug readout (written by the renderer, display only). */
export const visionOverlayDebug = { facing: 0, daylight: 1, strength: 1, frontAlpha: 0, rearAlpha: 0, frameMs: 0 }
