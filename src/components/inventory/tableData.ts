import { useMemo } from 'react'
import { getItemDef, type ItemInstance } from '../../game/entities/items'
import { useInventoryStore, type InventoryView } from '../../stores/inventoryStore'
import { useInventoryUiStore, type PanelId, type TableState } from '../../stores/inventoryUiStore'
import { buildRows, type Row } from './rows'
import { selectedInstanceIds } from './selection'

/** The snapshot view behind a key (main, worn bag, open container), or null. */
export function useView(key: string | null): InventoryView | null {
  return useInventoryStore((s) => (key === 'main' ? s.main : key === 'worn' ? s.worn : s.lootView?.key === key ? s.lootView : null))
}

/** Instances of a view by ID, in the given order (IDs no longer there are skipped). */
export function instancesIn(view: InventoryView | null, ids: readonly string[]): ItemInstance[] {
  if (!view) return []
  return ids.flatMap((id) => view.inventory.items.filter((i) => i.id === id))
}

/** Row weight: a bag with its contents (from the snapshot), anything else its units. */
export function weightFn(bagWeights: Record<string, number>): (item: ItemInstance) => number {
  return (i) => (i.kind === 'bag' ? (bagWeights[i.id] ?? getItemDef(i.itemId).weightKg) : getItemDef(i.itemId).weightKg * i.quantity)
}

/** The rows a table shows for a view and its table state (memoized). */
export function useRows(view: InventoryView | null, table: TableState): Row[] {
  const bagWeights = useInventoryStore((s) => s.bagWeights)
  const expanded = useMemo(() => new Set(table.expanded), [table.expanded])
  return useMemo(
    () => (view ? buildRows(view.inventory.items, { search: table.search, category: table.category, sort: table.sort, expanded }, weightFn(bagWeights)) : []),
    [view, table.search, table.category, table.sort, expanded, bagWeights],
  )
}

/** The instances a panel's selection means right now, in visible order (footer buttons). */
export function useSelectedIds(panel: PanelId, view: InventoryView | null): string[] {
  const table = useInventoryUiStore((s) => s.tables[panel])
  const rows = useRows(view, table)
  return useMemo(() => selectedInstanceIds(table.selection, rows), [table.selection, rows])
}
