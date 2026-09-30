import { afterEach, describe, expect, it } from 'vitest'
import { GameRuntime } from '../core/runtime'
import { GAME_CONFIG } from '../core/config'
import { addItem, countItem, findItem, totalQuantity } from './inventory'
import { containerKey } from './inventoryCommands'
import { transferStep } from './actionQueue'
import { validateSaveGame } from './save'
import { NEIGHBORHOOD_MAP } from '../world/mapData'
import { createRng } from './loot'
import type { ItemId } from '../entities/items'

const CABINET = 'c-1_-1/safehouse/cabinet'
const BOX = containerKey(CABINET)
const DT = 1 / 60

/** At the cabinet (walls ignored), the cabinet emptied, `box` / `main` filled as asked. */
function setup(box: [ItemId, number][] = [], main: [ItemId, number][] = []) {
  const rt = new GameRuntime()
  rt.newGame(777)
  rt.setLineOfSightOverride({ isBlocked: () => false })
  const cabinet = rt.interactables.find((i) => i.id === CABINET)!
  rt.player.position = { x: cabinet.position.x + 0.5, y: 0, z: cabinet.position.z }
  const inv = rt.world.containers.get(CABINET)!.items
  inv.items = []
  inv.slotCapacity = 8
  for (const [id, n] of box) addItem(inv, id, n)
  for (const [id, n] of main) addItem(rt.player.inventory, id, n)
  rt.openLoot(cabinet.id, true)
  const summaries: { moved: number; skipped: string[] }[] = []
  const cancels: string[] = []
  rt.events.on('inventory:transferred', (e) => summaries.push({ moved: e.moved, skipped: e.skipped }))
  rt.events.on('action:cancelled', (e) => cancels.push(e.reason))
  return { rt, inv, summaries, cancels }
}

const run = (rt: GameRuntime, seconds: number, dt = DT) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    rt.tick(Math.min(dt, seconds - t))
    rt.events.flush()
  }
}

/** Every unit per item type in the player's reach of the world: main, worn bag, containers, floor, bags. */
function totals(rt: GameRuntime): Record<string, number> {
  const t: Record<string, number> = {}
  const invs = [rt.player.inventory, ...[...rt.world.containers.values()].map((c) => c.items), ...[...rt.world.floor.cells.values()].map((c) => c.items), ...rt.world.bags.values()]
  for (const inv of invs) for (const i of inv.items) t[i.itemId] = (t[i.itemId] ?? 0) + i.quantity
  return t
}

function invariants(rt: GameRuntime): void {
  const invs = [rt.player.inventory, ...[...rt.world.containers.values()].map((c) => c.items), ...[...rt.world.floor.cells.values()].map((c) => c.items), ...rt.world.bags.values()]
  const ids = invs.flatMap((inv) => inv.items.map((i) => i.id))
  expect(new Set(ids).size).toBe(ids.length)
  for (const inv of invs) for (const i of inv.items) expect(rt.ledger.reserved(i.id)).toBeLessThanOrEqual(i.quantity)
  if (rt.jobs.length === 0) expect(rt.ledger.isEmpty()).toBe(true)
}

const saved = { ...GAME_CONFIG.transfer }
afterEach(() => Object.assign(GAME_CONFIG.transfer, saved))

