import { runtime } from '../../game/core/runtime'
import { useInventoryUiStore } from '../../stores/inventoryUiStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { isCompact, type WindowId } from './layout'

/**
 * INV-LOOT Escape, one layer per press: an open popup (menu, inspect card) → the running action →
 * the focused window, else the one on top. Returns false when there was nothing to do, so the game's
 * own layers (leave the combat stance, then pause) come next.
 */
export function handleInventoryEscape(): boolean {
  const ui = useInventoryUiStore.getState()
  if (ui.closePopup()) return true
  // Any queued work (a transfer as much as a craft or repair): cancel the queue first.
  if (runtime.jobs.length > 0) {
    runtime.cancelAction('cancelled')
    return true
  }
  const open: WindowId[] = []
  if (runtime.inventoryOpen) open.push('inventory')
  if (runtime.lootOpen) open.push('loot')
  if (runtime.inventoryOpen && ui.craftingOpen) open.push('crafting')
  if (open.length === 0) return false
  const scale = useSettingsStore.getState().uiScale
  const compact = isCompact({ w: window.innerWidth / scale, h: window.innerHeight / scale })
  // In compact mode Inventory and Loot share one window: its visible tab is what closes.
  const shown = (id: WindowId): WindowId => (compact && id === 'loot' ? 'inventory' : id)
  const focused = ui.focused && open.some((id) => shown(id) === ui.focused) ? ui.focused : null
  const target = focused ?? [...ui.order].reverse().find((id) => open.some((o) => shown(o) === id)) ?? open[0]
  if (target === 'crafting') ui.setCraftingOpen(false)
  else if (target === 'loot' || (compact && target === 'inventory' && runtime.lootOpen && (ui.compactTab === 'loot' || !runtime.inventoryOpen))) runtime.closeContainer()
  else runtime.setInventoryOpen(false)
  return true
}
