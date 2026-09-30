import { describe, expect, it } from 'vitest'
import { EventBus, type GameEvents } from '../core/events'
import { createPlayerState } from '../entities/player'
import { addItem, cloneInventory, countItem, createInventory } from '../systems/inventory'
import { applyMutation, eventEffect, inventorySignature, type GameplayEffect } from './effects'

function setup() {
  const player = createPlayerState({ x: 0, y: 0, z: 0 })
  const events = new EventBus<GameEvents>()
  const bag = createInventory(12, 'bag', 'player')
  const box = createInventory(2, 'box', 'container')
  addItem(bag, 'water', 3)
  const fired: string[] = []
  events.on('item:used', () => fired.push('item:used'))
  return { player, events, bag, box, fired, env: { player, events } }
}

describe('applyMutation (AX1 gameplay effect transaction)', () => {
  it('applies every effect in order when all checks pass; stats clamp to their max', () => {
    const { player, bag, env, events, fired } = setup()
    player.thirst = 90
    const ran: string[] = []
    const r = applyMutation({
      effects: [
        { type: 'stat', stat: 'thirst', delta: 40 },
        { type: 'item.consume', inventory: bag, instanceId: bag.items[0].id, quantity: 1 },
        eventEffect('item:used', { itemId: 'water', name: 'Nước', effect: { thirst: 40 } }),
        { type: 'after', run: () => ran.push('after') },
      ],
    }, env)
    events.flush()
    expect(r).toEqual({ ok: true })
    expect(player.thirst).toBe(100)
    expect(countItem(bag, 'water')).toBe(2)
    expect(fired).toEqual(['item:used'])
    expect(ran).toEqual(['after'])
  })

  it('one failing check means nothing changes: no stat, no item, no event, no follow-up', () => {
    const { player, bag, env, events, fired } = setup()
    player.hunger = 20
    const ran: string[] = []
    const effects: GameplayEffect[] = [
      { type: 'stat', stat: 'hunger', delta: 35 },
      eventEffect('item:used', { itemId: 'water', name: 'Nước', effect: {} }),
      { type: 'after', run: () => ran.push('after') },
      { type: 'item.consume', inventory: bag, instanceId: 'missing', quantity: 1 },
    ]
    const r = applyMutation({ effects }, env)
    events.flush()
    expect(r).toEqual({ ok: false, failure: 'MISSING_ITEM', index: 3 })
    expect(player.hunger).toBe(20)
    expect(countItem(bag, 'water')).toBe(3)
    expect([fired, ran]).toEqual([[], []])
  })

  it('units taken twice from one instance are counted together (never pass one by one, fail together)', () => {
    const { bag, env } = setup()
    const id = bag.items[0].id
    const r = applyMutation({ effects: [
      { type: 'item.consume', inventory: bag, instanceId: id, quantity: 2 },
      { type: 'item.consume', inventory: bag, instanceId: id, quantity: 2 },
    ] }, env)
    expect(r.ok).toBe(false)
    expect(countItem(bag, 'water')).toBe(3)
  })

  it('a transfer moves exactly its units, or nothing when the destination no longer has room', () => {
    const { bag, box, env } = setup()
    const id = bag.items[0].id
    expect(applyMutation({ effects: [{ type: 'item.transfer', from: bag, to: box, instanceId: id, quantity: 2 }] }, env)).toEqual({ ok: true })
    expect([countItem(bag, 'water'), countItem(box, 'water')]).toEqual([1, 2])
    addItem(box, 'wood_plank', 1)
    addItem(bag, 'nails', 5)
    const nails = bag.items.find((i) => i.itemId === 'nails')!.id
    const r = applyMutation({ effects: [{ type: 'item.transfer', from: bag, to: box, instanceId: nails, quantity: 5 }] }, env)
    expect(r).toMatchObject({ ok: false, failure: 'TARGET_CHANGED' })
    expect(countItem(bag, 'nails')).toBe(5)
  })

  it('an inventory prepared on a copy is refused when the live one changed meanwhile', () => {
    const { bag, env } = setup()
    const base = inventorySignature(bag)
    const items = cloneInventory(bag).items
    items[0].quantity = 1
    const nextItemId = bag.nextItemId
    addItem(bag, 'water', 1)
    const r = applyMutation({ effects: [{ type: 'inventory.write', inventory: bag, base, items, nextItemId }] }, env)
    expect(r).toMatchObject({ ok: false, failure: 'TARGET_CHANGED' })
    expect(countItem(bag, 'water')).toBe(4)
    const fresh = inventorySignature(bag)
    expect(applyMutation({ effects: [{ type: 'inventory.write', inventory: bag, base: fresh, items, nextItemId }] }, env)).toEqual({ ok: true })
    expect(countItem(bag, 'water')).toBe(1)
  })
})
