import { describe, expect, it } from 'vitest'
import { GameRuntime } from './runtime'
import { GAME_CONFIG } from './config'
import type { MapData } from '../world/mapData'
import type { ItemId } from '../entities/items'
import type { Recipe } from '../entities/recipes'
import { addItem, countItem, totalQuantity } from '../systems/inventory'
import { validateSaveGame } from '../systems/save'
import type { WeaponInstance } from '../systems/weapons'
import type { GameEvents } from './events'

const DT = 1 / 60

/** Open field with one container at the player's feet (so looting needs no walking). */
function field(zombieSpawns: MapData['zombieSpawns'] = []): MapData {
  return {
    id: 'field', size: 30, playerSpawn: { x: 0, y: 0, z: 0 }, zombieSpawns, buildings: [], walls: [], doors: [], roads: [],
    containers: [{ id: 'ct-bench', name: 'Bàn', position: { x: 0, y: 0.5, z: 1 }, size: [1, 1, 0.6], color: '#000' }],
  }
}

function setup(items: [ItemId, number][] = [['wood_plank', 3], ['duct_tape', 2], ['scrap_metal', 1]], zombies: MapData['zombieSpawns'] = []) {
  const rt = new GameRuntime(field(zombies))
  for (const z of rt.zombies.values()) z.staggerTimer = 1e6
  for (const [id, n] of items) addItem(rt.player.inventory, id, n)
  const log: string[] = []
  const events: Partial<{ [K in keyof GameEvents]: GameEvents[K][] }> = {}
  for (const type of ['action:started', 'action:rejected', 'action:cancelled', 'action:failed', 'action:completed', 'item:reserved', 'weapon:broken'] as const) {
    rt.events.on(type, (e) => {
      log.push(type)
      ;(events[type] ??= [] as never[]).push(e as never)
    })
  }
  return { rt, log, events }
}

function give(rt: GameRuntime, itemId: ItemId, condition: number): WeaponInstance {
  addItem(rt.player.inventory, itemId, 1, { condition })
  return rt.player.inventory.slots.findLast((i) => i?.itemId === itemId) as WeaponInstance
}

const find = (rt: GameRuntime, id: string) => rt.player.inventory.slots.find((i) => i?.id === id) as WeaponInstance | undefined
const slotOf = (rt: GameRuntime, itemId: ItemId) => rt.player.inventory.slots.findIndex((i) => i?.itemId === itemId)

function run(rt: GameRuntime, seconds: number) {
  for (let t = 0; t < seconds - 1e-9; t += DT) rt.tick(DT)
}

function press(rt: GameRuntime, code: string) {
  rt.input.simulateKey(code, true)
  rt.tick(DT)
  rt.input.simulateKey(code, false)
}

describe('timed repair', () => {
  it('completes exactly once after its duration; materials are only spent at commit and the ID is kept', () => {
    const { rt, log } = setup()
    const bat = give(rt, 'baseball_bat', 0)
    const start = rt.startRepair(bat.id)
    expect(start.ok).toBe(true)
    run(rt, 3.9)
    expect(rt.action).not.toBeNull()
    expect(find(rt, bat.id)!.condition).toBe(0)
    expect([countItem(rt.player.inventory, 'wood_plank'), countItem(rt.player.inventory, 'duct_tape')]).toEqual([3, 2])
    run(rt, 0.2)
    expect(rt.action).toBeNull()
    expect(find(rt, bat.id)!.condition).toBe(30)
    expect([countItem(rt.player.inventory, 'wood_plank'), countItem(rt.player.inventory, 'duct_tape')]).toEqual([2, 1])
    // A repeated or stale completion commits nothing.
    expect(rt.completeAction(start.ok ? start.id : -1)).toBe(false)
    run(rt, 5)
    expect(find(rt, bat.id)!.condition).toBe(30)
    expect(log.filter((e) => e === 'action:completed')).toHaveLength(1)
  })

  it('progress follows simulation time only: a long stall advances at most maxDelta, no ticks = no progress (pause)', () => {
    const { rt } = setup()
    const bat = give(rt, 'baseball_bat', 10)
    rt.startRepair(bat.id)
    rt.tick(10)
    expect(rt.action!.elapsed).toBeCloseTo(GAME_CONFIG.loop.maxDelta, 6)
    const before = rt.action!.elapsed
    // Paused: GameLoop simply does not tick; nothing else advances the action.
    expect(rt.action!.elapsed).toBe(before)
  })

  it('spamming start never duplicates: one action, one output, inputs spent once', () => {
    const { rt, log } = setup([['wood_plank', 4], ['duct_tape', 2]])
    for (let i = 0; i < 10; i++) rt.startCraft('craft_wooden_club')
    rt.events.flush()
    expect(log.filter((e) => e === 'action:started')).toHaveLength(1)
    expect(log.filter((e) => e === 'action:rejected')).toHaveLength(9)
    run(rt, 4.1)
    const clubs = () => rt.player.inventory.slots.filter((i) => i?.itemId === 'wooden_club').length
    expect(clubs()).toBe(1)
    expect([countItem(rt.player.inventory, 'wood_plank'), countItem(rt.player.inventory, 'duct_tape')]).toEqual([2, 1])
  })
})

