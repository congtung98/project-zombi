import type { Equipment, ItemEffect, ItemInstance } from '../../game/entities/items'
import { accepts, type Inventory } from '../../game/systems/inventory'
import { isCarried, itemRefusal, type InventoryKey } from '../../game/systems/inventoryCommands'
import { itemOptions, type ItemOptionId } from '../../game/items/itemActions'
import { ACTION_LABEL, L, REFUSAL_LABEL } from './labels'

/** Item options come from the item action registry (AX2); the rest are what every carried item allows. */
export type ActionId = ItemOptionId | 'transfer' | 'quantity' | 'drop' | 'favorite' | 'unfavorite' | 'inspect'

export interface MenuEntry {
  key: string
  action: ActionId
  label: string
  /** Readable reason when the action cannot run now; null = enabled. */
  disabled: string | null
  /** Transfer target. */
  destination?: InventoryKey
}

export interface Destination {
  key: InventoryKey
  name: string
  inventory: Inventory
}

export interface MenuContext {
  source: InventoryKey
  /** The concrete instances the menu acts on (a group already resolved), at least one. */
  items: readonly ItemInstance[]
  equipment: Equipment
  /** Other inventories the player can reach now (never the source). */
  destinations: readonly Destination[]
  isReserved: (item: ItemInstance) => boolean
  /** Whether an effect would do anything now (some stat it restores is below its max). */
  benefits: (effect: ItemEffect) => boolean
  /** From a container or the floor: one unit fits in the main inventory (using it takes it first). */
  canTake: (item: ItemInstance) => boolean
  /** Why a weapon cannot be repaired now, or null; undefined when it has no repair recipe. */
  repairBlock: (item: ItemInstance) => string | null | undefined
}

function transferLabel(source: InventoryKey, dest: Destination): string {
  if (!isCarried(source) && isCarried(dest.key)) return ACTION_LABEL.take(dest.name)
  if (isCarried(source) && !isCarried(dest.key)) return ACTION_LABEL.store(dest.name)
  return ACTION_LABEL.moveTo(dest.name)
}

/** Why this one item cannot go to `dest`, before capacity (capacity is only known when it moves). */
function transferBlock(ctx: MenuContext, item: ItemInstance, dest: Destination): string | null {
  const refusal = itemRefusal(item, ctx.equipment, isCarried(ctx.source) && !isCarried(dest.key), ctx.isReserved(item))
  if (refusal) return REFUSAL_LABEL[refusal]
  if (!accepts(dest.inventory, item.itemId)) return item.kind === 'unknown' ? L.unknownNotInBag : REFUSAL_LABEL['bag-in-bag']
  return null
}

/**
 * Context menu entries: for one item, the options its components offer (the item action registry:
 * equip/wear from the main inventory, eat/drink/apply, open, repair; using one from a container or
 * the floor takes it first); then transfer to every other reachable inventory, drop and favorite for
 * carried items, inspect for one item. A disabled entry always says why. Several items: transfer,
 * drop and favorite apply to all that qualify (a batch skips the rest and reports them).
 */
export function menuEntries(ctx: MenuContext): MenuEntry[] {
  const entries: MenuEntry[] = []
  const one = ctx.items.length === 1 ? ctx.items[0] : null
  const carried = isCarried(ctx.source)
  if (one) {
    const options = itemOptions({
      item: one, source: ctx.source, equipment: ctx.equipment, reserved: ctx.isReserved(one),
      benefits: ctx.benefits, canTake: ctx.canTake(one), repair: ctx.repairBlock,
    })
    for (const o of options) {
      const label = o.opensFirst ? ACTION_LABEL.openAnd(ACTION_LABEL[o.id as 'eat' | 'drink' | 'heal']) : ACTION_LABEL[o.id]
      entries.push({ key: o.id, action: o.id, label, disabled: o.blocked ? (o.detail ?? REFUSAL_LABEL[o.blocked as Exclude<typeof o.blocked, 'repair'>]) : null })
    }
  }
  for (const dest of ctx.destinations) {
    const blocks = ctx.items.map((i) => transferBlock(ctx, i, dest))
    const movable = blocks.filter((b) => b === null).length
    const suffix = ctx.items.length > 1 ? ` (${movable}/${ctx.items.length})` : ''
    entries.push({ key: `transfer:${dest.key}`, action: 'transfer', destination: dest.key, label: transferLabel(ctx.source, dest) + suffix, disabled: movable > 0 ? null : blocks[0] })
  }
  // Part of one stack: the quantity dialog (the destination is chosen there).
  if (one && one.kind === 'stack' && one.quantity > 1 && ctx.destinations.length > 0) {
    const first = ctx.destinations.find((d) => transferBlock(ctx, one, d) === null)
    entries.push({ key: 'quantity', action: 'quantity', label: ACTION_LABEL.quantity, destination: (first ?? ctx.destinations[0]).key, disabled: first ? null : transferBlock(ctx, one, ctx.destinations[0]) })
  }
  if (carried) {
    const blocks = ctx.items.map((i) => {
      const refusal = itemRefusal(i, ctx.equipment, true, ctx.isReserved(i))
      return refusal ? REFUSAL_LABEL[refusal] : null
    })
    const movable = blocks.filter((b) => b === null).length
    entries.push({ key: 'drop', action: 'drop', label: ACTION_LABEL.drop + (ctx.items.length > 1 ? ` (${movable}/${ctx.items.length})` : ''), disabled: movable > 0 ? null : blocks[0] })
    const allFavorite = ctx.items.every((i) => i.favorite)
    entries.push(allFavorite
      ? { key: 'unfavorite', action: 'unfavorite', label: ACTION_LABEL.unfavorite, disabled: null }
      : { key: 'favorite', action: 'favorite', label: ACTION_LABEL.favorite, disabled: null })
  }
  if (one) entries.push({ key: 'inspect', action: 'inspect', label: ACTION_LABEL.inspect, disabled: null })
  return entries
}
