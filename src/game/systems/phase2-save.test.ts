import { describe, expect, it } from 'vitest'
import legacyFixture from './fixtures/phase1-v1.json'
import currentFixture from './fixtures/phase2-s1-v2.json'
import { GameRuntime } from '../core/runtime'
import { validateSaveGame } from './save'
import { addItem, createInventory, totalQuantity, transferSlot } from './inventory'
import { equippedWeapon, equipWeapon } from './equipment'
import { NEIGHBORHOOD_MAP } from '../world/mapData'

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
    expect(save.schemaVersion).toBe(2)
    expect(save.clock).toEqual(legacyFixture.clock)
    expect(save.player.position).toEqual(legacyFixture.player.position)
    expect(save.player.health).toBe(73)
    expect(save.player.inventory.slots[0]).toMatchObject(legacyFixture.player.inventory.slots[0]!)
    expect(equippedWeapon(save.player.inventory, save.player.equipment)).toMatchObject({ kind: 'weapon', condition: 80 })
    expect(totalQuantity(save.player.inventory)).toBe(legacyFixture.player.inventory.slots.reduce((n, s) => n + (s?.quantity ?? 0), 0) + 1)
    for (let i = 0; i < save.containers.length; i++) {
      expect(save.containers[i].opened).toBe(legacyFixture.containers[i].opened)
      save.containers[i].items.slots.forEach((s, j) => {
        const old = legacyFixture.containers[i].items.slots[j]
        if (old) expect(s).toMatchObject(old)
        else expect(s).toBeNull()
      })
    }
    expect(migrate(legacyFixture).save).toEqual(save)
    expect(migrate(save)).toEqual({ ok: true, save, migrated: false })
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

describe('instance ownership', () => {
  it('loads the browser-generated v2 milestone fixture without migration or condition reset', () => {
    const { save, migrated } = migrate(currentFixture)
    expect(migrated).toBe(false)
    const rt = new GameRuntime()
    rt.loadSnapshot(save)
    const again = rt.createSnapshot()
    expect({ ...again, savedAt: 0 }).toEqual({ ...save, savedAt: 0 })
    expect(rt.player.inventory.slots.filter((i) => i?.kind === 'weapon').map((i) => i!.condition).sort((a, b) => a - b)).toEqual([10, 70])
  })
  it('keeps two bat IDs and conditions through equip, transfer, drop and repeated reload', () => {
    const rt = new GameRuntime()
    rt.newGame(20260924)
    addItem(rt.player.inventory, 'baseball_bat', 1)
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
    const items = [rt.player.inventory, ...Array.from(rt.world.containers.values()).map((c) => c.items)].flatMap((i) => i.slots).filter((i) => i?.kind === 'weapon')
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
