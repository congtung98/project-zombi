import { GAME_CONFIG } from '../core/config'
import type { Vec3 } from '../../types'

export interface PlayerState {
  health: number
  stamina: number
  hunger: number
  thirst: number
  alive: boolean
  /** Vị trí đồng bộ từ physics body ở mỗi tick. */
  position: Vec3
  /** Góc quay quanh trục Y (radian), dùng cho mesh hiển thị. */
  facing: number
  isRunning: boolean
  /** Thời gian còn phải chờ trước khi hồi stamina. */
  staminaRegenTimer: number
}

export function createPlayerState(spawn: Vec3): PlayerState {
  const cfg = GAME_CONFIG.player
  return {
    health: cfg.maxHealth,
    stamina: cfg.maxStamina,
    hunger: cfg.maxHunger,
    thirst: cfg.maxThirst,
    alive: true,
    position: { ...spawn },
    facing: 0,
    isRunning: false,
    staminaRegenTimer: 0,
  }
}
