import { describe, expect, it } from 'vitest'
import v9Fixture from './fixtures/inv-loot-v9.json'
import v1Fixture from './fixtures/phase1-v1.json'
import v2Fixture from './fixtures/phase2-s1-v2.json'
import v3Fixture from './fixtures/phase2-s2-v3.json'
import v4Fixture from './fixtures/phase2-s3-v4.json'
import v5Fixture from './fixtures/phase2-s4-v5.json'
import v6Fixture from './fixtures/phase2-s5-v6.json'
import v7Fixture from './fixtures/phase2-light-v7.json'
import { validateSaveGame, type SaveValidation } from './save'
import { NEIGHBORHOOD_MAP } from '../world/mapData'
import { CONTAINERS_ADDED_V3, CONTAINERS_ADDED_V5, legacyContentFor } from '../world/legacyContent'
import { createWorldState } from '../world/worldState'
import { GameRuntime } from '../core/runtime'
import { GAME_CONFIG } from '../core/config'
import { bonusRollHits, lootStats } from './loot'
import { addItem, totalQuantity } from './inventory'
import { inventoryWeight } from './bags'
import type { ItemInstance } from '../entities/items'
import { SAVE_SCHEMA_VERSION, type LegacyInventory, type SaveGame } from '../../types/save'
import { dropItemsOf, floorItemsOf, isBonusItem } from '../../test/legacySave'

/** A load clamps the stored zoom into the camera's current range (ba1db67 moved it to 32–128), so an older fixture's zoom comes back clamped. */
const zoomAfterLoad = (z: number) => Math.min(GAME_CONFIG.camera.zoomMax, Math.max(GAME_CONFIG.camera.zoomMin, z))

const map = NEIGHBORHOOD_MAP
const WARDROBE = 'c0_0/house/wardrobe'
const RULE = GAME_CONFIG.bonusLoot[0]
type V9 = typeof v9Fixture

const migrate = (data: unknown): Extract<SaveValidation, { ok: true }> => {
  const result = validateSaveGame(data, map.id, map)
  if (!result.ok) throw new Error(result.detail)
  return result
}
const v9 = () => structuredClone(v9Fixture) as V9
const slots = (inv: unknown) => (inv as LegacyInventory).slots.filter((s): s is ItemInstance => s !== null)
/** Units per item type over the player and every container, bonus items left out. */
const totals = (save: SaveGame) => {
  const t: Record<string, number> = {}
  for (const inv of [save.player.inventory, ...save.containers.map((c) => c.items), ...(save.floor ?? []).map((c) => c.items)]) {
    for (const i of inv.items) if (!isBonusItem(i)) t[i.itemId] = (t[i.itemId] ?? 0) + i.quantity
  }
  return t
}
const legacyTotals = (save: { player: { inventory: unknown }; containers: { items: unknown }[] }) => {
  const t: Record<string, number> = {}
  for (const inv of [save.player.inventory, ...save.containers.map((c) => c.items)]) for (const i of slots(inv)) t[i.itemId] = (t[i.itemId] ?? 0) + i.quantity
  return t
}

