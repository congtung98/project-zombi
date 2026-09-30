import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../core/runtime'
import { addItem, findItem, totalQuantity } from './inventory'
import { containerKey } from './inventoryCommands'
import { validateSaveGame } from './save'
import type { SaveGame } from '../../types/save'
import type { ItemInstance } from '../entities/items'
import { NEIGHBORHOOD_MAP } from '../world/mapData'
import v9Fixture from './fixtures/inv-loot-v9.json'

/** INV-LOOT S5: a save with items this version does not know (spec §11.3.7, T19/T20). */
const CABINET = 'c-1_-1/safehouse/cabinet'

function setup() {
  const rt = new GameRuntime()
  rt.newGame(4242)
  rt.setLineOfSightOverride({ isBlocked: () => false })
  const cabinet = rt.interactables.find((i) => i.id === CABINET)!
  rt.player.position = { x: cabinet.position.x + 0.5, y: 0, z: cabinet.position.z }
  return rt
}

/** A snapshot whose chosen instances are rewritten to unknown item IDs (a removed item, a newer save). */
function withUnknownItems(rt: GameRuntime): { save: SaveGame; stored: Record<string, unknown>[] } {
  addItem(rt.player.inventory, 'water', 3)
  addItem(rt.player.inventory, 'baseball_bat', 1, { condition: 50 })
  addItem(rt.player.inventory, 'backpack', 1)
  const bag = rt.player.inventory.items.find((i) => i.kind === 'bag')!
  rt.world.bags.set(bag.id, { id: `bag:${bag.id}`, kind: 'bag', nextItemId: 1, items: [], slotCapacity: 8 })
  addItem(rt.world.bags.get(bag.id)!, 'chips', 2)
  const bat = rt.player.inventory.items.find((i) => i.kind === 'weapon')!
  expect(rt.equipItem(bat.id)).toBe(true)
  expect(rt.wearBag(bag.id)).toBe(true)
  const save = structuredClone(rt.createSnapshot())
  const main = save.player.inventory.items as unknown as Record<string, unknown>[]
  const water = main.find((i) => i.itemId === 'water')!
  Object.assign(water, { itemId: 'rare_gem', favorite: true, extra: { cut: 'oval' } })
  const weapon = main.find((i) => i.kind === 'weapon')!
  weapon.itemId = 'katana'
  // A bag the game no longer knows, worn, still holding its contents record.
  const wornBag = main.find((i) => i.kind === 'bag')!
  wornBag.itemId = 'duffel_bag'
  const box = save.containers.find((c) => c.id === CABINET)!
  const inBox = { id: `${box.items.id}:${box.items.nextItemId++}`, itemId: 'radio', kind: 'tool', quantity: 1, battery: 0.4 }
  ;(box.items.items as unknown as Record<string, unknown>[]).push(inBox)
  return { save, stored: [water, weapon, wornBag, inBox].map((i) => structuredClone(i)) }
}

const storedItems = (save: SaveGame): ItemInstance[] => [
  ...save.player.inventory.items,
  ...save.containers.flatMap((c) => c.items.items),
  ...save.floor.flatMap((c) => c.items.items),
  ...save.bags.flatMap((b) => b.items),
]

