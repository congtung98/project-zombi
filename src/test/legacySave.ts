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
 * A current save in the v9 shape: slot arrays, no worn bag, no bag contents, no loot patches (bonus
 * items left out) and no dropped bags: since v11 their items are floor items (an emptied bag is gone),
 * compared on their own with `floorItemsOf` / `dropItemsOf`. Used to compare with frozen fixtures and
 * to build older saves from a live snapshot. Empty slots are at the end: a pre-v10 save with holes
 * compares by its instances (`compactSlots`).
 */
export function asV9(save: SaveGame): SaveGame {
  const copy = structuredClone(save) as unknown as Record<string, unknown> & { player: Record<string, unknown>; containers: Record<string, unknown>[] }
  delete copy.bags
  delete copy.lootPatches
  delete copy.floor
  copy.player.inventory = slotsOf(save.player.inventory)
  copy.player.equipment = { weaponInstanceId: save.player.equipment.weaponInstanceId }
  copy.containers = save.containers.map((c) => ({ ...structuredClone(c), items: slotsOf(c.items) }))
  return copy as unknown as SaveGame
}

/** Items on the floor of a v11+ save with their positions, by instance ID. */
export function floorItemsOf(save: SaveGame): { item: ItemInstance; position: { x: number; y: number; z: number } }[] {
  return (save.floor ?? [])
    .flatMap((cell) => cell.items.items.map((item) => ({ item, position: cell.positions.find((p) => p.id === item.id)!.position })))
    .sort((a, b) => (a.item.id < b.item.id ? -1 : 1))
}

/** Items in the dropped bags of a pre-v11 save (either inventory shape) with the bag's position, by instance ID. */
export function dropItemsOf(save: { containers: { position?: { x: number; y: number; z: number }; items: unknown }[] }): { item: ItemInstance; position: { x: number; y: number; z: number } }[] {
  return save.containers
    .filter((c) => c.position)
    .flatMap((c) => {
      const inv = c.items as { slots?: (ItemInstance | null)[]; items?: ItemInstance[] }
      return (inv.items ?? inv.slots!.filter((s): s is ItemInstance => s !== null)).map((item) => ({ item, position: c.position! }))
    })
    .sort((a, b) => (a.item.id < b.item.id ? -1 : 1))
}

/** A pre-v10 slot inventory with its empty slots moved to the end (the order of the items kept). */
export function compactSlots(inv: LegacyInventory): LegacyInventory {
  const items = inv.slots.filter((s) => s !== null)
  return { ...inv, slots: [...items, ...inv.slots.filter((s) => s === null)] }
}
