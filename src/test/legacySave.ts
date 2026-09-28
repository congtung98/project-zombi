import type { ItemInstance } from '../game/entities/items'
import { slotView, type Inventory } from '../game/systems/inventory'
import type { LegacyInventory, SaveGame } from '../types/save'

/** Instances added by a bonus loot rule (INV-LOOT `lootPatches`), tested on their own in inventoryV10.test.ts. */
export const isBonusItem = (i: ItemInstance) => i.id.endsWith(':backpack-v1')

/** A v10 inventory as a pre-v10 slot array: the same instances in order, then empty slots up to the capacity. */
export function slotsOf(inv: Inventory): LegacyInventory {
  return { id: inv.id, nextItemId: inv.nextItemId, slots: slotView({ ...inv, items: inv.items.filter((i) => !isBonusItem(i)) }) }
}

/**
 * A v10 save in the v9 shape: slot arrays, no worn bag, no bag contents, no loot patches (bonus items
 * left out). Used to compare with frozen fixtures and to build older saves from a live snapshot.
 * Empty slots are at the end: a pre-v10 save with holes compares by its instances (`compactSlots`).
 */
export function asV9(save: SaveGame): SaveGame {
  const copy = structuredClone(save) as unknown as Record<string, unknown> & { player: Record<string, unknown>; containers: Record<string, unknown>[] }
  delete copy.bags
  delete copy.lootPatches
  copy.player.inventory = slotsOf(save.player.inventory)
  copy.player.equipment = { weaponInstanceId: save.player.equipment.weaponInstanceId }
  copy.containers = save.containers.map((c) => ({ ...structuredClone(c), items: slotsOf(c.items) }))
  return copy as unknown as SaveGame
}

/** A pre-v10 slot inventory with its empty slots moved to the end (the order of the items kept). */
export function compactSlots(inv: LegacyInventory): LegacyInventory {
  const items = inv.slots.filter((s) => s !== null)
  return { ...inv, slots: [...items, ...inv.slots.filter((s) => s === null)] }
}
