import { describe, expect, it } from 'vitest'
import { EventBus, type GameEvents } from '../core/events'
import { createPlayerState } from '../entities/player'
import { ReservationLedger } from '../systems/actionQueue'
import { addItem, countItem, createInventory, findItem, type Inventory } from '../systems/inventory'
import { createWorldState } from '../world/worldState'
import { NEIGHBORHOOD_MAP } from '../world/mapData'
import { ActionSystem } from './actionSystem'
import { INTERRUPT_ALL } from './characterState'
import { registerAction } from './registry'
import type { ActionContext, ActionDefinition } from './types'
import type { ActionWorld } from './world'

/**
 * AX1 lifecycle, on a stand-in world: a test action that drinks one unit of an instance after 2 s
 * (stat + consume as one mutation) proves the executor's own rules without any feature's.
 */
interface SipData {
  inv: Inventory
  instanceId: string
  /** Break the mutation on purpose: consume more than there is (the whole change must not happen). */
  greedy?: boolean
}

const log: string[] = []

const SIP: ActionDefinition<SipData> = registerAction<SipData>({
  type: 'TEST_SIP',
  lane: 'queue',
  characterState: 'DRINKING',
  interrupt: INTERRUPT_ALL,
  presentation: { anim: 'drink' },
  begin(job, w) {
    if (!findItem(job.data.inv, job.data.instanceId)) return null
    w.ledger.reserve(job.id, 'recipe', job.data.instanceId, 1)
    log.push(`begin ${job.id}`)
    return { duration: 2, elapsed: 0 }
  },
  commit(job) {
    log.push(`commit ${job.id}`)
    const d = job.data
    return {
      next: 'done',
      mutation: {
        effects: [
          { type: 'stat', stat: 'thirst', delta: 40 },
          { type: 'item.consume', inventory: d.inv, instanceId: d.instanceId, quantity: d.greedy ? 99 : 1 },
          { type: 'after', run: () => log.push(`after ${job.id}`) },
        ],
      },
    }
  },
  ended(job) {
    log.push(`ended ${job.id}`)
  },
  cancelled(job) {
    log.push(`cancelled ${job.id}`)
  },
  claims: (job, id) => (!job.step && job.data.instanceId === id ? 1 : 0),
  view: (job) => ({ id: job.id, kind: 'craft', label: job.label, stepProgress: job.step ? job.step.elapsed / job.step.duration : 0, stepRemaining: 0, done: 0, total: 1 }),
})

function setup(limit = 128) {
  log.length = 0
  const player = createPlayerState({ x: 0, y: 0, z: 0 })
  player.thirst = 10
  const events = new EventBus<GameEvents>()
  const ledger = new ReservationLedger()
  const inv = createInventory(12, 'test', 'player')
  addItem(inv, 'water', 3)
  const fired: string[] = []
  for (const name of ['action:queued', 'action:cancelled', 'action:failed'] as const) events.on(name, () => fired.push(name))
  const w: ActionWorld = {
    player, events, ledger,
    world: createWorldState(NEIGHBORHOOD_MAP, 1, { generateLoot: false }),
    inventoryFor: () => inv,
    canReachFloor: () => true,
    bagHeld: () => false,
    craftSources: () => ({ inventories: [inv] }),
    claimed: (id) => system.claimed(id),
    inventoryChanged: () => {},
    floorChanged: () => {},
    objectExists: () => false,
    canReachObject: () => false,
    openContainerId: () => null,
    worldAdapter: () => undefined,
    requestTakeAll: () => {},
    startSwing: () => false,
    startShove: () => false,
    setCombatTarget: () => {},
  }
  const system: ActionSystem = new ActionSystem(w, { queueLimit: limit, recentRequests: 4 })
  const water = inv.items[0].id
  const ctx: ActionContext = { actorId: 'player', type: SIP.type, target: { kind: 'item', instanceId: water, inventory: 'main' }, source: 'inventory-menu' }
  const sip = (requestId: string | null = null, data: Partial<SipData> = {}) => system.enqueue<SipData>(SIP.type, ctx, { inv, instanceId: water, ...data }, 'Uống nước', { requestId })
  const flush = () => events.flush()
  return { system, player, inv, ledger, water, sip, fired, flush }
}

