import { describe, expect, it } from 'vitest'
import legacyFixture from './fixtures/phase1-v1.json'
import currentFixture from './fixtures/phase2-s1-v2.json'
import s2Fixture from './fixtures/phase2-s2-v3.json'
import s3Fixture from './fixtures/phase2-s3-v4.json'
import s4Fixture from './fixtures/phase2-s4-v5.json'
import s5Fixture from './fixtures/phase2-s5-v6.json'
import lightFixture from './fixtures/phase2-light-v7.json'
import { DOOR_MAX_HP } from '../world/doors'
import { GameRuntime } from '../core/runtime'
import { validateSaveGame } from './save'
import { addItem, createInventory, totalQuantity, transferSlot } from './inventory'
import { equippedWeapon, equipWeapon } from './equipment'
import { NEIGHBORHOOD_MAP } from '../world/mapData'
import { CONTAINERS_ADDED_V3, CONTAINERS_ADDED_V5, DOORS_ADDED_V7, legacyContentFor } from '../world/legacyContent'
import { LOOT_TABLES } from '../world/lootTables'
import { generateContainerLoot } from './loot'
import { SAVE_SCHEMA_VERSION, type SaveGame } from '../../types/save'
import { GAME_CONFIG } from '../core/config'
import { DEFAULT_APPEARANCE, DEFAULT_PLAYER_NAME } from '../entities/appearance'

const mapId = NEIGHBORHOOD_MAP.id
const migrate = (data: unknown) => {
  const result = validateSaveGame(data, mapId)
  if (!result.ok) throw new Error(result.detail)
  return result
}

// Fixtures before v8 use the hand-coded map's IDs; v8 renames them to stable content IDs.
const LEGACY = legacyContentFor(NEIGHBORHOOD_MAP)!
const TABLES = [LEGACY.ids.doors, LEGACY.ids.containers, LEGACY.ids.windows, LEGACY.ids.lamps, LEGACY.ids.rooms, LEGACY.ids.zones]
/** Stable content ID of a legacy neighbourhood ID. */
const id = (legacyId: string): string => {
  const found = TABLES.find((t) => legacyId in t)
  if (!found) throw new Error(`no stable ID for ${legacyId}`)
  return found[legacyId]
}
const invert = (t: Record<string, string>) => new Map(Object.entries(t).map(([a, b]) => [b, a]))
const BACK = { doors: invert(LEGACY.ids.doors), containers: invert(LEGACY.ids.containers), windows: invert(LEGACY.ids.windows), lamps: invert(LEGACY.ids.lamps), zones: invert(LEGACY.ids.zones) }
const back = (table: Map<string, string>, value: string) => table.get(value) ?? value
/** Legacy map order, then anything unknown (drops) in its current order. */
const inLegacyOrder = <T extends { id: string }>(list: T[], order: { id: string }[]) => {
  const rank = new Map(order.map((o, i) => [o.id, i]))
  return list.map((x, i) => ({ x, i })).sort((a, b) => (rank.get(a.x.id) ?? 1e9) - (rank.get(b.x.id) ?? 1e9) || a.i - b.i).map(({ x }) => x)
}
/**
 * A v8 save as the v7 save it came from: legacy IDs and order, no content version. Comparing
 * it with a pre-v8 fixture proves the whole chain changed nothing but what each step adds.
 */
