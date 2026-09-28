import { ITEMS, type Equipment, type ItemId, type ItemInstance, type SavedItemPayload, type UnknownItemInstance } from '../entities/items'
import type { Inventory } from './inventory'
import type { SaveGame } from '../../types/save'

/**
 * INV-LOOT S5 unknown item recovery (spec §11.3.7, T19). A save may hold an item this version has no
 * definition for (removed from the registry, a newer or hand-edited save). Instead of refusing the
 * whole save, such an item loads as an `unknown` instance that keeps the stored payload untouched;
 * saving writes that payload back (under the item's current ID and favorite flag), so nothing is
 * lost and a version that knows the item gets it back as it was.
 */

/** Stored item IDs this version knows (the stand-in itself is never a stored ID). */
export function isKnownItemId(itemId: unknown): itemId is ItemId {
  return typeof itemId === 'string' && itemId !== 'unknown_item' && Object.hasOwn(ITEMS, itemId)
}

/** The item ID a recovered item was saved with (for its name and the report). */
export function recoveredItemId(item: UnknownItemInstance): string {
  return typeof item.raw.itemId === 'string' ? item.raw.itemId : '?'
}

/** Units the stored payload held (shown with the name; the instance itself is one whole thing). */
export function recoveredQuantity(item: UnknownItemInstance): number {
  const q = item.raw.quantity
  return typeof q === 'number' && Number.isSafeInteger(q) && q > 0 ? q : 1
}

function recoverItem(stored: ItemInstance): ItemInstance {
  const raw = stored as unknown as SavedItemPayload
  if (isKnownItemId(raw.itemId)) return stored
  return { id: String(raw.id), itemId: 'unknown_item', kind: 'unknown', quantity: 1, ...(raw.favorite === true ? { favorite: true as const } : {}), raw }
}

/** The stored form of an item: a recovered one goes back to its payload, under its current ID and flag. */
export function savedItem(item: ItemInstance): ItemInstance {
  if (item.kind !== 'unknown') return item
  const { favorite: _drop, ...rest } = item.raw as Record<string, unknown>
  return { ...rest, id: item.id, ...(item.favorite ? { favorite: true } : {}) } as unknown as ItemInstance
}

function mapInventory(inv: Inventory, fn: (item: ItemInstance) => ItemInstance): Inventory {
  let changed = false
  const items = inv.items.map((i) => {
    const out = fn(i)
    if (out !== i) changed = true
    return out
  })
  return changed ? { ...inv, items } : inv
}

/** What the recovery did to a loaded save. */
export interface RecoveryReport {
  /** Stored item IDs kept as unknown items, one entry per item. */
  itemIds: string[]
  /** The equipped weapon / worn bag was an unknown item and was taken off (it stays in the inventory). */
  unequipped: ('weapon' | 'back')[]
}

/**
 * A validated save with every unknown item turned into a recovery instance (player, containers,
 * floor, bag contents) and any equipment reference to one cleared. The input is not changed.
 */
export function recoverSave(save: SaveGame): { save: SaveGame; report: RecoveryReport } {
  const itemIds: string[] = []
  const fn = (item: ItemInstance): ItemInstance => {
    const out = recoverItem(item)
    if (out !== item) itemIds.push(String((item as unknown as SavedItemPayload).itemId))
    return out
  }
  const inventory = mapInventory(save.player.inventory, fn)
  const containers = save.containers.map((c) => {
    const items = mapInventory(c.items, fn)
    return items === c.items ? c : { ...c, items }
  })
  const floor = save.floor.map((cell) => {
    const items = mapInventory(cell.items, fn)
    return items === cell.items ? cell : { ...cell, items }
  })
  const bags = save.bags.map((b) => mapInventory(b, fn))
  const unequipped: RecoveryReport['unequipped'] = []
  const equipment: Equipment = { ...save.player.equipment }
  const isUnknown = (id: string | null) => id !== null && inventory.items.some((i) => i.id === id && i.kind === 'unknown')
  if (isUnknown(equipment.weaponInstanceId)) {
    equipment.weaponInstanceId = null
    unequipped.push('weapon')
  }
  if (isUnknown(equipment.backInstanceId)) {
    equipment.backInstanceId = null
    unequipped.push('back')
  }
  if (itemIds.length === 0) return { save, report: { itemIds, unequipped } }
  return {
    save: { ...save, player: { ...save.player, inventory, equipment }, containers, floor, bags },
    report: { itemIds, unequipped },
  }
}

/** Every inventory of a snapshot in its stored form (recovered items back to their payload). */
export function toStoredForm(save: SaveGame): SaveGame {
  const any = (inv: Inventory) => inv.items.some((i) => i.kind === 'unknown')
  if (!any(save.player.inventory) && !save.containers.some((c) => any(c.items)) && !save.floor.some((c) => any(c.items)) && !save.bags.some(any)) return save
  return {
    ...save,
    player: { ...save.player, inventory: mapInventory(save.player.inventory, savedItem) },
    containers: save.containers.map((c) => ({ ...c, items: mapInventory(c.items, savedItem) })),
    floor: save.floor.map((cell) => ({ ...cell, items: mapInventory(cell.items, savedItem) })),
    bags: save.bags.map((b) => mapInventory(b, savedItem)),
  }
}