describe('S1 gate: a real v9 save (written by the pre-v10 code) keeps every item, condition and the equipped weapon', () => {
  it('same instances in the same owners and order, same IDs, quantities and conditions; slot counts become capacities', () => {
    const old = v9()
    const { save, migrated, fromVersion } = migrate(old)
    expect([migrated, fromVersion, save.schemaVersion]).toEqual([true, 9, SAVE_SCHEMA_VERSION])
    // The fixture's player bag has a hole in slot 1 and an equipped, worn bat (condition 37).
    expect(old.player.inventory.slots[1]).toBeNull()
    expect(save.player.inventory).toEqual({ id: old.player.inventory.id, kind: 'player', nextItemId: old.player.inventory.nextItemId, items: slots(old.player.inventory), slotCapacity: 12 })
    expect(save.player.equipment).toEqual({ weaponInstanceId: old.player.equipment.weaponInstanceId, backInstanceId: null })
    expect(save.player.inventory.items.find((i) => i.id === old.player.equipment.weaponInstanceId)).toMatchObject({ kind: 'weapon', condition: 37 })
    // v11: the dropped bag is a floor item where it lay; the map containers stay in order.
    expect(save.containers.map((c) => c.id)).toEqual(old.containers.filter((c) => !c.position).map((c) => c.id))
    expect(floorItemsOf(save)).toEqual(dropItemsOf(old as never))
    for (const c9 of old.containers.filter((c) => !c.position)) {
      const c10 = save.containers.find((c) => c.id === c9.id)!
      expect(c10.opened).toBe(c9.opened)
      expect(c10.position).toEqual(c9.position)
      expect(c10.items.items.filter((i) => !isBonusItem(i))).toEqual(slots(c9.items))
      expect(c10.items).toMatchObject({ id: c9.items.id, kind: c9.position ? 'drop' : 'container', nextItemId: c9.items.nextItemId, slotCapacity: c9.items.slots.length })
    }
    expect(totals(save)).toEqual(legacyTotals(old))
    // Everything outside the inventories is untouched.
    const { player: p10, containers: _c10, bags: _b, lootPatches: _l, floor: _f, schemaVersion: _s, ...rest10 } = save
    const { player: p9, containers: _c9, schemaVersion: _s9, ...rest9 } = old
    expect(rest10).toEqual(rest9)
    const { inventory: _i10, equipment: _e10, ...stats10 } = p10
    const { inventory: _i9, equipment: _e9, ...stats9 } = p9
    expect(stats10).toEqual(stats9)
  })

  it('the only addition is one backpack in the unopened wardrobe, exactly what a New Game with this seed has there', () => {
    const { save, lootPatch } = migrate(v9())
    const bonus = save.containers.flatMap((c) => c.items.items.filter(isBonusItem).map((i) => [c.id, i.itemId]))
    expect(bonus).toEqual([[WARDROBE, 'backpack']])
    expect(lootPatch).toEqual([{ rule: 'backpack-v1', itemId: 'backpack', eligible: 1, added: 1, full: 0 }])
    expect(save.lootPatches).toEqual(['backpack-v1'])
    const fresh = createWorldState(map, save.worldSeed)
    expect(save.containers.find((c) => c.id === WARDROBE)!.items).toEqual(fresh.containers.get(WARDROBE)!.items)
    const bagId = save.containers.find((c) => c.id === WARDROBE)!.items.items.find(isBonusItem)!.id
    expect(save.bags).toEqual([fresh.bags.get(bagId)])
    expect(save.bags[0]).toMatchObject({ id: `bag:${bagId}`, kind: 'bag', items: [], slotCapacity: 8 })
  })

  it('is idempotent and round-trips through the runtime exactly', () => {
    const first = migrate(v9())
    expect(migrate(v9()).save).toEqual(first.save)
    expect(migrate(first.save)).toEqual({ ok: true, save: first.save, migrated: false, fromVersion: SAVE_SCHEMA_VERSION })
    const rt = new GameRuntime()
    rt.loadSnapshot(first.save)
    for (let i = 0; i < 2; i++) rt.loadSnapshot(migrate(JSON.parse(JSON.stringify(rt.createSnapshot()))).save)
    expect({ ...rt.createSnapshot(), savedAt: 0 }).toEqual({ ...first.save, savedAt: 0, cameraZoom: zoomAfterLoad(first.save.cameraZoom) })
  })
})