describe('interruptions release the reservation and spend nothing', () => {
  const cases: [string, (rt: GameRuntime) => void, string][] = [
    ['moving', (rt) => press(rt, 'KeyW'), 'moved'],
    ['attacking', (rt) => press(rt, 'Mouse0'), 'attacked'],
    ['shoving', (rt) => press(rt, 'Space'), 'attacked'],
    ['the cancel key X', (rt) => press(rt, 'KeyX'), 'cancelled'],
    ['the cancel button', (rt) => rt.cancelAction(), 'cancelled'],
  ]
  it.each(cases)('%s cancels', (_, interrupt, reason) => {
    const { rt, events } = setup()
    const bat = give(rt, 'baseball_bat', 0)
    const before = structuredClone(rt.player.inventory)
    rt.startRepair(bat.id)
    run(rt, 2)
    interrupt(rt)
    run(rt, 4)
    expect(rt.action).toBeNull()
    expect(events['action:cancelled']).toMatchObject([{ reason }])
    expect(events['action:completed']).toBeUndefined()
    expect(countItem(rt.player.inventory, 'wood_plank')).toBe(countItem(before, 'wood_plank'))
    expect(countItem(rt.player.inventory, 'duct_tape')).toBe(countItem(before, 'duct_tape'))
    expect(find(rt, bat.id)!.condition).toBe(0)
    // Released: the bat can be dropped now.
    expect(rt.dropItem(rt.player.inventory.slots.findIndex((i) => i?.id === bat.id))).toBe(true)
  })

  it('a zombie hit cancels; slow starvation damage does not', () => {
    const { rt, events } = setup(undefined, [{ x: 1, y: 0, z: 0 }])
    const zombie = Array.from(rt.zombies.values())[0]
    zombie.staggerTimer = 0
    const bat = give(rt, 'baseball_bat', 0)
    rt.startRepair(bat.id)
    let hit = false
    rt.events.on('player:damaged', (e) => (hit ||= e.sourceId === zombie.id))
    for (let t = 0; t < 4 && !hit; t += DT) rt.tick(DT)
    expect(hit).toBe(true)
    expect(events['action:cancelled']).toMatchObject([{ reason: 'hit' }])
    expect(find(rt, bat.id)!.condition).toBe(0)

    const calm = setup().rt
    const club = give(calm, 'baseball_bat', 0)
    calm.player.hunger = 0
    calm.player.thirst = 0
    calm.startRepair(club.id)
    run(calm, 4.1)
    expect(calm.player.health).toBeLessThan(GAME_CONFIG.player.maxHealth)
    expect(find(calm, club.id)!.condition).toBe(30)
  })

  it('death cancels the action', () => {
    const { rt, events } = setup(undefined, [{ x: 1, y: 0, z: 0 }])
    const bat = give(rt, 'baseball_bat', 0)
    rt.startRepair(bat.id)
    rt.player.health = 1
    const zombie = Array.from(rt.zombies.values())[0]
    zombie.staggerTimer = 0
    run(rt, 3)
    expect(rt.player.alive).toBe(false)
    expect(rt.action).toBeNull()
    expect(events['action:cancelled']).toHaveLength(1)
    expect(rt.startRepair(bat.id)).toEqual({ ok: false, reason: 'dead' })
  })
})

