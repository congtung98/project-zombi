import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../core/runtime'
import { addItem, countItem, totalQuantity } from './inventory'
import { containerKey, type TransferSummary } from './inventoryCommands'
import { GAME_CONFIG } from '../core/config'

const CABINET = 'c-1_-1/safehouse/cabinet'

/** Stand next to the cabinet (walls ignored: reach through walls is tested in floor.test.ts) and open it. */
function setup() {
  const rt = new GameRuntime()
  rt.newGame(4242)
  rt.setLineOfSightOverride({ isBlocked: () => false })
  const cabinet = rt.interactables.find((i) => i.id === CABINET)!
  rt.player.position = { x: cabinet.position.x + 0.5, y: 0, z: cabinet.position.z }
  rt.interact(cabinet)
  const summaries: { moved: number; skipped: string[] }[] = []
  rt.events.on('inventory:transferred', (e) => summaries.push({ moved: e.moved, skipped: e.skipped }))
  return { rt, box: containerKey(CABINET), summaries }
}

const everything = (rt: GameRuntime) => totalQuantity(rt.player.inventory) + [...rt.world.containers.values()].reduce((n, c) => n + totalQuantity(c.items), 0)

describe('transferItems: one command path with state rules', () => {
  it('moves by instance ID between the open container and the main inventory, one summary per call', () => {
    const { rt, box, summaries } = setup()
    const total = everything(rt)
    const ids = rt.openContainer!.items.items.map((i) => i.id)
    const r = rt.transferItems(box, 'main', ids.map((instanceId) => ({ instanceId })))
    expect(r).toMatchObject({ skipped: [] })
    expect(r.movedLines).toBe(ids.length)
    expect(rt.openContainer!.items.items).toHaveLength(0)
    expect(everything(rt)).toBe(total)
    rt.events.flush()
    expect(summaries).toHaveLength(1)
    // Back again, then a missing ID is reported, not ignored.
    const back = rt.transferItems('main', box, [{ instanceId: ids[0] }, { instanceId: 'nobody' }])
    expect(back.skipped).toEqual([{ instanceId: 'nobody', itemId: null, reason: 'missing' }])
    expect(everything(rt)).toBe(total)
  })

  it('an equipped weapon or worn bag never moves; a favorite never leaves what is carried but moves inside it', () => {
    const { rt, box } = setup()
    addItem(rt.player.inventory, 'baseball_bat', 1)
    addItem(rt.player.inventory, 'backpack', 1)
    addItem(rt.player.inventory, 'water', 2)
    const bat = rt.player.inventory.items.find((i) => i.kind === 'weapon')!
    const bag = rt.player.inventory.items.find((i) => i.kind === 'bag')!
    const water = rt.player.inventory.items.find((i) => i.itemId === 'water')!
    rt.world.bags.set(bag.id, { id: `bag:${bag.id}`, kind: 'bag', nextItemId: 1, items: [], slotCapacity: 8 })
    expect(rt.equipItem(bat.id)).toBe(true)
    expect(rt.wearBag(bag.id)).toBe(true)
    expect(rt.setFavorite(water.id, true)).toBe(true)
    const reasons = (s: TransferSummary) => s.skipped.map((x) => x.reason)
    expect(reasons(rt.transferItems('main', box, [{ instanceId: bat.id }, { instanceId: bag.id }, { instanceId: water.id }]))).toEqual(['equipped', 'equipped', 'favorite'])
    expect(reasons(rt.transferItems('main', 'worn', [{ instanceId: bat.id }]))).toEqual(['equipped'])
    expect(rt.dropItem(water.id)).toBe(false)
    expect(rt.transferItems('main', 'worn', [{ instanceId: water.id }]).moved).toBe(2)
    expect(rt.world.bags.get(bag.id)!.items[0]).toMatchObject({ id: water.id, favorite: true })
    // Un-favorited it may be stored; a new water never merges into a favorite stack.
    addItem(rt.world.bags.get(bag.id)!, 'water', 1)
    expect(rt.world.bags.get(bag.id)!.items).toHaveLength(2)
    expect(rt.setFavorite(water.id, false)).toBe(true)
    expect(rt.transferItems('worn', box, [{ instanceId: water.id }]).moved).toBe(2)
    expect(rt.player.equipment).toEqual({ weaponInstanceId: bat.id, backInstanceId: bag.id })
  })

  it('reserved materials stay while an action runs; unreachable and busy are reported', () => {
    const { rt, box } = setup()
    addItem(rt.player.inventory, 'baseball_bat', 1, { condition: 5 })
    addItem(rt.player.inventory, 'wood_plank', 1)
    addItem(rt.player.inventory, 'duct_tape', 1)
    const bat = rt.player.inventory.items.find((i) => i.kind === 'weapon')!
    expect(rt.startRepair(bat.id).ok).toBe(true)
    const plank = rt.player.inventory.items.find((i) => i.itemId === 'wood_plank')!
    expect(rt.transferItems('main', box, [{ instanceId: plank.id }, { instanceId: bat.id }]).skipped.map((s) => s.reason)).toEqual(['reserved', 'reserved'])
    rt.cancelAction()
    // Out of reach (walked away): nothing moves, whether the loot window is open or not.
    rt.player.position = { x: rt.player.position.x + 5, y: 0, z: rt.player.position.z }
    expect(rt.transferItems('main', box, [{ instanceId: plank.id }]).skipped[0].reason).toBe('unreachable')
    expect(rt.transferItems('main', 'worn', [{ instanceId: plank.id }]).skipped[0].reason).toBe('unreachable')
  })

  it('Take All into a full inventory: merges what fits, leaves the rest in the container with the reason', () => {
    const { rt, box } = setup()
    const total = everything(rt)
    for (let i = 0; i < GAME_CONFIG.inventory.slots; i++) addItem(rt.player.inventory, 'medkit', 1)
    const r = rt.takeAll()
    expect(r.moved).toBe(0)
    expect(r.reason).toBe('full')
    expect(everything(rt)).toBe(total + GAME_CONFIG.inventory.slots)
    expect(rt.transferItems(box, 'main', rt.openContainer!.items.items.map((i) => ({ instanceId: i.id }))).skipped.every((s) => s.reason === 'full')).toBe(true)
    expect(countItem(rt.player.inventory, 'medkit')).toBe(GAME_CONFIG.inventory.slots)
  })
})

describe('the inventory window and the loot window are independent', () => {
  it('I toggles only the inventory; closing the container keeps the inventory; closeAllUi closes both', () => {
    const { rt } = setup()
    expect([rt.inventoryOpen, rt.openContainerId]).toEqual([true, CABINET])
    rt.toggleInventory()
    expect([rt.inventoryOpen, rt.openContainerId, rt.uiOpen]).toEqual([false, CABINET, true])
    rt.toggleInventory()
    rt.closeContainer()
    expect([rt.inventoryOpen, rt.openContainerId, rt.uiOpen]).toEqual([true, null, true])
    rt.interact(rt.interactables.find((i) => i.id === CABINET)!)
    rt.closeAllUi()
    expect([rt.inventoryOpen, rt.openContainerId, rt.uiOpen]).toEqual([false, null, false])
  })
})
