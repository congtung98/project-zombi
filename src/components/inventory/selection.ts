import type { Row } from './rows'

/**
 * Table selection by row ID (instance ID or `group:<itemId>`), never by list index, so a sort or a
 * filter never moves it to another item. `anchor` is where a Shift range starts.
 */
export interface Selection {
  ids: ReadonlySet<string>
  anchor: string | null
}

export const EMPTY_SELECTION: Selection = { ids: new Set(), anchor: null }

export interface ClickModifiers {
  /** Ctrl or Cmd: toggle the row. */
  toggle: boolean
  /** Shift: select the range from the anchor over the visible rows. */
  range: boolean
}

export function clickRow(sel: Selection, rows: readonly Row[], rowId: string, mods: ClickModifiers): Selection {
  if (mods.range && sel.anchor !== null) {
    const a = rows.findIndex((r) => r.id === sel.anchor)
    const b = rows.findIndex((r) => r.id === rowId)
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a]
      const ids = new Set(mods.toggle ? sel.ids : [])
      for (let i = lo; i <= hi; i++) ids.add(rows[i].id)
      return { ids, anchor: sel.anchor }
    }
  }
  if (mods.toggle) {
    const ids = new Set(sel.ids)
    if (ids.has(rowId)) ids.delete(rowId)
    else ids.add(rowId)
    return { ids, anchor: rowId }
  }
  return { ids: new Set([rowId]), anchor: rowId }
}

/** Ctrl+A in the table: every visible row (not the whole page). */
export function selectAll(rows: readonly Row[]): Selection {
  return { ids: new Set(rows.map((r) => r.id)), anchor: rows[0]?.id ?? null }
}

/** Drop selected rows that are gone (an item used up, moved away or filtered out). */
export function pruneSelection(sel: Selection, rows: readonly Row[]): Selection {
  const visible = new Set(rows.map((r) => r.id))
  let changed = false
  const ids = new Set<string>()
  for (const id of sel.ids) {
    if (visible.has(id)) ids.add(id)
    else changed = true
  }
  const anchor = sel.anchor !== null && visible.has(sel.anchor) ? sel.anchor : null
  return changed || anchor !== sel.anchor ? { ids, anchor } : sel
}

/**
 * The concrete instances a selection means, in visible order, each once: a group resolves to all of
 * its members (T05: a group of 4 bats is 4 IDs, never one stack), a member row to itself.
 */
export function selectedInstanceIds(sel: Selection, rows: readonly Row[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (!sel.ids.has(r.id)) continue
    for (const id of r.instanceIds) {
      if (seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
  }
  return out
}