describe('timed transfer (INV-LOOT §8, S0 audit §4)', () => {
  it('small items move in capped batches, others one unit per step timed from their weight', () => {
    const bags = new Map()
    expect(transferStep({ id: 'a', itemId: 'nails', kind: 'stack', quantity: 50 }, bags)).toEqual({ units: 10, seconds: 0.3 })
    expect(transferStep({ id: 'b', itemId: 'water', kind: 'stack', quantity: 3 }, bags).seconds).toBeCloseTo(0.2 + 0.6 * 0.15)
    expect(transferStep({ id: 'c', itemId: 'wood_plank', kind: 'stack', quantity: 3 }, bags)).toEqual({ units: 1, seconds: 0.5 })
  })

  it('T01 through the queue: 3 of 10 nails in one 0.3 s batch; source 7, destination 3, one summary', () => {
    const { rt, inv, summaries } = setup([['nails', 10]])
    const nails = inv.items[0].id
    expect(rt.queueTransfer(BOX, 'main', [{ instanceId: nails, quantity: 3 }])).toMatchObject({ refused: [] })
    run(rt, 0.25)
    expect(countItem(rt.player.inventory, 'nails')).toBe(0) // nothing before the step ends
    run(rt, 0.1)
    expect([countItem(inv, 'nails'), countItem(rt.player.inventory, 'nails')]).toEqual([7, 3])
    expect(findItem(inv, nails)?.quantity).toBe(7)
    expect(summaries).toEqual([{ moved: 3, skipped: [] }])
    expect(rt.jobs).toHaveLength(0)
    invariants(rt)
  })

  it('does not depend on the frame rate, also when one frame finishes several steps', () => {
    Object.assign(GAME_CONFIG.transfer, { base: 0.02, perKg: 0, min: 0.02, max: 1.5 })
    const movedAt = (dt: number) => {
      const { rt } = setup([['water', 5], ['water', 5], ['canned_food', 5]])
      rt.queueTransfer(BOX, 'main', rt.openContainer!.items.items.map((i) => ({ instanceId: i.id })))
      const samples: number[] = []
      for (const t of [0.1, 0.2, 0.3]) {
        run(rt, t - (samples.length ? [0.1, 0.2, 0.3][samples.length - 1] : 0), dt)
        samples.push(totalQuantity(rt.player.inventory))
      }
      return samples
    }
    const at60 = movedAt(1 / 60)
    expect(at60).toEqual([5, 10, 15])
    for (const dt of [1 / 30, 1 / 144, 0.1]) {
      const s = movedAt(dt)
      s.forEach((n, i) => expect(Math.abs(n - at60[i])).toBeLessThanOrEqual(1))
    }
  })

  it('T06: spamming the same item never queues more than there is', () => {
    const { rt, inv } = setup([['canned_food', 3]])
    const can = inv.items[0].id
    const before = totals(rt)
    const results = Array.from({ length: 5 }, () => rt.queueTransfer(BOX, 'main', [{ instanceId: can }]))
    expect(results[0].refused).toEqual([])
    for (const r of results.slice(1)) expect(r).toMatchObject({ id: null, refused: [{ reason: 'queued' }] })
    run(rt, 2)
    expect(countItem(rt.player.inventory, 'canned_food')).toBe(3)
    expect(totals(rt)).toEqual(before)
    invariants(rt)
  })

  it('T07: Take All then a hit: committed steps stay, the running step moves nothing, the rest is cancelled', () => {
    const { rt, inv, cancels } = setup([['water', 5], ['canned_food', 4]])
    const before = totals(rt)
    rt.queueTransfer(BOX, 'main', inv.items.map((i) => ({ instanceId: i.id })))
    run(rt, 0.29 * 3 + 0.1) // three waters, part of the fourth
    const carried = totalQuantity(rt.player.inventory)
    expect(carried).toBe(3)
    ;(rt as unknown as { applyPlayerDamage: (n: number, s: string) => void }).applyPlayerDamage(5, 'zombie-1')
    rt.events.flush()
    expect(cancels).toEqual(['hit'])
    run(rt, 3)
    expect(totalQuantity(rt.player.inventory)).toBe(carried)
    expect(totals(rt)).toEqual(before)
    invariants(rt)
  })

  it('T09: a destination filling up meanwhile: merges still go, new stacks are skipped with the reason', () => {
    const { rt, inv, summaries } = setup([['water', 2], ['bandage', 2]], [['water', 3]])
    rt.queueTransfer(BOX, 'main', inv.items.map((i) => ({ instanceId: i.id })))
    // Fill every free slot while the job waits on its first step.
    while (rt.player.inventory.items.length < rt.player.inventory.slotCapacity!) addItem(rt.player.inventory, 'medkit', 1)
    run(rt, 3)
    expect(countItem(rt.player.inventory, 'water')).toBe(5)
    expect(countItem(inv, 'bandage')).toBe(2)
    expect(rt.player.inventory.items.length).toBe(rt.player.inventory.slotCapacity)
    expect(summaries.at(-1)).toEqual({ moved: 2, skipped: ['full'] })
    invariants(rt)
  })

  it('T10: the order of the lists changing meanwhile never changes which item moves', () => {
    const { rt, inv } = setup([['water', 1], ['canned_food', 1], ['chips', 1]])
    const can = inv.items[1].id
    rt.queueTransfer(BOX, 'main', [{ instanceId: can }])
    inv.items.reverse()
    addItem(inv, 'soda', 1)
    run(rt, 1)
    expect(rt.player.inventory.items.map((i) => i.id)).toEqual([can])
  })

  it('T11: an item being moved cannot be used or equipped meanwhile', () => {
    const { rt } = setup([], [['water', 1], ['baseball_bat', 1]])
    rt.player.thirst = 10
    const [water, bat] = rt.player.inventory.items.map((i) => i.id)
    rt.queueTransfer('main', BOX, [{ instanceId: water }, { instanceId: bat }])
    expect(rt.useItem('main', water)).toMatchObject({ ok: false, reason: 'reserved' })
    run(rt, 0.3)
    expect(rt.equipItem(bat)).toBe(false) // its step runs now
    run(rt, 1)
    expect(countItem(rt.openContainer!.items, 'baseball_bat')).toBe(1)
  })
})

