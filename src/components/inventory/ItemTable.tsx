import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { getItemDef, type ItemInstance } from '../../game/entities/items'
import { conditionLevel } from '../../game/systems/weapons'
import type { InventoryKey } from '../../game/systems/inventoryCommands'
import { useInventoryStore, type InventoryView } from '../../stores/inventoryStore'
import { useRows } from './tableData'
import { useInventoryUiStore, type PanelId } from '../../stores/inventoryUiStore'
import type { Row, SortKey } from './rows'
import { clickRow, pruneSelection, selectAll, selectedInstanceIds, type Selection } from './selection'
import { CATEGORY_LABEL, L } from './labels'
import { Glyph, ItemIcon } from './ItemIcon'

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

const kg = (n: number) => (n < 0.1 && n > 0 ? n.toFixed(2) : n.toFixed(1))

interface RowFlags {
  weaponId: string | null
  backId: string | null
  reserved: ReadonlySet<string>
}

function Badges({ item, flags }: { item: ItemInstance; flags: RowFlags }) {
  const level = item.kind === 'weapon' ? conditionLevel(item.itemId, item.condition) : null
  return (
    <>
      {item.id === flags.weaponId && <span className="inv-badge inv-badge-eq" title={L.equippedWeapon}>{L.equippedWeapon}</span>}
      {item.id === flags.backId && <span className="inv-badge inv-badge-eq" title={L.wornBag}>{L.wornBag}</span>}
      {item.favorite && <span className="inv-badge inv-badge-fav" title={L.favorite} aria-label={L.favorite}>★</span>}
      {flags.reserved.has(item.id) && <span className="inv-badge inv-badge-use">{L.reserved}</span>}
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
  const { patchTable, openPopup, setHover } = useInventoryUiStore.getState()
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
  const flags = useMemo<RowFlags>(() => ({ weaponId, backId, reserved: new Set(reservedIds ?? []) }), [weaponId, backId, reservedIds])

  // Items used up or moved away leave the selection (and the hover card).
  useEffect(() => {
    const pruned = pruneSelection(table.selection, rows)
    if (pruned !== table.selection) patchTable(panel, { selection: pruned })
  }, [rows, table.selection, panel, patchTable])

  const setSelection = (selection: Selection) => patchTable(panel, { selection })
  const at = (e: MouseEvent) => ({ x: e.clientX / scale, y: e.clientY / scale })

  const onPointer = (row: Row, e: MouseEvent) => {
    setFocusId(row.id)
    listRef.current?.focus({ preventScroll: true })
    setSelection(clickRow(table.selection, rows, row.id, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey }))
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
        className="inv-tbody"
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
