import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { getItemDef, type ItemInstance } from '../../game/entities/items'
import { conditionLevel } from '../../game/systems/weapons'
import type { InventoryKey } from '../../game/systems/inventoryCommands'
import { useInventoryStore, type InventoryView } from '../../stores/inventoryStore'
import { useRows } from './tableData'
import { transfer } from './commands'
import { useInventoryUiStore, type PanelId } from '../../stores/inventoryUiStore'
import type { Row, SortKey } from './rows'
import { clickRow, pruneSelection, selectAll, selectedInstanceIds, sweepRows, type Selection } from './selection'
import { CATEGORY_LABEL, L } from './labels'
import { Glyph, ItemIcon } from './ItemIcon'
import { dropKeyAt, useDropTarget } from './dragDrop'

interface Props {
  panel: PanelId
  view: InventoryView
  scale: number
  /** Double click / Enter on rows: the concrete instances. */
  onActivate: (instanceIds: string[]) => void
  emptyText: string
}

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: 'name', label: L.colName, className: 'col-name' },
  { key: 'category', label: L.colCategory, className: 'col-cat' },
  { key: 'qty', label: L.colQty, className: 'col-qty' },
  { key: 'weight', label: L.colWeight, className: 'col-kg' },
]

/** Fixed row height (CSS --inv-row-height): long lists render only the rows in view. */
const ROW_H = 28
/** Measured on a 500-row container: a full re-render took ~110 ms, windowed it is a few ms. */
const VIRTUAL_MIN_ROWS = 80
const OVERSCAN = 8

/** A press must move this far (screen px) before it becomes a sweep or a drag (a click never drags). */
const DRAG_START_PX = 5
/** A sweep keeps selecting while the pointer is this close above/below the list (UI px); farther = drag. */
const SWEEP_MARGIN = 24
/**
 * A sweep is an up/down motion: once the pointer is this far sideways from the press (UI px) the
 * run is fixed and carried, so leaving the list on a slant never changes what was swept.
 */
const SWEEP_SIDEWAYS = 48
/** Within this distance of the list's top/bottom edge (UI px) a sweep scrolls the list. */
const SWEEP_EDGE = 14
/** Sweep auto-scroll speed at the edge (UI px per frame). */
const SWEEP_SCROLL = 6

const kg = (n: number) => (n < 0.1 && n > 0 ? n.toFixed(2) : n.toFixed(1))

interface RowFlags {
  weaponId: string | null
  backId: string | null
  reserved: ReadonlySet<string>
  /** Units claimed by a queued transfer (INV-LOOT S4 ghost state; quantities change only on commit). */
  queued: ReadonlySet<string>
}

function Badges({ item, flags }: { item: ItemInstance; flags: RowFlags }) {
  const level = item.kind === 'weapon' ? conditionLevel(item.itemId, item.condition) : null
  return (
    <>
      {item.id === flags.weaponId && <span className="inv-badge inv-badge-eq" title={L.equippedWeapon}>{L.equippedWeapon}</span>}
      {item.id === flags.backId && <span className="inv-badge inv-badge-eq" title={L.wornBag}>{L.wornBag}</span>}
      {item.favorite && <span className="inv-badge inv-badge-fav" title={L.favorite} aria-label={L.favorite}>★</span>}
      {flags.reserved.has(item.id) ? <span className="inv-badge inv-badge-use">{L.reserved}</span> : flags.queued.has(item.id) && <span className="inv-badge inv-badge-queued">{L.queued}</span>}
      {level === 'broken' && <span className="inv-badge inv-badge-broken">{L.broken}</span>}
    </>
  )
}

function Condition({ item }: { item: ItemInstance }) {
  if (item.kind !== 'weapon') return null
  const max = getItemDef(item.itemId).maxCondition!
  const level = conditionLevel(item.itemId, item.condition)
  return (
    <span className={`inv-cond inv-cond-${level}`} title={`${L.condition} ${item.condition}/${max}`}>
      <span className="inv-cond-bar"><span style={{ width: `${(item.condition / max) * 100}%` }} /></span>
      <span className="inv-cond-num">{item.condition}</span>
    </span>
  )
}

interface RowProps {
  row: Row
  selected: boolean
  focused: boolean
  flags: RowFlags
  onPointer: (row: Row, e: MouseEvent) => void
  onDouble: (row: Row) => void
  onMenu: (row: Row, e: MouseEvent) => void
  onHover: (row: Row | null, e?: MouseEvent) => void
  onToggleGroup: (row: Row) => void
}