describe('backpack patch rules (owner conditions 1–4)', () => {
  it('1: the recorded opened flag decides, not whether a container still holds items', () => {
    const old = v9()
    old.containers.find((c) => c.id === WARDROBE)!.opened = true
    const { save, lootPatch } = migrate(old)
    expect(save.containers.flatMap((c) => c.items.items).some(isBonusItem)).toBe(false)
    expect(save.bags).toEqual([])
    expect(lootPatch).toEqual([{ rule: 'backpack-v1', itemId: 'backpack', eligible: 0, added: 0, full: 0 }])
    // 4: nothing suitable → items unchanged, the patch is still recorded so it never runs again.
    expect(save.lootPatches).toEqual(['backpack-v1'])
    expect(totals(save)).toEqual(legacyTotals(old))
  })

  it('2: a suitable container without a free slot gets nothing and loses nothing', () => {
    const old = v9()
    const wardrobe = old.containers.find((c) => c.id === WARDROBE)!.items as unknown as LegacyInventory
    for (let n = 0; n < wardrobe.slots.length; n++) {
      if (!wardrobe.slots[n]) wardrobe.slots[n] = { id: `${wardrobe.id}:${wardrobe.nextItemId++}`, itemId: 'chips', kind: 'stack', quantity: 1 }
    }
    const { save, lootPatch } = migrate(old)
    expect(lootPatch).toEqual([{ rule: 'backpack-v1', itemId: 'backpack', eligible: 1, added: 0, full: 1 }])
    expect(save.containers.find((c) => c.id === WARDROBE)!.items.items).toEqual(slots(wardrobe))
    expect(save.bags).toEqual([])
  })

  it('3: the deterministic ID means a patch run twice never adds a second backpack', () => {
    const { save } = migrate(v9())
    const again = structuredClone(save)
    again.lootPatches = []
    const { save: patched, lootPatch } = migrate(again)
    expect(lootPatch).toEqual([{ rule: 'backpack-v1', itemId: 'backpack', eligible: 1, added: 0, full: 0 }])
    expect(patched.containers).toEqual(save.containers)
    expect(patched.bags).toEqual(save.bags)
  })

  it('every older fixture: a backpack only where the container is unopened, suitable, rolled and had room', () => {
    for (const fixture of [v1Fixture, v2Fixture, v3Fixture, v4Fixture, v5Fixture, v6Fixture, v7Fixture]) {
      const { save, lootPatch } = migrate(fixture)
      expect(save.lootPatches).toEqual(['backpack-v1'])
      let expected = 0
      for (const c of save.containers) {
        const table = map.containers.find((d) => d.id === c.id)?.loot
        const suitable = !c.position && !c.opened && table !== undefined && RULE.tables.includes(table as never)
        const got = c.items.items.some(isBonusItem)
        if (got) expect(suitable && bonusRollHits(RULE, save.worldSeed, c.id)).toBe(true)
        if (suitable && bonusRollHits(RULE, save.worldSeed, c.id) && c.items.items.filter((i) => !isBonusItem(i)).length < c.items.slotCapacity!) expect(got).toBe(true)
        if (got) expected += 1
      }
      expect(lootPatch?.[0].added).toBe(expected)
      expect(save.bags).toHaveLength(expected)
    }
  })
})

