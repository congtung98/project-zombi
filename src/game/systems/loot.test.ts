import { describe, expect, it } from 'vitest'
import { createRng, generateContainerLoot, hashSeed, rollLoot, type LootTable } from './loot'
import { countItem, totalQuantity } from './inventory'
import { LOOT_TABLES } from '../world/lootTables'
import { NEIGHBORHOOD_MAP } from '../world/mapData'
import { createWorldState } from '../world/worldState'
import { ITEMS } from '../entities/items'

const table: LootTable = {
  id: 't',
  guaranteed: [{ itemId: 'water', min: 1, max: 2 }],
  rolls: 3,
  pool: [
    { itemId: 'chips', weight: 2, min: 1, max: 3 },
    { itemId: 'bandage', weight: 1, min: 1, max: 1 },
    { itemId: null, weight: 1, min: 0, max: 0 },
  ],
}

describe('createRng', () => {
  it('is deterministic per seed and stays within [0, 1)', () => {
    const a = createRng(42)
    const b = createRng(42)
    const c = createRng(43)
    const seqA = Array.from({ length: 5 }, () => a())
    const seqB = Array.from({ length: 5 }, () => b())
    const seqC = Array.from({ length: 5 }, () => c())
    expect(seqA).toEqual(seqB)
    expect(seqA).not.toEqual(seqC)
    for (const v of seqA) expect(v >= 0 && v < 1).toBe(true)
  })
})

describe('rollLoot', () => {
  it('always includes guaranteed entries and keeps quantities within bounds', () => {
    for (let seed = 0; seed < 50; seed++) {
      const stacks = rollLoot(table, createRng(seed))
      const water = stacks.filter((s) => s.itemId === 'water')
      expect(water.length).toBe(1)
      expect(water[0].quantity).toBeGreaterThanOrEqual(1)
      expect(water[0].quantity).toBeLessThanOrEqual(2)
      for (const s of stacks) {
        expect(s.quantity).toBeGreaterThan(0)
        if (s.itemId === 'chips') expect(s.quantity).toBeLessThanOrEqual(3)
        if (s.itemId === 'bandage') expect(s.quantity).toBe(1)
      }
      expect(stacks.length).toBeLessThanOrEqual(1 + table.rolls)
    }
  })

  it('produces different results for different seeds', () => {
    const results = new Set<string>()
    for (let seed = 0; seed < 20; seed++) results.add(JSON.stringify(rollLoot(table, createRng(seed))))
    expect(results.size).toBeGreaterThan(1)
  })
})

describe('generateContainerLoot', () => {
  it('is identical for the same world seed and container id, and empty without a table', () => {
    const a = generateContainerLoot(table, 123, 'ct-1', 8)
    const b = generateContainerLoot(table, 123, 'ct-1', 8)
    expect(a).toEqual(b)
    expect(hashSeed(123, 'ct-1')).not.toBe(hashSeed(123, 'ct-2'))
    expect(totalQuantity(generateContainerLoot(undefined, 123, 'ct-1', 8))).toBe(0)
  })

  it('never exceeds the container slot count', () => {
    const rich: LootTable = { id: 'rich', guaranteed: [], rolls: 30, pool: [{ itemId: 'medkit', weight: 1, min: 1, max: 1 }] }
    const inv = generateContainerLoot(rich, 7, 'x', 4)
    expect(inv.slots.length).toBe(4)
    expect(totalQuantity(inv)).toBe(4)
  })
})

describe('world loot on the neighborhood map', () => {
  it('every container references an existing loot table', () => {
    for (const c of NEIGHBORHOOD_MAP.containers) {
      expect(c.loot, c.id).toBeDefined()
      expect(LOOT_TABLES[c.loot!], c.id).toBeDefined()
    }
  })

  it('generates loot once per game and independently of open order', () => {
    const w1 = createWorldState(NEIGHBORHOOD_MAP, 999)
    const w2 = createWorldState(NEIGHBORHOOD_MAP, 999)
    const w3 = createWorldState(NEIGHBORHOOD_MAP, 1000)
    let differs = false
    for (const c of NEIGHBORHOOD_MAP.containers) {
      expect(w1.containers.get(c.id)!.items).toEqual(w2.containers.get(c.id)!.items)
      if (JSON.stringify(w1.containers.get(c.id)!.items) !== JSON.stringify(w3.containers.get(c.id)!.items)) differs = true
    }
    expect(differs).toBe(true)
  })

  it('the safe house always holds water, food and a bandage (no unwinnable start)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const w = createWorldState(NEIGHBORHOOD_MAP, seed * 7919)
      const cabinet = w.containers.get('c-1_-1/safehouse/cabinet')!.items
      expect(countItem(cabinet, 'water')).toBeGreaterThanOrEqual(1)
      expect(countItem(cabinet, 'canned_food')).toBeGreaterThanOrEqual(1)
      expect(countItem(cabinet, 'bandage')).toBeGreaterThanOrEqual(1)
    }
  })

  it('loot only contains defined items within stack limits', () => {
    const w = createWorldState(NEIGHBORHOOD_MAP, 31337)
    for (const c of w.containers.values()) {
      for (const s of c.items.slots) {
        if (!s) continue
        expect(ITEMS[s.itemId]).toBeDefined()
        expect(s.quantity).toBeLessThanOrEqual(ITEMS[s.itemId].stackLimit)
      }
    }
  })
})
