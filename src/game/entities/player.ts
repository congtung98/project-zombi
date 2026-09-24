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

  /** Cooldown còn lại trước khi được đánh tiếp. */
  attackCooldown: number
  /** Thời gian đã trôi của cú vung hiện tại; < 0 khi không vung. */
  attackTimer: number
  /** Cú vung hiện tại chưa tới khung gây sát thương. */
  attackHitPending: boolean
  pushCooldown: number
  /** Số zombie đã hạ trong ván. */
  kills: number
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
    attackCooldown: 0,
    attackTimer: -1,
    attackHitPending: false,
    pushCooldown: 0,
    kills: 0,
  }
}