const toLegacy = (save: SaveGame): SaveGame => {
  const copy = structuredClone(save) as Partial<SaveGame>
  delete copy.contentVersion
  copy.doors = inLegacyOrder(save.doors.map((d) => ({ ...d, id: back(BACK.doors, d.id) })), LEGACY.map.doors)
  copy.containers = inLegacyOrder(save.containers.map((c) => ({ ...c, id: back(BACK.containers, c.id) })), LEGACY.map.containers)
  if (save.lighting) {
    copy.lighting = {
      ...save.lighting,
      curtains: inLegacyOrder(save.lighting.curtains.map((c) => ({ ...c, id: back(BACK.windows, c.id) })), LEGACY.map.windows!),
      lamps: save.lighting.lamps.map((l) => ({ ...l, id: back(BACK.lamps, l.id) })),
    }
  }
  copy.zombies = save.zombies.map((z) => ({
    ...z,
    zoneId: z.zoneId === null ? null : back(BACK.zones, z.zoneId),
    structureTargetId: z.structureTargetId === null ? null : back(BACK.doors, z.structureTargetId),
  }))
  return copy as SaveGame
}
/** What New Game rolled for a container before v8 (loot is seeded by the container ID of the time). */
const legacyRoll = (legacyId: string, seed: number) => {
  const def = LEGACY.map.containers.find((c) => c.id === legacyId)!
  return generateContainerLoot(def.loot ? LOOT_TABLES[def.loot] : undefined, seed, legacyId, GAME_CONFIG.inventory.containerSlots)
}

/** The save (as v7) without the v7 lighting inputs and the bedroom door, to compare with pre-v7 fixtures. */
const withoutV7 = (save: SaveGame): Omit<SaveGame, 'lighting'> => {
  const copy: Partial<SaveGame> = toLegacy(save)
  delete copy.lighting
  copy.doors = copy.doors!.filter((d) => !DOORS_ADDED_V7.has(d.id))
  return copy as Omit<SaveGame, 'lighting'>
}
/** The save without the P2-S5 (v6) zombie AI fields (and v7 additions), to compare with pre-v6 fixtures. */
const withoutV6 = (save: SaveGame): Omit<SaveGame, 'horde' | 'lighting'> => {
  const copy: Partial<SaveGame> = withoutV7(save)
  delete copy.horde
  for (const z of copy.zombies as Partial<SaveGame['zombies'][number]>[]) {
    delete z.memoryAge
    delete z.memorySource
    delete z.zoneId
    delete z.structureTargetId
  }
  return copy as Omit<SaveGame, 'horde' | 'lighting'>
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
      const c = save.containers.find((s) => s.id === id(old.id))!
      expect(c.opened).toBe(old.opened)
      c.items.slots.forEach((s, j) => {
        const before = old.items.slots[j]
        if (before) expect(s).toMatchObject(before)
        else expect(s).toBeNull()
      })
    }
    // v1 → … → v8 in one pass: the P2-S2 containers are seeded, not the old ones.
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
  it('seeds each new container exactly like New Game did for the same seed; old loot is never rerolled', () => {
    const { save } = migrate(currentFixture)
    for (const legacyId of CONTAINERS_ADDED_V3) {
      expect(currentFixture.containers.some((c) => c.id === legacyId)).toBe(false)
      const added = save.containers.find((c) => c.id === id(legacyId))!
      expect(added.opened).toBe(false)
      expect(added.items).toEqual(legacyRoll(legacyId, currentFixture.worldSeed))
    }
    expect(save.containers.find((c) => c.id === id('ct-safehouse-closet'))!.items.slots.some((i) => i?.kind === 'weapon')).toBe(true)
    // Idempotent: migrating again (or re-validating the v3 result) adds nothing.
    expect(migrate(currentFixture).save).toEqual(save)
    expect(migrate(save)).toMatchObject({ migrated: false, save })
  })

  it('rejects a v3 save missing a new container and a v2 save that already has one', () => {
    const { save } = migrate(currentFixture)
    const missing = structuredClone(save)
    missing.containers = missing.containers.filter((c) => c.id !== id('ct-store-tools'))
    expect(validateSaveGame(missing, mapId)).toMatchObject({ ok: false, reason: 'corrupt' })
    const early = structuredClone(currentFixture) as unknown as SaveGame
    early.containers.push({ ...structuredClone(save.containers.find((c) => c.id === id('ct-store-tools'))!), id: 'ct-store-tools' })
    expect(validateSaveGame(early, mapId)).toMatchObject({ ok: false, reason: 'corrupt' })
  })
})