const ItemRowView = memo(function ItemRowView({ row, selected, focused, flags, onPointer, onDouble, onMenu, onHover, onToggleGroup }: RowProps) {
  const itemId = row.kind === 'group' ? row.itemId : row.item.itemId
  const member = row.kind === 'item' && row.groupId !== null
  return (
    <div
      role="row"
      aria-selected={selected}
      data-row-id={row.id}
      className={`inv-row${selected ? ' inv-row-selected' : ''}${focused ? ' inv-row-focus' : ''}${member ? ' inv-row-member' : ''}`}
      onMouseDown={(e) => e.button === 0 && onPointer(row, e)}
      onDoubleClick={() => onDouble(row)}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(row, e)
      }}
      onMouseMove={(e) => onHover(row, e)}
      onMouseLeave={() => onHover(null)}
    >
      <span role="gridcell" className="col-name">
        {row.kind === 'group' ? (
          <button type="button" className="inv-expander" title={row.expanded ? L.collapseGroup : L.expandGroup} aria-expanded={row.expanded} onMouseDown={(e) => e.stopPropagation()} onClick={() => onToggleGroup(row)}>
            <Glyph name={row.expanded ? 'chevron-down' : 'chevron-right'} />
          </button>
        ) : member ? (
          <span className="inv-expander-space" />
        ) : null}
        <ItemIcon itemId={itemId} />
        <span className="inv-name">{row.name}</span>
        {row.kind === 'item' && <Badges item={row.item} flags={flags} />}
        {row.kind === 'item' && <Condition item={row.item} />}
      </span>
      <span role="gridcell" className="col-cat">{CATEGORY_LABEL[row.category]}</span>
      <span role="gridcell" className="col-qty">{row.qty}</span>
      <span role="gridcell" className="col-kg">{kg(row.weight)}</span>
    </div>
  )
})

/**
 * The item list of one inventory. Selection and sort are by row ID, never by index; rows are derived
 * from the store snapshot (memoized), selection is pruned when rows go away. Pointer and keys here
 * never reach the game: the canvas only takes presses made on itself, and `data-ui-keys` keeps
 * arrows, Enter and Ctrl shortcuts for the table (WASD still moves the character).
 */
