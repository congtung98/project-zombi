import { describe, expect, it } from 'vitest'
import { addItem, createInventory, type Inventory } from '../../game/systems/inventory'
import type { ItemInstance } from '../../game/entities/items'
import { buildRows, DEFAULT_QUERY, type RowQuery } from './rows'
import { clickRow, EMPTY_SELECTION, pruneSelection, selectAll, selectedInstanceIds } from './selection'
import { clampRect, defaultLayout, GRIP, isCompact, MIN_H, MIN_W, TITLE_H } from './layout'
import { menuEntries, type MenuContext } from './itemActions'
import { REFUSAL_LABEL, searchKey, summaryText } from './labels'

const weight = (i: ItemInstance) => i.quantity
const q = (patch: Partial<RowQuery> = {}): RowQuery => ({ ...DEFAULT_QUERY, ...patch })

function bagWith(): Inventory {
  const inv = createInventory(12, 'p', 'player')
  addItem(inv, 'water', 7) // two real stacks: 5 + 2
  for (const c of [10, 70, 30, 55]) addItem(inv, 'baseball_bat', 1, { condition: c })
  addItem(inv, 'canned_food', 1)
  addItem(inv, 'hammer', 1)
  return inv
}

describe('rows', () => {
  it('groups individual items of one kind but never real stacks; T05: a group of 4 is 4 IDs', () => {
    const inv = bagWith()
    const rows = buildRows(inv.items, q(), weight)
    const water = rows.filter((r) => r.name === 'Nước')
    expect(water).toHaveLength(2)
    const bats = rows.find((r) => r.kind === 'group')!
    expect(bats).toMatchObject({ id: 'group:baseball_bat', qty: 4 })
    expect(bats.instanceIds).toEqual(inv.items.filter((i) => i.itemId === 'baseball_bat').map((i) => i.id).sort())
    const sel = clickRow(EMPTY_SELECTION, rows, bats.id, { toggle: false, range: false })
    expect(selectedInstanceIds(sel, rows)).toHaveLength(4)
    // The hammer alone is not a group.
    expect(rows.find((r) => r.name === 'Búa')?.kind).toBe('item')
  })

  it('an expanded group lists each member with its own state after the group row', () => {
    const inv = bagWith()
    const rows = buildRows(inv.items, q({ expanded: new Set(['group:baseball_bat']) }), weight)
    const at = rows.findIndex((r) => r.id === 'group:baseball_bat')
    const members = rows.slice(at + 1, at + 5)
    expect(members.every((r) => r.kind === 'item' && r.groupId === 'group:baseball_bat')).toBe(true)
    expect(members.map((r) => (r.kind === 'item' && r.item.kind === 'weapon' ? r.item.condition : null)).sort()).toEqual([10, 30, 55, 70])
  })

  it('search ignores accents and case; category filter; empty results', () => {
    const inv = bagWith()
    expect(buildRows(inv.items, q({ search: 'NUOC' }), weight).map((r) => r.name)).toEqual(['Nước', 'Nước'])
    expect(buildRows(inv.items, q({ search: 'gay' }), weight).map((r) => r.id)).toEqual(['group:baseball_bat'])
    expect(buildRows(inv.items, q({ category: 'food' }), weight).map((r) => r.name)).toEqual(['Đồ hộp'])
    expect(buildRows(inv.items, q({ search: 'zzz' }), weight)).toEqual([])
    expect(searchKey('Đồ hộp')).toBe('do hop')
  })

  it('sorts stably: equal keys keep instance-ID order in both directions of other keys', () => {
    const inv = createInventory(12, 'p', 'player')
    for (let n = 0; n < 5; n++) inv.items.push({ id: `p:${9 - n}`, itemId: 'medkit', kind: 'stack', quantity: 1 })
    const asc = buildRows(inv.items, q({ sort: { key: 'qty', dir: 1 } }), weight).map((r) => r.id)
    const desc = buildRows(inv.items, q({ sort: { key: 'qty', dir: -1 } }), weight).map((r) => r.id)
    expect(asc).toEqual(['p:5', 'p:6', 'p:7', 'p:8', 'p:9'])
    expect(desc).toEqual(asc)
    const byWeight = buildRows(bagWith().items, q({ sort: { key: 'weight', dir: -1 } }), weight).map((r) => r.weight)
    expect(byWeight).toEqual([...byWeight].sort((a, b) => b - a))
  })
})

