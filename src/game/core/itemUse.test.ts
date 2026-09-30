import { afterEach, describe, expect, it } from 'vitest'
import { GameRuntime } from './runtime'
import { addItem, countItem } from '../systems/inventory'
import { containerKey } from '../systems/inventoryCommands'
import { ITEMS } from '../entities/items'
import { validateSaveGame } from '../systems/save'
import type { MapData } from '../world/mapData'

/**
 * AX2 item actions through the runtime (CAS §11, FB §15 cases 2, 5, 6): using an item is timed,
 * all-or-nothing, cancelled cleanly, and a sealed tin is opened first.
 */
const DT = 1 / 60
const CABINET = 'c-1_-1/safehouse/cabinet'

function field(): MapData {
  return { id: 'field', size: 20, playerSpawn: { x: 0, y: 0, z: 0 }, zombieSpawns: [], buildings: [], walls: [], doors: [], containers: [], roads: [] }
}

function setup() {
  const rt = new GameRuntime(field())
  const events: string[] = []
  rt.events.on('item:used', (e) => events.push(`used ${e.itemId}`))
  rt.events.on('item:useFailed', (e) => events.push(`failed ${e.itemId} ${e.reason}`))
  rt.events.on('item:opened', (e) => events.push(`opened ${e.itemId}`))
  rt.events.on('action:cancelled', (e) => events.push(`cancelled ${e.reason}`))
  return { rt, events }
}

const run = (rt: GameRuntime, seconds: number) => {
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    rt.tick(Math.min(DT, seconds - t))
    rt.events.flush()
  }
}
const hit = (rt: GameRuntime) => (rt as unknown as { applyPlayerDamage(amount: number, sourceId: string): void }).applyPlayerDamage(10, 'zombie-1')
const idOf = (rt: GameRuntime, itemId: string) => rt.player.inventory.items.find((i) => i.itemId === itemId)!.id

const sealed = { ...ITEMS.canned_food.sealed! }
afterEach(() => {
  ITEMS.canned_food.sealed = { ...sealed }
})