describe('v4 → v5 (P2-S4 material containers)', () => {
  it('seeds the three material containers like New Game did for the same seed; nothing else changes', () => {
    const before = JSON.stringify(s3Fixture)
    const { save, fromVersion } = migrate(s3Fixture)
    expect(fromVersion).toBe(4)
    expect(JSON.stringify(s3Fixture)).toBe(before)
    for (const legacyId of CONTAINERS_ADDED_V5) {
      expect(s3Fixture.containers.some((c) => c.id === legacyId)).toBe(false)
      const added = save.containers.find((c) => c.id === id(legacyId))!
      expect(added).toEqual({ id: id(legacyId), opened: false, items: legacyRoll(legacyId, s3Fixture.worldSeed) })
    }
    const old = withoutV6(save)
    expect({ ...old, schemaVersion: 4, containers: old.containers.filter((c) => !CONTAINERS_ADDED_V5.has(c.id)) }).toEqual(s3Fixture)
    // Map order first, then drops (matches createSnapshot), and idempotent.
    const fixed = save.containers.filter((c) => !c.position).map((c) => c.id)
    expect(fixed).toEqual(NEIGHBORHOOD_MAP.containers.map((c) => c.id))
    expect(migrate(s3Fixture).save).toEqual(save)
    expect(migrate(save)).toMatchObject({ migrated: false, save })
  })

  it('rejects a v5 save missing a material container and a v4 save that already has one', () => {
    const { save } = migrate(s3Fixture)
    const missing = structuredClone(save)
    missing.containers = missing.containers.filter((c) => c.id !== id('ct-store-hardware'))
    expect(validateSaveGame(missing, mapId)).toMatchObject({ ok: false, reason: 'corrupt' })
    const early = structuredClone(s3Fixture) as unknown as SaveGame
    early.containers.push({ ...structuredClone(save.containers.find((c) => c.id === id('ct-store-hardware'))!), id: 'ct-store-hardware' })
    expect(validateSaveGame(early, mapId)).toMatchObject({ ok: false, reason: 'corrupt' })
  })

  it('a migrated save can loot the starter kit and repair its crowbar; the result saves cleanly', () => {
    const { save } = migrate(s3Fixture)
    const rt = new GameRuntime()
    rt.loadSnapshot(save)
    rt.player.position = { x: -16.5, y: 0, z: -13 }
    rt.interact(rt.interactables.find((i) => i.id === id('ct-safehouse-toolbox'))!)
    expect(rt.takeAll().moved).toBe(3)
    rt.closeAllUi()
    const crowbar = rt.player.inventory.slots.find((i) => i?.itemId === 'crowbar')!
    expect(rt.startRepair(crowbar.id).ok).toBe(true)
    for (let t = 0; t < 5.1; t += 1 / 60) rt.tick(1 / 60)
    expect(rt.player.inventory.slots.find((i) => i?.id === crowbar.id)).toMatchObject({ condition: 115 })
    expect(rt.player.inventory.slots.filter(Boolean).map((i) => i!.itemId).sort()).toEqual(['crowbar', 'wood_plank'])
    const round = migrate(JSON.parse(JSON.stringify(rt.createSnapshot())))
    expect(round.migrated).toBe(false)
    rt.loadSnapshot(round.save)
    expect(rt.player.equipment.weaponInstanceId).toBe(crowbar.id)
  })
})

