import { describe, expect, it } from 'vitest'
import { GameRuntime } from './runtime'
import { GAME_CONFIG } from './config'
import type { MapData } from '../world/mapData'
import { generateBuildingWalls, generateDoorPlacements, type BuildingDef } from '../world/buildings'
import { addItem } from '../systems/inventory'
import { registerInteractable } from '../interaction/registry'
import { registerAction } from '../actions/registry'
import { INTERRUPT_ALL } from '../actions/characterState'
import { boxAround } from '../interaction/picker'
import type { Interactable } from '../systems/interaction'
import type { Vec3 } from '../../types'

/** AX4: pointer picking, left click default actions, reach, and new object types without runtime changes. */
const DT = 1 / 60
const hut: BuildingDef = {
  id: 'hut', name: 'Hut', center: { x: 0, z: 0 }, size: { w: 6, d: 6 }, height: 3, wallThickness: 0.3,
  wallColor: '#fff', roofColor: '#000', floorColor: '#888',
  doors: [{ id: 'door-hut', name: 'Cửa', side: 'S', offset: 0, width: 1.4 }],
  containers: [{ id: 'ct-hut', name: 'Tủ', position: { x: 0, y: 0.5, z: -2.5 }, size: [1, 1, 0.6], color: '#000' }],
}
function hutMap(): MapData {
  return { id: 'field', size: 30, playerSpawn: { x: 0, y: 0, z: 0 }, zombieSpawns: [], buildings: [hut], walls: generateBuildingWalls(hut), doors: generateDoorPlacements(hut), containers: hut.containers, roads: [] }
}

const o = GAME_CONFIG.camera.offset
const len = Math.hypot(o.x, o.y, o.z)
const DIR = { x: -o.x / len, y: -o.y / len, z: -o.z / len }
/** Point the cursor at `p` (the camera ray through it). */
const aim = (rt: GameRuntime, p: Vec3) => rt.updatePointerTarget({ origin: { x: p.x - DIR.x * 60, y: p.y - DIR.y * 60, z: p.z - DIR.z * 60 }, dir: DIR })
const center = (i: Interactable): Vec3 => ({ x: (i.pick!.min.x + i.pick!.max.x) / 2, y: (i.pick!.min.y + i.pick!.max.y) / 2, z: (i.pick!.min.z + i.pick!.max.z) / 2 })
const click = (rt: GameRuntime, button = 'Mouse0') => {
  rt.input.simulateKey(button, true)
  rt.tick(DT)
  rt.input.simulateKey(button, false)
  rt.events.flush()
}
const ticks = (rt: GameRuntime, n: number) => {
  for (let i = 0; i < n; i++) rt.tick(DT)
  rt.events.flush()
}

function setup(at: Vec3 = { x: 0, y: 0, z: -1.5 }) {
  const rt = new GameRuntime(hutMap())
  rt.player.position = { ...at }
  const failed: string[] = []
  const hints: string[] = []
  rt.events.on('interaction:failed', (e) => failed.push(e.reason))
  rt.events.on('player:attackNeedsStance', () => hints.push('hint'))
  const byId = (id: string) => rt.interactables.find((i) => i.id === id)!
  return { rt, failed, hints, byId }
}