describe('older fixtures keep every instance, condition and the equipped weapon through v10', () => {
  const stable = legacyContentFor(map)!.ids.containers
  it.each([
    ['v2', v2Fixture], ['v3', v3Fixture], ['v4', v4Fixture], ['v5', v5Fixture], ['v6', v6Fixture], ['v7', v7Fixture],
  ] as const)('%s', (_, fixture) => {
    const { save } = migrate(fixture)
    const owner = new Map<string, { owner: string; item: ItemInstance }>()
    for (const i of save.player.inventory.items) owner.set(i.id, { owner: 'player', item: i })
    for (const c of save.containers) for (const i of c.items.items) owner.set(i.id, { owner: c.id, item: i })
    // Dropped bags (pre-v11) are floor items now.
    for (const { item } of floorItemsOf(save)) owner.set(item.id, { owner: 'floor', item })
    const oldPlayer = fixture.player as unknown as { inventory: LegacyInventory; equipment: { weaponInstanceId: string | null } }
    for (const i of slots(oldPlayer.inventory)) expect(owner.get(i.id)).toEqual({ owner: 'player', item: i })
    for (const c of fixture.containers as unknown as { id: string; items: LegacyInventory; position?: unknown }[]) {
      const id = c.position ? 'floor' : (stable[c.id] ?? c.id)
      for (const i of slots(c.items)) expect(owner.get(i.id)).toEqual({ owner: id, item: i })
    }
    expect(save.player.equipment).toEqual({ weaponInstanceId: oldPlayer.equipment.weaponInstanceId, backInstanceId: null })
  })

  it('v1 (no instance IDs yet): every stack kept in its owner, plus the one granted bat', () => {
    const { save } = migrate(v1Fixture)
    // Only the player and the containers v1 had (later steps seed new containers of their own).
    const had = new Set(v1Fixture.containers.map((c) => stable[c.id]))
    const t = totals({ ...save, containers: save.containers.filter((c) => had.has(c.id)) })
    expect(t).toEqual({ ...legacyTotals(v1Fixture as never), baseball_bat: 1 })
  })
})

describe('v10 validation', () => {
  const good = () => migrate(v9()).save
  it.each([
    ['bag record without a bag', (s: SaveGame) => { s.bags.push({ ...s.bags[0], id: 'bag:ghost' }) }],
    ['bag without its record', (s: SaveGame) => { s.bags = [] }],
    ['bag inside a bag', (s: SaveGame) => { s.bags[0].items.push({ id: `${s.bags[0].id}:1`, itemId: 'backpack', kind: 'bag', quantity: 1 }); s.bags[0].nextItemId = 2 }],
    ['worn bag not carried', (s: SaveGame) => { s.player.equipment.backInstanceId = s.bags[0].id.slice(4) }],
    ['duplicate loot patch', (s: SaveGame) => { s.lootPatches.push('backpack-v1') }],
    ['wrong inventory kind', (s: SaveGame) => { s.containers[0].items.kind = 'player' }],
    ['zero capacity', (s: SaveGame) => { s.containers[0].items.slotCapacity = 0 }],
    ['favorite that is not true', (s: SaveGame) => { (s.player.inventory.items[0] as { favorite?: unknown }).favorite = false }],
  ])('rejects %s', (_, corrupt) => {
    const save = good()
    corrupt(save)
    expect(validateSaveGame(save, map.id, map)).toMatchObject({ ok: false, reason: 'corrupt' })
  })

  it('keeps an over-capacity container (older data is never truncated) and a favorite', () => {
    const save = good()
    const shelf = save.containers.find((c) => c.id === 'c0_-1/store/shelf-2')!.items
    for (let n = 0; n < 9; n++) shelf.items.push({ id: `${shelf.id}:${shelf.nextItemId++}`, itemId: 'nails', kind: 'stack', quantity: 1 })
    expect(shelf.items.length).toBeGreaterThan(shelf.slotCapacity!)
    const first = save.player.inventory.items[0]
    first.favorite = true
    expect(migrate(save)).toMatchObject({ migrated: false, save })
  })

  it('rejects a favorite in a pre-v10 save', () => {
    const old = v9()
    ;(old.player.inventory.slots[0] as { favorite?: boolean }).favorite = true
    expect(validateSaveGame(old, map.id, map)).toMatchObject({ ok: false, reason: 'corrupt' })
  })
})

