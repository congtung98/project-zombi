import { describe, expect, it } from 'vitest'
import {
  addItem,
  countItem,
  createInventory,
  removeFromSlot,
  removeItem,
  totalQuantity,
  transferAll,
  transferSlot,
} from './inventory'
import { ITEMS } from '../entities/items'

describe('addItem', () => {
  it('fills existing stacks before opening new slots and respects stackLimit', () => {
    const inv = createInventory(4)
    expect(addItem(inv, 'water', 3)).toEqual({ added: 3, remainder: 0 })
    expect(addItem(inv, 'water', 4)).toEqual({ added: 4, remainder: 0 })
    // water stackLimit = 5: ô 0 đầy 5, ô 1 có 2
    expect(inv.slots[0]).toMatchObject({ itemId: 'water', quantity: 5 })
    expect(inv.slots[1]).toMatchObject({ itemId: 'water', quantity: 2 })
    expect(inv.slots[2]).toBeNull()
  })

  it('reports the remainder instead of dropping items when the inventory is full', () => {
    const inv = createInventory(2)
    addItem(inv, 'medkit', 1) // stackLimit 1
    const r = addItem(inv, 'bandage', 5) // stackLimit 3
    expect(r).toEqual({ added: 3, remainder: 2 })
    expect(totalQuantity(inv)).toBe(4)
    expect(addItem(inv, 'water', 1)).toEqual({ added: 0, remainder: 1 })
  })

  it('ignores zero or negative quantities', () => {
    const inv = createInventory(2)
    expect(addItem(inv, 'water', 0)).toEqual({ added: 0, remainder: 0 })
    expect(addItem(inv, 'water', -3)).toEqual({ added: 0, remainder: 0 })
    expect(totalQuantity(inv)).toBe(0)
  })
})

describe('remove', () => {
  it('never goes negative and clears the slot at zero', () => {
    const inv = createInventory(2)
    addItem(inv, 'chips', 2)
    expect(removeFromSlot(inv, 0, 5)).toEqual({ removed: 2 })
    expect(inv.slots[0]).toBeNull()
    expect(removeFromSlot(inv, 0, 1)).toEqual({ removed: 0 })
    expect(removeFromSlot(inv, 1, 1)).toEqual({ removed: 0 })
  })

  it('removeItem spans multiple stacks and reports what was actually removed', () => {
    const inv = createInventory(3)
    addItem(inv, 'water', 7) // 5 + 2
    expect(countItem(inv, 'water')).toBe(7)
    expect(removeItem(inv, 'water', 6)).toEqual({ removed: 6 })
    expect(countItem(inv, 'water')).toBe(1)
    expect(removeItem(inv, 'water', 6)).toEqual({ removed: 1 })
    expect(countItem(inv, 'water')).toBe(0)
  })
})

describe('transfer', () => {
  it('moves a whole slot and keeps the total constant', () => {
    const a = createInventory(3)
    const b = createInventory(3)
    addItem(a, 'canned_food', 4)
    const before = totalQuantity(a) + totalQuantity(b)
    expect(transferSlot(a, 0, b)).toEqual({ moved: 4, remainder: 0 })
    expect(a.slots[0]).toBeNull()
    expect(b.slots[0]).toMatchObject({ itemId: 'canned_food', quantity: 4 })
    expect(totalQuantity(a) + totalQuantity(b)).toBe(before)
  })

  it('leaves the remainder in the source when the destination is full (no loss, no duplication)', () => {
    const src = createInventory(2)
    const dst = createInventory(1)
    addItem(src, 'water', 5)
    addItem(src, 'bandage', 2)
    addItem(dst, 'water', 3)

    const r = transferSlot(src, 0, dst) // chỉ còn 2 chỗ trong stack water của đích
    expect(r).toEqual({ moved: 2, remainder: 3 })
    expect(src.slots[0]).toMatchObject({ itemId: 'water', quantity: 3 })
    expect(dst.slots[0]).toMatchObject({ itemId: 'water', quantity: 5 })

    const all = transferAll(src, dst)
    expect(all.moved).toBe(0)
    expect(all.remainder).toBe(5)
    expect(totalQuantity(src) + totalQuantity(dst)).toBe(10)
  })

  it('transferAll fills a 12-slot bag and reports leftovers', () => {
    const container = createInventory(8)
    const bag = createInventory(12)
    for (const id of Object.keys(ITEMS) as (keyof typeof ITEMS)[]) addItem(container, id, ITEMS[id].stackLimit)
    const total = totalQuantity(container)
    const r = transferAll(container, bag)
    expect(r.moved).toBe(total)
    expect(r.remainder).toBe(0)
    expect(totalQuantity(container)).toBe(0)
    expect(totalQuantity(bag)).toBe(total)
  })

  it('can move a partial quantity', () => {
    const a = createInventory(1)
    const b = createInventory(1)
    addItem(a, 'soda', 4)
    expect(transferSlot(a, 0, b, 1)).toEqual({ moved: 1, remainder: 3 })
    expect(transferSlot(a, 0, b, 0)).toEqual({ moved: 0, remainder: 3 })
    expect(transferSlot(a, 0, b, 99)).toEqual({ moved: 3, remainder: 0 })
  })
})