describe('AX2 item use', () => {
  it('Case 2: drinking takes its time; the effect and the unit come together at the end', () => {
    const { rt, events } = setup()
    addItem(rt.player.inventory, 'water', 2)
    rt.player.thirst = 30
    expect(rt.useItem('main', idOf(rt, 'water'))).toMatchObject({ ok: true, queued: false })
    run(rt, 1)
    expect(rt.characterState).toBe('DRINKING')
    expect([rt.player.thirst < 30, countItem(rt.player.inventory, 'water')]).toEqual([true, 2])
    run(rt, 1.6)
    expect(countItem(rt.player.inventory, 'water')).toBe(1)
    expect(rt.player.thirst).toBeGreaterThan(65)
    expect(events).toEqual(['used water'])
    expect([rt.characterState, rt.ledger.isEmpty(), rt.character.violations]).toEqual(['IDLE', true, []])
  })

  it('the same request sent twice drinks once', () => {
    const { rt } = setup()
    addItem(rt.player.inventory, 'water', 3)
    rt.player.thirst = 10
    const water = idOf(rt, 'water')
    expect(rt.useItem('main', water, { requestId: 'r' }).ok).toBe(true)
    expect(rt.useItem('main', water, { requestId: 'r' })).toEqual({ ok: false, reason: 'duplicate' })
    run(rt, 6)
    expect(countItem(rt.player.inventory, 'water')).toBe(2)
  })

  it('CAS §11: a blow at 1.5 s cancels; the water and the thirst are as before, nothing stays reserved', () => {
    const { rt, events } = setup()
    addItem(rt.player.inventory, 'water', 1)
    rt.player.thirst = 30
    rt.useItem('main', idOf(rt, 'water'))
    run(rt, 1.5)
    const thirst = rt.player.thirst
    hit(rt)
    run(rt, 3)
    expect(countItem(rt.player.inventory, 'water')).toBe(1)
    expect(rt.player.thirst).toBeLessThanOrEqual(thirst)
    expect(events).toEqual(['cancelled hit'])
    expect([rt.jobs.length, rt.ledger.isEmpty()]).toEqual([0, true])
  })

  it('Case 5 / D7: eating, the stance or a step cancels it and nothing is eaten', () => {
    for (const interrupt of ['stance', 'moved'] as const) {
      const { rt, events } = setup()
      addItem(rt.player.inventory, 'chips', 1)
      rt.player.hunger = 20
      rt.useItem('main', idOf(rt, 'chips'))
      run(rt, 0.5)
      expect(rt.characterState).toBe('EATING')
      rt.input.simulateKey(interrupt === 'stance' ? 'Mouse2' : 'KeyW', true)
      run(rt, 0.1)
      expect(events).toEqual([`cancelled ${interrupt}`])
      expect(countItem(rt.player.inventory, 'chips')).toBe(1)
      expect(rt.characterState).toBe(interrupt === 'stance' ? 'COMBAT_STANCE' : 'MOVING')
    }
  })

  it('dying mid-bandage consumes nothing and frees the reservation', () => {
    const { rt } = setup()
    addItem(rt.player.inventory, 'bandage', 1)
    rt.player.health = 40
    rt.useItem('main', idOf(rt, 'bandage'))
    expect(rt.jobs[0].ctx.target).toEqual({ kind: 'self' })
    run(rt, 1)
    rt.player.health = 0
    rt.player.alive = false
    run(rt, 3)
    expect([countItem(rt.player.inventory, 'bandage'), rt.jobs.length, rt.ledger.isEmpty()]).toEqual([1, 0, true])
  })

  it('an item in use cannot be moved away meanwhile (no copy, no loss)', () => {
    const rt = new GameRuntime()
    rt.newGame(5)
    rt.setLineOfSightOverride({ isBlocked: () => false })
    const cabinet = rt.interactables.find((i) => i.id === CABINET)!
    rt.player.position = { x: cabinet.position.x + 0.5, y: 0, z: cabinet.position.z }
    rt.interact(cabinet)
    addItem(rt.player.inventory, 'water', 1)
    rt.player.thirst = 20
    const water = idOf(rt, 'water')
    rt.useItem('main', water)
    expect(rt.queueTransfer('main', containerKey(CABINET), [{ instanceId: water }]).refused[0].reason).toBe('reserved')
    expect(rt.useItem('main', water)).toMatchObject({ ok: false, reason: 'reserved' })
  })

  it('a stat that is already full refuses at once with the reason; nothing is queued', () => {
    const { rt, events } = setup()
    addItem(rt.player.inventory, 'medkit', 1)
    expect(rt.useItem('main', idOf(rt, 'medkit'))).toEqual({ ok: false, reason: 'no-effect' })
    rt.events.flush()
    expect([rt.jobs.length, events]).toEqual([0, ['failed medkit no-effect']])
  })

  it('Case 6: a sealed tin is opened, then eaten; cancelling the eating keeps it open, through save and load', () => {
    const { rt, events } = setup()
    addItem(rt.player.inventory, 'canned_food', 2)
    rt.player.hunger = 20
    expect(rt.useItem('main', idOf(rt, 'canned_food')).ok).toBe(true)
    expect(rt.jobs.map((j) => j.type)).toEqual(['OPEN_ITEM', 'EAT'])
    run(rt, 1.6)
    expect([countItem(rt.player.inventory, 'canned_food'), countItem(rt.player.inventory, 'canned_food_open')]).toEqual([1, 1])
    expect(rt.characterState).toBe('EATING')
    hit(rt)
    run(rt, 0.1)
    expect(events).toEqual(['opened canned_food', 'cancelled hit'])
    expect(countItem(rt.player.inventory, 'canned_food_open')).toBe(1)
    const save = validateSaveGame(rt.createSnapshot(), 'field')
    expect(save.ok).toBe(true)
    const again = new GameRuntime(field())
    again.loadSnapshot(rt.createSnapshot())
    expect(countItem(again.player.inventory, 'canned_food_open')).toBe(1)
    again.player.hunger = 20
    again.useItem('main', idOf(again, 'canned_food_open'))
    run(again, 3.1)
    expect(countItem(again.player.inventory, 'canned_food_open')).toBe(0)
    expect(again.player.hunger).toBeCloseTo(55, 0) // +35, minus the hunger that passed while eating
  })

  it('Open alone opens one unit; with no room for the opened tin it refuses before starting', () => {
    const { rt, events } = setup()
    addItem(rt.player.inventory, 'canned_food', 2)
    rt.useItem('main', idOf(rt, 'canned_food'), { open: true })
    run(rt, 2)
    expect([countItem(rt.player.inventory, 'canned_food'), countItem(rt.player.inventory, 'canned_food_open')]).toEqual([1, 1])
    const full = setup()
    addItem(full.rt.player.inventory, 'canned_food', 2)
    while (full.rt.player.inventory.items.length < 12) addItem(full.rt.player.inventory, 'baseball_bat', 1)
    full.rt.useItem('main', idOf(full.rt, 'canned_food'), { open: true })
    full.rt.events.flush()
    expect(full.events).toEqual(['failed canned_food full'])
    expect(countItem(full.rt.player.inventory, 'canned_food')).toBe(2)
    expect(events).toEqual(['opened canned_food'])
  })

  it('Case 6: a tool requirement (a can opener later) is data on the item, checked by the same action', () => {
    ITEMS.canned_food.sealed = { ...sealed, requiresToolTag: 'pry' }
    const { rt, events } = setup()
    addItem(rt.player.inventory, 'canned_food', 1)
    rt.useItem('main', idOf(rt, 'canned_food'), { open: true })
    rt.events.flush()
    expect(events).toEqual(['failed canned_food missing-tool'])
    addItem(rt.player.inventory, 'crowbar', 1, { condition: 50 })
    rt.useItem('main', idOf(rt, 'canned_food'), { open: true })
    run(rt, 2)
    expect(countItem(rt.player.inventory, 'canned_food_open')).toBe(1)
  })

  it('from a container: taken into the bag first, then drunk; out of reach, nothing is drunk', () => {
    const rt = new GameRuntime()
    rt.newGame(5)
    for (const z of [...rt.zombies.values()]) rt.zombies.delete(z.id)
    rt.setLineOfSightOverride({ isBlocked: () => false })
    const cabinet = rt.interactables.find((i) => i.id === CABINET)!
    rt.player.position = { x: cabinet.position.x + 0.5, y: 0, z: cabinet.position.z }
    const box = rt.world.containers.get(CABINET)!.items
    box.items = []
    addItem(box, 'water', 2)
    rt.interact(cabinet)
    rt.player.thirst = 20
    const key = containerKey(CABINET)
    expect(rt.useItem(key, box.items[0].id).ok).toBe(true)
    expect(rt.jobs.map((j) => j.type)).toEqual(['TRANSFER', 'DRINK'])
    run(rt, 4)
    expect([countItem(box, 'water'), countItem(rt.player.inventory, 'water'), rt.player.thirst > 55]).toEqual([1, 0, true])
    rt.player.thirst = 20
    rt.useItem(key, box.items[0].id)
    rt.player.position = { x: cabinet.position.x + 6, y: 0, z: cabinet.position.z }
    run(rt, 4)
    expect([countItem(box, 'water'), countItem(rt.player.inventory, 'water'), rt.player.thirst < 20]).toEqual([1, 0, true])
    expect([rt.jobs.length, rt.ledger.isEmpty()]).toEqual([0, true])
  })
})
