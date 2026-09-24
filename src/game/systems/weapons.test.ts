import { describe, expect, it } from 'vitest'
import { GAME_CONFIG } from '../core/config'
import { ITEMS, ITEM_IDS, type ItemId } from '../entities/items'
import { addItem, createInventory } from './inventory'
import { applyWeaponWear, conditionLevel, isUsableTool, meleeStats, weaponHitDamage, type WeaponInstance } from './weapons'
import { generateContainerLoot } from './loot'
import { LOOT_TABLES } from '../world/lootTables'
import { NEIGHBORHOOD_MAP } from '../world/mapData'
import legacyFixture from './fixtures/phase1-v1.json'

const WEAPONS: ItemId[] = ['baseball_bat', 'metal_pipe', 'crowbar', 'hammer']

function weapon(itemId: ItemId, condition: number): WeaponInstance {
  const inv = createInventory(1, 't')
  addItem(inv, itemId, 1, { condition })
  return inv.slots[0] as WeaponInstance
}

describe('melee definitions', () => {
  it('every weapon is a non-stacking instance type with stats and a max condition', () => {
    expect(ITEM_IDS.filter((id) => ITEMS[id].kind === 'weapon').sort()).toEqual([...WEAPONS].sort())
    for (const id of WEAPONS) {
      const def = ITEMS[id]
      expect(def.stackLimit).toBe(1)
      expect(def.maxCondition).toBeGreaterThan(0)
      expect(def.melee!.cooldown).toBeGreaterThanOrEqual(GAME_CONFIG.melee.swingDuration)
    }
  })

  it('the bat keeps the soak-balanced Phase 1 numbers; roles differ in hits-to-kill, speed and durability', () => {
    const { damage, range, cooldown, stamina } = GAME_CONFIG.melee
    expect(meleeStats('baseball_bat')).toEqual({ damage, range, cooldown, stamina })
    const hp = GAME_CONFIG.zombie.health
    const hitsToKill = (id: ItemId) => Math.ceil(hp / meleeStats(id).damage)
    expect(WEAPONS.map(hitsToKill)).toEqual([2, 2, 2, 3])
    // Heavier weapons are slower/costlier but last longer; the hammer is a tool first.
    expect(meleeStats('crowbar').cooldown).toBeGreaterThan(meleeStats('baseball_bat').cooldown)
    expect(ITEMS.crowbar.maxCondition!).toBeGreaterThan(ITEMS.metal_pipe.maxCondition!)
    expect(ITEMS.metal_pipe.maxCondition!).toBeGreaterThan(ITEMS.baseball_bat.maxCondition!)
    expect(meleeStats('hammer').range).toBeLessThan(GAME_CONFIG.zombie.attackRange)
  })
})

describe('condition rules', () => {
  it('condition > 0 deals full damage; broken deals 20% rounded, minimum 1', () => {
    expect(weaponHitDamage('baseball_bat', 80)).toBe(25)
    expect(weaponHitDamage('baseball_bat', 1)).toBe(25)
    expect(weaponHitDamage('baseball_bat', 0)).toBe(5)
    expect(weaponHitDamage('hammer', 0)).toBe(4)
    expect(weaponHitDamage('crowbar', 0)).toBe(6)
    expect(weaponHitDamage('hammer', 0, { ...GAME_CONFIG.weapon, brokenDamageRatio: 0.01 })).toBe(1)
  })

  it('wear is paid once per attackId; condition 1 → 0 breaks exactly once and never goes negative', () => {
    const bat = weapon('baseball_bat', 2)
    const ledger = { lastWornAttackId: 0 }
    expect(applyWeaponWear(bat, 1, ledger)).toEqual({ worn: 1, broke: false, becameLow: false })
    expect(applyWeaponWear(bat, 1, ledger)).toEqual({ worn: 0, broke: false, becameLow: false })
    expect(bat.condition).toBe(1)
    expect(applyWeaponWear(bat, 2, ledger)).toEqual({ worn: 1, broke: true, becameLow: false })
    expect(applyWeaponWear(bat, 3, ledger)).toEqual({ worn: 0, broke: false, becameLow: false })
    expect(bat.condition).toBe(0)
  })

  it('warns once when crossing into ≤ 25% and derives broken from condition only', () => {
    const bat = weapon('baseball_bat', 21)
    const ledger = { lastWornAttackId: 0 }
    expect(conditionLevel('baseball_bat', 21)).toBe('ok')
    expect(applyWeaponWear(bat, 1, ledger).becameLow).toBe(true)
    expect(conditionLevel('baseball_bat', bat.condition)).toBe('low')
    expect(applyWeaponWear(bat, 2, ledger).becameLow).toBe(false)
    bat.condition = 0
    expect(conditionLevel('baseball_bat', 0)).toBe('broken')
    bat.condition = 30 // a later repair clears the broken state with no extra flag to reset
    expect(conditionLevel('baseball_bat', bat.condition)).toBe('ok')
    expect(weaponHitDamage('baseball_bat', bat.condition)).toBe(25)
  })

  it('tool requirements need the capability and condition > 0; a broken hammer never qualifies', () => {
    expect(isUsableTool(weapon('hammer', 1), 'hammer')).toBe(true)
    expect(isUsableTool(weapon('hammer', 0), 'hammer')).toBe(false)
    expect(isUsableTool(weapon('crowbar', 10), 'pry')).toBe(true)
    expect(isUsableTool(weapon('crowbar', 10), 'hammer')).toBe(false)
    expect(isUsableTool(weapon('baseball_bat', 80), 'hammer')).toBe(false)
    expect(isUsableTool(null, 'hammer')).toBe(false)
  })

  it('new instances clamp the requested condition into [0, max]', () => {
    expect(weapon('baseball_bat', 999).condition).toBe(80)
    expect(weapon('baseball_bat', -5).condition).toBe(0)
    const inv = createInventory(1, 'x')
    addItem(inv, 'hammer', 1)
    expect(inv.slots[0]).toMatchObject({ kind: 'weapon', condition: 100 })
  })
})