describe('loot is rolled once (T15, T16 as generator calls)', () => {
  it('New Game rolls each container once; the runtime constructor rolls no extra placeholder world', () => {
    const before = lootStats.generated
    const rt = new GameRuntime()
    expect(lootStats.generated - before).toBe(map.containers.length)
    rt.newGame(5)
    expect(lootStats.generated - before).toBe(2 * map.containers.length)
  })

  it('opening, closing and loading never roll; an emptied container stays empty through reload (T15)', () => {
    const rt = new GameRuntime()
    rt.newGame(8)
    const box = rt.interactables.find((i) => i.kind === 'container')!
    rt.openLoot(box.id, true)
    rt.takeAll()
    const left = totalQuantity(rt.openContainer!.items)
    const before = lootStats.generated
    for (let n = 0; n < 5; n++) {
      rt.closeAllUi()
      rt.openLoot(box.id, true)
    }
    const snap = migrate(JSON.parse(JSON.stringify(rt.createSnapshot()))).save
    const other = new GameRuntime()
    const afterCtor = lootStats.generated
    other.loadSnapshot(snap)
    other.loadSnapshot(migrate(JSON.parse(JSON.stringify(other.createSnapshot()))).save)
    expect(lootStats.generated - afterCtor).toBe(0)
    expect(afterCtor - before).toBe(map.containers.length) // only the second runtime's own New Game
    expect(totalQuantity(other.world.containers.get(box.id)!.items)).toBe(left)
    expect(other.world.containers.get(box.id)!.opened).toBe(true)
  })

  it('migrating an old save rolls only the containers that did not exist in it', () => {
    const before = lootStats.generated
    migrate(v9())
    expect(lootStats.generated - before).toBe(0)
    migrate(v2Fixture)
    // v2 → v3 seeds the P2-S2 containers and v4 → v5 the P2-S4 ones: nothing else is rolled.
    expect(lootStats.generated - before).toBe(CONTAINERS_ADDED_V3.size + CONTAINERS_ADDED_V5.size)
  })
})

describe('bags in the runtime (data level; the bag UI comes in S3)', () => {
  const withBag = () => {
    const rt = new GameRuntime()
    rt.newGame(3)
    addItem(rt.player.inventory, 'backpack', 1)
    const bag = rt.player.inventory.items.find((i) => i.kind === 'bag')!
    rt.world.bags.set(bag.id, { id: `bag:${bag.id}`, kind: 'bag', nextItemId: 1, items: [], slotCapacity: 8 })
    addItem(rt.world.bags.get(bag.id)!, 'water', 2)
    return { rt, bag, contents: rt.world.bags.get(bag.id)! }
  }

  it('the worn bag is usable (Q2); a carried bag that is not worn is not', () => {
    const { rt, bag, contents } = withBag()
    const water = contents.items[0].id
    rt.player.thirst = 10
    expect(rt.useItem('worn', water)).toMatchObject({ ok: false, reason: 'unreachable' })
    expect(rt.wearBag(bag.id)).toBe(true)
    expect(rt.usableInventories).toEqual([rt.player.inventory, contents])
    expect(rt.useItem('worn', water).ok).toBe(true)
    for (let i = 0; i < 180; i++) rt.tick(1 / 60)
    expect(contents.items[0].quantity).toBe(1)
  })

  it('T13 (data): a dropped bag keeps its contents and weight through save/load and pick-up, counted once', () => {
    const { rt, bag } = withBag()
    const weight = inventoryWeight(rt.player.inventory, rt.world.bags)
    expect(rt.dropItem(bag.id)).toBe(true)
    const snap = migrate(JSON.parse(JSON.stringify(rt.createSnapshot()))).save
    expect(snap.bags).toHaveLength(1)
    expect(floorItemsOf(snap).map((e) => e.item.id)).toEqual([bag.id])
    const other = new GameRuntime()
    other.loadSnapshot(snap)
    other.tick(1 / 60)
    expect(other.transferItems('floor', 'main', [{ instanceId: bag.id }]).moved).toBe(1)
    expect(other.world.bags.get(bag.id)!.items).toEqual([expect.objectContaining({ itemId: 'water', quantity: 2 })])
    expect(inventoryWeight(other.player.inventory, other.world.bags)).toBeCloseTo(weight)
  })
})
