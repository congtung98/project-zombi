import { GAME_CONFIG } from '../core/config'
import { describe, expect, it } from 'vitest'
import v10Fixture from './fixtures/inv-loot-v10.json'
import { FloorStore, floorCellId } from './floor'
import { addItem, totalQuantity, transferItem } from './inventory'
import { inventoryWeight } from './bags'
import { containerKey } from './inventoryCommands'
import { validateSaveGame, type SaveValidation } from './save'
import { GameRuntime } from '../core/runtime'
import { NEIGHBORHOOD_MAP } from '../world/mapData'
import { SAVE_SCHEMA_VERSION, type SaveGame } from '../../types/save'
import { dropItemsOf, floorItemsOf } from '../../test/legacySave'

/** A load clamps the stored zoom into the camera's current range (ba1db67 moved it to 32–128), so an older fixture's zoom comes back clamped. */
const zoomAfterLoad = (z: number) => Math.min(GAME_CONFIG.camera.zoomMax, Math.max(GAME_CONFIG.camera.zoomMin, z))

const map = NEIGHBORHOOD_MAP
const migrate = (data: unknown): Extract<SaveValidation, { ok: true }> => {
  const r = validateSaveGame(data, map.id, map)
  if (!r.ok) throw new Error(r.detail)
  return r
}

describe('FloorStore', () => {
  it('cells per 1 m and storey; every item keeps its own position; drops never merge', () => {
    const floor = new FloorStore()
    expect(floorCellId({ x: 1.4, y: 0, z: -0.2 })).toBe('floor:0:1:-1')
    expect(floorCellId({ x: 1.4, y: 2.9, z: -0.2 })).toBe('floor:290:1:-1')
    const a = { x: 1.2, y: 0, z: 0.3 }
    const b = { x: 1.8, y: 0, z: 0.6 }
    const cell = floor.cellAt(a)
    addItem(cell.items, 'water', 2)
    floor.sync(cell, a)
    const source = floor.cellAt(b) // same cell
    expect(source).toBe(cell)
    const hand = { id: 'p', kind: 'player' as const, nextItemId: 1, items: [{ id: 'p:1', itemId: 'water' as const, kind: 'stack' as const, quantity: 3 }], slotCapacity: 12 }
    transferItem(hand, 'p:1', cell.items)
    floor.sync(cell, b)
    // Two piles of water where they fell, not one merged stack.
    expect(cell.items.items.map((i) => i.quantity)).toEqual([2, 3])
    expect(floor.find(cell.items.items[0].id)!.position).toEqual(a)
    expect(floor.find('p:1')!.position).toEqual(b)
    // A part taken from the pile leaves the rest where it was.
    const back = { ...hand, items: [] }
    transferItem(cell.items, 'p:1', back, 1)
    floor.sync(cell)
    expect(floor.find('p:1')).toMatchObject({ position: b, item: { quantity: 2 } })
    // Round trip; an emptied cell disappears.
    const restored = FloorStore.restore(floor.serialize())
    expect(restored.entries().map((e) => [e.item.id, e.position])).toEqual(floor.entries().map((e) => [e.item.id, e.position]))
    for (const e of floor.entries()) transferItem(cell.items, e.item.id, back)
    floor.sync(cell)
    expect(floor.cells.size).toBe(0)
  })

  it('near() keeps the storey and the real distance of each item', () => {
    const floor = new FloorStore()
    for (const [x, y] of [[0.5, 0], [1.4, 0], [1.9, 0], [0.5, 2.9]] as const) {
      const p = { x, y, z: 0.5 }
      const cell = floor.cellAt(p)
      addItem(cell.items, 'nails', 1)
      floor.sync(cell, p)
    }
    expect(floor.near({ x: 0, y: 0, z: 0.5 }, 1.6, 0).map((e) => e.position.x).sort()).toEqual([0.5, 1.4])
    expect(floor.near({ x: 0, y: 2.9, z: 0.5 }, 1.6, 2.9).map((e) => e.position.x)).toEqual([0.5])
  })
})