describe('ActionSystem (AX1)', () => {
  it('a request sent twice with the same ID runs once (double click)', () => {
    const { system, sip, inv, player } = setup()
    expect(sip('r1')).toMatchObject({ ok: true, state: 'running' })
    expect(sip('r1')).toEqual({ ok: false, reason: 'DUPLICATE' })
    expect(system.jobs).toHaveLength(1)
    system.tick(5)
    expect(countItem(inv, 'water')).toBe(2)
    expect(player.thirst).toBe(50)
  })

  it('forgets old request IDs after its window (an ID is only a guard against repeats)', () => {
    const { system, sip } = setup()
    for (const id of ['a', 'b', 'c', 'd', 'e']) sip(id)
    expect(system.refusal('a')).toBeNull()
    expect(system.refusal('e')).toBe('DUPLICATE')
  })

  it('refuses beyond the queue limit', () => {
    const { system, sip } = setup(2)
    expect(sip().ok).toBe(true)
    expect(sip().ok).toBe(true)
    expect(sip()).toEqual({ ok: false, reason: 'QUEUE_FULL' })
    expect(system.jobs).toHaveLength(2)
  })

  it('commits once: at the end of its time, never early, never again for a stale ID', () => {
    const { system, sip, inv } = setup()
    const r = sip()
    if (!r.ok) throw new Error('refused')
    expect(system.complete(r.job.id)).toBe(false)
    system.tick(1.999)
    expect(countItem(inv, 'water')).toBe(3)
    system.tick(0.001)
    expect(countItem(inv, 'water')).toBe(2)
    expect(system.complete(r.job.id)).toBe(false)
    expect(log.filter((l) => l.startsWith('commit'))).toHaveLength(1)
    expect(r.job.status).toBe('completed')
  })

  it('advances by simulation time only: no time, no progress; the split of the time does not matter', () => {
    const a = setup()
    a.sip()
    a.sip()
    for (let i = 0; i < 400; i++) a.system.tick(0.01)
    a.system.tick(0)
    const b = setup()
    b.sip()
    b.sip()
    b.system.tick(4)
    expect([countItem(a.inv, 'water'), a.system.jobs.length]).toEqual([1, 0])
    expect([countItem(b.inv, 'water'), b.system.jobs.length]).toEqual([1, 0])
  })

  it('a change that cannot apply changes nothing at all and fails the job', () => {
    const { system, sip, inv, player, ledger, fired, flush } = setup()
    sip(null, { greedy: true })
    system.tick(2)
    flush()
    expect(countItem(inv, 'water')).toBe(3)
    expect(player.thirst).toBe(10)
    expect(log).not.toContain('after 1')
    expect(fired).toContain('action:failed')
    expect([system.jobs.length, ledger.isEmpty()]).toEqual([0, true])
  })

  it('cancel releases what the running job holds and runs its hook; waiting jobs go with it', () => {
    const { system, sip, ledger, fired, flush } = setup()
    sip()
    sip()
    expect(ledger.isEmpty()).toBe(false)
    expect(system.cancelAll('hit')).toBe(true)
    flush()
    expect([system.jobs.length, ledger.isEmpty()]).toEqual([0, true])
    expect(log).toContain('cancelled 1')
    expect(fired.filter((f) => f === 'action:cancelled')).toHaveLength(1)
    expect(system.cancelAll('hit')).toBe(false)
  })

  it('a waiting job counts its claim; once running its units are reserved instead', () => {
    const { system, sip, water, ledger } = setup()
    sip()
    sip()
    expect(system.claimed(water)).toBe(1)
    expect(ledger.reserved(water)).toBe(1)
  })

  it('a job that cannot start leaves the queue through `ended` and the next one runs', () => {
    const { system, sip, inv, fired, flush } = setup()
    sip(null, { instanceId: 'nope' })
    flush()
    expect(system.jobs).toHaveLength(0)
    expect(log).toContain('ended 1')
    sip()
    sip(null, { instanceId: 'nope' })
    sip()
    flush()
    expect(fired.filter((f) => f === 'action:queued')).toHaveLength(2)
    system.tick(10)
    expect(countItem(inv, 'water')).toBe(1)
  })
})