describe('INV-LOOT S5 unknown item recovery', () => {
  it('T19: a save with unknown item IDs loads, keeps every one, takes off the equipped ones and saves them back unchanged', () => {
    const source = setup()
    const { save, stored } = withUnknownItems(source)
    const checked = validateSaveGame(save, source.map.id, source.map)
    expect(checked.ok).toBe(true)

    const rt = setup()
    const events: unknown[] = []
    rt.events.on('items:recovered', (e) => events.push(e))
    rt.loadSnapshot(save)
    rt.events.flush()
    expect(events).toEqual([{ itemIds: ['rare_gem', 'katana', 'duffel_bag', 'radio'], unequipped: ['weapon', 'back'] }])
    const unknown = rt.player.inventory.items.filter((i) => i.kind === 'unknown')
    expect(unknown.map((i) => i.id)).toEqual(stored.slice(0, 3).map((s) => s.id))
    expect(unknown[0]).toMatchObject({ itemId: 'unknown_item', quantity: 1, favorite: true })
    expect(rt.player.equipment).toEqual({ weaponInstanceId: null, backInstanceId: null })
    expect(findItem(rt.world.containers.get(CABINET)!.items, stored[3].id as string)?.kind).toBe('unknown')

    // Round trip: the stored payloads come back exactly as they were, the rest unchanged.
    const again = rt.createSnapshot()
    for (const s of stored) expect(storedItems(again).find((i) => i.id === s.id)).toEqual(s)
    expect(again.bags).toEqual(save.bags)
    expect(validateSaveGame(again, rt.map.id, rt.map).ok).toBe(true)
    // T20: loading it again adds nothing and changes nothing.
    const rt2 = setup()
    rt2.loadSnapshot(again)
    const third = rt2.createSnapshot()
    expect(storedItems(third).map((i) => [i.id, i.itemId, i.quantity])).toEqual(storedItems(again).map((i) => [i.id, i.itemId, i.quantity]))
  })

  it('an unknown item is never used, equipped, worn, merged or put into a bag; it moves whole and drops', () => {
    const source = setup()
    const { save, stored } = withUnknownItems(source)
    const rt = setup()
    rt.loadSnapshot(save)
    const gem = stored[0].id as string
    const katana = stored[1].id as string
    const duffel = stored[2].id as string
    expect(rt.useItem('main', gem).ok).toBe(false)
    expect(rt.equipItem(katana)).toBe(false)
    expect(rt.wearBag(duffel)).toBe(false)
    expect(rt.player.equipment).toEqual({ weaponInstanceId: null, backInstanceId: null })
    // Into a worn bag: refused (it may be a bag itself).
    addItem(rt.player.inventory, 'backpack', 1)
    const bag = rt.player.inventory.items.find((i) => i.kind === 'bag')!
    rt.world.bags.set(bag.id, { id: `bag:${bag.id}`, kind: 'bag', nextItemId: 1, items: [], slotCapacity: 8 })
    expect(rt.wearBag(bag.id)).toBe(true)
    expect(rt.transferItems('main', 'worn', [{ instanceId: katana }]).skipped[0].reason).toBe('bag-in-bag')
    // Into the cabinet and back: one whole thing, same ID, payload kept.
    rt.interact(rt.interactables.find((i) => i.id === CABINET)!)
    const box = containerKey(CABINET)
    const room = rt.world.containers.get(CABINET)!.items
    while (room.items.length >= room.slotCapacity!) room.items.pop()
    expect(rt.transferItems('main', box, [{ instanceId: katana, quantity: 1 }]).moved).toBe(1)
    expect(findItem(room, katana)).toMatchObject({ kind: 'unknown', raw: { itemId: 'katana', condition: 50 } })
    expect(rt.transferItems(box, 'main', [{ instanceId: katana }]).moved).toBe(1)
    // Unfavorite then drop on the floor: it lies there and is saved back as it was (favorite gone).
    expect(rt.setFavorite(gem, false)).toBe(true)
    expect(rt.dropItem(gem)).toBe(true)
    const saved = storedItems(rt.createSnapshot()).find((i) => i.id === gem) as unknown as Record<string, unknown>
    const { favorite: _f, ...rest } = stored[0]
    expect(saved).toEqual(rest)
    expect(totalQuantity(rt.player.inventory)).toBeGreaterThan(0)
  })

  it('an unknown item in a v9 slot save survives the migrations to v11 and loads as a recovery item', () => {
    const old = structuredClone(v9Fixture) as unknown as { player: { inventory: { id: string; nextItemId: number; slots: unknown[] } } }
    const inv = old.player.inventory
    const id = `${inv.id}:${inv.nextItemId++}`
    inv.slots[1] = { id, itemId: 'flare_gun', kind: 'weapon', quantity: 1, condition: 7 }
    const checked = validateSaveGame(old, NEIGHBORHOOD_MAP.id, NEIGHBORHOOD_MAP)
    expect(checked).toMatchObject({ ok: true, migrated: true, fromVersion: 9 })
    if (!checked.ok) return
    expect(checked.save.player.inventory.items.find((i) => i.id === id)).toEqual({ id, itemId: 'flare_gun', kind: 'weapon', quantity: 1, condition: 7 })
    const rt = new GameRuntime(NEIGHBORHOOD_MAP)
    rt.loadSnapshot(checked.save)
    expect(findItem(rt.player.inventory, id)).toMatchObject({ kind: 'unknown', raw: { itemId: 'flare_gun', condition: 7 } })
    expect(storedItems(rt.createSnapshot()).find((i) => i.id === id)).toEqual({ id, itemId: 'flare_gun', kind: 'weapon', quantity: 1, condition: 7 })
  })

  it('broken shapes of an unknown item and the stand-in ID itself are still refused', () => {
    const rt = setup()
    const save = structuredClone(rt.createSnapshot()) as unknown as Record<string, unknown>
    const items = (save.player as { inventory: { items: Record<string, unknown>[]; nextItemId: number; id: string } }).inventory
    items.items.push({ id: `${items.id}:${items.nextItemId++}`, itemId: 'mystery', kind: 'stack', quantity: 4 })
    expect(validateSaveGame(save, rt.map.id, rt.map).ok).toBe(true)
    for (const bad of [{ quantity: 0 }, { quantity: 1.5 }, { kind: undefined }, { itemId: 'unknown_item' }, { itemId: '' }]) {
      const copy = structuredClone(save) as typeof save
      const inv = (copy.player as typeof save.player & { inventory: { items: Record<string, unknown>[] } }).inventory
      Object.assign(inv.items[inv.items.length - 1], bad)
      expect(validateSaveGame(copy, rt.map.id, rt.map)).toMatchObject({ ok: false, reason: 'corrupt' })
    }
  })
})
