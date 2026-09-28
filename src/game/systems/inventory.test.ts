import { describe, expect, it } from 'vitest'
import {
  addItem,
  countItem,
  countUsedSlots,
  createInventory,
  freeSlots,
  isOvercapacity,
  previewTransfer,
  removeItem,
  removeQuantity,
  roomFor,
  slotView,
  totalQuantity,
  transferAll,
  transferItem,
  type Inventory,
} from './inventory'
import { ITEMS, type ItemId, type ItemInstance } from '../entities/items'
import { createRng } from './loot'
import { bagInventoryId, createBagContents, ensureBagContents, findUsable, inventoryWeight, itemWeight, usableInventories, type BagStore } from './bags'


describe('addItem', () => {
  it('fills existing stacks before opening new slots and respects stackLimit', () => {
    const inv = createInventory(4)
    expect(addItem(inv, 'water', 3)).toEqual({ added: 3, remainder: 0 })
    expect(addItem(inv, 'water', 4)).toEqual({ added: 4, remainder: 0 })
    // water stackLimit = 5: stack 1 full at 5, stack 2 holds 2; two of four slots used.
    expect(inv.items.map((i) => i.quantity)).toEqual([5, 2])
    expect(countUsedSlots(inv)).toBe(2)
    expect(freeSlots(inv)).toBe(2)
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

  it('never merges into a favorite stack (a favorite is its own stack)', () => {
    const inv = createInventory(3)
    addItem(inv, 'water', 2)
    const first = inv.items[0]
    if (first.kind === 'stack') first.favorite = true
    addItem(inv, 'water', 2)
    expect(inv.items.map((i) => [i.quantity, !!i.favorite])).toEqual([[2, true], [2, false]])
  })
})

describe('remove', () => {
  it('never goes negative and the instance leaves at zero', () => {
    const inv = createInventory(2)
    addItem(inv, 'chips', 2)
    const id = inv.items[0].id
    expect(removeQuantity(inv, id, 5)).toEqual({ removed: 2 })
    expect(inv.items).toHaveLength(0)
    expect(removeQuantity(inv, id, 1)).toEqual({ removed: 0 })
    expect(removeQuantity(inv, 'nobody', 1)).toEqual({ removed: 0 })
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
  it('T01: 3 of a stack of 10 nails: source 7, destination +3, the total is kept; the part gets a new ID', () => {
    const a = createInventory(3, 'a')
    const b = createInventory(3, 'b')
    addItem(a, 'nails', 10)
    const id = a.items[0].id
    expect(transferItem(a, id, b, 3)).toEqual({ moved: 3, remainder: 7, reason: null })
    expect(a.items).toEqual([expect.objectContaining({ id, quantity: 7 })])
    expect(b.items).toEqual([expect.objectContaining({ itemId: 'nails', quantity: 3 })])
    expect(b.items[0].id).not.toBe(id)
    expect(totalQuantity(a) + totalQuantity(b)).toBe(10)
  })

  it('moves a whole instance with its ID and keeps the total constant', () => {
    const a = createInventory(3)
    const b = createInventory(3)
    addItem(a, 'canned_food', 4)
    const id = a.items[0].id
    expect(transferItem(a, id, b)).toEqual({ moved: 4, remainder: 0, reason: null })
    expect(a.items).toHaveLength(0)
    expect(b.items).toEqual([expect.objectContaining({ id, itemId: 'canned_food', quantity: 4 })])
  })

  it('T02: a full destination still takes what merges into a stack with room', () => {
    const src = createInventory(2)
    const dst = createInventory(1)
    addItem(src, 'water', 5)
    addItem(dst, 'water', 3)
    expect(freeSlots(dst)).toBe(0)
    expect(previewTransfer(src, src.items[0].id, dst)).toEqual({ quantity: 2, reason: 'full' })
    expect(transferItem(src, src.items[0].id, dst)).toEqual({ moved: 2, remainder: 3, reason: 'full' })
    expect(countItem(dst, 'water')).toBe(5)
    expect(countItem(src, 'water')).toBe(3)
  })

  it('T03: a full destination that cannot merge takes nothing and says why; nothing is lost', () => {
    const src = createInventory(2)
    const dst = createInventory(1)
    addItem(src, 'bandage', 2)
    addItem(dst, 'water', 3)
    const before = [structuredClone(src), structuredClone(dst)]
    expect(transferItem(src, src.items[0].id, dst)).toEqual({ moved: 0, remainder: 2, reason: 'full' })
    expect([src, dst]).toEqual(before)
  })

  it('T04: two weapons of the same kind with different condition stay two instances', () => {
    const a = createInventory(3, 'a')
    const b = createInventory(3, 'b')
    addItem(a, 'baseball_bat', 1, { condition: 10 })
    addItem(a, 'baseball_bat', 1, { condition: 70 })
    transferAll(a, b)
    expect(b.items.map((i) => (i.kind === 'weapon' ? i.condition : null))).toEqual([10, 70])
    expect(new Set(b.items.map((i) => i.id)).size).toBe(2)
  })

  it('refuses self, missing, fractional and NaN requests without changing anything', () => {
    const a = createInventory(2, 'a')
    const b = createInventory(2, 'b')
    addItem(a, 'water', 3)
    const id = a.items[0].id
    const before = structuredClone(a)
    expect(transferItem(a, id, a).reason).toBe('same-inventory')
    expect(transferItem(a, 'nobody', b).reason).toBe('missing')
    expect(transferItem(a, id, b, Number.NaN).reason).toBe('invalid-quantity')
    expect(transferItem(a, id, b, 0).reason).toBe('invalid-quantity')
    expect(a).toEqual(before)
    // A fraction is floored, never split into a partial unit.
    expect(transferItem(a, id, b, 1.7).moved).toBe(1)
  })

  it('merges only stacks with the same favorite flag', () => {
    const a = createInventory(2, 'a')
    const b = createInventory(2, 'b')
    addItem(a, 'water', 2)
    addItem(b, 'water', 1)
    const fav = b.items[0]
    if (fav.kind === 'stack') fav.favorite = true
    transferItem(a, a.items[0].id, b)
    expect(b.items.map((i) => [i.quantity, !!i.favorite])).toEqual([[1, true], [2, false]])
  })

  it('transferAll leaves what does not fit and reports it', () => {
    const src = createInventory(3)
    const dst = createInventory(1)
    addItem(src, 'water', 5)
    addItem(src, 'bandage', 2)
    addItem(dst, 'water', 3)
    const r = transferAll(src, dst)
    expect(r).toMatchObject({ moved: 2, remainder: 5, reason: 'full' })
    expect(totalQuantity(src) + totalQuantity(dst)).toBe(10)
    expect(countItem(src, 'bandage')).toBe(2)
  })

  it('stack limits of every definition hold after any addItem', () => {
    const inv = createInventory(20)
    for (const id of Object.keys(ITEMS) as ItemId[]) addItem(inv, id, 7)
    for (const s of inv.items) expect(s.quantity).toBeLessThanOrEqual(ITEMS[s.itemId].stackLimit)
  })
})

describe('capacity and overcapacity', () => {
  it('an inventory over its limit keeps every item, never adds a slot, but may merge', () => {
    const inv = createInventory(2)
    // Older data kept as is (never truncated): three stacks in a 2-slot inventory.
    inv.items.push({ id: 'x:1', itemId: 'water', kind: 'stack', quantity: 2 }, { id: 'x:2', itemId: 'chips', kind: 'stack', quantity: 1 }, { id: 'x:3', itemId: 'soda', kind: 'stack', quantity: 1 })
    expect(isOvercapacity(inv)).toBe(true)
    expect(freeSlots(inv)).toBe(0)
    expect(addItem(inv, 'bandage', 1)).toEqual({ added: 0, remainder: 1 })
    expect(addItem(inv, 'water', 2)).toEqual({ added: 2, remainder: 0 })
    expect(inv.items).toHaveLength(3)
    // Taking out is always allowed.
    const out = createInventory(3)
    expect(transferItem(inv, 'x:3', out).moved).toBe(1)
    expect(isOvercapacity(inv)).toBe(false)
  })

  it('an unlimited inventory (null capacity) always has room', () => {
    const floor = createInventory(null, 'floor')
    for (let i = 0; i < 500; i++) addItem(floor, 'baseball_bat', 1)
    expect(floor.items).toHaveLength(500)
    expect(freeSlots(floor)).toBe(Infinity)
    expect(roomFor(floor, floor.items[0])).toBe(1)
  })

  it('slotView pads the list to the capacity for the slot grid', () => {
    const inv = createInventory(4)
    addItem(inv, 'water', 1)
    expect(slotView(inv).map((s) => s?.itemId ?? null)).toEqual(['water', null, null, null])
  })
})

describe('bags (INV-LOOT)', () => {
  const bag = (inv: Inventory, bags: BagStore) => {
    addItem(inv, 'backpack', 1)
    ensureBagContents(bags, inv)
    return inv.items.find((i) => i.kind === 'bag')!
  }

  it('T14: a bag never goes into a bag, including itself', () => {
    const bags: BagStore = new Map()
    const main = createInventory(12, 'player', 'player')
    const one = bag(main, bags)
    const two = bag(main, bags)
    const contents = bags.get(one.id)!
    expect(contents).toMatchObject({ id: bagInventoryId(one.id), kind: 'bag', slotCapacity: 8 })
    expect(transferItem(main, two.id, contents)).toMatchObject({ moved: 0, reason: 'bag-in-bag' })
    expect(transferItem(main, one.id, contents)).toMatchObject({ moved: 0, reason: 'bag-in-bag' })
    expect(addItem(contents, 'backpack', 1)).toEqual({ added: 0, remainder: 1 })
    expect(contents.items).toHaveLength(0)
  })

  it('a bag moves as one instance; its contents stay attached to it (no copy)', () => {
    const bags: BagStore = new Map()
    const main = createInventory(12, 'player', 'player')
    const shelf = createInventory(8, 'shelf')
    const b = bag(main, bags)
    addItem(bags.get(b.id)!, 'water', 3)
    expect(transferItem(main, b.id, shelf).moved).toBe(1)
    expect(shelf.items).toEqual([b])
    expect(countItem(bags.get(b.id)!, 'water')).toBe(3)
    expect(bags.size).toBe(1)
  })

  it('weight counts each instance once: a bag with its contents, never its contents again', () => {
    const bags: BagStore = new Map()
    const main = createInventory(12, 'player', 'player')
    addItem(main, 'water', 2) // 1.2 kg
    const b = bag(main, bags) // 0.8 kg
    addItem(bags.get(b.id)!, 'wood_plank', 3) // 6 kg
    expect(itemWeight(b, bags)).toBeCloseTo(6.8)
    expect(inventoryWeight(main, bags)).toBeCloseTo(8)
    expect(inventoryWeight(createBagContents(b), bags)).toBe(0)
  })

  it('usable inventories: main, then the worn bag only; a carried or dropped bag is not usable', () => {
    const bags: BagStore = new Map()
    const main = createInventory(12, 'player', 'player')
    const b = bag(main, bags)
    addItem(bags.get(b.id)!, 'water', 1)
    const water = bags.get(b.id)!.items[0].id
    const equipment = { weaponInstanceId: null, backInstanceId: null as string | null }
    expect(usableInventories(main, equipment, bags)).toEqual([main])
    expect(findUsable(main, equipment, bags, water)).toBeNull()
    equipment.backInstanceId = b.id
    expect(usableInventories(main, equipment, bags)).toEqual([main, bags.get(b.id)])
    expect(findUsable(main, equipment, bags, water)?.item.id).toBe(water)
    // Worn ID but the bag left the main inventory: not usable.
    transferItem(main, b.id, createInventory(8))
    expect(usableInventories(main, equipment, bags)).toEqual([main])
  })
})

describe('conservation under random operations (seeded)', () => {
  const ITEM_POOL: ItemId[] = ['water', 'nails', 'bandage', 'baseball_bat', 'canned_food', 'wood_plank']

  const totals = (invs: Inventory[]) => {
    const t: Record<string, number> = {}
    for (const inv of invs) for (const i of inv.items) t[i.itemId] = (t[i.itemId] ?? 0) + i.quantity
    return t
  }
  const allIds = (invs: Inventory[]) => invs.flatMap((inv) => inv.items.map((i: ItemInstance) => i.id))

  it('2 000 random transfers between 4 inventories never lose, create or duplicate an item', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = createRng(seed)
      const invs = [createInventory(12, 'p', 'player'), createInventory(8, 'c1'), createInventory(3, 'c2'), createInventory(null, 'f')]
      for (let n = 0; n < 30; n++) addItem(invs[Math.floor(rng() * 4)], ITEM_POOL[Math.floor(rng() * ITEM_POOL.length)], 1 + Math.floor(rng() * 12))
      const start = totals(invs)
      for (let step = 0; step < 100; step++) {
        const from = invs[Math.floor(rng() * 4)]
        const to = invs[Math.floor(rng() * 4)]
        if (from.items.length === 0) continue
        const item = from.items[Math.floor(rng() * from.items.length)]
        const qty = rng() < 0.3 ? undefined : 1 + Math.floor(rng() * item.quantity)
        const preview = previewTransfer(from, item.id, to, qty)
        const r = transferItem(from, item.id, to, qty)
        expect(r.moved).toBe(preview.quantity)
        expect(totals(invs)).toEqual(start)
        const ids = allIds(invs)
        expect(new Set(ids).size).toBe(ids.length)
        for (const inv of invs) {
          if (inv.slotCapacity !== null) expect(inv.items.length).toBeLessThanOrEqual(inv.slotCapacity)
          for (const i of inv.items) {
            expect(Number.isInteger(i.quantity) && i.quantity > 0 && i.quantity <= ITEMS[i.itemId].stackLimit).toBe(true)
          }
        }
      }
    }
  })
})