export function ItemTable({ panel, view, scale, onActivate, emptyText }: Props) {
  const table = useInventoryUiStore((s) => s.tables[panel])
  const weaponId = useInventoryStore((s) => s.weaponInstanceId)
  const backId = useInventoryStore((s) => s.backInstanceId)
  const reservedIds = useInventoryStore((s) => s.action?.reservedIds)
  const queuedIds = useInventoryStore((s) => s.queuedIds)
  const { patchTable, openPopup, setHover, setDrag } = useInventoryUiStore.getState()
  const [focusId, setFocusId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const hoverRow = useRef<string | null>(null)
  const [scroll, setScroll] = useState({ top: 0, height: 400 })

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setScroll((s) => (s.height === el.clientHeight ? s : { ...s, height: el.clientHeight })))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const rows = useRows(view, table)
  // A sweep or drag in progress reads the rows as they are now (an item may come or go meanwhile).
  const rowsRef = useRef(rows)
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])
  const dropHere = useDropTarget(view.key)
  const flags = useMemo<RowFlags>(() => ({ weaponId, backId, reserved: new Set(reservedIds ?? []), queued: new Set(queuedIds) }), [weaponId, backId, reservedIds, queuedIds])

  // Items used up or moved away leave the selection (and the hover card).
  useEffect(() => {
    const pruned = pruneSelection(table.selection, rows)
    if (pruned !== table.selection) patchTable(panel, { selection: pruned })
  }, [rows, table.selection, panel, patchTable])

  const setSelection = (selection: Selection) => patchTable(panel, { selection })
  const at = (e: MouseEvent) => ({ x: e.clientX / scale, y: e.clientY / scale })

  /**
   * Left press on a row (INV-LOOT S4/S5), all by mouse:
   * - a press that stays put is a click (select; Ctrl toggles, Shift selects a range);
   * - held and moved up/down the list it sweeps: every row from the pressed one to the one under the
   *   pointer is selected (Ctrl adds the run to the selection), scrolling at the list's edges;
   * - pulled sideways at once it carries the row (or its selection); a sweep is carried once the
   *   pointer goes 48 px sideways or well above/below the list (the run as swept), and dropped on
   *   the window or tab under the pointer when released (Shift + one stack asks how many first);
   * - a press on a row of a multi-selection carries that selection at once.
   */
  const onPointer = (row: Row, e: MouseEvent) => {
    setFocusId(row.id)
    const list = listRef.current
    list?.focus({ preventScroll: true })
    const add = e.ctrlKey || e.metaKey
    const plain = !(add || e.shiftKey)
    const base = table.selection
    const carry = plain && base.ids.has(row.id) && base.ids.size > 1
    let selection = carry ? base : clickRow(base, rows, row.id, { toggle: add, range: e.shiftKey })
    if (selection !== base) setSelection(selection)
    const x0 = e.clientX
    const y0 = e.clientY
    let mode: 'press' | 'sweep' | 'drag' = 'press'
    let ids: string[] = []
    let last = { x: x0, y: y0 }
    let raf = 0
    // The row under a screen height, virtualized rows included (index from the scroll), clamped.
    const rowAt = (y: number): string | null => {
      if (!list) return null
      const r = list.getBoundingClientRect()
      const all = rowsRef.current
      const i = Math.floor(((y - r.top) / scale + list.scrollTop) / ROW_H)
      return all[Math.max(0, Math.min(all.length - 1, i))]?.id ?? null
    }
    const inBand = (x: number, y: number): boolean => {
      if (!list || Math.abs(x - x0) > SWEEP_SIDEWAYS * scale) return false
      const r = list.getBoundingClientRect()
      const m = SWEEP_MARGIN * scale
      return x >= r.left && x <= r.right && y >= r.top - m && y <= r.bottom + m
    }
    const sweepTo = (y: number) => {
      const over = rowAt(y)
      if (!over) return
      const next = sweepRows(base, rowsRef.current, row.id, over, add)
      if (next.ids.size !== selection.ids.size || [...next.ids].some((id) => !selection.ids.has(id))) {
        selection = next
        setSelection(next)
      }
    }
    const scrollStep = () => {
      raf = 0
      if (mode !== 'sweep' || !list) return
      const r = list.getBoundingClientRect()
      const edge = SWEEP_EDGE * scale
      const dir = last.y < r.top + edge ? -1 : last.y > r.bottom - edge ? 1 : 0
      if (dir === 0) return
      list.scrollTop += dir * SWEEP_SCROLL
      sweepTo(last.y)
      raf = requestAnimationFrame(scrollStep)
    }
    const startDrag = () => {
      mode = 'drag'
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      ids = selection.ids.has(row.id) ? selectedInstanceIds(selection, rowsRef.current) : row.instanceIds
    }
    const move = (ev: PointerEvent) => {
      last = { x: ev.clientX, y: ev.clientY }
      if (mode === 'press') {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_START_PX) return
        // A mostly sideways pull carries the row at once (S4); a mostly up/down one sweeps once it
        // reaches another row.
        const sideways = Math.abs(ev.clientX - x0) > Math.abs(ev.clientY - y0)
        if (carry || e.shiftKey || sideways || !inBand(ev.clientX, ev.clientY)) startDrag()
        else if (rowAt(ev.clientY) !== row.id) {
          mode = 'sweep'
          setHover(null)
        } else return
      }
      if (mode === 'sweep') {
        if (!inBand(ev.clientX, ev.clientY)) startDrag()
        else {
          sweepTo(ev.clientY)
          if (!raf) raf = requestAnimationFrame(scrollStep)
          return
        }
      }
      setDrag({ source: view.key, instanceIds: ids, x: ev.clientX / scale, y: ev.clientY / scale, target: dropKeyAt(ev.clientX, ev.clientY) })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      if (raf) cancelAnimationFrame(raf)
      if (mode === 'press') {
        // A plain click (no drag) on a row of a multi-selection selects just that row.
        if (carry) setSelection(clickRow(selection, rows, row.id, { toggle: false, range: false }))
        return
      }
      if (mode === 'sweep') return
      setDrag(null)
      if (ev.type === 'pointercancel') return
      const key = dropKeyAt(ev.clientX, ev.clientY)
      if (!key || key === view.key || ids.length === 0) return
      const only = ids.length === 1 ? view.inventory.items.find((i) => i.id === ids[0]) : undefined
      // Shift + drag of one stack: choose how many first (INV-LOOT §5).
      if (ev.shiftKey && only && only.kind === 'stack' && only.quantity > 1) openPopup({ kind: 'quantity', panel, source: view.key, instanceId: only.id, destination: key, x: ev.clientX / scale, y: ev.clientY / scale })
      else transfer(view.key, key, ids)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  const onDouble = (row: Row) => onActivate(row.instanceIds)
  const onMenu = (row: Row, e: MouseEvent) => {
    const selection = table.selection.ids.has(row.id) ? table.selection : clickRow(table.selection, rows, row.id, { toggle: false, range: false })
    setSelection(selection)
    setFocusId(row.id)
    openPopup({ kind: 'menu', panel, source: view.key, instanceIds: selectedInstanceIds(selection, rows), ...at(e) })
  }
  // The hover card follows rows, not every mouse move: the store changes only when the row changes.
  const onHover = (row: Row | null, e?: MouseEvent) => {
    if ((row?.id ?? null) === hoverRow.current) return
    hoverRow.current = row?.id ?? null
    setHover(row && e ? { source: view.key as InventoryKey, instanceIds: row.instanceIds, ...at(e) } : null)
  }
  const onToggleGroup = (row: Row) => {
    const next = new Set(table.expanded)
    if (next.has(row.id)) next.delete(row.id)
    else next.add(row.id)
    patchTable(panel, { expanded: [...next] })
  }
  const latest = useRef({ onPointer, onDouble, onMenu, onHover, onToggleGroup })
  useEffect(() => {
    latest.current = { onPointer, onDouble, onMenu, onHover, onToggleGroup }
  })
  // Same functions every render, so memoized rows re-render only when their own row or state changes.
  const stable = useMemo(() => ({
    onPointer: (row: Row, e: MouseEvent) => latest.current.onPointer(row, e),
    onDouble: (row: Row) => latest.current.onDouble(row),
    onMenu: (row: Row, e: MouseEvent) => latest.current.onMenu(row, e),
    onHover: (row: Row | null, e?: MouseEvent) => latest.current.onHover(row, e),
    onToggleGroup: (row: Row) => latest.current.onToggleGroup(row),
  }), [])
  const sortBy = (key: SortKey) => patchTable(panel, { sort: { key, dir: table.sort.key === key ? (table.sort.dir === 1 ? -1 : 1) : 1 } })

  const onKeyDown = (e: KeyboardEvent) => {
    if (rows.length === 0) return
    const index = Math.max(0, rows.findIndex((r) => r.id === focusId))
    const moveTo = (i: number) => {
      const row = rows[Math.max(0, Math.min(rows.length - 1, i))]
      setFocusId(row.id)
      setSelection(clickRow(table.selection, rows, row.id, { toggle: false, range: e.shiftKey }))
      const el = listRef.current
      const top = rows.indexOf(row) * ROW_H
      if (el && top < el.scrollTop) el.scrollTop = top
      else if (el && top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight
    }
    if (e.key === 'ArrowDown') moveTo(focusId === null ? 0 : index + 1)
    else if (e.key === 'ArrowUp') moveTo(index - 1)
    else if (e.key === 'Home') moveTo(0)
    else if (e.key === 'End') moveTo(rows.length - 1)
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') setSelection(selectAll(rows))
    else if (e.key === 'Enter') onActivate(selectedInstanceIds(table.selection, rows))
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      const el = listRef.current?.querySelector(`[data-row-id="${CSS.escape(rows[index].id)}"]`)
      const box = el?.getBoundingClientRect()
      openPopup({ kind: 'menu', panel, source: view.key, instanceIds: selectedInstanceIds(table.selection, rows), x: (box?.left ?? 0) / scale + 24, y: (box?.bottom ?? 0) / scale })
    } else return
    e.preventDefault()
  }

  const count = table.selection.ids.size
  const virtual = rows.length > VIRTUAL_MIN_ROWS
  const start = virtual ? Math.max(0, Math.floor(scroll.top / ROW_H) - OVERSCAN) : 0
  const end = virtual ? Math.min(rows.length, Math.ceil((scroll.top + scroll.height) / ROW_H) + OVERSCAN) : rows.length
  return (
    <div className="inv-table" role="grid" aria-label={view.name} aria-multiselectable aria-rowcount={rows.length}>
      <div className="inv-thead" role="row">
        {COLUMNS.map((c) => (
          <button
            key={c.key}
            type="button"
            role="columnheader"
            className={`inv-th ${c.className}`}
            aria-sort={table.sort.key === c.key ? (table.sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
            onClick={() => sortBy(c.key)}
          >
            {c.label}
            {table.sort.key === c.key && <Glyph name={table.sort.dir === 1 ? 'up' : 'down'} />}
          </button>
        ))}
      </div>
      <div
        ref={listRef}
        data-drop-key={view.key}
        className={`inv-tbody${dropHere ? ' inv-drop-target' : ''}`}
        tabIndex={0}
        data-ui-keys
        onKeyDown={onKeyDown}
        onScroll={virtual ? (e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight }) : undefined}
        aria-label={count > 0 ? L.selected(count) : view.name}
      >
        {rows.length === 0 ? (
          <div className="inv-empty-state">{view.inventory.items.length === 0 ? emptyText : L.noResults}</div>
        ) : (
          <>
            {start > 0 && <div style={{ height: start * ROW_H }} aria-hidden />}
            {rows.slice(start, end).map((row) => (
              <ItemRowView key={row.id} row={row} selected={table.selection.ids.has(row.id)} focused={focusId === row.id} flags={flags} {...stable} />
            ))}
            {end < rows.length && <div style={{ height: (rows.length - end) * ROW_H }} aria-hidden />}
          </>
        )}
      </div>
    </div>
  )
}
