import type { Equipment, ItemInstance } from '../entities/items'
import type { Inventory } from './inventory'

export function equippedWeapon(inventory: Inventory, equipment: Equipment): Extract<ItemInstance, { kind: 'weapon' }> | null {
  const item = inventory.slots.find((i) => i?.id === equipment.weaponInstanceId)
  return item?.kind === 'weapon' ? item : null
}

export function equipWeapon(inventory: Inventory, equipment: Equipment, id: string | null): boolean {
  if (id !== null && !inventory.slots.some((i) => i?.id === id && i.kind === 'weapon')) return false
  equipment.weaponInstanceId = id
  return true
}

export function reconcileEquipment(inventory: Inventory, equipment: Equipment): void {
  if (!equippedWeapon(inventory, equipment)) equipment.weaponInstanceId = null
}
