import { GAME_CONFIG } from '../core/config'
import { getItemDef, type ItemEffect, type ItemId } from '../entities/items'
import type { PlayerState } from '../entities/player'
import { removeFromSlot } from './inventory'

/** `not-usable`: materials/equipment have no direct use (or the item is reserved by an action). */
export type UseItemFailure = 'dead' | 'empty' | 'no-effect' | 'not-usable'

export type UseItemResult =
  | { ok: true; itemId: ItemId; effect: ItemEffect }
  | { ok: false; reason: UseItemFailure; itemId?: ItemId }

/** Vật phẩm có tác dụng khi ít nhất một chỉ số nó hồi đang dưới mức tối đa. */
export function canBenefit(player: PlayerState, effect: ItemEffect, limits = GAME_CONFIG.player): boolean {
  if ((effect.health ?? 0) > 0 && player.health < limits.maxHealth) return true
  if ((effect.hunger ?? 0) > 0 && player.hunger < limits.maxHunger) return true
  if ((effect.thirst ?? 0) > 0 && player.thirst < limits.maxThirst) return true
  if ((effect.stamina ?? 0) > 0 && player.stamina < limits.maxStamina) return true
  return false
}

/** Áp hiệu ứng vật phẩm, kẹp 0..max cho mọi chỉ số. */
export function applyItemEffect(player: PlayerState, effect: ItemEffect, limits = GAME_CONFIG.player): void {
  if (effect.health) player.health = clampStat(player.health + effect.health, limits.maxHealth)
  if (effect.hunger) player.hunger = clampStat(player.hunger + effect.hunger, limits.maxHunger)
  if (effect.thirst) player.thirst = clampStat(player.thirst + effect.thirst, limits.maxThirst)
  if (effect.stamina) player.stamina = clampStat(player.stamina + effect.stamina, limits.maxStamina)
}

/**
 * Dùng một vật phẩm ở ô `slot` của túi người chơi. Chỉ trừ vật phẩm khi dùng
 * thành công (kế hoạch §5.2): ô trống, đã chết hoặc không có tác dụng thì không trừ.
 */
export function consumeInventoryItem(player: PlayerState, slot: number, limits = GAME_CONFIG.player): UseItemResult {
  const stack = player.inventory.slots[slot]
  if (!stack || stack.quantity <= 0) return { ok: false, reason: 'empty' }
  const def = getItemDef(stack.itemId)
  if (!player.alive) return { ok: false, reason: 'dead', itemId: def.id }
  if (def.kind !== 'food' && def.kind !== 'drink' && def.kind !== 'medical') return { ok: false, reason: 'not-usable', itemId: def.id }
  if (!canBenefit(player, def.effect, limits)) return { ok: false, reason: 'no-effect', itemId: def.id }
  applyItemEffect(player, def.effect, limits)
  removeFromSlot(player.inventory, slot, 1)
  return { ok: true, itemId: def.id, effect: def.effect }
}

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
