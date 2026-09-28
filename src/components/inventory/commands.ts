import { runtime } from '../../game/core/runtime'
import { findItem } from '../../game/systems/inventory'
import { itemRefusal, type InventoryKey, type TransferRefusal } from '../../game/systems/inventoryCommands'
import { useHudStore } from '../../stores/hudStore'
import { summaryText } from './labels'
import type { MenuEntry } from './itemActions'

/**
 * UI → runtime commands. The UI sends keys and instance IDs only; the runtime re-reads its own state
 * and applies its rules (INV-LOOT §8.3). In S2 a transfer happens at once; S4 queues timed steps
 * behind the same calls. The transfer summary toast comes from the `inventory:transferred` event.
 */
export function transfer(source: InventoryKey, destination: InventoryKey, instanceIds: readonly string[]): void {
  if (instanceIds.length === 0) return
  runtime.transferItems(source, destination, instanceIds.map((instanceId) => ({ instanceId })))
}

/** Every item of the container, whatever the table's search or filter shows (Take All). */
export function takeAll(source: InventoryKey, destination: InventoryKey): void {
  const inv = runtime.inventoryFor(source)
  if (inv) transfer(source, destination, inv.items.map((i) => i.id))
}

/** Drop from the main inventory: equipped, favorite and reserved items stay; one summary. */
export function drop(instanceIds: readonly string[]): void {
  let moved = 0
  const skipped: TransferRefusal[] = []
  for (const id of instanceIds) {
    const item = findItem(runtime.player.inventory, id)
    if (!item) {
      skipped.push('missing')
      continue
    }
    const refusal = itemRefusal(item, runtime.player.equipment, true, false)
    if (refusal) skipped.push(refusal)
    else if (runtime.dropItem(id)) moved += item.quantity
    else skipped.push('reserved')
  }
  if (instanceIds.length > 1 || skipped.length > 0) useHudStore.getState().showToast(summaryText(moved, skipped, 'bỏ'), 2200)
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
      drop(instanceIds)
      return
    case 'favorite':
    case 'unfavorite':
      for (const id of instanceIds) runtime.setFavorite(id, entry.action === 'favorite')
      return
    case 'inspect':
      return
  }
}