describe('one queue for transfers, crafts and repairs (Q3) with one reservation ledger', () => {
  it('a craft queued behind a transfer that takes its wood away fails at its turn: nothing spent, the queue goes on', () => {
    const { rt, inv } = setup([['water', 2]], [['wood_plank', 2], ['duct_tape', 1]])
    const failed: string[] = []
    rt.events.on('action:failed', (e) => failed.push(e.reason))
    rt.queueTransfer(BOX, 'main', [{ instanceId: inv.items[0].id }])
    expect(rt.startCraft('craft_wooden_club')).toMatchObject({ ok: true, queued: true })
    rt.queueTransfer(BOX, 'main', [{ instanceId: inv.items[0].id }])
    // The wood leaves by another way while the craft waits (e.g. an older save's instant move).
    const wood = rt.player.inventory.items.find((i) => i.itemId === 'wood_plank')!.id
    rt.transferItems('main', BOX, [{ instanceId: wood }])
    run(rt, 6)
    expect(failed).toEqual(['missing-input'])
    expect([countItem(rt.player.inventory, 'duct_tape'), countItem(rt.player.inventory, 'wooden_club')]).toEqual([1, 0])
    expect(countItem(rt.player.inventory, 'water')).toBe(2)
    invariants(rt)
  })

  it('materials held by a running craft cannot be queued away, and a craft never counts on items still moving', () => {
    const { rt } = setup([['wood_plank', 2]], [['wood_plank', 2], ['duct_tape', 1]])
    expect(rt.startCraft('craft_wooden_club')).toMatchObject({ ok: true, queued: false })
    const wood = rt.player.inventory.items.find((i) => i.itemId === 'wood_plank')!.id
    expect(rt.queueTransfer('main', BOX, [{ instanceId: wood }])).toMatchObject({ id: null, refused: [{ reason: 'reserved' }] })
    // Two more planks are in the box, not carried: a second club is refused, not queued on them.
    const box = rt.openContainer!.items.items[0].id
    rt.queueTransfer(BOX, 'main', [{ instanceId: box }])
    expect(rt.startCraft('craft_wooden_club')).toEqual({ ok: false, reason: 'missing-carried' })
    run(rt, 6)
    expect(countItem(rt.player.inventory, 'wooden_club')).toBe(1)
    invariants(rt)
  })

  it("cancelling a transfer never frees a craft's materials; cancelling the craft frees exactly its own", () => {
    const { rt, inv } = setup([['water', 3]], [['wood_plank', 2], ['duct_tape', 1]])
    const t = rt.queueTransfer(BOX, 'main', [{ instanceId: inv.items[0].id }]).id!
    const c = rt.startCraft('craft_wooden_club')
    expect(c).toMatchObject({ ok: true, queued: true })
    expect(rt.cancelJob(t)).toBe(true)
    run(rt, DT)
    const wood = rt.player.inventory.items.find((i) => i.itemId === 'wood_plank')!.id
    expect(rt.ledger.reserved(wood)).toBe(2)
    const t2 = rt.queueTransfer(BOX, 'main', [{ instanceId: inv.items[0].id }]).id!
    expect(rt.cancelJob(t2)).toBe(true)
    expect(rt.ledger.reserved(wood)).toBe(2)
    rt.cancelAction()
    expect(rt.ledger.isEmpty()).toBe(true)
    expect(countItem(rt.player.inventory, 'wood_plank')).toBe(2)
  })

  it('random queueing, cancelling and ticking never holds an item twice, loses or makes one (seeded)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { rt } = setup([['water', 5], ['nails', 20], ['wood_plank', 3], ['canned_food', 4]], [['wood_plank', 2], ['duct_tape', 2], ['chips', 3]])
      const rng = createRng(seed)
      let crafted = 0
      rt.events.on('action:completed', (e) => (crafted += e.outputItemId ? 1 : 0))
      const start = totals(rt)
      for (let step = 0; step < 120; step++) {
        const r = rng()
        const keys = [BOX, 'main'] as const
        const src = keys[Math.floor(rng() * 2)]
        const dst = src === 'main' ? BOX : 'main'
        const from = rt.inventoryFor(src)!
        if (r < 0.45 && from.items.length > 0) {
          const pick = from.items[Math.floor(rng() * from.items.length)]
          rt.queueTransfer(src, dst, [{ instanceId: pick.id, quantity: rng() < 0.5 ? undefined : 1 + Math.floor(rng() * pick.quantity) }])
        } else if (r < 0.55) rt.startCraft('craft_wooden_club')
        else if (r < 0.6) rt.cancelAction()
        else if (r < 0.65 && rt.jobs.length > 1) rt.cancelJob(rt.jobs[1].id)
        run(rt, 0.05 + rng() * 0.3)
        invariants(rt)
      }
      run(rt, 60)
      invariants(rt)
      // Only crafting changes totals: each club took 2 planks and 1 tape.
      const end = totals(rt)
      expect(end.wood_plank ?? 0).toBe(start.wood_plank - 2 * crafted)
      expect(end.duct_tape ?? 0).toBe(start.duct_tape - crafted)
      for (const k of ['water', 'nails', 'canned_food', 'chips']) expect(end[k]).toBe(start[k])
    }
    // 12 towns built and 120 random operations each: seconds of work, more when the suite runs in parallel.
  }, 30_000)
})

