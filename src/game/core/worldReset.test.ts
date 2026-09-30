import { describe, expect, it } from 'vitest'
import { GameRuntime } from './runtime'
import { addItem } from '../systems/inventory'
import { containerKey } from '../systems/inventoryCommands'
import type { SaveGame } from '../../types/save'

/**
 * INV-LOOT S5 T22: New Game after looting the previous world starts a world of its own: nothing of
 * the old one's containers, floor, bags, queue or reservations stays, and it equals a New Game of
 * the same seed on a runtime that never played.
 */
const CABINET = 'c-1_-1/safehouse/cabinet'
const DT = 1 / 60

const comparable = (s: SaveGame) => ({ ...s, savedAt: 0 })

describe('T22 New Game after looting', () => {
  it('leaves nothing of the looted world and equals a fresh New Game with the same seed', () => {
    const rt = new GameRuntime()
    rt.newGame(4242)
    rt.setLineOfSightOverride({ isBlocked: () => false })
    const cabinet = rt.interactables.find((i) => i.id === CABINET)!
    rt.player.position = { x: cabinet.position.x + 0.5, y: 0, z: cabinet.position.z }
    rt.openLoot(cabinet.id, true)
    const box = containerKey(CABINET)
    // Loot part of it, leave a job running, drop something, wear a bag.
    expect(rt.queueTransfer(box, 'main', rt.openContainer!.items.items.map((i) => ({ instanceId: i.id }))).id).not.toBeNull()
    for (let i = 0; i < 20; i++) rt.tick(DT)
    addItem(rt.player.inventory, 'water', 2)
    expect(rt.dropItem(rt.player.inventory.items.find((i) => i.itemId === 'water')!.id)).toBe(true)
    addItem(rt.player.inventory, 'backpack', 1)
    const bag = rt.player.inventory.items.find((i) => i.kind === 'bag')!
    rt.world.bags.set(bag.id, { id: `bag:${bag.id}`, kind: 'bag', nextItemId: 1, items: [], slotCapacity: 8 })
    expect(rt.wearBag(bag.id)).toBe(true)
    expect(rt.jobs.length).toBeGreaterThan(0)
    expect(rt.world.containers.get(CABINET)!.opened).toBe(true)

    rt.newGame(99)
    expect(rt.jobs).toEqual([])
    expect(rt.ledger.isEmpty()).toBe(true)
    expect([rt.inventoryOpen, rt.lootOpen, rt.openContainerId, rt.uiOpen]).toEqual([false, false, null, false])
    expect(rt.player.equipment).toEqual({ weaponInstanceId: null, backInstanceId: null })
    expect([...rt.world.containers.values()].some((c) => c.opened)).toBe(false)
    expect(rt.world.floor.serialize()).toEqual([])

    const fresh = new GameRuntime()
    fresh.newGame(99)
    expect(comparable(rt.createSnapshot())).toEqual(comparable(fresh.createSnapshot()))
  })
})
