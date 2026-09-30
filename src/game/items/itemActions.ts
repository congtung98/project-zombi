import { getItemDef, type Equipment, type ItemDefinition, type ItemEffect, type ItemInstance } from '../entities/items'
import { isCarried, isEquipped, type InventoryKey } from '../systems/inventoryCommands'

/**
 * AX2 (FB §6, docs/character-action-ax0.md §2.6): what an item offers is the sum of what its
 * components offer. Each provider looks at one component (a weapon or a bag to equip, a consumable,
 * a sealed item, a repairable weapon) and returns options with the reason when one cannot be used
 * now. Menus render the list; running an option is a request to the Action System. A new item needs
 * data, a new kind of use needs one provider: no menu or character code changes.
 */
export type ItemOptionId = 'equip' | 'unequip' | 'wear' | 'takeOff' | 'eat' | 'drink' | 'heal' | 'open' | 'repair'

/** Why an option is disabled (the UI names it); `repair` comes with its own text in `detail`. */
export type ItemOptionBlock = 'not-main' | 'reserved' | 'no-effect' | 'full' | 'repair'

export interface ItemOption {
  id: ItemOptionId
  blocked: ItemOptionBlock | null
  /** A sealed item is opened first (the option runs both). */
  opensFirst?: boolean
  /** Text of a `repair` block (the recipe's own reason). */
  detail?: string
}

export interface ItemActionQuery {
  item: ItemInstance
  source: InventoryKey
  equipment: Equipment
  /** The running action holds it. */
  reserved: boolean
  /** Whether an effect would do anything now (some stat it restores is below its max). */
  benefits: (effect: ItemEffect) => boolean
  /** From a container or the floor: one unit fits in the main inventory (it is taken first). */
  canTake: boolean
  /** Why this weapon cannot be repaired now (null = it can); undefined when it has no repair recipe. */
  repair?: (item: ItemInstance) => string | null | undefined
}

export interface ItemActionProvider {
  id: string
  options(q: ItemActionQuery, def: ItemDefinition): ItemOption[]
}

const PROVIDERS: ItemActionProvider[] = []

export function registerItemActions(provider: ItemActionProvider): void {
  if (PROVIDERS.some((p) => p.id === provider.id)) throw new Error(`Item action provider registered twice: ${provider.id}`)
  PROVIDERS.push(provider)
}

/** Every option the item offers where it is, in provider order. */
export function itemOptions(q: ItemActionQuery): ItemOption[] {
  if (q.item.kind === 'unknown') return []
  const def = getItemDef(q.item.itemId)
  return PROVIDERS.flatMap((p) => p.options(q, def))
}

const USE_OPTION = { EAT: 'eat', DRINK: 'drink', HEAL: 'heal' } as const

/** Reserved, then no room to take it from where it lies. */
function placeBlock(q: ItemActionQuery): ItemOptionBlock | null {
  if (q.reserved) return 'reserved'
  if (!isCarried(q.source) && !q.canTake) return 'full'
  return null
}

registerItemActions({
  id: 'equippable',
  options(q) {
    const { item } = q
    const equipped = isEquipped(item, q.equipment)
    if (item.kind === 'weapon') return [equipped ? { id: 'unequip', blocked: null } : { id: 'equip', blocked: q.source === 'main' ? null : 'not-main' }]
    if (item.kind === 'bag') return [equipped ? { id: 'takeOff', blocked: q.reserved ? 'reserved' : null } : { id: 'wear', blocked: q.source === 'main' ? null : 'not-main' }]
    return []
  },
})

registerItemActions({
  id: 'consumable',
  options(q, def) {
    if (!def.consumable) return []
    return [{ id: USE_OPTION[def.consumable.action], blocked: placeBlock(q) ?? (q.benefits(def.effect) ? null : 'no-effect') }]
  },
})

registerItemActions({
  id: 'sealed',
  options(q, def) {
    if (!def.sealed) return []
    const inside = getItemDef(def.sealed.opensTo)
    const options: ItemOption[] = [{ id: 'open', blocked: placeBlock(q) }]
    if (inside.consumable) {
      options.push({ id: USE_OPTION[inside.consumable.action], opensFirst: true, blocked: placeBlock(q) ?? (q.benefits(inside.effect) ? null : 'no-effect') })
    }
    return options
  },
})

registerItemActions({
  id: 'repairable',
  options(q) {
    if (q.item.kind !== 'weapon') return []
    const text = q.repair?.(q.item)
    if (text === undefined) return []
    if (q.source !== 'main') return [{ id: 'repair', blocked: 'not-main' }]
    return [{ id: 'repair', blocked: text === null ? null : 'repair', detail: text ?? undefined }]
  },
})
