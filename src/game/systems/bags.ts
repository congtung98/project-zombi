import { getItemDef, type Equipment, type ItemInstance } from '../entities/items'
import { createInventory, type Inventory } from './inventory'

/**
 * Contents of every bag instance in the world, keyed by the bag's instance ID. The contents follow
 * the instance wherever it lies (player, container, ground): moving the bag moves one instance and
 * nothing else, so a bag and its contents always move as one aggregate.
 */
export type BagStore = Map<string, Inventory>

export function bagInventoryId(instanceId: string): string {
  return `bag:${instanceId}`
}

/** The bag instance a contents inventory belongs to (inverse of `bagInventoryId`). */
export function bagInstanceIdOf(inventoryId: string): string {
  return inventoryId.slice('bag:'.length)
}

export function createBagContents(bag: ItemInstance): Inventory {
  const slots = getItemDef(bag.itemId).bag?.slots ?? 0
  return createInventory(slots, bagInventoryId(bag.id), 'bag')
}

/** Every bag instance in `inv` gets its (empty) contents record if it has none yet. */
export function ensureBagContents(bags: BagStore, inv: Inventory): void {
  for (const item of inv.items) if (item.kind === 'bag' && !bags.has(item.id)) bags.set(item.id, createBagContents(item))
}

/** Weight of one instance: its units, plus a bag's contents (bags never nest, so one level). */
export function itemWeight(item: ItemInstance, bags: BagStore): number {
  const own = getItemDef(item.itemId).weightKg * item.quantity
  if (item.kind !== 'bag') return own
  const contents = bags.get(item.id)
  return own + (contents ? contents.items.reduce((kg, i) => kg + getItemDef(i.itemId).weightKg * i.quantity, 0) : 0)
}

/** Total weight: each instance once, a bag with its contents, never a contents list counted again. */
export function inventoryWeight(inv: Inventory, bags: BagStore): number {
  return inv.items.reduce((kg, i) => kg + itemWeight(i, bags), 0)
}

/** The worn bag's contents, if the worn bag is really in the main inventory. */
export function wornBagContents(main: Inventory, equipment: Equipment, bags: BagStore): Inventory | null {
  const id = equipment.backInstanceId
  if (!id || !main.items.some((i) => i.id === id && i.kind === 'bag')) return null
  return bags.get(id) ?? null
}

/**
 * The only definition of what the player may use directly (eat, drink, use, craft, repair): the main
 * inventory first, then the worn bag. A bag that is not worn (carried, in a container or on the
 * ground) is never included.
 */
export function usableInventories(main: Inventory, equipment: Equipment, bags: BagStore): Inventory[] {
  const worn = wornBagContents(main, equipment, bags)
  return worn ? [main, worn] : [main]
}

/** Locate an instance among the usable inventories. */
export function findUsable(main: Inventory, equipment: Equipment, bags: BagStore, instanceId: string): { inventory: Inventory; item: ItemInstance } | null {
  for (const inventory of usableInventories(main, equipment, bags)) {
    const item = inventory.items.find((i) => i.id === instanceId)
    if (item) return { inventory, item }
  }
  return null
}
