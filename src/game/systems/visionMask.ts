import type { PlayerVisionConfig } from '../core/config'
import type { VisionOccluderSet } from '../world/visionOccluders'
import type { Vec3 } from '../../types'
import type { VisionObserver } from './playerVision'

/**
 * VisionMask geometry: the ground area the player can see, as a fan of rays around the character
 * (the vision cone out to `visionDistance`, the near radius behind), each cut at the first vision
 * occluder. The renderer lights this area normally and darkens the rest; it is visual only.
 */

/** Number of outline points for a config (fixed, so the render buffer is allocated once). */
export function visibilityPointCount(cfg: PlayerVisionConfig): number {
  return cfg.mask.coneRays + 1 + backRayCount(cfg) + 1
}

function backRayCount(cfg: PlayerVisionConfig): number {
  return Math.max(1, Math.ceil((360 - cfg.fieldOfView) / cfg.mask.backStepDeg))
}

/**
 * Writes the outline (x, z pairs, counter-clockwise in yaw) into `out` and returns it. Rays run
 * horizontally between eye and target height, so lintels above doorways and low fences/crates
 * (not occluders) do not cut the area; walls, closed doors and tall furniture do.
 */
export function computeVisibilityOutline(
  observer: VisionObserver,
  cfg: PlayerVisionConfig,
  occluders: VisionOccluderSet,
  out: Float32Array = new Float32Array(visibilityPointCount(cfg) * 2),
): Float32Array {
  const half = ((cfg.fieldOfView / 2) * Math.PI) / 180
  const f = observer.facing
  const from: Vec3 = { x: observer.position.x, y: (cfg.playerEyeHeight + cfg.zombieTargetHeight) / 2, z: observer.position.z }
  const to: Vec3 = { x: 0, y: from.y, z: 0 }
  let k = 0
  const ray = (angle: number, length: number) => {
    const dx = Math.sin(angle) * length
    const dz = Math.cos(angle) * length
    to.x = from.x + dx
    to.z = from.z + dz
    const t = occluders.clearFraction(from, to)
    out[k++] = from.x + dx * t
    out[k++] = from.z + dz * t
  }
  const cone = cfg.mask.coneRays
  for (let i = 0; i <= cone; i++) ray(f - half + (2 * half * i) / cone, cfg.visionDistance)
  // Behind the character: the near radius only (same angle at the cone edge = radial step).
  const back = backRayCount(cfg)
  const arc = 2 * Math.PI - 2 * half
  for (let i = 0; i <= back; i++) ray(f + half + (arc * i) / back, cfg.nearDetectionRadius)
  return out
}
