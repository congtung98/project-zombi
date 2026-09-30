import { describe, expect, it } from 'vitest'
import type { ItemInstance } from '../entities/items'
import { itemOptions, registerItemActions, type ItemActionQuery } from './itemActions'

/** AX2 (FB §6): an item offers what its components offer; no rule looks at its name or ID. */
const stack = (itemId: ItemInstance['itemId']): ItemInstance => ({ id: `main:${itemId}`, itemId, kind: 'stack', quantity: 2 })
const query = (item: ItemInstance, patch: Partial<ItemActionQuery> = {}): ItemActionQuery => ({
  item, source: 'main', equipment: { weaponInstanceId: null, backInstanceId: null }, reserved: false, benefits: () => true, canTake: true, ...patch,
})
const ids = (q: ItemActionQuery) => itemOptions(q).map((o) => (o.opensFirst ? `open+${o.id}` : o.id))

describe('item action registry (AX2)', () => {
  it('water drinks, a snack eats, a bandage heals, a sealed tin opens or opens then eats', () => {
    expect(ids(query(stack('water')))).toEqual(['drink'])
    expect(ids(query(stack('chips')))).toEqual(['eat'])
    expect(ids(query(stack('bandage')))).toEqual(['heal'])
    expect(ids(query(stack('canned_food')))).toEqual(['open', 'open+eat'])
    expect(ids(query(stack('canned_food_open')))).toEqual(['eat'])
    expect(ids(query(stack('nails')))).toEqual([])
  })

  it('a weapon equips and repairs from the main inventory; a bag is worn', () => {
    const bat: ItemInstance = { id: 'main:bat', itemId: 'baseball_bat', kind: 'weapon', quantity: 1, condition: 20 }
    expect(ids(query(bat, { repair: () => null }))).toEqual(['equip', 'repair'])
    expect(itemOptions(query(bat, { source: 'worn', repair: () => null })).map((o) => o.blocked)).toEqual(['not-main', 'not-main'])
    expect(ids(query(bat, { equipment: { weaponInstanceId: 'main:bat', backInstanceId: null } }))).toEqual(['unequip'])
    expect(itemOptions(query(bat, { repair: () => 'thiếu nguyên liệu' }))[1]).toEqual({ id: 'repair', blocked: 'repair', detail: 'thiếu nguyên liệu' })
    expect(ids(query({ id: 'main:p', itemId: 'backpack', kind: 'bag', quantity: 1 }))).toEqual(['wear'])
  })

  it('disabled options say why: reserved, nothing to restore, no room to take it from a container', () => {
    expect(itemOptions(query(stack('water'), { reserved: true }))[0].blocked).toBe('reserved')
    expect(itemOptions(query(stack('water'), { benefits: () => false }))[0].blocked).toBe('no-effect')
    expect(itemOptions(query(stack('water'), { source: 'container:x', canTake: false }))[0].blocked).toBe('full')
    expect(itemOptions(query(stack('water'), { source: 'container:x' }))[0].blocked).toBeNull()
  })

  it('an item this version does not know offers nothing; a provider is registered once', () => {
    expect(itemOptions(query({ id: 'x', itemId: 'unknown_item', kind: 'unknown', quantity: 1, raw: {} }))).toEqual([])
    expect(() => registerItemActions({ id: 'consumable', options: () => [] })).toThrow()
  })
})
