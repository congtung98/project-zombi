import { GAME_CONFIG } from '../core/config'
import type { Vec3 } from '../../types'
import type { Rng } from './loot'

export interface SpawnCandidateContext {
  playerPos: Vec3
  /** Vị trí zombie còn sống (để không spawn chồng). */
  aliveZombies: readonly Vec3[]
  /** true nếu điểm bị tường/cửa đóng che khỏi người chơi; ưu tiên các điểm này. Mặc định: không biết. */
  isHiddenFromPlayer?: (point: Vec3) => boolean
}

/**
 * Chọn điểm spawn hợp lệ trong danh sách điểm đặt tay: đủ xa người chơi, không
 * chồng zombie sống, ưu tiên điểm bị che khuất. Trả về null nếu không có điểm nào.
 * Thuần: mọi ngẫu nhiên lấy từ `rng` để tái lập được sau load.
 */
export function pickSpawnPoint(
  candidates: readonly Vec3[],
  ctx: SpawnCandidateContext,
  rng: Rng,
  cfg = GAME_CONFIG.spawn,
): Vec3 | null {
  const valid: Vec3[] = []
  for (const p of candidates) {
    if (dist2(p, ctx.playerPos) < cfg.minDistance * cfg.minDistance) continue
    let overlaps = false
    for (const z of ctx.aliveZombies) {
      if (dist2(p, z) < cfg.minZombieGap * cfg.minZombieGap) {
        overlaps = true
        break
      }
    }
    if (overlaps) continue
    valid.push(p)
  }
  if (valid.length === 0) return null

  if (ctx.isHiddenFromPlayer) {
    const hidden = valid.filter((p) => ctx.isHiddenFromPlayer!(p))
    if (hidden.length > 0) return hidden[Math.floor(rng() * hidden.length)]
  }
  return valid[Math.floor(rng() * valid.length)]
}

/** Khoảng cách giữa hai lần spawn theo ngày/đêm. */
export function spawnInterval(isNight: boolean, cfg = GAME_CONFIG.spawn): number {
  return isNight ? cfg.intervalNight : cfg.intervalDay
}

function dist2(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return dx * dx + dz * dz
}
