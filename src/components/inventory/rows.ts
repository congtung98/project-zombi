import { getItemDef, type ItemInstance, type ItemKind } from '../../game/entities/items'
import { CATEGORY_LABEL, searchKey } from './labels'

export type SortKey = 'name' | 'category' | 'qty' | 'weight'

export interface SortState {
  key: SortKey
  dir: 1 | -1
}

export type CategoryFilter = ItemKind | 'all'

export interface RowQuery {
  search: string
  category: CategoryFilter
  sort: SortState
  /** Group row IDs shown expanded. */
  expanded: ReadonlySet<string>
}

interface RowBase {
  /** Stable row ID: the instance ID, or `group:<itemId>` for a display group. */
  id: string
  name: string
  category: ItemKind
  /** Units shown (a stack's quantity, a group's number of instances). */
  qty: number
  /** Weight of the whole row in kg (a bag with its contents). */
  weight: number
  /** Real instances behind the row, in display order (a group resolves to all of its members). */
  instanceIds: string[]
}

export interface ItemRow extends RowBase {
  kind: 'item'
  item: ItemInstance
  /** Set when the row is a member shown under an expanded group. */
  groupId: string | null
}

/**
 * Display group of individual items of one definition (e.g. two bats of different condition). It
 * never merges them: each keeps its instance, state and slot (INV-LOOT §4.4).
 */
export interface GroupRow extends RowBase {
  kind: 'group'
  itemId: ItemInstance['itemId']
  items: ItemInstance[]
  expanded: boolean
}

export type Row = ItemRow | GroupRow

export const DEFAULT_QUERY: RowQuery = { search: '', category: 'all', sort: { key: 'name', dir: 1 }, expanded: new Set() }

const collator = new Intl.Collator('vi', { sensitivity: 'base', numeric: true })

function matches(item: ItemInstance, search: string, category: CategoryFilter): boolean {
  const def = getItemDef(item.itemId)
  if (category !== 'all' && def.kind !== category) return false
  if (!search) return true
  const key = searchKey(search.trim())
  return searchKey(def.name).includes(key) || searchKey(CATEGORY_LABEL[def.kind]).includes(key)
}

function compare(a: RowBase, b: RowBase, sort: SortState): number {
  let c = 0
  if (sort.key === 'name') c = collator.compare(a.name, b.name)
  else if (sort.key === 'category') c = collator.compare(CATEGORY_LABEL[a.category], CATEGORY_LABEL[b.category]) || collator.compare(a.name, b.name)
  else if (sort.key === 'qty') c = a.qty - b.qty
  else c = a.weight - b.weight
  // Stable: the first instance ID breaks every tie, so a sort never swaps two equal rows.
  return c * sort.dir || (a.instanceIds[0] < b.instanceIds[0] ? -1 : a.instanceIds[0] > b.instanceIds[0] ? 1 : 0)
}

/**
 * Rows of an inventory as the table shows them: filtered by category and search (accents ignored),
 * individual items of one definition grouped (≥ 2), sorted with the instance ID as tie-breaker.
 * Real stacks are never grouped: one row per stack, so a row never hides a slot.
 */
export function buildRows(items: readonly ItemInstance[], query: RowQuery, weightOf: (item: ItemInstance) => number): Row[] {
  const visible = items.filter((i) => matches(i, query.search, query.category))
  const singles = new Map<ItemInstance['itemId'], ItemInstance[]>()
  for (const i of visible) if (i.kind !== 'stack') singles.set(i.itemId, [...(singles.get(i.itemId) ?? []), i])
  const top: Row[] = []
  const itemRow = (item: ItemInstance, groupId: string | null): ItemRow => {
    const def = getItemDef(item.itemId)
    return { kind: 'item', id: item.id, item, groupId, name: def.name, category: def.kind, qty: item.quantity, weight: weightOf(item), instanceIds: [item.id] }
  }
  for (const i of visible) {
    const members = i.kind === 'stack' ? null : singles.get(i.itemId)!
    if (!members || members.length < 2) {
      top.push(itemRow(i, null))
      continue
    }
    if (members[0] !== i) continue
    const def = getItemDef(i.itemId)
    const ordered = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const id = `group:${i.itemId}`
    top.push({
      kind: 'group', id, itemId: i.itemId, items: ordered, expanded: query.expanded.has(id), name: def.name, category: def.kind,
      qty: ordered.length, weight: ordered.reduce((kg, m) => kg + weightOf(m), 0), instanceIds: ordered.map((m) => m.id),
    })
  }
  top.sort((a, b) => compare(a, b, query.sort))
  const rows: Row[] = []
  for (const r of top) {
    rows.push(r)
    if (r.kind === 'group' && r.expanded) for (const m of r.items) rows.push(itemRow(m, r.id))
  }
  return rows
}
