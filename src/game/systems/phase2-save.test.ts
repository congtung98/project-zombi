import { describe, expect, it } from 'vitest'
import legacyFixture from './fixtures/phase1-v1.json'
import currentFixture from './fixtures/phase2-s1-v2.json'
import s2Fixture from './fixtures/phase2-s2-v3.json'
import { GameRuntime } from '../core/runtime'
import { validateSaveGame } from './save'
import { addItem, createInventory, totalQuantity, transferSlot } from './inventory'
import { equippedWeapon, equipWeapon } from './equipment'
import { CONTAINERS_ADDED_V3, NEIGHBORHOOD_MAP } from '../world/mapData'
import { SAVE_SCHEMA_VERSION, type SaveGame } from '../../types/save'

const mapId = NEIGHBORHOOD_MAP.id
const migrate = (data: unknown) => {
  const result = validateSaveGame(data, mapId)
  if (!result.ok) throw new Error(result.detail)
  return result
}

describe('Phase 1 fixture migration', () => {
  it('preserves stacks, progress, time and stats; grants one owned, equipped bat deterministically', () => {
    const before = JSON.stringify(legacyFixture)
    const { save, migrated } = migrate(legacyFixture)
    expect(migrated).toBe(true)
    expect(save.schemaVersion).toBe(SAVE_SCHEMA_VERSION)
    expect(save.clock).toEqual(legacyFixture.clock)
    expect(save.player.position).toEqual(legacyFixture.player.position)
    expect(save.player.health).toBe(73)
    expect(save.player.inventory.slots[0]).toMatchObject(legacyFixture.player.inventory.slots[0]!)
    expect(equippedWeapon(save.player.inventory, save.player.equipment)).toMatchObject({ kind: 'weapon', condition: 80 })
    expect(totalQuantity(save.player.inventory)).toBe(legacyFixture.player.inventory.slots.reduce((n, s) => n + (s?.quantity ?? 0), 0) + 1)
    for (const old of legacyFixture.containers) {
      const c = save.containers.find((s) => s.id === old.id)!
      expect(c.opened).toBe(old.opened)
      c.items.slots.forEach((s, j) => {
        const before = old.items.slots[j]
        if (before) expect(s).toMatchObject(before)
        else expect(s).toBeNull()
      })
    }
    // v1 → v2 → v3 in one pass: the P2-S2 containers are seeded, not the old ones.
    expect(save.containers.map((c) => c.id)).toEqual(NEIGHBORHOOD_MAP.containers.map((c) => c.id))
    expect(migrate(legacyFixture).save).toEqual(save)
    expect(migrate(legacyFixture).fromVersion).toBe(1)
    expect(migrate(save)).toEqual({ ok: true, save, migrated: false, fromVersion: SAVE_SCHEMA_VERSION })
    expect(JSON.stringify(legacyFixture)).toBe(before)
  })

  it('keeps all 12 occupied slots and puts the legacy bat in a reachable persistent drop', () => {
    const full = structuredClone(legacyFixture)
    full.player.inventory.slots = Array.from({ length: 12 }, () => ({ itemId: 'medkit', quantity: 1 }))
    const { save } = migrate(full)
    expect(totalQuantity(save.player.inventory)).toBe(12)
    expect(save.player.inventory.slots).toHaveLength(12)
    expect(save.player.equipment.weaponInstanceId).toBeNull()
    const drop = save.containers.find((c) => c.id === 'drop:legacy-bat')!
    expect(drop.items.slots[0]).toMatchObject({ itemId: 'baseball_bat', condition: 80 })
    expect(drop.position).toEqual({ ...full.player.position, y: 0 })
    const rt = new GameRuntime()
    rt.loadSnapshot(save)
    rt.player.health = 1
    rt.consumeItem(0) // frees one slot without discarding an item
    rt.tick(1 / 60)
    expect(rt.currentInteractable?.id).toBe(drop.id)
    rt.interact(rt.currentInteractable!)
    expect(rt.takeAll().moved).toBe(1)
    const bat = rt.player.inventory.slots.find((i) => i?.kind === 'weapon')!
    expect(rt.equipItem(bat.id)).toBe(true)
    const second = migrate(rt.createSnapshot())
    expect(second.migrated).toBe(false)
    rt.loadSnapshot(second.save)
    expect(rt.player.equipment.weaponInstanceId).toBe(bat.id)
    expect(totalQuantity(rt.world.containers.get(drop.id)!.items)).toBe(0)
  })

  it('rejects corrupt/unknown saves without modifying the source', () => {
    const malformed = structuredClone(legacyFixture)
    malformed.player.inventory.slots[0]!.quantity = 99
    const before = JSON.stringify(malformed)
    expect(validateSaveGame(malformed, mapId).ok).toBe(false)
    expect(JSON.stringify(malformed)).toBe(before)
    expect(validateSaveGame({ ...legacyFixture, schemaVersion: 999 }, mapId)).toMatchObject({ ok: false, reason: 'incompatible' })
  })
})

