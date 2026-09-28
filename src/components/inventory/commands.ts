import { runtime } from '../../game/core/runtime'
import type { InventoryKey } from '../../game/systems/inventoryCommands'
import type { MenuEntry } from './itemActions'

/**
 * UI → runtime commands. The UI sends keys and instance IDs only; the runtime re-reads its own state
 * and applies its rules (INV-LOOT §8.3). Transfers are queued as timed steps (S4); the summary toast
 * comes once per job from the `inventory:transferred` event, refusals at queueing time too.
 */
export function transfer(source: InventoryKey, destination: InventoryKey, instanceIds: readonly string[]): void {
  if (instanceIds.length === 0) return
  runtime.queueTransfer(source, destination, instanceIds.map((instanceId) => ({ instanceId })))
}

/** Part of one stack (the quantity dialog). */
export function transferQuantity(source: InventoryKey, destination: InventoryKey, instanceId: string, quantity: number): void {
  runtime.queueTransfer(source, destination, [{ instanceId, quantity }])
}

/** Every item of the container, whatever the table's search or filter shows (Take All). */
export function takeAll(source: InventoryKey, destination: InventoryKey): void {
  const inv = runtime.inventoryFor(source)
  if (inv) transfer(source, destination, inv.items.map((i) => i.id))
}

/** Drop carried items (main or worn bag) on the floor through the one transfer path; one summary. */
export function drop(source: InventoryKey, instanceIds: readonly string[]): void {
  transfer(source, 'floor', instanceIds)
}

/** Run a context menu entry on the resolved instances. `inspect` is handled by the window. */
export function runMenuEntry(entry: MenuEntry, source: InventoryKey, instanceIds: readonly string[]): void {
  const first = instanceIds[0]
  switch (entry.action) {
    case 'equip':
      runtime.equipItem(first)
      return
    case 'unequip':
      runtime.equipItem(null)
      return
    case 'wear':
      runtime.wearBag(first)
      return
    case 'takeOff':
      runtime.wearBag(null)
      return
    case 'eat':
    case 'drink':
    case 'use':
      runtime.consumeItem(first)
      return
    case 'repair':
      runtime.startRepair(first)
      return
    case 'transfer':
      if (entry.destination) transfer(source, entry.destination, instanceIds)
      return
    case 'drop':
      drop(source, instanceIds)
      return
    case 'favorite':
    case 'unfavorite':
      for (const id of instanceIds) runtime.setFavorite(id, entry.action === 'favorite')
      return
    case 'inspect':
    case 'quantity':
      return
  }
}