describe('selection', () => {
  const rows = buildRows(bagWith().items, q(), weight)
  it('click, Ctrl toggle, Shift range over visible rows, Ctrl+A, prune', () => {
    let sel = clickRow(EMPTY_SELECTION, rows, rows[1].id, { toggle: false, range: false })
    expect([...sel.ids]).toEqual([rows[1].id])
    sel = clickRow(sel, rows, rows[3].id, { toggle: false, range: true })
    expect([...sel.ids]).toEqual([rows[1].id, rows[2].id, rows[3].id])
    sel = clickRow(sel, rows, rows[2].id, { toggle: true, range: false })
    expect(sel.ids.has(rows[2].id)).toBe(false)
    expect(selectAll(rows).ids.size).toBe(rows.length)
    const pruned = pruneSelection(selectAll(rows), rows.slice(0, 2))
    expect([...pruned.ids]).toEqual([rows[0].id, rows[1].id])
    expect(pruneSelection(pruned, rows.slice(0, 2))).toBe(pruned)
  })

  it('a group and one of its members selected resolve to each instance once', () => {
    const inv = bagWith()
    const open = buildRows(inv.items, q({ expanded: new Set(['group:baseball_bat']) }), weight)
    const group = open.find((r) => r.kind === 'group')!
    const member = open.find((r) => r.kind === 'item' && r.groupId === group.id)!
    const sel = { ids: new Set([group.id, member.id]), anchor: null }
    expect(selectedInstanceIds(sel, open)).toEqual(group.instanceIds)
  })
})

describe('layout', () => {
  it('1920×1080: two ~480×360 windows at the top, loot below the clock, crafting under inventory', () => {
    const view = { w: 1920, h: 1080 }
    const l = defaultLayout(view, { top: 0, left: 0, right: 0, bottom: 0, topRight: 96, bottomLeft: 880 })
    expect(l.inventory).toEqual({ x: 16, y: 16, w: 480, h: 360 })
    expect(l.loot).toMatchObject({ x: 1920 - 16 - 480, y: 112, w: 480 })
    expect(l.crafting.y).toBe(16 + 360 + 16)
    expect(l.crafting.y + l.crafting.h).toBeLessThanOrEqual(880)
  })

  it('1366×768 and 125 % / 150 % scale: both fit side by side; narrow views switch to one window', () => {
    for (const scale of [1, 1.25, 1.5]) {
      const view = { w: 1366 / scale, h: 768 / scale }
      const l = defaultLayout(view)
      expect(l.inventory.x + l.inventory.w).toBeLessThan(l.loot.x)
      expect(l.loot.x + l.loot.w).toBeLessThanOrEqual(view.w)
      expect(l.inventory.h).toBeLessThanOrEqual(view.h * 0.75)
      expect(isCompact(view)).toBe(false)
    }
    expect(isCompact({ w: 1024 / 1.5, h: 600 })).toBe(true)
    // Compact: below the clock, above the stats, full width, never under the top-right HUD.
    const view = { w: 1024 / 1.5, h: 640 / 1.5 }
    const c = defaultLayout(view, { top: 0, left: 0, right: 0, bottom: 0, topRight: 60, bottomLeft: 330 }).compact
    expect(c).toMatchObject({ x: 16, y: 76, w: Math.round(view.w - 32) })
    expect(c.y + c.h).toBeLessThanOrEqual(330 - 16)
  })

  it('clamp keeps a grip of the title bar on screen and the size within bounds', () => {
    const view = { w: 1000, h: 700 }
    expect(clampRect({ x: 5000, y: 5000, w: 10, h: 10 }, view)).toEqual({ x: 1000 - GRIP, y: 700 - TITLE_H, w: MIN_W, h: MIN_H })
    expect(clampRect({ x: -5000, y: -50, w: 480, h: 5000 }, view)).toEqual({ x: GRIP - 480, y: 0, w: 480, h: 525 })
  })
})