describe('worn bag, reach, saves and scale', () => {
  const wear = (rt: GameRuntime) => {
    addItem(rt.player.inventory, 'backpack', 1)
    const bag = rt.player.inventory.items.find((i) => i.kind === 'bag')!
    rt.world.bags.set(bag.id, { id: `bag:${bag.id}`, kind: 'bag', nextItemId: 1, items: [], slotCapacity: 8 })
    expect(rt.wearBag(bag.id)).toBe(true)
    return { bag, contents: rt.world.bags.get(bag.id)! }
  }

  it('Q2: a craft takes from the main inventory then the worn bag; the bag holding its inputs stays on', () => {
    const { rt } = setup([], [['wood_plank', 1]])
    const { bag, contents } = wear(rt)
    addItem(contents, 'wood_plank', 2)
    addItem(contents, 'duct_tape', 1)
    expect(rt.startCraft('craft_wooden_club')).toMatchObject({ ok: true })
    expect(rt.wearBag(null)).toBe(false)
    expect(rt.queueTransfer('main', BOX, [{ instanceId: bag.id }]).refused[0].reason).toBe('equipped')
    run(rt, 4.1)
    expect([countItem(rt.player.inventory, 'wood_plank'), countItem(contents, 'wood_plank'), countItem(contents, 'duct_tape')]).toEqual([0, 1, 0])
    expect(rt.wearBag(null)).toBe(true)
  })

  it('a container out of reach cancels the jobs that use it; the others go on', () => {
    const { rt, inv, cancels } = setup([['water', 3]], [['chips', 2]])
    const worn = wear(rt)
    rt.queueTransfer(BOX, 'main', [{ instanceId: inv.items[0].id }])
    rt.queueTransfer('main', 'worn', [{ instanceId: rt.player.inventory.items.find((i) => i.itemId === 'chips')!.id }])
    rt.player.position = { x: rt.player.position.x + 6, y: 0, z: rt.player.position.z }
    run(rt, 3)
    expect(cancels).toEqual(['unreachable'])
    expect(countItem(worn.contents, 'chips')).toBe(2)
    invariants(rt)
  })

  it('T18: a save mid-batch holds only committed steps; loading clears the queue (never replayed)', () => {
    const { rt, inv } = setup([['water', 4]])
    rt.queueTransfer(BOX, 'main', [{ instanceId: inv.items[0].id }])
    run(rt, 0.29 * 2 + 0.1)
    const snap = JSON.parse(JSON.stringify(rt.createSnapshot()))
    expect(countItem(snap.player.inventory, 'water')).toBe(2)
    expect(JSON.stringify(snap)).not.toMatch(/"jobs"|"ledger"|"step"/)
    const v = validateSaveGame(snap, NEIGHBORHOOD_MAP.id, NEIGHBORHOOD_MAP)
    if (!v.ok) throw new Error(v.detail)
    rt.loadSnapshot(v.save)
    expect([rt.jobs.length, rt.ledger.isEmpty()]).toEqual([0, true])
    run(rt, 2)
    expect(countItem(rt.player.inventory, 'water')).toBe(2)
  })

  it('T26: 500 items in a container, 100 transfers in a row: no stall, no leak', () => {
    const { rt, inv } = setup()
    inv.slotCapacity = 600
    for (let n = 0; n < 500; n++) inv.items.push({ id: `${inv.id}:big${n}`, itemId: n % 2 ? 'nails' : 'bandage', kind: 'stack', quantity: 1 })
    rt.player.inventory.slotCapacity = 200
    const before = totals(rt)
    for (let n = 0; n < 100; n++) rt.queueTransfer(BOX, 'main', [{ instanceId: inv.items[n].id }])
    expect(rt.jobs).toHaveLength(100)
    run(rt, 40, 0.1)
    expect([rt.jobs.length, rt.ledger.isEmpty(), totalQuantity(rt.player.inventory)]).toEqual([0, true, 100])
    expect(totals(rt)).toEqual(before)
  })
})
