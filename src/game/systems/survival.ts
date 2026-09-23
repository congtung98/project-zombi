import { GAME_CONFIG } from '../core/config'
import type { PlayerState } from '../entities/player'

export function clampStat(value: number, max: number): number {
  return Math.min(max, Math.max(0, value))
}

/**
 * Cập nhật hunger/thirst theo thời gian game; khi về 0 thì trừ health.
 * Trả về lượng máu mất trong tick để hệ thống combat/sự kiện xử lý.
 */
export function tickSurvival(
  player: PlayerState,
  dt: number,
  cfg = GAME_CONFIG.survival,
  limits = GAME_CONFIG.player,
): number {
  if (!player.alive) return 0
  player.hunger = clampStat(player.hunger - cfg.hungerPerSec * dt, limits.maxHunger)
  player.thirst = clampStat(player.thirst - cfg.thirstPerSec * dt, limits.maxThirst)

  let damage = 0
  if (player.hunger <= 0) damage += cfg.starvationDamagePerSec * dt
  if (player.thirst <= 0) damage += cfg.starvationDamagePerSec * dt
  return damage
}

/** Gây sát thương cho người chơi; trả về true nếu vừa chết trong lần gọi này. */
export function damagePlayer(player: PlayerState, amount: number, limits = GAME_CONFIG.player): boolean {
  if (!player.alive || amount <= 0) return false
  player.health = clampStat(player.health - amount, limits.maxHealth)
  if (player.health <= 0) {
    player.alive = false
    player.isRunning = false
    return true
  }
  return false
}