describe('AX4 world interaction', () => {
  it('the cursor picks the object it points at; nothing under it picks the ground', () => {
    const { rt, byId } = setup()
    aim(rt, center(byId('ct-hut')))
    expect(rt.pointerTarget).toMatchObject({ kind: 'object', id: 'ct-hut' })
    expect(rt.hoverInteractable?.id).toBe('ct-hut')
    aim(rt, { x: 1.5, y: 0, z: 1 })
    expect(rt.pointerTarget?.kind).toBe('ground')
    expect(rt.hoverInteractable).toBeNull()
    // Not shown (a hidden storey, an unexplored room): not picked.
    rt.updatePointerTarget({ origin: { x: -DIR.x * 60, y: 0.5 - DIR.y * 60, z: -2.5 - DIR.z * 60 }, dir: DIR }, () => false)
    expect(rt.pointerTarget?.kind).toBe('ground')
  })

  it('Case 1: a left click on the container opens it after the short OPEN_CONTAINER action (reach pose)', () => {
    const { rt, byId, hints } = setup()
    aim(rt, center(byId('ct-hut')))
    click(rt)
    expect(rt.jobs.map((j) => j.type)).toEqual(['OPEN_CONTAINER'])
    expect(rt.characterState).toBe('LOOTING')
    expect(rt.actionPresentation?.group).toBe('reach')
    expect(rt.openContainerId).toBeNull()
    ticks(rt, 25)
    expect([rt.openContainerId, rt.lootOpen, rt.world.containers.get('ct-hut')!.opened]).toEqual(['ct-hut', true, true])
    expect(hints).toEqual([])
    expect(rt.player.attackTimer).toBeLessThan(0)
  })

  it('a left click on a door opens it at once, a second one closes it; collider/nav follow the state', () => {
    const { rt, byId } = setup({ x: 0, y: 0, z: 2 })
    const door = byId('door-hut')
    aim(rt, center(door))
    click(rt)
    expect(rt.world.doors.get('door-hut')!.state).toBe('open')
    expect(rt.worldVersions.get('door-hut')).toBe(1)
    click(rt)
    expect(rt.world.doors.get('door-hut')!.state).toBe('closed')
  })

  it('too far: nothing changes and the player is told why (walking there comes with AX6)', () => {
    const { rt, byId, failed } = setup({ x: 8, y: 0, z: 8 })
    aim(rt, center(byId('door-hut')))
    click(rt)
    expect(rt.world.doors.get('door-hut')!.state).toBe('closed')
    expect(failed).toEqual(['OUT_OF_RANGE'])
  })

  it('in the combat stance the left button swings, never opens; outside it the ground click still hints', () => {
    const { rt, byId, hints } = setup()
    addItem(rt.player.inventory, 'baseball_bat', 1)
    rt.equipItem(rt.player.inventory.items[0].id)
    aim(rt, { x: 1.5, y: 0, z: 1 })
    click(rt)
    ticks(rt, 40)
    expect(hints).toEqual(['hint'])
    rt.input.simulateKey('Mouse2', true)
    ticks(rt, 2)
    aim(rt, center(byId('ct-hut')))
    click(rt)
    expect(rt.player.attackTimer).toBeGreaterThanOrEqual(0)
    expect(rt.jobs).toHaveLength(0)
  })

  it('repeated clicks while it opens queue it once; E on the open container closes it at once', () => {
    const { rt, byId } = setup()
    aim(rt, center(byId('ct-hut')))
    click(rt)
    click(rt)
    rt.interact(byId('ct-hut'))
    expect(rt.jobs).toHaveLength(1)
    ticks(rt, 25)
    rt.interact(byId('ct-hut'))
    expect(rt.openContainerId).toBeNull()
  })

  it('Case 7: a new object type (a generator) needs only its provider, action and state adapter', () => {
    const running = new Map<string, boolean>([['gen-1', false]])
    const rt = new GameRuntime({ ...hutMap(), generators: [{ id: 'gen-1', at: { x: 2, y: 0, z: 1 } }] } as MapData)
    rt.registerWorldAdapter('generator', { exists: (id) => running.has(id), apply: (id, p) => running.set(id, p.running === true) })
    // The two registrations below are what a feature adds; runtime, input and state machine are untouched.
    registerAction<{ running: boolean }>({
      type: 'GENERATOR_SWITCH', lane: 'queue', characterState: 'INTERACTING', interrupt: INTERRUPT_ALL, presentation: { anim: 'work' },
      begin: () => ({ duration: 2, elapsed: 0 }),
      commit: (job) => ({ next: 'done', mutation: { effects: [{ type: 'world.set', objectType: 'generator', objectId: 'gen-1', patch: { running: job.data.running } }] } }),
      view: (job) => ({ id: job.id, kind: 'interact', label: job.label, stepProgress: 0, stepRemaining: 0, done: 0, total: 1 }),
    })
    const gen: Interactable = { id: 'gen-1', kind: 'generator', name: 'Máy phát', position: { x: 2, y: 0.5, z: 1 }, radius: 0.6, pick: boxAround({ x: 2, y: 0.5, z: 1 }, 0.5, 0.5, 0.5) }
    registerInteractable({
      type: 'generator',
      build: () => [],
      getActions: (obj) => running.get(obj.id)
        ? [{ id: 'generator.stop', actionType: 'GENERATOR_SWITCH', label: 'Tắt máy', isDefault: true, blocked: null, data: { running: false } }]
        : [{ id: 'generator.start', actionType: 'GENERATOR_SWITCH', label: 'Khởi động', isDefault: true, blocked: null, data: { running: true } },
            { id: 'generator.refuel', actionType: 'REFUEL', label: 'Đổ xăng', blocked: { reason: 'MISSING_ITEM', text: 'Cần can xăng' }, data: {} }],
      getInteractionContext: () => ({ note: 'nhiên liệu 40%', status: null }),
    })
    expect(rt.interaction.prompt(gen)).toBe('Khởi động (nhiên liệu 40%)')
    expect(rt.interaction.options(gen).map((o) => o.label)).toEqual(['Khởi động', 'Đổ xăng'])
    rt.player.position = { x: 2, y: 0, z: 2 }
    rt.interaction.executeDefault(gen, 'world-menu')
    expect(rt.characterState === 'IDLE' || rt.jobs[0].type === 'GENERATOR_SWITCH').toBe(true)
    ticks(rt, 130)
    expect(running.get('gen-1')).toBe(true)
    expect(rt.interaction.prompt(gen)).toBe('Tắt máy (nhiên liệu 40%)')
  })
})