describe('P2-S2 browser fixture (v3)', () => {
  it('v3 → v8 adds only the default name/appearance, the P2-S4 material containers, zombie AI fields and lighting, and renames IDs; everything else is the S2 save', () => {
    const before = JSON.stringify(s2Fixture)
    const { save, migrated, fromVersion } = migrate(s2Fixture)
    expect([migrated, fromVersion, save.schemaVersion]).toEqual([true, 3, SAVE_SCHEMA_VERSION])
    expect(JSON.stringify(s2Fixture)).toBe(before)
    const { name, appearance, ...rest } = save.player
    expect([name, appearance]).toEqual([DEFAULT_PLAYER_NAME, DEFAULT_APPEARANCE])
    expect(rest).toEqual(s2Fixture.player)
    const old = withoutV6(save)
    const containers = old.containers.filter((c) => !CONTAINERS_ADDED_V5.has(c.id))
    expect({ ...old, player: rest, schemaVersion: 3, containers }).toEqual(s2Fixture)
    expect(migrate(s2Fixture).save).toEqual(save)
  })

  it('broken equipped weapon, looted closet and a dropped pipe survive round trips', () => {
    const { save } = migrate(s2Fixture)
    const rt = new GameRuntime()
    rt.loadSnapshot(save)
    for (let i = 0; i < 2; i++) rt.loadSnapshot(migrate(JSON.parse(JSON.stringify(rt.createSnapshot()))).save)
    expect({ ...rt.createSnapshot(), savedAt: 0 }).toEqual({ ...save, savedAt: 0 })
    const held = equippedWeapon(rt.player.inventory, rt.player.equipment)!
    expect([held.itemId, held.condition]).toEqual(['metal_pipe', 0])
    // The ID minted by the closet survives take → drop → pick up → save (item IDs are never renamed).
    expect(held.id.startsWith('loot:') && held.id.includes('ct-safehouse-closet')).toBe(true)
    expect(rt.world.containers.get(id('ct-safehouse-closet'))).toMatchObject({ opened: true })
    const dropped = Array.from(rt.world.containers.values()).flatMap((c) => c.position ? c.items.slots : []).find((i) => i?.kind === 'weapon')
    expect(dropped).toMatchObject({ itemId: 'metal_pipe', condition: 33 })
  })
})

describe('P2-S3 browser fixture (v4)', () => {
  it('migrates to the current schema and keeps the chosen name/appearance through repeated round trips', () => {
    const { save, migrated, fromVersion } = migrate(s3Fixture)
    expect([migrated, fromVersion, save.schemaVersion]).toEqual([true, 4, SAVE_SCHEMA_VERSION])
    expect([save.player.name, save.player.appearance]).toEqual(['Trần Tùng', { preset: 'sturdy', hair: 'mohawk', skin: 'dark', shirt: 'red', pants: 'olive' }])
    const rt = new GameRuntime()
    rt.loadSnapshot(save)
    for (let i = 0; i < 2; i++) rt.loadSnapshot(migrate(JSON.parse(JSON.stringify(rt.createSnapshot()))).save)
    expect({ ...rt.createSnapshot(), savedAt: 0 }).toEqual({ ...save, savedAt: 0 })
  })
})