describe('reservation while working', () => {
  it('reserved target and materials cannot be dropped, stored or used; unreserved items still move', () => {
    const { rt, events } = setup([['wood_plank', 1], ['duct_tape', 1], ['water', 1]])
    const bat = give(rt, 'baseball_bat', 5)
    rt.player.thirst = 50
    rt.startRepair(bat.id)
    const batSlot = rt.player.inventory.slots.findIndex((i) => i?.id === bat.id)
    expect(rt.dropItem(batSlot)).toBe(false)
    expect(rt.dropItem(slotOf(rt, 'duct_tape'))).toBe(false)
    rt.interact(rt.interactables.find((i) => i.id === 'ct-bench')!)
    expect(rt.putIntoContainer(slotOf(rt, 'wood_plank')).moved).toBe(0)
    expect(rt.putIntoContainer(slotOf(rt, 'water')).moved).toBe(1)
    rt.tick(DT)
    expect(events['item:reserved']!.length).toBe(3)
    // Equip changes are allowed and do not disturb the action.
    expect(rt.equipItem(bat.id)).toBe(true)
    run(rt, 4.1)
    expect(find(rt, bat.id)!.condition).toBe(35)
  })

  it('only one action at a time; not mid-swing', () => {
    const { rt } = setup([['wood_plank', 5], ['duct_tape', 5], ['scrap_metal', 1]])
    const bat = give(rt, 'baseball_bat', 10)
    expect(rt.equipItem(bat.id)).toBe(true)
    rt.input.simulateKey('Mouse0', true)
    rt.tick(DT)
    rt.input.simulateKey('Mouse0', false)
    expect(rt.startRepair(bat.id)).toEqual({ ok: false, reason: 'busy' })
    run(rt, 1)
    expect(rt.startRepair(bat.id).ok).toBe(true)
    expect(rt.startCraft('craft_wooden_club')).toEqual({ ok: false, reason: 'busy' })
  })
})

describe('commit re-checks and stays atomic', () => {
  it('a bag filled during crafting fails the commit with no-space and loses nothing', () => {
    const { rt, events } = setup([['wood_plank', 3], ['duct_tape', 2]])
    rt.startCraft('craft_wooden_club')
    run(rt, 1)
    // Picked up other items meanwhile (takes are allowed): no room left after consuming inputs.
    while (rt.player.inventory.slots.includes(null)) addItem(rt.player.inventory, 'medkit', 1)
    const before = structuredClone(rt.player.inventory)
    run(rt, 3.2)
    expect(events['action:failed']).toMatchObject([{ reason: 'no-space' }])
    expect(rt.player.inventory).toEqual(before)
  })

  it('tool condition 1: the job completes once, the tool breaks and blocks the next job', () => {
    const { rt, events } = setup([['nails', 4]])
    const hammer = give(rt, 'hammer', 1)
    const job: Recipe = { id: 'test_job', kind: 'craft', name: 'Test', duration: 1, inputs: [{ itemId: 'nails', quantity: 2 }], tools: [{ tag: 'hammer', wear: 1 }], output: { itemId: 'wood_plank', quantity: 1 } }
    expect(rt.startRecipe(job, null).ok).toBe(true)
    run(rt, 1.1)
    expect(find(rt, hammer.id)!.condition).toBe(0)
    expect(events['weapon:broken']).toHaveLength(1)
    expect(rt.startRecipe(job, null)).toEqual({ ok: false, reason: 'missing-tool' })
    // Cancelled jobs never wear the tool.
    const fresh = setup([['nails', 2]]).rt
    const h2 = give(fresh, 'hammer', 1)
    fresh.startRecipe(job, null)
    fresh.cancelAction()
    run(fresh, 2)
    expect(find(fresh, h2.id)!.condition).toBe(1)
  })
})

