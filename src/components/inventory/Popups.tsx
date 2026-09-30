import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { getItemDef, type ItemInstance } from '../../game/entities/items'
import { repairRecipeFor } from '../../game/entities/recipes'
import { runtime } from '../../game/core/runtime'
import { checkRecipe } from '../../game/systems/crafting'
import { canBenefit } from '../../game/systems/survival'
import { previewTransfer } from '../../game/systems/inventory'
import type { InventoryKey } from '../../game/systems/inventoryCommands'
import { useInventoryStore, type InventoryView } from '../../stores/inventoryStore'
import { useInventoryUiStore } from '../../stores/inventoryUiStore'
import { ACTION_FAILURE_TEXT } from '../craftText'
import { menuEntries, type Destination } from './itemActions'
import { runMenuEntry, transferQuantity } from './commands'
import { ItemIcon } from './ItemIcon'
import { ItemCard } from './ItemCard'
import { instancesIn, useView } from './tableData'
import { itemName, L } from './labels'
import type { View } from './layout'

const HOVER_DELAY_MS = 300

/** Keep a popup inside the view, offset from the pointer so it never covers what is being pointed at. */
function usePlacement(x: number, y: number, view: View, offset: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x + offset, top: y + offset })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = x + offset + w > view.w - 4 ? Math.max(4, x - offset - w) : x + offset
    const top = y + offset + h > view.h - 4 ? Math.max(4, view.h - 4 - h) : y + offset
    setPos((p) => (p.left === left && p.top === top ? p : { left, top }))
  }, [x, y, view.w, view.h, offset])
  return { ref, pos }
}

/** Other inventories the player can reach now, by key (never the source). */
function useDestinations(source: InventoryKey): Destination[] {
  const main = useInventoryStore((s) => s.main)
  const worn = useInventoryStore((s) => s.worn)
  const loot = useInventoryStore((s) => s.lootView)
  // The floor is reached through "Bỏ xuống đất", never listed as a second destination.
  return useMemo(() => [main, worn, loot].filter((v): v is InventoryView => v !== null && v.key !== source && v.key !== 'floor').map((v) => ({ key: v.key, name: v.name, inventory: v.inventory })), [main, worn, loot, source])
}

function ContextMenu({ source, instanceIds, x, y, view, onInspect, onQuantity }: { source: InventoryKey; instanceIds: string[]; x: number; y: number; view: View; onInspect: (id: string) => void; onQuantity: (id: string, destination: InventoryKey) => void }) {
  const inv = useView(source)
  const items = useMemo(() => instancesIn(inv, instanceIds), [inv, instanceIds])
  const destinations = useDestinations(source)
  const weaponId = useInventoryStore((s) => s.weaponInstanceId)
  const backId = useInventoryStore((s) => s.backInstanceId)
  const action = useInventoryStore((s) => s.action)
  const bag = useInventoryStore((s) => s.bag)
  const worn = useInventoryStore((s) => s.worn)
  const close = useInventoryUiStore((s) => s.closePopup)
  const { ref, pos } = usePlacement(x, y, view, 2)

  const entries = useMemo(() => {
    if (items.length === 0) return []
    const reserved = new Set(action?.reservedIds ?? [])
    return menuEntries({
      source, items, destinations, equipment: { weaponInstanceId: weaponId, backInstanceId: backId },
      isReserved: (i: ItemInstance) => reserved.has(i.id),
      benefits: (effect) => canBenefit(runtime.player, effect),
      // AX2: using it from a container or the floor takes one unit into the main inventory first.
      canTake: (i: ItemInstance) => previewTransfer(inv?.inventory ?? bag, i.id, bag, 1).quantity > 0,
      repairBlock: (i: ItemInstance) => {
        const recipe = repairRecipeFor(i.itemId)
        if (!recipe) return undefined
        if (action?.targetId === i.id) return 'Đang sửa'
        // INV-LOOT Q2/Q3: inputs from the main inventory then the worn bag; queued behind a running action.
        const check = checkRecipe({ inventories: worn ? [bag, worn.inventory] : [bag], protect: (x) => !!x.favorite || x.id === weaponId || x.id === backId, available: (x) => (reserved.has(x.id) ? 0 : x.quantity) }, recipe, i.id)
        return check.failure ? ACTION_FAILURE_TEXT[action && check.failure === 'missing-input' ? 'missing-carried' : check.failure] : null
      },
    })
  }, [items, source, destinations, weaponId, backId, action, bag, worn, inv])

  // The menu closes by itself when its items are gone (used up, moved away).
  useEffect(() => {
    if (items.length === 0) close()
  }, [items.length, close])
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()
  }, [ref])

  const onKeyDown = (e: KeyboardEvent) => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown') buttons[(i + 1) % buttons.length]?.focus()
    else if (e.key === 'ArrowUp') buttons[(i - 1 + buttons.length) % buttons.length]?.focus()
    else return
    e.preventDefault()
  }

  return (
    <div ref={ref} className="inv-menu" role="menu" data-ui-keys style={pos} onKeyDown={onKeyDown}>
      {entries.map((entry) => (
        <button
          key={entry.key}
          type="button"
          role="menuitem"
          className="inv-menu-item"
          disabled={entry.disabled !== null}
          title={entry.disabled ?? undefined}
          onClick={() => {
            close()
            if (entry.action === 'inspect') onInspect(instanceIds[0])
            else if (entry.action === 'quantity') onQuantity(instanceIds[0], entry.destination!)
            else runMenuEntry(entry, source, instanceIds)
          }}
        >
          <span>{entry.label}</span>
          {entry.disabled && <small className="inv-menu-reason">{entry.disabled}</small>}
        </button>
      ))}
    </div>
  )
}

