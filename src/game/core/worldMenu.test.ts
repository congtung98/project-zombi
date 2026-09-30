import { describe, expect, it } from 'vitest'
import { GameRuntime } from './runtime'
import { GAME_CONFIG } from './config'
import type { MapData } from '../world/mapData'
import { generateBuildingWalls, generateDoorPlacements, type BuildingDef } from '../world/buildings'
import { addItem, countItem } from '../systems/inventory'
import type { Interactable } from '../systems/interaction'
import type { Vec3 } from '../../types'

/** AX5: the contextual right click (FB §1), the world context menu (WIS §7, §10) and the combat lane (FB §13). */
const DT = 1 / 60
const hut: BuildingDef = {
  id: 'hut', name: 'Hut', center: { x: 0, z: 0 }, size: { w: 6, d: 6 }, height: 3, wallThickness: 0.3,
  wallColor: '#fff', roofColor: '#000', floorColor: '#888',
  doors: [{ id: 'door-hut', name: 'Cửa', side: 'S', offset: 0, width: 1.4 }],
  containers: [{ id: 'ct-hut', name: 'Tủ', position: { x: 0, y: 0.5, z: -2.5 }, size: [1, 1, 0.6], color: '#000' }],
}
const hutMap = (zombieSpawns: MapData['zombieSpawns'] = []): MapData => ({
  id: 'field', size: 30, playerSpawn: { x: 0, y: 0, z: 0 }, zombieSpawns, buildings: [hut], walls: generateBuildingWalls(hut), doors: generateDoorPlacements(hut), containers: hut.containers, roads: [],
})

const o = GAME_CONFIG.camera.offset
const len = Math.hypot(o.x, o.y, o.z)
const DIR = { x: -o.x / len, y: -o.y / len, z: -o.z / len }
const aim = (rt: GameRuntime, p: Vec3) => rt.updatePointerTarget({ origin: { x: p.x - DIR.x * 60, y: p.y - DIR.y * 60, z: p.z - DIR.z * 60 }, dir: DIR })
const center = (i: Interactable): Vec3 => ({ x: (i.pick!.min.x + i.pick!.max.x) / 2, y: (i.pick!.min.y + i.pick!.max.y) / 2, z: (i.pick!.min.z + i.pick!.max.z) / 2 })
const key = (rt: GameRuntime, code: string, down: boolean) => rt.input.simulateKey(code, down)
const ticks = (rt: GameRuntime, n: number) => {
  for (let i = 0; i < n; i++) rt.tick(DT)
  rt.events.flush()
}

function setup(map = hutMap(), at: Vec3 = { x: 0, y: 0, z: -1.5 }) {
  const rt = new GameRuntime(map)
  for (const z of rt.zombies.values()) z.staggerTimer = 1e6
  rt.player.position = { ...at }
  const menus: { targetId: string; options: string[]; disabled: (string | null)[] }[] = []
  const closed: number[] = []
  const failed: string[] = []
  const hints: string[] = []
  rt.events.on('interaction:menu', (e) => menus.push({ targetId: e.targetId, options: e.options.map((x) => x.label), disabled: e.options.map((x) => x.disabled) }))
  rt.events.on('interaction:menuClosed', () => closed.push(1))
  rt.events.on('interaction:failed', (e) => failed.push(e.reason))
  rt.events.on('player:attackNeedsStance', () => hints.push('hint'))
  const byId = (id: string) => rt.interactables.find((i) => i.id === id)!
  return { rt, menus, closed, failed, hints, byId }
}

