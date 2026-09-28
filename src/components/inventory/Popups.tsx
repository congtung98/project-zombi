import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { getItemDef, type ItemInstance } from '../../game/entities/items'
import { repairRecipeFor } from '../../game/entities/recipes'
import { runtime } from '../../game/core/runtime'
import { checkRecipe } from '../../game/systems/crafting'
import { canBenefit } from '../../game/systems/survival'
import type { InventoryKey } from '../../game/systems/inventoryCommands'
import { useInventoryStore, type InventoryView } from '../../stores/inventoryStore'
import { useInventoryUiStore } from '../../stores/inventoryUiStore'
import { ACTION_FAILURE_TEXT } from '../craftText'
import { menuEntries, type Destination } from './itemActions'
import { runMenuEntry } from './commands'
import { ItemCard } from './ItemCard'
import { instancesIn, useView } from './tableData'
import { L, REFUSAL_LABEL } from './labels'
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
  return useMemo(() => [main, worn, loot].filter((v): v is InventoryView => v !== null && v.key !== source).map((v) => ({ key: v.key, name: v.name, inventory: v.inventory })), [main, worn, loot, source])
}

function ContextMenu({ source, instanceIds, x, y, view, onInspect }: { source: InventoryKey; instanceIds: string[]; x: number; y: number; view: View; onInspect: (id: string) => void }) {
  const inv = useView(source)
  const items = useMemo(() => instancesIn(inv, instanceIds), [inv, instanceIds])
  const destinations = useDestinations(source)
  const weaponId = useInventoryStore((s) => s.weaponInstanceId)
  const backId = useInventoryStore((s) => s.backInstanceId)
  const action = useInventoryStore((s) => s.action)
  const bag = useInventoryStore((s) => s.bag)
  const close = useInventoryUiStore((s) => s.closePopup)
  const { ref, pos } = usePlacement(x, y, view, 2)

  const entries = useMemo(() => {
    if (items.length === 0) return []
    const reserved = new Set(action?.reservedIds ?? [])
    return menuEntries({
      source, items, destinations, equipment: { weaponInstanceId: weaponId, backInstanceId: backId },
      isReserved: (i: ItemInstance) => reserved.has(i.id),
      useBlock: (i: ItemInstance) => (canBenefit(runtime.player, getItemDef(i.itemId).effect) ? null : REFUSAL_LABEL['no-effect']),
      repairBlock: (i: ItemInstance) => {
        const recipe = repairRecipeFor(i.itemId)
        if (!recipe) return undefined
        if (action) return action.targetId === i.id ? 'Đang sửa' : ACTION_FAILURE_TEXT.busy
        const check = checkRecipe(bag, recipe, i.id)
        return check.failure ? ACTION_FAILURE_TEXT[check.failure] : null
      },
    })
  }, [items, source, destinations, weaponId, backId, action, bag])

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
    <div ref={ref} className="inv-card inv-inspect" role="dialog" aria-label={L.colName} style={pos}>
      <button type="button" className="inv-tool inv-inspect-close" title={L.close} onClick={close}>×</button>
      <ItemCard items={items} />
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
      if (!(e.target as HTMLElement).closest('.inv-menu, .inv-inspect')) closePopup()
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
        />
      )}
      {popup?.kind === 'inspect' && <InspectCard source={popup.source} instanceId={popup.instanceId} x={popup.x} y={popup.y} view={view} />}
    </div>
  )
}
