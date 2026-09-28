import { useEffect, type ReactNode } from 'react'
import { runtime } from '../../game/core/runtime'
import { countUsedSlots, isOvercapacity } from '../../game/systems/inventory'
import type { ItemKind } from '../../game/entities/items'
import { containerIdOf, type InventoryKey } from '../../game/systems/inventoryCommands'
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
function ContextLine({ view, extra, warning }: { view: InventoryView; extra?: string; warning?: string }) {
  const over = isOvercapacity(view.inventory)
  return (
    <div className="inv-context">
      <span className="inv-context-name">{view.name}</span>
      {view.inventory.slotCapacity !== null && (
        <span className={over ? 'inv-context-over' : undefined} title={over ? L.overCapacity : undefined}>
          {countUsedSlots(view.inventory)}/{view.inventory.slotCapacity} {L.slots}
        </span>
      )}
      <span>{kg(view.weightKg)} {L.kg}</span>
      {extra && <span className="inv-context-ok">{extra}</span>}
      {warning && <span className="inv-context-warn" role="status">{warning}</span>}
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

/**
 * The running job (step progress, units done of the job) with Cancel, and the jobs waiting behind it,
 * each removable (INV-LOOT Q3: the running and the waiting actions are shown).
 */
function ActionStrip() {
  const action = useHudStore((s) => s.action)
  const waiting = useInventoryStore((s) => s.waiting)
  if (!action && waiting.length === 0) return null
  return (
    <div className="inv-action-wrap">
      {action && (
        <div className="inv-action" role="status">
          <span className="inv-action-label">{L.running}: {action.label}</span>
          {action.total > 1 && <span className="inv-action-time">{L.progress(action.done, action.total)}</span>}
          <span className="inv-action-track"><span style={{ width: `${Math.round(action.progress * 100)}%` }} /></span>
          <span className="inv-action-time">{action.remaining.toFixed(1)} s</span>
          <button type="button" className="inv-btn" title={L.cancelHint} onClick={() => runtime.cancelAction()}>{waiting.length > 0 ? L.cancelAll : L.cancel}</button>
        </div>
      )}
      {waiting.length > 0 && (
        <ul className="inv-queue" aria-label={L.waiting}>
          {waiting.map((j) => (
            <li key={j.id}>
              <span>{L.waiting}: {j.label}</span>
              <button type="button" className="inv-tool" title={L.cancelOne} onClick={() => runtime.cancelJob(j.id)}>×</button>
            </li>
          ))}
        </ul>
      )}
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
    <div className="inv-panel-body" data-drop-key={view.key}>
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
        <button type="button" className="inv-btn" disabled={selected.length === 0} onClick={() => drop(view.key, selected)}>
          {L.dropSelected}
        </button>
      </div>
      <ActionStrip />
    </div>
  )
}

/** Loot tabs: the floor and every container in reach, by key; clicking one shows it (it counts as opening it). */
function LootTabs({ active }: { active: InventoryKey }) {
  const tabs = useInventoryStore((s) => s.lootTabs)
  return (
    <div className="inv-selector" role="tablist" aria-label={L.loot}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={t.key === active}
          className={`inv-tab${t.inReach ? '' : ' inv-tab-out'}`}
          title={t.inReach ? undefined : L.outOfReach}
          onClick={() => runtime.openLoot(t.key === 'floor' ? null : containerIdOf(t.key))}
        >
          {t.name}
          <span className="inv-tab-count">{t.capacity === null ? t.used : `${t.used}/${t.capacity}`}</span>
        </button>
      ))}
    </div>
  )
}

export function LootPanel({ scale }: { scale: number }) {
  const loot = useInventoryStore((s) => s.lootView)
  const inReach = useInventoryStore((s) => s.lootInReach)
  const target = useInventoryUiStore((s) => s.tables.inventory.activeKey) ?? 'main'
  const worn = useInventoryStore((s) => s.worn)
  const selected = useSelectedIds('loot', loot)
  // Items go to the inventory shown in the Inventory window (main or worn bag), never elsewhere when full.
  const destination: InventoryKey = target === 'worn' && worn ? 'worn' : 'main'
  if (!loot) return <div className="inv-panel-body"><div className="inv-empty-state">{L.noContainer}</div></div>
  const floor = loot.key === 'floor'
  return (
    <div className="inv-panel-body" data-drop-key={loot.key}>
      <LootTabs active={loot.key} />
      <ContextLine view={loot} extra={inReach ? L.inReach : undefined} warning={inReach ? undefined : L.outOfReach} />
      <Toolbar panel="loot">
        <button type="button" className="inv-btn inv-btn-accent" title={L.takeAllHint} disabled={!inReach || loot.inventory.items.length === 0} onClick={() => takeAll(loot.key, destination)}>
          {L.takeAll}
        </button>
      </Toolbar>
      <ItemTable panel="loot" view={loot} scale={scale} emptyText={floor ? L.emptyFloor : L.empty} onActivate={(ids) => inReach && transfer(loot.key, destination, ids)} />
      <div className="inv-footer-bar">
        <span className="inv-footer-count">{selected.length > 0 ? L.selected(selected.length) : ''}</span>
        <button type="button" className="inv-btn" disabled={!inReach || selected.length === 0} onClick={() => transfer(loot.key, destination, selected)}>
          {L.takeSelected}
        </button>
      </div>
    </div>
  )
}
