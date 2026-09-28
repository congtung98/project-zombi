import type { InventoryKey } from '../../game/systems/inventoryCommands'
import { useInventoryUiStore } from '../../stores/inventoryUiStore'

/** The inventory key of the drop target under a screen point (a list, a panel or a tab), or null. */
export function dropKeyAt(x: number, y: number): InventoryKey | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  return (el?.closest('[data-drop-key]')?.getAttribute('data-drop-key') as InventoryKey | null) ?? null
}

/** Rows dragged from another inventory are over this key (its list, panel or tab lights up). */
export function useDropTarget(key: InventoryKey): boolean {
  return useInventoryUiStore((s) => s.drag !== null && s.drag.target === key && s.drag.source !== key)
}