describe('v2 → v3 (P2-S2 melee containers)', () => {
  it('seeds each new container exactly like New Game for the same seed; old loot is never rerolled', () => {
    const { save } = migrate(currentFixture)
    const fresh = new GameRuntime()
    fresh.newGame(currentFixture.worldSeed)
    for (const id of CONTAINERS_ADDED_V3) {
      expect(currentFixture.containers.some((c) => c.id === id)).toBe(false)
      const added = save.containers.find((c) => c.id === id)!
      expect(added.opened).toBe(false)
      expect(added.items).toEqual(fresh.world.containers.get(id)!.items)
    }
    expect(save.containers.find((c) => c.id === 'ct-safehouse-closet')!.items.slots.some((i) => i?.kind === 'weapon')).toBe(true)
    // Idempotent: migrating again (or re-validating the v3 result) adds nothing.
    expect(migrate(currentFixture).save).toEqual(save)
    expect(migrate(save)).toMatchObject({ migrated: false, save })
  })

  it('rejects a v3 save missing a new container and a v2 save that already has one', () => {
    const { save } = migrate(currentFixture)
    const missing = structuredClone(save)
    missing.containers = missing.containers.filter((c) => c.id !== 'ct-store-tools')
    expect(validateSaveGame(missing, mapId)).toMatchObject({ ok: false, reason: 'corrupt' })
    const early = structuredClone(currentFixture) as unknown as SaveGame
    early.containers.push({ ...structuredClone(save.containers.find((c) => c.id === 'ct-store-tools')!) })
    expect(validateSaveGame(early, mapId)).toMatchObject({ ok: false, reason: 'corrupt' })
  })
})

describe('P2-S2 browser fixture (v3)', () => {
  it('loads without migration: broken equipped weapon, looted closet and a dropped pipe survive round trips', () => {
    const { save, migrated } = migrate(s2Fixture)
    expect(migrated).toBe(false)
    const rt = new GameRuntime()
    rt.loadSnapshot(save)
    for (let i = 0; i < 2; i++) rt.loadSnapshot(migrate(JSON.parse(JSON.stringify(rt.createSnapshot()))).save)
    expect({ ...rt.createSnapshot(), savedAt: 0 }).toEqual({ ...save, savedAt: 0 })
    const held = equippedWeapon(rt.player.inventory, rt.player.equipment)!
    expect([held.itemId, held.condition]).toEqual(['metal_pipe', 0])
    // The ID minted by the closet survives take → drop → pick up → save.
    expect(held.id.startsWith('loot:') && held.id.includes('ct-safehouse-closet')).toBe(true)
    expect(rt.world.containers.get('ct-safehouse-closet')).toMatchObject({ opened: true })
    const dropped = Array.from(rt.world.containers.values()).flatMap((c) => c.position ? c.items.slots : []).find((i) => i?.kind === 'weapon')
    expect(dropped).toMatchObject({ itemId: 'metal_pipe', condition: 33 })
  })
})