describe('reach (INV-LOOT §7.2)', () => {
  function standBy(rt: GameRuntime, id: string) {
    const target = rt.interactables.find((i) => i.id === id)!
    rt.player.position = { x: target.position.x + 0.5, y: 0, z: target.position.z }
    return target
  }

  it('T08: a container behind a wall is not in reach: not listed, nothing moves', () => {
    const rt = new GameRuntime()
    rt.newGame(11)
    const id = map.containers.find((c) => c.loot === 'safehouse-cabinet')!.id
    let wall = false
    rt.setLineOfSightOverride({ isBlocked: () => wall })
    const target = standBy(rt, id)
    rt.tick(1 / 60)
    expect(rt.nearbyContainerIds).toContain(id)
    wall = true
    for (let i = 0; i < 3; i++) rt.tick(0.1)
    expect(rt.nearbyContainerIds).not.toContain(id)
    rt.interact(target)
    expect(rt.lootInReach).toBe(false)
    const first = rt.openContainer!.items.items[0]
    expect(rt.transferItems(containerKey(id), 'main', [{ instanceId: first.id }]).skipped[0].reason).toBe('unreachable')
  })

  it('floor items are reached one by one at their own position, never through a wall', () => {
    const rt = new GameRuntime()
    rt.newGame(12)
    rt.setLineOfSightOverride({ isBlocked: () => false })
    rt.player.position = { x: -13, y: 0, z: -13 }
    for (const [x, itemId] of [[-11.6, 'water'], [-11.1, 'nails']] as const) {
      const p = { x, y: 0, z: -13 }
      const cell = rt.world.floor.cellAt(p)
      addItem(cell.items, itemId, 1)
      rt.world.floor.sync(cell, p)
    }
    const [near, far] = rt.world.floor.entries().sort((a, b) => a.position.x - b.position.x).map((e) => e.item.id)
    expect(rt.world.floor.find(near)!.cell).toBe(rt.world.floor.find(far)!.cell) // same 1 m cell
    rt.tick(1 / 60)
    expect(rt.nearbyFloorIds).toEqual([near])
    const r = rt.transferItems('floor', 'main', [{ instanceId: near }, { instanceId: far }])
    expect([r.moved, r.skipped.map((s) => s.reason)]).toEqual([1, ['unreachable']])
    rt.setLineOfSightOverride({ isBlocked: () => true })
    rt.player.position = { x: -12, y: 0, z: -13 }
    expect(rt.transferItems('floor', 'main', [{ instanceId: far }]).skipped[0].reason).toBe('unreachable')
  })

  it('a container coming into reach never takes the tab being looked at; E on nothing opens the floor', () => {
    const rt = new GameRuntime()
    rt.newGame(13)
    rt.setLineOfSightOverride({ isBlocked: () => false })
    const [a, b] = map.containers.filter((c) => c.id.startsWith('c0_-1/store/shelf')).map((c) => c.id)
    rt.interact(standBy(rt, a))
    standBy(rt, b)
    for (let i = 0; i < 3; i++) rt.tick(0.1)
    expect(rt.nearbyContainerIds).toContain(b)
    expect(rt.openContainerId).toBe(a)
    rt.closeAllUi()
    // Something on the ground, nothing targeted: E opens the loot window on the floor.
    rt.player.position = { x: -13, y: 0, z: -13 }
    rt.player.inventory.items.push({ id: 'test:w', itemId: 'water', kind: 'stack', quantity: 1 })
    expect(rt.dropItem('test:w')).toBe(true)
    for (let i = 0; i < 3; i++) rt.tick(0.1)
    rt.input.simulateKey('KeyE', true)
    rt.tick(1 / 60)
    rt.input.simulateKey('KeyE', false)
    expect([rt.lootOpen, rt.openContainerId, rt.nearbyFloorIds]).toEqual([true, null, ['test:w']])
  })
})

