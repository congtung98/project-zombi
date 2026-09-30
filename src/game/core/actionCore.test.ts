import { afterEach, describe, expect, it } from 'vitest'
import { GameRuntime } from './runtime'
import { GAME_CONFIG } from './config'
import type { MapData } from '../world/mapData'
import { addItem, countItem } from '../systems/inventory'
import { containerKey } from '../systems/inventoryCommands'
import { getAction } from '../actions/registry'
import { ACTION } from '../actions/types'

/** AX1: the runtime's timed actions go through the one registry, executor and state machine. */
const DT = 1 / 60
const CABINET = 'c-1_-1/safehouse/cabinet'

function field(): MapData {
  return { id: 'field', size: 20, playerSpawn: { x: 0, y: 0, z: 0 }, zombieSpawns: [], buildings: [], walls: [], doors: [], containers: [], roads: [] }
}

/** Craft materials for two clubs in the main inventory of an empty field. */
function crafter() {
  const rt = new GameRuntime(field())
  addItem(rt.player.inventory, 'wood_plank', 4)
  addItem(rt.player.inventory, 'duct_tape', 2)
  return rt
}

/** At the neighbourhood cabinet (walls ignored), three waters inside. */
function atCabinet() {
  const rt = new GameRuntime()
  rt.newGame(777)
  rt.setLineOfSightOverride({ isBlocked: () => false })
  const cabinet = rt.interactables.find((i) => i.id === CABINET)!
  rt.player.position = { x: cabinet.position.x + 0.5, y: 0, z: cabinet.position.z }
  const box = rt.world.containers.get(CABINET)!.items
  box.items = []
  addItem(box, 'water', 3)
  rt.interact(cabinet)
  return { rt, box }
}

const run = (rt: GameRuntime, seconds: number) => {
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    rt.tick(Math.min(DT, seconds - t))
    rt.events.flush()
  }
}

const saved = { ...GAME_CONFIG.actions }
afterEach(() => Object.assign(GAME_CONFIG.actions, saved))

describe('AX1 action core in the runtime', () => {
  it('transfers, crafts and repairs are jobs of registered definitions', () => {
    const rt = crafter()
    addItem(rt.player.inventory, 'baseball_bat', 1)
    const bat = rt.player.inventory.items.find((i) => i.itemId === 'baseball_bat')!
    if (bat.kind === 'weapon') bat.condition = 10
    rt.startCraft('craft_wooden_club')
    rt.startRepair(bat.id)
    expect(rt.jobs.map((j) => j.type)).toEqual([ACTION.CRAFT, ACTION.REPAIR])
    expect(rt.jobs.map((j) => j.def)).toEqual([getAction(ACTION.CRAFT), getAction(ACTION.REPAIR)])
    const { rt: looter, box } = atCabinet()
    looter.queueTransfer(containerKey(CABINET), 'main', [{ instanceId: box.items[0].id }])
    expect(looter.jobs[0].def).toBe(getAction(ACTION.TRANSFER))
  })

  it('the character state follows the running action and returns to IDLE', () => {
    const rt = crafter()
    run(rt, 0.1)
    expect(rt.characterState).toBe('IDLE')
    rt.startCraft('craft_wooden_club')
    run(rt, 1)
    expect(rt.characterState).toBe('CRAFTING')
    run(rt, 4)
    expect(rt.characterState).toBe('IDLE')
    const { rt: looter, box } = atCabinet()
    looter.queueTransfer(containerKey(CABINET), 'main', [{ instanceId: box.items[0].id }])
    run(looter, 0.1)
    expect(looter.characterState).toBe('LOOTING')
    expect(looter.character.violations).toEqual([])
  })

  it('the stance does not stop a transfer or a craft (their policy); a swing does', () => {
    const { rt, box } = atCabinet()
    rt.queueTransfer(containerKey(CABINET), 'main', [{ instanceId: box.items[0].id }])
    rt.input.simulateKey('Mouse2', true)
    run(rt, 0.2)
    expect(rt.stance.requested).toBe(true)
    expect(rt.jobs).toHaveLength(1)
    addItem(rt.player.inventory, 'baseball_bat', 1)
    rt.equipItem(rt.player.inventory.items.find((i) => i.itemId === 'baseball_bat')!.id)
    const cancels: string[] = []
    rt.events.on('action:cancelled', (e) => cancels.push(e.reason))
    rt.input.simulateKey('Mouse0', true)
    run(rt, DT)
    expect(cancels).toEqual(['attacked'])
    expect(rt.jobs).toHaveLength(0)
  })

  it('a craft request repeated with the same ID runs once and says nothing the second time', () => {
    const rt = crafter()
    const rejected: string[] = []
    rt.events.on('action:rejected', (e) => rejected.push(e.reason))
    expect(rt.startCraft('craft_wooden_club', { requestId: 'click-1' }).ok).toBe(true)
    expect(rt.startCraft('craft_wooden_club', { requestId: 'click-1' })).toEqual({ ok: false, reason: 'duplicate' })
    rt.events.flush()
    expect([rt.jobs.length, rejected]).toEqual([1, []])
    run(rt, 5)
    expect(countItem(rt.player.inventory, 'wooden_club')).toBe(1)
  })

  it('a transfer request repeated with the same ID moves the units once', () => {
    const { rt, box } = atCabinet()
    const id = box.items[0].id
    rt.queueTransfer(containerKey(CABINET), 'main', [{ instanceId: id, quantity: 1 }], { requestId: 'drag-7' })
    expect(rt.queueTransfer(containerKey(CABINET), 'main', [{ instanceId: id, quantity: 1 }], { requestId: 'drag-7' })).toEqual({ id: null, refused: [] })
    run(rt, 3)
    expect([countItem(rt.player.inventory, 'water'), countItem(box, 'water')]).toEqual([1, 2])
  })

  it('the queue has a limit; beyond it a request is refused with a reason', () => {
    GAME_CONFIG.actions.queueLimit = 1
    const rt = crafter()
    const rejected: string[] = []
    rt.events.on('action:rejected', (e) => rejected.push(e.reason))
    expect(rt.startCraft('craft_wooden_club').ok).toBe(true)
    expect(rt.startCraft('craft_wooden_club')).toEqual({ ok: false, reason: 'queue-full' })
    rt.events.flush()
    expect(rejected).toEqual(['queue-full'])
  })

  it('world objects count their state changes (runtime only, reset by New Game)', () => {
    const rt = new GameRuntime()
    rt.newGame(3)
    const door = [...rt.world.doors.keys()][0]
    const lamp = [...rt.world.lamps.keys()][0]
    expect(rt.worldVersions.get(door)).toBe(0)
    rt.setDoorState(door, 'open')
    rt.setDoorState(door, 'open')
    rt.setDoorState(door, 'closed')
    rt.setLamp(lamp, true)
    expect([rt.worldVersions.get(door), rt.worldVersions.get(lamp)]).toEqual([2, 1])
    rt.newGame(3)
    expect(rt.worldVersions.get(door)).toBe(0)
  })
})
