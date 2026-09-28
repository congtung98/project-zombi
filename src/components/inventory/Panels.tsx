import { useEffect, type ReactNode } from 'react'
import { runtime } from '../../game/core/runtime'
import { countUsedSlots, isOvercapacity } from '../../game/systems/inventory'
import type { ItemKind } from '../../game/entities/items'
import type { InventoryKey } from '../../game/systems/inventoryCommands'
import { useHudStore } from '../../stores/hudStore'
import { useInventoryStore, type InventoryView } from '../../stores/inventoryStore'
import { useInventoryUiStore, type PanelId } from '../../stores/inventoryUiStore'
import { ItemTable } from './ItemTable'
import { useSelectedIds } from './tableData'
import { drop, takeAll, transfer } from './commands'
import { CATEGORY_LABEL, L } from './labels'

const CATEGORIES = Object.keys(CATEGORY_LABEL) as ItemKind[]
const kg = (n: number) => n.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** Container tabs, selected by key (never by position). */
function Selector({ panel, views, active }: { panel: PanelId; views: InventoryView[]; active: InventoryKey | null }) {
  const patchTable = useInventoryUiStore((s) => s.patchTable)
  return (
    <div className="inv-selector" role="tablist" aria-label={panel === 'inventory' ? L.inventory : L.loot}>
      {views.map((v) => (
        <button
          key={v.key}
          type="button"
          role="tab"
          aria-selected={v.key === active}
          className="inv-tab"
          onClick={() => patchTable(panel, { activeKey: v.key, selection: { ids: new Set(), anchor: null } })}
        >
          {v.name}
          <span className="inv-tab-count">{countUsedSlots(v.inventory)}/{v.inventory.slotCapacity ?? '∞'}</span>
        </button>
      ))}
    </div>
  )
}

/** Name, slots and weight of the shown inventory; the slot limit is what is enforced, weight is only shown. */
function ContextLine({ view, extra }: { view: InventoryView; extra?: string }) {
  const over = isOvercapacity(view.inventory)
  return (
    <div className="inv-context">
      <span className="inv-context-name">{view.name}</span>
      <span className={over ? 'inv-context-over' : undefined} title={over ? L.overCapacity : undefined}>
        {countUsedSlots(view.inventory)}/{view.inventory.slotCapacity ?? '∞'} {L.slots}
      </span>
      <span>{kg(view.weightKg)} {L.kg}</span>
      {extra && <span className="inv-context-ok">{extra}</span>}
    </div>
  )
}

function Toolbar({ panel, children }: { panel: PanelId; children?: ReactNode }) {
  const table = useInventoryUiStore((s) => s.tables[panel])
  const patchTable = useInventoryUiStore((s) => s.patchTable)
  return (
    <div className="inv-toolbar">
      <input
        type="search"
        className="inv-search"
        placeholder={L.search}
        aria-label={L.searchLabel}
        value={table.search}
        onChange={(e) => patchTable(panel, { search: e.target.value })}
        onKeyDown={(e) => {
          // Escape in the field clears it, then leaves it (the game's Escape layers come after).
          if (e.key !== 'Escape') return
          if (table.search) patchTable(panel, { search: '' })
          else e.currentTarget.blur()
        }}
      />
      <select className="inv-filter" aria-label={L.categoryFilter} value={table.category} onChange={(e) => patchTable(panel, { category: e.target.value as ItemKind | 'all' })}>
        <option value="all">{L.allCategories}</option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
        ))}
      </select>
      {children}
    </div>
  )
}

/** The running timed action with its progress and Cancel (S4 lists the waiting ones here too). */
function ActionStrip() {
  const action = useHudStore((s) => s.action)
  if (!action) return null
  return (
    <div className="inv-action" role="status">
      <span className="inv-action-label">{L.running}: {action.label}</span>
      <span className="inv-action-track"><span style={{ width: `${Math.round(action.progress * 100)}%` }} /></span>
      <span className="inv-action-time">{action.remaining.toFixed(1)} s</span>
      <button type="button" className="inv-btn" title={L.cancelHint} onClick={() => runtime.cancelAction()}>{L.cancel}</button>
    </div>
  )
}

/** Where a double click / Enter in the inventory sends items: the open container, never the ground. */
function useLootKey(): InventoryKey | null {
  return useInventoryStore((s) => s.lootView?.key ?? null)
}

export function InventoryPanel({ scale }: { scale: number }) {
  const main = useInventoryStore((s) => s.main)
  const worn = useInventoryStore((s) => s.worn)
  const active = useInventoryUiStore((s) => s.tables.inventory.activeKey)
  const patchTable = useInventoryUiStore((s) => s.patchTable)
  const lootKey = useLootKey()
  const views = worn ? [main, worn] : [main]
  const view = views.find((v) => v.key === active) ?? main
  const selected = useSelectedIds('inventory', view)

  // The worn bag was taken off: show the main inventory again.
  useEffect(() => {
    if (active !== view.key) patchTable('inventory', { activeKey: view.key })
  }, [active, view.key, patchTable])

  return (
    <div className="inv-panel-body">
      <Selector panel="inventory" views={views} active={view.key} />
      <ContextLine view={view} />
      <Toolbar panel="inventory" />
      <ItemTable panel="inventory" view={view} scale={scale} emptyText={L.emptyInventory} onActivate={(ids) => lootKey && transfer(view.key, lootKey, ids)} />
      <div className="inv-footer-bar">
        <span className="inv-footer-count">{selected.length > 0 ? L.selected(selected.length) : ''}</span>
        {lootKey && (
          <button type="button" className="inv-btn" disabled={selected.length === 0} onClick={() => transfer(view.key, lootKey, selected)}>
            {L.storeSelected}
          </button>
        )}
        <button type="button" className="inv-btn" disabled={selected.length === 0 || view.key !== 'main'} title={view.key !== 'main' ? 'Chuyển vào túi chính trước' : undefined} onClick={() => drop(selected)}>
          {L.dropSelected}
        </button>
      </div>
      <ActionStrip />
    </div>
  )
}

export function LootPanel({ scale }: { scale: number }) {
  const loot = useInventoryStore((s) => s.lootView)
  const target = useInventoryUiStore((s) => s.tables.inventory.activeKey) ?? 'main'
  const worn = useInventoryStore((s) => s.worn)
  const selected = useSelectedIds('loot', loot)
  // Items go to the inventory shown in the Inventory window (main or worn bag), never elsewhere when full.
  const destination: InventoryKey = target === 'worn' && worn ? 'worn' : 'main'
  if (!loot) return <div className="inv-panel-body"><div className="inv-empty-state">{L.noContainer}</div></div>
  return (
    <div className="inv-panel-body">
      <Selector panel="loot" views={[loot]} active={loot.key} />
      <ContextLine view={loot} extra={L.inReach} />
      <Toolbar panel="loot">
        <button type="button" className="inv-btn inv-btn-accent" title={L.takeAllHint} disabled={loot.inventory.items.length === 0} onClick={() => takeAll(loot.key, destination)}>
          {L.takeAll}
        </button>
      </Toolbar>
      <ItemTable panel="loot" view={loot} scale={scale} emptyText={L.empty} onActivate={(ids) => transfer(loot.key, destination, ids)} />
      <div className="inv-footer-bar">
        <span className="inv-footer-count">{selected.length > 0 ? L.selected(selected.length) : ''}</span>
        <button type="button" className="inv-btn" disabled={selected.length === 0} onClick={() => transfer(loot.key, destination, selected)}>
          {L.takeSelected}
        </button>
      </div>
    </div>
  )
}