describe('bags and the floor (T13) and the floor through saves (T17)', () => {
  it('a worn bag with items: take off, drop, save/load, pick up, wear: contents and weight kept, counted once', () => {
    const rt = new GameRuntime()
    rt.newGame(21)
    rt.setLineOfSightOverride({ isBlocked: () => false })
    rt.player.position = { x: -13, y: 0, z: -13 }
    addItem(rt.player.inventory, 'backpack', 1)
    const bag = rt.player.inventory.items.find((i) => i.kind === 'bag')!
    rt.world.bags.set(bag.id, { id: `bag:${bag.id}`, kind: 'bag', nextItemId: 1, items: [], slotCapacity: 8 })
    expect(rt.wearBag(bag.id)).toBe(true)
    addItem(rt.world.bags.get(bag.id)!, 'wood_plank', 3)
    addItem(rt.world.bags.get(bag.id)!, 'water', 2)
    const weight = inventoryWeight(rt.player.inventory, rt.world.bags)
    expect(rt.dropItem(bag.id)).toBe(false) // worn: take it off first
    expect(rt.wearBag(null)).toBe(true)
    expect(rt.dropItem(bag.id)).toBe(true)
    let save = migrate(JSON.parse(JSON.stringify(rt.createSnapshot()))).save
    for (let i = 0; i < 2; i++) {
      const next = new GameRuntime()
      next.loadSnapshot(save)
      save = migrate(JSON.parse(JSON.stringify(next.createSnapshot()))).save
    }
    // T17: one floor item, one bag record, no second copy after two reloads.
    expect(floorItemsOf(save).map((e) => e.item.id)).toEqual([bag.id])
    expect(save.bags.map((b) => b.id)).toEqual([`bag:${bag.id}`])
    const other = new GameRuntime()
    other.loadSnapshot(save)
    other.setLineOfSightOverride({ isBlocked: () => false })
    other.tick(0.1)
    expect(other.transferItems('floor', 'main', [{ instanceId: bag.id }]).moved).toBe(1)
    expect(other.wearBag(bag.id)).toBe(true)
    expect(other.usableInventories[1].items.map((i) => [i.itemId, i.quantity])).toEqual([['wood_plank', 3], ['water', 2]])
    expect(inventoryWeight(other.player.inventory, other.world.bags)).toBeCloseTo(weight)
    expect(other.world.floor.entries()).toHaveLength(0)
  })
})

describe('v10 → v11: a real v10 save (written by the S2 code)', () => {
  it('dropped bags become floor items at the same place; bags, favorites and equipment untouched', () => {
    const old = structuredClone(v10Fixture) as unknown as SaveGame
    const { save, migrated, fromVersion } = migrate(old)
    expect([migrated, fromVersion, save.schemaVersion]).toEqual([true, 10, SAVE_SCHEMA_VERSION])
    expect(floorItemsOf(save)).toEqual(dropItemsOf(old))
    expect(save.containers).toEqual(old.containers.filter((c) => !c.position))
    expect(save.bags).toEqual(old.bags)
    expect(save.player).toEqual(old.player)
    expect(save.bags.flatMap((b) => b.items).find((i) => i.favorite)).toMatchObject({ itemId: 'water' })
    expect(save.lootPatches).toEqual(old.lootPatches)
    const count = (s: SaveGame) => totalQuantity(s.player.inventory) + s.containers.reduce((n, c) => n + totalQuantity(c.items), 0) + (s.floor ?? []).reduce((n, c) => n + totalQuantity(c.items), 0) + s.bags.reduce((n, b) => n + totalQuantity(b), 0)
    expect(count(save)).toBe(count(old))
    // Idempotent; loads and round-trips.
    expect(migrate(save)).toEqual({ ok: true, save, migrated: false, fromVersion: SAVE_SCHEMA_VERSION })
    const rt = new GameRuntime()
    rt.loadSnapshot(save)
    expect({ ...rt.createSnapshot(), savedAt: 0 }).toEqual({ ...save, savedAt: 0, cameraZoom: zoomAfterLoad(save.cameraZoom) })
  })

  it('rejects a dropped bag in a v11 save and a floor item outside its cell', () => {
    const { save } = migrate(structuredClone(v10Fixture))
    const withBag = structuredClone(save) as unknown as { containers: unknown[] }
    withBag.containers.push(structuredClone((v10Fixture as unknown as SaveGame).containers.find((c) => c.position)))
    expect(validateSaveGame(withBag, map.id, map)).toMatchObject({ ok: false, reason: 'corrupt' })
    const moved = structuredClone(save)
    moved.floor[0].positions[0].position.x += 3
    expect(validateSaveGame(moved, map.id, map)).toMatchObject({ ok: false, reason: 'corrupt' })
  })
})
