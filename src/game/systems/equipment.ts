import type { Equipment, ItemInstance } from '../entities/items'
import type { Inventory } from './inventory'

export function createEquipment(): Equipment {
  return { weaponInstanceId: null, backInstanceId: null }
}

export function equippedWeapon(inventory: Inventory, equipment: Equipment): Extract<ItemInstance, { kind: 'weapon' }> | null {
  const item = inventory.items.find((i) => i.id === equipment.weaponInstanceId)
  return item?.kind === 'weapon' ? item : null
}

export function equipWeapon(inventory: Inventory, equipment: Equipment, id: string | null): boolean {
  if (id !== null && !inventory.items.some((i) => i.id === id && i.kind === 'weapon')) return false
  equipment.weaponInstanceId = id
  return true
}

export function wornBag(inventory: Inventory, equipment: Equipment): Extract<ItemInstance, { kind: 'bag' }> | null {
  const item = inventory.items.find((i) => i.id === equipment.backInstanceId)
  return item?.kind === 'bag' ? item : null
}

/** Wear (or take off, `null`) a bag from the main inventory; the bag keeps its slot there. */
export function wearBag(inventory: Inventory, equipment: Equipment, id: string | null): boolean {
  if (id !== null && !inventory.items.some((i) => i.id === id && i.kind === 'bag')) return false
  equipment.backInstanceId = id
  return true
}

/** Drop references to instances that left the main inventory (never a copy of an item). */
export function reconcileEquipment(inventory: Inventory, equipment: Equipment): void {
  if (!equippedWeapon(inventory, equipment)) equipment.weaponInstanceId = null
  if (!wornBag(inventory, equipment)) equipment.backInstanceId = null
}