describe('instance ownership', () => {
  it('migrates the browser-generated v2 (S1) fixture without condition reset or loot reroll', () => {
    const before = JSON.stringify(currentFixture)
    const { save, migrated, fromVersion } = migrate(currentFixture)
    expect([migrated, fromVersion]).toEqual([true, 2])
    expect(JSON.stringify(currentFixture)).toBe(before)
    for (const old of currentFixture.containers) expect(save.containers.find((c) => c.id === old.id)).toEqual(old)
    expect(save.player).toEqual(currentFixture.player)
    const rt = new GameRuntime()
    rt.loadSnapshot(save)
    const again = rt.createSnapshot()
    expect({ ...again, savedAt: 0 }).toEqual({ ...save, savedAt: 0 })
    expect(rt.player.inventory.slots.filter((i) => i?.kind === 'weapon').map((i) => i!.condition).sort((a, b) => a - b)).toEqual([10, 70])
  })
  it('keeps two bat IDs and conditions through equip, transfer, drop and repeated reload', () => {
    const rt = new GameRuntime()
    rt.newGame(20260924)
    addItem(rt.player.inventory, 'baseball_bat', 2)
    const bats = rt.player.inventory.slots.filter((i) => i?.kind === 'weapon')
    expect(bats).toHaveLength(2)
    bats[0]!.condition = 10
    bats[1]!.condition = 70
    expect(new Set(bats.map((b) => b!.id)).size).toBe(2)
    for (const bat of bats) {
      expect(rt.equipItem(bat!.id)).toBe(true)
      expect(equippedWeapon(rt.player.inventory, rt.player.equipment)?.condition).toBe(bat!.condition)
    }
    const cabinet = rt.interactables.find((i) => i.kind === 'container')!
    rt.interact(cabinet)
    const slot = rt.player.inventory.slots.findIndex((i) => i?.id === bats[1]!.id)
    expect(rt.putIntoContainer(slot).moved).toBe(1)
    expect(rt.player.equipment.weaponInstanceId).toBeNull()
    const transferred = rt.openContainer!.items.slots.findIndex((i) => i?.id === bats[1]!.id)
    expect(rt.takeFromContainer(transferred).moved).toBe(1)
    expect(rt.equipItem(bats[0]!.id)).toBe(true)
    expect(rt.dropItem(rt.player.inventory.slots.findIndex((i) => i?.id === bats[0]!.id))).toBe(true)
    expect(rt.player.equipment.weaponInstanceId).toBeNull()
    for (let i = 0; i < 3; i++) rt.loadSnapshot(migrate(JSON.parse(JSON.stringify(rt.createSnapshot()))).save)
    const ids = new Set(bats.map((b) => b!.id))
    const items = [rt.player.inventory, ...Array.from(rt.world.containers.values()).map((c) => c.items)].flatMap((i) => i.slots).filter((i) => i?.kind === 'weapon').filter((i) => ids.has(i.id))
    expect(items.map((i) => [i!.id, i!.condition]).sort()).toEqual(bats.map((i) => [i!.id, i!.condition]).sort())
  })

  it('refuses a full destination, self-transfer, duplicate ID and foreign equipment', () => {
    const a = createInventory(1, 'a')
    const b = createInventory(1, 'b')
    addItem(a, 'baseball_bat', 1)
    addItem(b, 'water', 5)
    const before = structuredClone(a)
    expect(transferSlot(a, 0, b).moved).toBe(0)
    expect(transferSlot(a, 0, a).moved).toBe(0)
    expect(transferSlot(a, 0, b, Number.NaN).moved).toBe(0)
    expect(a).toEqual(before)
    expect(equipWeapon(b, { weaponInstanceId: null }, a.slots[0]!.id)).toBe(false)
    b.slots[0] = { ...a.slots[0]! }
    expect(transferSlot(a, 0, b).moved).toBe(0)
  })

  it('split/merge conserves quantities, IDs remain unique, and counters survive transfers', () => {
    const a = createInventory(2, 'a')
    const b = createInventory(2, 'b')
    addItem(a, 'water', 5)
    const id = a.slots[0]!.id
    transferSlot(a, 0, b, 2)
    expect(b.slots[0]!.id).not.toBe(id)
    expect(a.slots[0]!.id).toBe(id)
    transferSlot(a, 0, b)
    expect(totalQuantity(a) + totalQuantity(b)).toBe(5)
    addItem(a, 'water', 1)
    expect(a.slots[0]!.id).not.toBe(id)
  })

  it.each(['duplicate', 'foreign-equipment', 'counter', 'condition', 'fraction', 'missing-container', 'duplicate-door', 'capacity'])('rejects %s corruption', (kind) => {
    const save = migrate(legacyFixture).save
    const weapon = save.player.inventory.slots.find((i) => i?.kind === 'weapon')!
    if (kind === 'duplicate') save.containers[0].items.slots[0] = { ...weapon }
    if (kind === 'foreign-equipment') save.player.equipment.weaponInstanceId = 'missing'
    if (kind === 'counter') save.player.inventory.nextItemId = 1
    if (kind === 'condition') weapon.condition = Number.NaN
    if (kind === 'fraction') save.player.inventory.slots[0]!.quantity = 1.5
    if (kind === 'missing-container') save.containers.pop()
    if (kind === 'duplicate-door') save.doors.push({ ...save.doors[0] })
    if (kind === 'capacity') save.player.inventory.slots.push(null)
    expect(validateSaveGame(save, mapId).ok).toBe(false)
  })
})