describe('AX5 contextual right click', () => {
  it('Case 1: right click on the container opens its menu (no stance, also while the button stays held); Open runs OPEN_CONTAINER', () => {
    const { rt, menus, byId } = setup()
    aim(rt, center(byId('ct-hut')))
    key(rt, 'Mouse2', true)
    ticks(rt, 10)
    expect(rt.stance.requested).toBe(false)
    expect(menus).toEqual([{ targetId: 'ct-hut', options: ['Mở Tủ', 'Lấy hết'], disabled: [null, null] }])
    key(rt, 'Mouse2', false)
    ticks(rt, 1)
    expect(rt.stance.requested).toBe(false)
    expect(rt.selectMenuOption('container.open', 'm-1')).toBe(true)
    expect(rt.worldMenu).toBeNull()
    expect(rt.jobs.map((j) => j.type)).toEqual(['OPEN_CONTAINER'])
    ticks(rt, 25)
    expect(rt.openContainerId).toBe('ct-hut')
  })

  it('Case 4: right click on the ground takes the stance, as before', () => {
    const { rt, menus } = setup()
    aim(rt, { x: 1.5, y: 0, z: 1 })
    key(rt, 'Mouse2', true)
    ticks(rt, 2)
    expect([rt.stance.requested, menus.length, rt.combatTarget]).toEqual([true, 0, null])
  })

  it('in the stance a right press is combat: toggle mode leaves the stance, never opens a menu', () => {
    const { rt, menus, byId } = setup()
    rt.setStanceMode('toggle')
    aim(rt, { x: 1.5, y: 0, z: 1 })
    key(rt, 'Mouse2', true)
    ticks(rt, 1)
    key(rt, 'Mouse2', false)
    ticks(rt, 1)
    expect(rt.stance.requested).toBe(true)
    aim(rt, center(byId('ct-hut')))
    key(rt, 'Mouse2', true)
    ticks(rt, 1)
    key(rt, 'Mouse2', false)
    ticks(rt, 1)
    expect([rt.stance.requested, menus.length]).toEqual([false, 0])
    // Out of the stance, the same press on the container opens its menu and does not toggle.
    key(rt, 'Mouse2', true)
    ticks(rt, 1)
    key(rt, 'Mouse2', false)
    ticks(rt, 1)
    expect([rt.stance.requested, menus.length]).toEqual([false, 1])
  })

  it('while the menu is open a press on the world only closes it (no swing, no action, no hint)', () => {
    const { rt, closed, hints, byId } = setup()
    aim(rt, center(byId('ct-hut')))
    key(rt, 'Mouse2', true)
    ticks(rt, 1)
    key(rt, 'Mouse2', false)
    aim(rt, { x: 1.5, y: 0, z: 1 })
    key(rt, 'Mouse0', true)
    ticks(rt, 1)
    key(rt, 'Mouse0', false)
    ticks(rt, 40)
    expect([rt.worldMenu, closed.length, hints.length, rt.jobs.length]).toEqual([null, 1, 0, 0])
  })

  it('WIS §7: the menu keeps its target; a door that changed meanwhile updates the menu, a stale entry fails and changes nothing', () => {
    const { rt, menus, failed, byId } = setup(hutMap(), { x: 0, y: 0, z: 2 })
    aim(rt, center(byId('door-hut')))
    key(rt, 'Mouse2', true)
    ticks(rt, 1)
    key(rt, 'Mouse2', false)
    aim(rt, { x: 1.5, y: 0, z: 1 }) // the cursor wanders off: the menu stays on the door
    ticks(rt, 1)
    expect(rt.worldMenu?.targetId).toBe('door-hut')
    rt.setDoorState('door-hut', 'open') // a zombie, another player...
    ticks(rt, 1)
    expect(menus.map((m) => m.options)).toEqual([['Mở Cửa'], ['Đóng Cửa']])
    expect(rt.selectMenuOption('door.open')).toBe(false)
    rt.events.flush()
    expect(failed).toEqual(['TARGET_CHANGED'])
    expect(rt.world.doors.get('door-hut')!.state).toBe('open')
  })

  it('"Lấy hết" opens the container and takes everything; on an emptied one it is disabled with the reason', () => {
    const { rt, menus, byId } = setup()
    const box = rt.world.containers.get('ct-hut')!.items
    box.items = []
    addItem(box, 'water', 2)
    addItem(box, 'chips', 1)
    aim(rt, center(byId('ct-hut')))
    rt.openWorldMenu(byId('ct-hut'))
    rt.selectMenuOption('container.takeAll')
    ticks(rt, 25)
    expect(rt.openContainerId).toBe('ct-hut')
    ticks(rt, 120)
    expect([countItem(rt.player.inventory, 'water'), countItem(rt.player.inventory, 'chips'), box.items.length]).toEqual([2, 1, 0])
    rt.openWorldMenu(byId('ct-hut'))
    rt.events.flush()
    expect(menus.at(-1)).toEqual({ targetId: 'ct-hut', options: ['Đóng Tủ', 'Lấy hết'], disabled: [null, 'Tủ trống'] })
  })

  it('death closes the menu', () => {
    const { rt, byId } = setup()
    rt.openWorldMenu(byId('ct-hut'))
    rt.player.alive = false
    ticks(rt, 1)
    expect(rt.worldMenu).toBeNull()
  })
})

describe('AX5 combat lane (FB §13, Case 3)', () => {
  it('right click on a zombie takes the stance against it; a left click swings (MELEE_ATTACK) and the hit damages it', () => {
    const { rt } = setup(hutMap([{ x: 9, y: 0, z: 10.1 }]), { x: 9, y: 0, z: 9 })
    const zombie = [...rt.zombies.values()][0]
    addItem(rt.player.inventory, 'baseball_bat', 1)
    rt.equipItem(rt.player.inventory.items[0].id)
    rt.cursorWorld = { ...zombie.position }
    aim(rt, { x: zombie.position.x, y: 0.9, z: zombie.position.z })
    expect(rt.pointerTarget).toMatchObject({ kind: 'character', id: zombie.id })
    key(rt, 'Mouse2', true)
    ticks(rt, 30)
    expect([rt.stance.requested, rt.combatTarget, rt.characterState]).toEqual([true, zombie.id, 'COMBAT_STANCE'])
    const health = zombie.health
    key(rt, 'Mouse0', true)
    ticks(rt, 1)
    key(rt, 'Mouse0', false)
    expect(rt.characterState).toBe('ATTACKING')
    ticks(rt, 40)
    expect(zombie.health).toBeLessThan(health)
    key(rt, 'Mouse2', false)
    ticks(rt, 30)
    expect([rt.stance.requested, rt.combatTarget]).toEqual([false, null])
  })

  it('Space shoves through the combat lane (the same push as before)', () => {
    const { rt } = setup(hutMap([{ x: 9, y: 0, z: 9.8 }]), { x: 9, y: 0, z: 9 })
    const zombie = [...rt.zombies.values()][0]
    rt.cursorWorld = { ...zombie.position }
    const pushed: number[] = []
    rt.events.on('player:pushed', (e) => pushed.push(e.hitIds.length))
    key(rt, 'Space', true)
    ticks(rt, 1)
    expect(pushed).toEqual([1])
  })
})
