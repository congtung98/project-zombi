import { GAME_CONFIG } from '../core/config'
import { getItemDef, type ItemId, type ItemInstance, type MeleeStats, type ToolTag } from '../entities/items'

export type WeaponInstance = Extract<ItemInstance, { kind: 'weapon' }>

/** Broken is derived from condition, never stored separately, so repair clears it automatically. */
export type ConditionLevel = 'ok' | 'low' | 'broken'

export function meleeStats(itemId: ItemId): MeleeStats {
  const stats = getItemDef(itemId).melee
  if (!stats) throw new Error(`${itemId} is not a melee weapon`)
  return stats
}

export function maxCondition(itemId: ItemId): number {
  return getItemDef(itemId).maxCondition ?? 0
}

export function isBroken(weapon: WeaponInstance): boolean {
  return weapon.condition <= 0
}

export function conditionLevel(itemId: ItemId, condition: number, cfg = GAME_CONFIG.weapon): ConditionLevel {
  if (condition <= 0) return 'broken'
  return condition <= maxCondition(itemId) * cfg.lowConditionRatio ? 'low' : 'ok'
}

/** Damage for the condition read when the hit is confirmed: any condition > 0 deals full damage. */
export function weaponHitDamage(itemId: ItemId, condition: number, cfg = GAME_CONFIG.weapon): number {
  const base = meleeStats(itemId).damage
  return condition > 0 ? base : Math.max(1, Math.round(base * cfg.brokenDamageRatio))
}

/** Remembers the last swing that already paid wear, so one attackId can never wear twice. */
export interface WearLedger {
  lastWornAttackId: number
}

export interface WearResult {
  worn: number
  /** Condition went from > 0 to 0 on this swing. */
  broke: boolean
  /** Condition crossed into the low-condition warning band on this swing (not broken). */
  becameLow: boolean
}

/**
 * Apply wear after the swing's damage is resolved. Misses must not call this; a swing that
 * hits several targets calls it once, and a repeated call with the same attackId is a no-op.
 */
export function applyWeaponWear(weapon: WeaponInstance, attackId: number, ledger: WearLedger, amount = GAME_CONFIG.weapon.wearPerHit): WearResult {
  if (ledger.lastWornAttackId === attackId || amount <= 0 || weapon.condition <= 0) return { worn: 0, broke: false, becameLow: false }
  ledger.lastWornAttackId = attackId
  const before = weapon.condition
  weapon.condition = Math.max(0, before - amount)
  const was = conditionLevel(weapon.itemId, before)
  const now = conditionLevel(weapon.itemId, weapon.condition)
  return { worn: before - weapon.condition, broke: now === 'broken', becameLow: was === 'ok' && now === 'low' }
}

/** Tool requirement for later recipes: right capability and condition > 0 (broken tools never qualify). */
export function isUsableTool(item: ItemInstance | null | undefined, tag: ToolTag): boolean {
  if (!item || item.kind !== 'weapon' || item.condition <= 0) return false
  return getItemDef(item.itemId).toolTags?.includes(tag) ?? false
}
