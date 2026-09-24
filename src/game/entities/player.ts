import { GAME_CONFIG } from '../core/config'
import { createInventory, type Inventory } from '../systems/inventory'
import type { Vec3 } from '../../types'
import type { Equipment } from './items'

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
  /** Increments per swing start; wear is paid at most once per attackId. */
  attackId: number
  /** Weapon instance that started the current swing (equipment cannot change mid-swing). */
  attackWeaponId: string | null
  lastWornAttackId: number
  pushCooldown: number
  /** Số zombie đã hạ trong ván. */
  kills: number
  /** Túi đồ 12 ô; tuần tự hóa được để lưu ở Sprint 5. */
  inventory: Inventory
  equipment: Equipment
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
    attackId: 0,
    attackWeaponId: null,
    lastWornAttackId: 0,
    pushCooldown: 0,
    kills: 0,
    inventory: createInventory(GAME_CONFIG.inventory.slots, 'player'),
    equipment: { weaponInstanceId: null },
  }
}