describe('melee loot distribution', () => {
  const seeds = Array.from({ length: 400 }, (_, i) => (i * 2654435761) >>> 0)
  const slots = GAME_CONFIG.inventory.containerSlots
  const loot = (table: string, seed: number, id: string) => generateContainerLoot(LOOT_TABLES[table], seed, id, slots)

  it('every seed has exactly one basic melee in the starting closet and a usable hammer on the tool shelf', () => {
    const starters = new Set<string>()
    const conditions = new Set<number>()
    for (const seed of seeds) {
      const closet = loot('safehouse-closet', seed, 'ct-safehouse-closet').slots.filter(Boolean)
      expect(closet).toHaveLength(1)
      const w = closet[0] as WeaponInstance
      expect(['baseball_bat', 'metal_pipe']).toContain(w.itemId)
      expect(w.condition).toBeGreaterThanOrEqual(Math.ceil(ITEMS[w.itemId].maxCondition! * 0.6))
      starters.add(w.itemId)
      conditions.add(w.condition)
      const hammer = loot('tool-shelf', seed, 'ct-store-tools').slots.find((i) => i?.itemId === 'hammer')
      expect(isUsableTool(hammer, 'hammer')).toBe(true)
    }
    expect(starters).toEqual(new Set(['baseball_bat', 'metal_pipe']))
    // Two looted bats can differ: conditions really vary across seeds.
    expect(conditions.size).toBeGreaterThan(10)
  })

  it('never generates broken loot; rarer melee exist on some seeds only', () => {
    const seen: Record<string, number> = {}
    for (const seed of seeds) {
      for (const c of NEIGHBORHOOD_MAP.containers) {
        const inv = loot(c.loot!, seed, c.id)
        for (const item of inv.slots) {
          if (item?.kind !== 'weapon') continue
          expect(item.condition).toBeGreaterThan(0)
          expect(item.condition).toBeLessThanOrEqual(ITEMS[item.itemId].maxCondition!)
          seen[item.itemId] = (seen[item.itemId] ?? 0) + 1
        }
      }
    }
    expect(seen.crowbar).toBeGreaterThan(0)
    expect(seen.crowbar).toBeLessThan(seeds.length)
    expect(seen.hammer).toBeGreaterThanOrEqual(seeds.length)
  })

  it('Phase 1 tables still roll exactly what the Phase 1 runtime generated for the fixture seed', () => {
    // phase1-v1.json was exported before any Phase 2 change; only the first cabinet was looted.
    const byId = new Map(NEIGHBORHOOD_MAP.containers.map((c) => [c.id, c]))
    for (const old of legacyFixture.containers.filter((c) => !c.opened)) {
      const def = byId.get(old.id)!
      const now = loot(def.loot!, legacyFixture.worldSeed, def.id)
      expect(now.slots.map((s) => (s ? { itemId: s.itemId, quantity: s.quantity } : null))).toEqual(old.items.slots)
    }
  })
})
