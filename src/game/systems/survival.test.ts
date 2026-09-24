import { describe, expect, it } from 'vitest'
import { damagePlayer, tickSurvival, consumeInventoryItem } from './survival'
import { addItem } from './inventory'
import { createPlayerState } from '../entities/player'
import { GAME_CONFIG } from '../core/config'

describe('tickSurvival', () => {
  it('decreases hunger and thirst over time and clamps at zero', () => {
    const p = createPlayerState({ x: 0, y: 0, z: 0 })
    tickSurvival(p, 60)
    expect(p.hunger).toBeCloseTo(100 - GAME_CONFIG.survival.hungerPerSec * 60)
    expect(p.thirst).toBeCloseTo(100 - GAME_CONFIG.survival.thirstPerSec * 60)
    tickSurvival(p, 100000)
    expect(p.hunger).toBe(0)
    expect(p.thirst).toBe(0)
  })

  it('reports starvation damage only when a stat is at zero', () => {
    const p = createPlayerState({ x: 0, y: 0, z: 0 })
    expect(tickSurvival(p, 1)).toBe(0)
    p.hunger = 0
    p.thirst = 50
    expect(tickSurvival(p, 1)).toBeCloseTo(GAME_CONFIG.survival.starvationDamagePerSec)
    p.thirst = 0
    expect(tickSurvival(p, 1)).toBeCloseTo(GAME_CONFIG.survival.starvationDamagePerSec * 2)
  })
})

describe('damagePlayer', () => {
  it('reduces health, clamps at zero and reports death once', () => {
    const p = createPlayerState({ x: 0, y: 0, z: 0 })
    expect(damagePlayer(p, 30)).toBe(false)
    expect(p.health).toBe(70)
    expect(damagePlayer(p, 100)).toBe(true)
    expect(p.health).toBe(0)
    expect(p.alive).toBe(false)
    expect(damagePlayer(p, 10)).toBe(false)
  })
})

describe('consumeInventoryItem', () => {
  function playerWith(itemId: 'water' | 'bandage' | 'chips' | 'soda', qty: number) {
    const p = createPlayerState({ x: 0, y: 0, z: 0 })
    addItem(p.inventory, itemId, qty)
    return p
  }

  it('restores the stat, clamps at max and consumes exactly one item', () => {
    const p = playerWith('water', 2)
    p.thirst = 80
    const r = consumeInventoryItem(p, 0)
    expect(r.ok).toBe(true)
    expect(p.thirst).toBe(100)
    expect(p.inventory.slots[0]).toEqual({ itemId: 'water', quantity: 1 })
  })

  it('does not consume the item when it would have no effect', () => {
    const p = playerWith('bandage', 1)
    const r = consumeInventoryItem(p, 0)
    expect(r).toEqual({ ok: false, reason: 'no-effect', itemId: 'bandage' })
    expect(p.inventory.slots[0]).toEqual({ itemId: 'bandage', quantity: 1 })
    p.health = 50
    expect(consumeInventoryItem(p, 0).ok).toBe(true)
    expect(p.health).toBe(75)
    expect(p.inventory.slots[0]).toBeNull()
  })

  it('fails on an empty slot and never creates a negative quantity', () => {
    const p = playerWith('chips', 1)
    p.hunger = 10
    expect(consumeInventoryItem(p, 0).ok).toBe(true)
    expect(consumeInventoryItem(p, 0)).toEqual({ ok: false, reason: 'empty' })
    expect(consumeInventoryItem(p, 5)).toEqual({ ok: false, reason: 'empty' })
    expect(p.hunger).toBe(25)
  })

  it('applies side effects and multi-stat items with clamping at zero', () => {
    const p = playerWith('chips', 1)
    p.hunger = 50
    p.thirst = 2
    consumeInventoryItem(p, 0)
    expect(p.hunger).toBe(65)
    expect(p.thirst).toBe(0)

    const q = playerWith('soda', 1)
    q.stamina = 95
    consumeInventoryItem(q, 0)
    expect(q.stamina).toBe(100)
    expect(q.thirst).toBe(100)
  })

  it('a dead player cannot use items', () => {
    const p = playerWith('bandage', 1)
    p.health = 0
    p.alive = false
    expect(consumeInventoryItem(p, 0)).toEqual({ ok: false, reason: 'dead', itemId: 'bandage' })
    expect(p.inventory.slots[0]?.quantity).toBe(1)
  })
})