describe('context menu by capability', () => {
  const inv = bagWith()
  const box = createInventory(8, 'box')
  const worn = createInventory(8, 'bag:x', 'bag')
  const bat = inv.items.find((i) => i.itemId === 'baseball_bat')!
  const water = inv.items.find((i) => i.itemId === 'water')!
  const base = (patch: Partial<MenuContext>): MenuContext => ({
    source: 'main', items: [water], equipment: { weaponInstanceId: bat.id, backInstanceId: null },
    destinations: [{ key: 'container:box', name: 'Tủ', inventory: box }, { key: 'worn', name: 'Balo', inventory: worn }],
    isReserved: () => false, useBlock: () => null, repairBlock: () => undefined, ...patch,
  })
  const byKey = (ctx: MenuContext) => Object.fromEntries(menuEntries(ctx).map((e) => [e.key, e]))

  it('an equipped weapon: unequip, transfers and drop disabled with the reason', () => {
    const m = byKey(base({ items: [bat], repairBlock: () => null }))
    expect(m.unequip.disabled).toBeNull()
    expect(m.repair.disabled).toBeNull()
    expect(m['transfer:container:box']).toMatchObject({ label: 'Cất vào Tủ', disabled: REFUSAL_LABEL.equipped })
    expect(m.drop.disabled).toBe(REFUSAL_LABEL.equipped)
    expect(m.inspect.disabled).toBeNull()
  })

  it('a drink: Uống from what is carried only; in a container it must be taken first', () => {
    expect(byKey(base({})).drink.disabled).toBeNull()
    expect(byKey(base({ useBlock: () => REFUSAL_LABEL['no-effect'] })).drink.disabled).toBe(REFUSAL_LABEL['no-effect'])
    const fromBox = byKey(base({ source: 'container:box', destinations: [{ key: 'main', name: 'Túi chính', inventory: inv }] }))
    expect(fromBox.drink.disabled).toBe(REFUSAL_LABEL['not-carried'])
    expect(fromBox['transfer:main'].label).toBe('Lấy vào Túi chính')
    expect(fromBox.drop).toBeUndefined()
    expect(fromBox.favorite).toBeUndefined()
  })

  it('a favorite cannot be stored or dropped but moves inside what is carried; a bag never goes into the bag', () => {
    const fav: ItemInstance = { ...water, favorite: true }
    const m = byKey(base({ items: [fav] }))
    expect(m['transfer:container:box'].disabled).toBe(REFUSAL_LABEL.favorite)
    expect(m['transfer:worn'].disabled).toBeNull()
    expect(m.drop.disabled).toBe(REFUSAL_LABEL.favorite)
    expect(m.unfavorite.disabled).toBeNull()
    const pack: ItemInstance = { id: 'p:bag', itemId: 'backpack', kind: 'bag', quantity: 1 }
    expect(byKey(base({ items: [pack] }))['transfer:worn'].disabled).toBe(REFUSAL_LABEL['bag-in-bag'])
    expect(byKey(base({ items: [pack] })).wear.disabled).toBeNull()
  })

  it('several items: transfer counts what can go, disabled only when none can', () => {
    const m = byKey(base({ items: [bat, water] }))
    expect(m['transfer:container:box']).toMatchObject({ label: 'Cất vào Tủ (1/2)', disabled: null })
    expect(m.inspect).toBeUndefined()
    expect(m.equip).toBeUndefined()
  })

  it('batch summary text counts reasons once', () => {
    expect(summaryText(5, ['full', 'equipped', 'full'])).toBe(`Đã chuyển 5 · 3 món không chuyển: ${REFUSAL_LABEL.full} (2), ${REFUSAL_LABEL.equipped} (1).`)
    expect(summaryText(0, [])).toBe('Không chuyển được món nào.')
  })
})
