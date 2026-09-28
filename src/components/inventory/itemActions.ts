import { getItemDef, type Equipment, type ItemInstance } from '../../game/entities/items'
import { accepts, type Inventory } from '../../game/systems/inventory'
import { isCarried, isEquipped, itemRefusal, type InventoryKey } from '../../game/systems/inventoryCommands'
import { ACTION_LABEL, REFUSAL_LABEL } from './labels'

export type ActionId = 'equip' | 'unequip' | 'wear' | 'takeOff' | 'eat' | 'drink' | 'use' | 'repair' | 'transfer' | 'quantity' | 'drop' | 'favorite' | 'unfavorite' | 'inspect'

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
  /** Why using a consumable does nothing now (e.g. stats full), or null. */
  useBlock: (item: ItemInstance) => string | null
  /** Why a weapon cannot be repaired now, or null; undefined when it has no repair recipe. */
  repairBlock: (item: ItemInstance) => string | null | undefined
}

const USE_ACTION = { food: 'eat', drink: 'drink', medical: 'use' } as const

function transferLabel(source: InventoryKey, dest: Destination): string {
  if (!isCarried(source) && isCarried(dest.key)) return ACTION_LABEL.take(dest.name)
  if (isCarried(source) && !isCarried(dest.key)) return ACTION_LABEL.store(dest.name)
  return ACTION_LABEL.moveTo(dest.name)
}

/** Why this one item cannot go to `dest`, before capacity (capacity is only known when it moves). */
function transferBlock(ctx: MenuContext, item: ItemInstance, dest: Destination): string | null {
  const refusal = itemRefusal(item, ctx.equipment, isCarried(ctx.source) && !isCarried(dest.key), ctx.isReserved(item))
  if (refusal) return REFUSAL_LABEL[refusal]
  if (!accepts(dest.inventory, item.itemId)) return REFUSAL_LABEL['bag-in-bag']
  return null
}

/**
 * Context menu entries resolved from the items' capabilities and where they are: equip/wear only
 * from the main inventory, use only what the player carries (main or worn bag), transfer to every
 * other reachable inventory, drop and favorite for carried items, inspect for one item. A disabled
 * entry always says why. Several items: transfer, drop and favorite apply to all that qualify (a
 * batch skips the rest and reports them).
 */
export function menuEntries(ctx: MenuContext): MenuEntry[] {
  const entries: MenuEntry[] = []
  const one = ctx.items.length === 1 ? ctx.items[0] : null
  const carried = isCarried(ctx.source)
  if (one) {
    const def = getItemDef(one.itemId)
    const equipped = isEquipped(one, ctx.equipment)
    if (one.kind === 'weapon') {
      entries.push(equipped
        ? { key: 'unequip', action: 'unequip', label: ACTION_LABEL.unequip, disabled: null }
        : { key: 'equip', action: 'equip', label: ACTION_LABEL.equip, disabled: ctx.source === 'main' ? null : REFUSAL_LABEL['not-main'] })
    }
    if (one.kind === 'bag') {
      entries.push(equipped
        ? { key: 'takeOff', action: 'takeOff', label: ACTION_LABEL.takeOff, disabled: ctx.isReserved(one) ? REFUSAL_LABEL.reserved : null }
        : { key: 'wear', action: 'wear', label: ACTION_LABEL.wear, disabled: ctx.source === 'main' ? null : REFUSAL_LABEL['not-main'] })
    }
    if (def.kind === 'food' || def.kind === 'drink' || def.kind === 'medical') {
      const action = USE_ACTION[def.kind]
      const disabled = !carried ? REFUSAL_LABEL['not-carried'] : ctx.isReserved(one) ? REFUSAL_LABEL.reserved : ctx.useBlock(one)
      entries.push({ key: action, action, label: ACTION_LABEL[action], disabled })
    }
    const repair = ctx.repairBlock(one)
    if (one.kind === 'weapon' && repair !== undefined) {
      entries.push({ key: 'repair', action: 'repair', label: ACTION_LABEL.repair, disabled: ctx.source !== 'main' ? REFUSAL_LABEL['not-main'] : repair })
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