function HoverCard({ view }: { view: View }) {
  const hover = useInventoryUiStore((s) => s.hover)
  // The card shows once the pointer rested on the same row for the delay.
  const key = hover ? `${hover.source}|${hover.instanceIds.join(',')}` : null
  const [ready, setReady] = useState<string | null>(null)
  useEffect(() => {
    if (!key) return
    const t = window.setTimeout(() => setReady(key), HOVER_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [key])
  const shown = hover && ready === key ? hover : null
  const inv = useView(shown?.source ?? null)
  const items = useMemo(() => (shown ? instancesIn(inv, shown.instanceIds) : []), [inv, shown])
  const { ref, pos } = usePlacement(shown?.x ?? 0, shown?.y ?? 0, view, 16)
  if (!shown || items.length === 0) return null
  return (
    <div ref={ref} className="inv-card inv-tooltip" role="tooltip" style={pos}>
      <ItemCard items={items} />
    </div>
  )
}

function InspectCard({ source, instanceId, x, y, view }: { source: InventoryKey; instanceId: string; x: number; y: number; view: View }) {
  const inv = useView(source)
  const items = useMemo(() => instancesIn(inv, [instanceId]), [inv, instanceId])
  const close = useInventoryUiStore((s) => s.closePopup)
  const { ref, pos } = usePlacement(x, y, view, 8)
  useEffect(() => {
    if (items.length === 0) close()
  }, [items.length, close])
  return (
    <div ref={ref} className="inv-card inv-inspect" role="dialog" aria-label={items[0] ? itemName(items[0]) : L.inspect} style={pos}>
      <button type="button" className="inv-tool inv-inspect-close" title={L.close} onClick={close}>×</button>
      <ItemCard items={items} />
    </div>
  )
}

/**
 * How many of a stack to move (INV-LOOT §5.1): a whole number 1..available with Max, confirm and
 * cancel; the runtime checks it again when it queues and when each step moves.
 */
function QuantityDialog({ source, instanceId, destination, x, y, view }: { source: InventoryKey; instanceId: string; destination: InventoryKey; x: number; y: number; view: View }) {
  const inv = useView(source)
  const item = useMemo(() => instancesIn(inv, [instanceId])[0], [inv, instanceId])
  const destinations = useDestinations(source)
  const close = useInventoryUiStore((s) => s.closePopup)
  const [value, setValue] = useState('1')
  const [dest, setDest] = useState<InventoryKey>(destination)
  const input = useRef<HTMLInputElement>(null)
  const { ref, pos } = usePlacement(x, y, view, 8)
  useEffect(() => {
    if (!item) close()
  }, [item, close])
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  if (!item) return null
  const max = item.quantity
  const n = Number(value)
  const valid = Number.isInteger(n) && n >= 1 && n <= max
  const confirm = () => {
    if (!valid) return
    close()
    transferQuantity(source, dest, instanceId, n)
  }
  return (
    <div ref={ref} className="inv-card inv-qty" role="dialog" aria-label={L.quantityTitle} style={pos}>
      <div className="inv-card-head">
        <ItemIcon itemId={item.itemId} size={28} />
        <div className="inv-card-name">{getItemDef(item.itemId).name} ×{max}</div>
      </div>
      <div className="inv-qty-row">
        <label>
          {L.quantityTitle}{' '}
          <input
            ref={input}
            type="number"
            className="inv-search inv-qty-input"
            min={1}
            max={max}
            step={1}
            value={value}
            aria-invalid={!valid}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirm()
              else if (e.key === 'Escape') close()
            }}
          />
        </label>
        <button type="button" className="inv-btn" onClick={() => setValue(String(max))}>{L.quantityMax}</button>
      </div>
      {destinations.length > 1 && (
        <label className="inv-qty-row">
          {L.quantityTo}{' '}
          <select className="inv-filter" value={dest} onChange={(e) => setDest(e.target.value as InventoryKey)}>
            {destinations.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
          </select>
        </label>
      )}
      <div className="inv-qty-row inv-qty-actions">
        <button type="button" className="inv-btn inv-btn-accent" disabled={!valid} onClick={confirm}>{L.confirm}</button>
        <button type="button" className="inv-btn" onClick={close}>{L.cancel}</button>
      </div>
    </div>
  )
}

/**
 * Popups of the inventory windows, above every window in the scaled UI layer (a portal-like layer:
 * never clipped by a table's scroll box). A press outside the open menu closes it.
 */
export function Popups({ view }: { view: View }) {
  const popup = useInventoryUiStore((s) => s.popup)
  const { openPopup, closePopup } = useInventoryUiStore.getState()
  useEffect(() => {
    if (!popup) return
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.inv-menu, .inv-inspect, .inv-qty')) closePopup()
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [popup, closePopup])
  return (
    <div className="inv-popups">
      {!popup && <HoverCard view={view} />}
      {popup?.kind === 'menu' && (
        <ContextMenu
          source={popup.source}
          instanceIds={popup.instanceIds}
          x={popup.x}
          y={popup.y}
          view={view}
          onInspect={(id) => openPopup({ kind: 'inspect', panel: popup.panel, source: popup.source, instanceId: id, x: popup.x, y: popup.y })}
          onQuantity={(id, destination) => openPopup({ kind: 'quantity', panel: popup.panel, source: popup.source, instanceId: id, destination, x: popup.x, y: popup.y })}
        />
      )}
      {popup?.kind === 'quantity' && <QuantityDialog source={popup.source} instanceId={popup.instanceId} destination={popup.destination} x={popup.x} y={popup.y} view={view} />}
      {popup?.kind === 'inspect' && <InspectCard source={popup.source} instanceId={popup.instanceId} x={popup.x} y={popup.y} view={view} />}
    </div>
  )
}