describe('save and load around actions', () => {
  it('a save mid-action holds the state before it; load drops the action and never duplicates items', () => {
    const { rt } = setup([['wood_plank', 2], ['duct_tape', 1]])
    rt.startCraft('craft_wooden_club')
    run(rt, 2)
    const mid = JSON.parse(JSON.stringify(rt.createSnapshot()))
    expect(JSON.stringify(mid)).not.toMatch(/action|reserv/i)
    expect(validateSaveGame(mid, rt.map.id, rt.map).ok).toBe(true)
    expect(countItem(mid.player.inventory, 'wood_plank')).toBe(2)
    expect(countItem(mid.player.inventory, 'wooden_club')).toBe(0)

    // The live game finishes the craft...
    run(rt, 2.1)
    expect(countItem(rt.player.inventory, 'wooden_club')).toBe(1)
    const done = JSON.parse(JSON.stringify(rt.createSnapshot()))
    // ...but loading the mid-action save restores the materials, with no action running.
    rt.loadSnapshot(mid)
    expect(rt.action).toBeNull()
    run(rt, 5)
    expect(countItem(rt.player.inventory, 'wooden_club')).toBe(0)
    expect(countItem(rt.player.inventory, 'wood_plank')).toBe(2)
    // Crafting again from that save yields exactly one club, same as the other timeline.
    expect(rt.startCraft('craft_wooden_club').ok).toBe(true)
    run(rt, 4.1)
    expect(totalQuantity(rt.player.inventory)).toBe(totalQuantity(done.player.inventory))
    expect(countItem(rt.player.inventory, 'wooden_club')).toBe(1)
  })

  it('snapshots around the completion tick are entirely before or entirely after the commit', () => {
    const { rt } = setup([['wood_plank', 2], ['duct_tape', 1]])
    rt.startCraft('craft_wooden_club')
    const seen = new Set<string>()
    for (let t = 0; t < 4.2; t += DT) {
      rt.tick(DT)
      const s = rt.createSnapshot()
      const key = `${countItem(s.player.inventory, 'wood_plank')}/${countItem(s.player.inventory, 'duct_tape')}/${countItem(s.player.inventory, 'wooden_club')}`
      seen.add(key)
      expect(validateSaveGame(JSON.parse(JSON.stringify(s)), rt.map.id, rt.map).ok).toBe(true)
    }
    expect([...seen]).toEqual(['2/1/0', '0/0/1'])
  })
})

describe('plan acceptance: loot materials → repair a broken weapon → full damage again', () => {
  it('broken bat deals 5, repaired bat deals 25', () => {
    const { rt } = setup([], [{ x: 1.2, y: 0, z: 0 }])
    const zombie = Array.from(rt.zombies.values())[0]
    rt.player.facing = Math.PI / 2
    // Materials come from a real container through the normal take flow.
    const bench = rt.world.containers.get('ct-bench')!
    addItem(bench.items, 'wood_plank', 1)
    addItem(bench.items, 'duct_tape', 1)
    rt.interact(rt.interactables.find((i) => i.id === 'ct-bench')!)
    expect(rt.takeAll().moved).toBe(2)
    rt.closeAllUi()
    const bat = give(rt, 'baseball_bat', 0)
    expect(rt.equipItem(bat.id)).toBe(true)
    const damage: number[] = []
    rt.events.on('zombie:damaged', (e) => damage.push(e.amount))
    const swing = () => {
      zombie.position = { x: 1.2, y: 0, z: 0 }
      press(rt, 'Mouse0')
      run(rt, 1.5)
    }
    swing()
    expect(rt.startRepair(bat.id).ok).toBe(true)
    run(rt, 4.1)
    expect(find(rt, bat.id)!.condition).toBe(30)
    swing()
    expect(damage).toEqual([5, 25])
    expect(find(rt, bat.id)!.condition).toBe(29)
    expect(countItem(rt.player.inventory, 'wood_plank') + countItem(rt.player.inventory, 'duct_tape')).toBe(0)
  })
})