describe('instance ownership', () => {
  it('migrates the browser-generated v2 (S1) fixture without condition reset or loot reroll', () => {
    const before = JSON.stringify(currentFixture)
    const { save, migrated, fromVersion } = migrate(currentFixture)
    expect([migrated, fromVersion]).toEqual([true, 2])
    expect(JSON.stringify(currentFixture)).toBe(before)
    for (const old of currentFixture.containers) expect(save.containers.find((c) => c.id === id(old.id))).toEqual({ ...old, id: id(old.id) })
    expect(save.player).toEqual({ ...currentFixture.player, name: DEFAULT_PLAYER_NAME, appearance: DEFAULT_APPEARANCE })
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

describe('P2-S4 browser fixture (v5)', () => {
  it('migrates to v6 only in zombie AI fields: crafted club equipped, closet bat repaired then worn, materials and looted kit kept', () => {
    const { save, migrated, fromVersion } = migrate(s4Fixture)
    expect([migrated, fromVersion]).toEqual([true, 5])
    const rt = new GameRuntime()
    rt.loadSnapshot(save)
    for (let i = 0; i < 2; i++) rt.loadSnapshot(migrate(JSON.parse(JSON.stringify(rt.createSnapshot()))).save)
    expect({ ...rt.createSnapshot(), savedAt: 0 }).toEqual({ ...save, savedAt: 0 })
    expect(equippedWeapon(rt.player.inventory, rt.player.equipment)).toMatchObject({ itemId: 'wooden_club', condition: 40 })
    const bat = rt.player.inventory.slots.find((i) => i?.itemId === 'baseball_bat')!
    expect(bat.id.includes('ct-safehouse-closet') && bat.kind === 'weapon' && bat.condition).toBe(29)
    expect(rt.world.containers.get(id('ct-safehouse-toolbox'))).toMatchObject({ opened: true })
    expect(totalQuantity(rt.world.containers.get(id('ct-safehouse-toolbox'))!.items)).toBe(0)
    // The saved materials still pay for a repair after Continue.
    expect(rt.startRepair(bat.id).ok).toBe(true)
    for (let t = 0; t < 4.1; t += 1 / 60) rt.tick(1 / 60)
    expect(rt.player.inventory.slots.find((i) => i?.id === bat.id)).toMatchObject({ condition: 59 })
  })
})

describe('v5 → v6 (P2-S5 zombie perception, zones, siege, horde)', () => {
  it('adds only zombie AI fields and the horde countdown; zombies join the zone nearest to them', () => {
    const before = JSON.stringify(s4Fixture)
    const { save, fromVersion } = migrate(s4Fixture)
    expect(JSON.stringify(s4Fixture)).toBe(before)
    expect([fromVersion, save.schemaVersion]).toEqual([5, SAVE_SCHEMA_VERSION])
    expect({ ...withoutV6(save), schemaVersion: 5 }).toEqual(s4Fixture)
    expect(save.horde).toEqual({ timer: GAME_CONFIG.horde.intervalMin, counter: 0 })
    expect(Object.fromEntries(save.zombies.map((z) => [z.id, z.zoneId]))).toEqual({
      'zombie-2': id('zone-south'), 'zombie-3': id('zone-east'), 'zombie-4': id('zone-north'), 'zombie-5': id('zone-store'),
      'zombie-6': id('zone-yard'), 'zombie-7': id('zone-west'), 'zombie-8': id('zone-south'),
    })
    for (const z of save.zombies) expect(z).toMatchObject({ memoryAge: 0, memorySource: null, structureTargetId: null })
    expect(migrate(s4Fixture).save).toEqual(save)
    expect(migrate(save)).toMatchObject({ migrated: false, save })
  })

  it('a remembered position in a v5 save becomes a fresh sighting', () => {
    const old = structuredClone(s4Fixture) as unknown as SaveGame
    old.zombies[0] = { ...old.zombies[0], ai: 'SEARCH', lastKnownTarget: { x: -13, y: 0.9, z: -13 } }
    const { save } = migrate(old)
    expect(save.zombies[0]).toMatchObject({ ai: 'SEARCH', memoryAge: 0, memorySource: 'sight', structureTargetId: null })
  })

  it.each([
    ['unknown zone', (s: SaveGame) => { s.zombies[0].zoneId = 'zone-moon' }],
    ['siege without a door', (s: SaveGame) => { s.zombies[0] = { ...s.zombies[0], ai: 'ATTACK_STRUCTURE', lastKnownTarget: { x: 0, y: 0, z: 0 }, memorySource: 'sight' } }],
    ['siege door not on the map', (s: SaveGame) => { s.zombies[0] = { ...s.zombies[0], ai: 'APPROACH_STRUCTURE', lastKnownTarget: { x: 0, y: 0, z: 0 }, memorySource: 'sight', structureTargetId: 'door-x' } }],
    ['door target outside a siege', (s: SaveGame) => { s.zombies[0].structureTargetId = id('door-house') }],
    ['memory source without memory', (s: SaveGame) => { s.zombies[0].memorySource = 'noise' }],
    ['negative memory age', (s: SaveGame) => { s.zombies[0].memoryAge = -1 }],
    ['missing horde', (s: SaveGame) => { delete (s as Partial<SaveGame>).horde }],
    ['v6 state in a v5 save', (s: SaveGame) => { Object.assign(s, withoutV6(s), { schemaVersion: 5 }); s.zombies[0].ai = 'WANDER' }],
  ])('rejects %s', (_, corruptSave) => {
    const save = structuredClone(migrate(s4Fixture).save)
    corruptSave(save)
    expect(validateSaveGame(save, mapId)).toMatchObject({ ok: false })
  })

  it('a valid siege save loads and round-trips exactly', () => {
    const save = structuredClone(migrate(s4Fixture).save)
    save.zombies[0] = { ...save.zombies[0], ai: 'ATTACK_STRUCTURE', lastKnownTarget: { x: 12, y: 0.9, z: 11 }, memorySource: 'noise', memoryAge: 4.5, structureTargetId: id('door-house') }
    save.doors = save.doors.map((d) => (d.id === id('door-house') ? { ...d, hp: 70 } : d))
    save.horde = { timer: 42.5, counter: 3 }
    const rt = new GameRuntime()
    rt.loadSnapshot(migrate(save).save)
    expect({ ...rt.createSnapshot(), savedAt: 0 }).toEqual({ ...save, savedAt: 0 })
    expect(rt.zombies.get('zombie-2')).toMatchObject({ ai: 'ATTACK_STRUCTURE', structureTargetId: id('door-house'), memoryAge: 4.5 })
    expect(rt.world.doors.get(id('door-house'))!.hp).toBe(70)
    expect([rt.hordeTimer, rt.hordeCounter]).toEqual([42.5, 3])
  })
})

describe('P2-S5 browser fixture (v6, saved mid-siege in Chromium)', () => {
  it('migrates to v8 (lighting, bedroom door, stable IDs), round-trips exactly, and the loaded siege breaks the door', () => {
    const { save, migrated, fromVersion } = migrate(s5Fixture)
    expect([migrated, fromVersion, save.schemaVersion]).toEqual([true, 6, SAVE_SCHEMA_VERSION])
    const siege = save.zombies.find((z) => z.ai === 'ATTACK_STRUCTURE')!
    expect(siege).toMatchObject({ structureTargetId: id('door-safehouse'), memorySource: 'sight' })
    const door = save.doors.find((d) => d.id === id('door-safehouse'))!
    expect(door.state).toBe('closed')
    expect(door.hp).toBeLessThan(DOOR_MAX_HP)
    const rt = new GameRuntime()
    rt.loadSnapshot(save)
    for (let i = 0; i < 2; i++) rt.loadSnapshot(migrate(JSON.parse(JSON.stringify(rt.createSnapshot()))).save)
    expect({ ...rt.createSnapshot(), savedAt: 0 }).toEqual({ ...save, savedAt: 0 })
    // No Rapier in Node: walls and the closed door block sight like the grid does.
    rt.registerPhysicsQuery({ isBlocked: (a, b, ignore) => (ignore.length > 0 ? false : !rt.nav.hasLineOfWalk(a, b)) })
    let destroyed = 0
    rt.events.on('door:destroyed', () => (destroyed += 1))
    const period = GAME_CONFIG.zombie.attackWindup + GAME_CONFIG.structure.cooldown
    for (let t = 0; t < (door.hp / GAME_CONFIG.structure.damage) * period + 2; t += 1 / 30) rt.tick(1 / 30)
    expect(rt.world.doors.get(id('door-safehouse'))).toMatchObject({ state: 'destroyed', hp: 0 })
    expect(destroyed).toBe(1)
  })
})

describe('v6 → v7 (building lighting)', () => {
  it('adds the bedroom door open, curtains open, lamps off and power on; nothing else changes', () => {
    const before = JSON.stringify(s5Fixture)
    const { save, fromVersion } = migrate(s5Fixture)
    expect(JSON.stringify(s5Fixture)).toBe(before)
    expect(fromVersion).toBe(6)
    expect(save.doors.find((d) => d.id === id('door-house-bedroom'))).toEqual({ id: id('door-house-bedroom'), state: 'open', hp: DOOR_MAX_HP })
    expect(save.lighting.electricity).toBe(true)
    expect(save.lighting.curtains.map((c) => c.id).sort()).toEqual(['win-house-n', 'win-house-w', 'win-safehouse-e', 'win-safehouse-n', 'win-store-s1', 'win-store-s2'].map(id).sort())
    expect(save.lighting.curtains.every((c) => !c.closed)).toBe(true)
    expect(save.lighting.lamps.map((l) => l.id).sort()).toEqual(['lamp-house-bedroom', 'lamp-house-living', 'lamp-safehouse', 'lamp-store'].map(id).sort())
    expect(save.lighting.lamps.every((l) => !l.on)).toBe(true)
    expect({ ...withoutV7(save), schemaVersion: 6 }).toEqual(s5Fixture)
    expect(migrate(s5Fixture).save).toEqual(save)
    expect(migrate(save)).toMatchObject({ migrated: false, save })
  })

  it('moves a player or zombie standing where the new partition is to beside it', () => {
    const inWall = structuredClone(s5Fixture) as unknown as SaveGame
    inWall.player.position = { x: 14.05, y: 0.9, z: 14 }
    inWall.zombies[0].position = { x: 13.95, y: 0.9, z: 14.9 }
    const { save } = migrate(inWall)
    expect(save.player.position.x).toBeGreaterThan(14.5)
    expect(save.player.position.z).toBe(14)
    expect(save.zombies[0].position.x).toBeLessThan(13.5)
    const rt = new GameRuntime()
    rt.loadSnapshot(save)
    expect(rt.nav.isWalkable(save.player.position.x, save.player.position.z)).toBe(true)
  })

  it('rejects v7 saves with unknown/missing lighting IDs and pre-v7 saves that already have the bedroom door', () => {
    const { save } = migrate(s5Fixture)
    const missingLamp = structuredClone(save)
    missingLamp.lighting.lamps.pop()
    expect(validateSaveGame(missingLamp, mapId)).toMatchObject({ ok: false, reason: 'corrupt' })
    const badCurtain = structuredClone(save)
    badCurtain.lighting.curtains[0] = { id: 'win-nowhere', closed: true }
    expect(validateSaveGame(badCurtain, mapId)).toMatchObject({ ok: false, reason: 'corrupt' })
    const noLighting = structuredClone(save) as Partial<SaveGame>
    delete noLighting.lighting
    expect(validateSaveGame(noLighting, mapId)).toMatchObject({ ok: false, reason: 'corrupt' })
    const early = structuredClone(s5Fixture) as unknown as SaveGame
    early.doors.push({ id: 'door-house-bedroom', state: 'open', hp: DOOR_MAX_HP })
    expect(validateSaveGame(early, mapId)).toMatchObject({ ok: false, reason: 'corrupt' })
  })

  it('curtains, lamps and power round-trip; room light is recomputed after load, not stored', () => {
    const rt = new GameRuntime()
    rt.newGame(77)
    rt.setCurtain(id('win-house-n'), true)
    rt.setLamp(id('lamp-house-bedroom'), true)
    rt.setElectricity(false)
    rt.tick(1 / 60)
    const snap = JSON.parse(JSON.stringify(rt.createSnapshot()))
    expect(JSON.stringify(snap)).not.toContain('finalLightLevel')
    const other = new GameRuntime()
    other.loadSnapshot(migrate(snap).save)
    other.tick(1 / 60)
    expect(other.world.curtains.get(id('win-house-n'))).toBe(true)
    expect(other.world.lamps.get(id('lamp-house-bedroom'))).toBe(true)
    expect(other.world.electricity).toBe(false)
    expect(other.lighting.getRoomLight(id('room-house-bedroom'))).toEqual(rt.lighting.getRoomLight(id('room-house-bedroom')))
  })
})

describe('Building lighting browser fixture (v7, saved in Chromium)', () => {
  it('v7 → v8 only renames map IDs; keeps lamp/curtain/door, recomputes room light and round-trips exactly', () => {
    const before = JSON.stringify(lightFixture)
    const { save, migrated, fromVersion } = migrate(lightFixture)
    expect([migrated, fromVersion, save.schemaVersion, save.contentVersion]).toEqual([true, 7, 8, 1])
    expect(JSON.stringify(lightFixture)).toBe(before)
    expect({ ...toLegacy(save), schemaVersion: 7 }).toEqual(lightFixture)
    expect(save.doors.map((d) => d.id)).toEqual(NEIGHBORHOOD_MAP.doors.map((d) => d.id))
    expect(save.containers.filter((c) => !c.position).map((c) => c.id)).toEqual(NEIGHBORHOOD_MAP.containers.map((c) => c.id))
    expect(migrate(lightFixture).save).toEqual(save)
    expect(migrate(save)).toMatchObject({ migrated: false, save })
    const rt = new GameRuntime()
    rt.loadSnapshot(save)
    for (let i = 0; i < 2; i++) rt.loadSnapshot(migrate(JSON.parse(JSON.stringify(rt.createSnapshot()))).save)
    expect({ ...rt.createSnapshot(), savedAt: 0 }).toEqual({ ...save, savedAt: 0 })
    rt.tick(1 / 60)
    expect(rt.world.lamps.get(id('lamp-house-living'))).toBe(true)
    expect(rt.world.curtains.get(id('win-safehouse-n'))).toBe(true)
    expect(rt.world.doors.get(id('door-house-bedroom'))!.state).toBe('open')
    expect(rt.lighting.getRoomLight(id('room-house-living'))!.artificialLight).toBeCloseTo(0.8)
  })
})

describe('v7 → v8 (map content, stable IDs)', () => {
  it('renames sieges, zones, drops and looted containers without touching items or loot', () => {
    const v7 = structuredClone(lightFixture) as unknown as SaveGame
    v7.zombies.push({ id: 'zombie-99', position: { x: -14, y: 0.9, z: -8.5 }, facing: 0, health: 60, ai: 'ATTACK_STRUCTURE', lastKnownTarget: { x: -14, y: 0.9, z: -12 }, memoryAge: 1.5, memorySource: 'sight', zoneId: 'zone-north', structureTargetId: 'door-safehouse' })
    const bag = createInventory(1, 'drop-7')
    addItem(bag, 'water', 1)
    v7.containers.push({ id: 'drop:7', opened: false, items: bag, position: { x: 0, y: 0, z: 0 } })
    const { save } = migrate(v7)
    expect(save.zombies[0]).toMatchObject({ id: 'zombie-99', structureTargetId: id('door-safehouse'), zoneId: id('zone-north'), health: 60 })
    expect(save.containers.at(-1)).toEqual(v7.containers.at(-1))
    for (const c of v7.containers.filter((x) => !x.position)) expect(save.containers.find((x) => x.id === id(c.id))).toEqual({ ...c, id: id(c.id) })
    expect({ ...toLegacy(save), schemaVersion: 7 }).toEqual(v7)
  })

  it('rejects legacy IDs in a v8 save, a missing or foreign content version, and unknown IDs in a v7 save', () => {
    const { save } = migrate(lightFixture)
    const legacyIds = structuredClone(save)
    legacyIds.doors[0].id = 'door-safehouse'
    expect(validateSaveGame(legacyIds, mapId)).toMatchObject({ ok: false, reason: 'corrupt' })
    const noContent = structuredClone(save) as Partial<SaveGame>
    delete noContent.contentVersion
    expect(validateSaveGame(noContent, mapId)).toMatchObject({ ok: false, reason: 'corrupt' })
    expect(validateSaveGame({ ...save, contentVersion: 2 }, mapId)).toMatchObject({ ok: false, reason: 'incompatible' })
    const unknown = structuredClone(lightFixture) as unknown as SaveGame
    unknown.doors[0].id = 'door-nowhere'
    const before = JSON.stringify(unknown)
    expect(validateSaveGame(unknown, mapId)).toMatchObject({ ok: false, reason: 'corrupt' })
    expect(JSON.stringify(unknown)).toBe(before)
  })
})
