import { describe, expect, it } from 'vitest'
import { GameRuntime } from './runtime'
import { GAME_CONFIG } from './config'
import type { MapData } from '../world/mapData'
import { generateBuildingWalls, generateDoorPlacements, type BuildingDef } from '../world/buildings'
import { addItem } from '../systems/inventory'

/** CS1a: right-button combat stance, aim and heading in the simulation (no physics body). */
const DT = 1 / 60
const DEG = Math.PI / 180
const CS = GAME_CONFIG.combatStance

function field(zombieSpawns: MapData['zombieSpawns'] = []): MapData {
  return { id: 'field', size: 20, playerSpawn: { x: 0, y: 0, z: 0 }, zombieSpawns, buildings: [], walls: [], doors: [], containers: [], roads: [] }
}

function setup(spawns: MapData['zombieSpawns'] = []) {
  const rt = new GameRuntime(field(spawns))
  for (const z of rt.zombies.values()) z.staggerTimer = 1e6
  addItem(rt.player.inventory, 'baseball_bat', 1)
  expect(rt.equipItem(rt.player.inventory.items[0]!.id)).toBe(true)
  return rt
}

const key = (rt: GameRuntime, code: string, down: boolean) => rt.input.simulateKey(code, down)
const ticks = (rt: GameRuntime, n: number) => {
  for (let i = 0; i < n; i++) rt.tick(DT)
}

describe('CS1 left click and the stance', () => {
  it('a left click outside the stance never swings, costs nothing and hints once after the grace', () => {
    const rt = setup([{ x: 0, y: 0, z: 1 }])
    const hints: unknown[] = []
    rt.events.on('player:attackNeedsStance', (e) => hints.push(e))
    key(rt, 'Mouse0', true)
    ticks(rt, 1)
    key(rt, 'Mouse0', false)
    ticks(rt, 20)
    expect(rt.player.attackTimer).toBeLessThan(0)
    expect(rt.player.stamina).toBe(GAME_CONFIG.player.maxStamina)
    expect([...rt.zombies.values()][0].health).toBe(GAME_CONFIG.zombie.health)
    expect(hints).toHaveLength(1)
  })

  it('right and left pressed in the same tick: the stance comes first, the click swings', () => {
    const rt = setup()
    key(rt, 'Mouse2', true)
    key(rt, 'Mouse0', true)
    ticks(rt, 1)
    expect(rt.stance.requested).toBe(true)
    expect(rt.player.attackTimer).toBeGreaterThanOrEqual(0)
  })

  it('a left click a frame before the right one still counts (grace), without the hint', () => {
    const rt = setup()
    const hints: unknown[] = []
    rt.events.on('player:attackNeedsStance', (e) => hints.push(e))
    key(rt, 'Mouse0', true)
    ticks(rt, 1)
    expect(rt.player.attackTimer).toBeLessThan(0)
    key(rt, 'Mouse2', true)
    ticks(rt, 1)
    expect(rt.player.attackTimer).toBeGreaterThanOrEqual(0)
    ticks(rt, 10)
    expect(hints).toHaveLength(0)
  })

  it('right held, left clicked and right released within one frame: the click still swings', () => {
    const rt = setup()
    key(rt, 'Mouse2', true)
    key(rt, 'Mouse0', true)
    key(rt, 'Mouse2', false)
    ticks(rt, 1)
    expect(rt.player.attackTimer).toBeGreaterThanOrEqual(0)
    // Not after Esc while the right button stays down (it waits for a release).
    const rt2 = setup()
    key(rt2, 'Mouse2', true)
    ticks(rt2, 2)
    rt2.cancelStance()
    key(rt2, 'Mouse0', true)
    key(rt2, 'Mouse2', false)
    ticks(rt2, 1)
    expect(rt2.player.attackTimer).toBeLessThan(0)
  })

  it('a left button held before the stance does not swing without a new press', () => {
    const rt = setup()
    key(rt, 'Mouse0', true)
    ticks(rt, 30)
    key(rt, 'Mouse2', true)
    ticks(rt, 30)
    expect(rt.stance.requested).toBe(true)
    expect(rt.player.attackTimer).toBeLessThan(0)
    expect(rt.player.stamina).toBe(GAME_CONFIG.player.maxStamina)
    key(rt, 'Mouse0', false)
    ticks(rt, 1)
    key(rt, 'Mouse0', true)
    ticks(rt, 1)
    expect(rt.player.attackTimer).toBeGreaterThanOrEqual(0)
  })
})

describe('CS1 heading in the stance', () => {
  it('turns toward the cursor at the configured speed, the short way, and settles on it', () => {
    const rt = setup()
    rt.player.facing = 0
    rt.cursorWorld = { x: 5, y: 0, z: 0 } // +X = yaw π/2
    key(rt, 'Mouse2', true)
    ticks(rt, 1)
    expect(rt.player.facing).toBeCloseTo(CS.turnSpeedDeg * DEG * DT, 6)
    let last = rt.player.facing
    for (let i = 0; i < 30; i++) {
      rt.tick(DT)
      expect(rt.player.facing - last).toBeLessThanOrEqual(CS.turnSpeedDeg * DEG * DT + 1e-9)
      expect(rt.player.facing).toBeGreaterThanOrEqual(last)
      last = rt.player.facing
    }
    expect(rt.player.facing).toBeCloseTo(Math.PI / 2, 9)
  })

  it('outside the stance the aim does not turn the body (walking does)', () => {
    const rt = setup()
    rt.player.facing = 0
    rt.cursorWorld = { x: 5, y: 0, z: 0 }
    ticks(rt, 30)
    expect(rt.player.facing).toBe(0)
  })

  it('strafing and backing off in the stance keep the aim; walk speed ×0.8 and no running', () => {
    const rt = setup()
    rt.player.facing = 0
    rt.cursorWorld = { x: 0, y: 0, z: 5 } // aim +Z
    key(rt, 'Mouse2', true)
    ticks(rt, 5)
    for (const code of ['KeyA', 'KeyS', 'KeyD']) {
      key(rt, code, true)
      key(rt, 'ShiftLeft', true)
      ticks(rt, 20)
      expect(rt.player.facing).toBeCloseTo(0, 9)
      expect(rt.player.isRunning).toBe(false)
      expect(rt.player.moveSpeed).toBeCloseTo(GAME_CONFIG.player.walkSpeed * CS.speedFactor, 9)
      key(rt, code, false)
      key(rt, 'ShiftLeft', false)
    }
    // Leaving the stance: walking turns the body again and running is back.
    key(rt, 'Mouse2', false)
    key(rt, 'KeyS', true)
    key(rt, 'ShiftLeft', true)
    ticks(rt, 60)
    expect(rt.player.isRunning).toBe(true)
    expect(Math.abs(rt.player.facing)).toBeGreaterThan(0.5)
  })

  it('a cursor on the player keeps the previous aim: no NaN, no jitter', () => {
    const rt = setup()
    rt.player.facing = 0
    rt.cursorWorld = { x: 3, y: 0, z: 0 }
    key(rt, 'Mouse2', true)
    ticks(rt, 30)
    const aim = rt.stance.aimYaw
    for (const off of [0, 0.01, -0.02, 0.1]) {
      rt.cursorWorld = { x: off, y: 0, z: -off }
      ticks(rt, 3)
      expect(Number.isFinite(rt.player.facing)).toBe(true)
      expect(rt.stance.aimYaw).toBe(aim)
      expect(rt.player.facing).toBeCloseTo(aim, 9)
    }
    // Off the canvas (no cursor point): the last aim stays too.
    rt.cursorWorld = null
    ticks(rt, 10)
    expect(rt.player.facing).toBeCloseTo(aim, 9)
  })
})

describe('CS1 leaving the stance', () => {
  it('toggle: one press = one switch; switching the mode resets it', () => {
    const rt = setup()
    rt.setStanceMode('toggle')
    key(rt, 'Mouse2', true)
    ticks(rt, 10)
    key(rt, 'Mouse2', false)
    ticks(rt, 10)
    expect(rt.stance.requested).toBe(true)
    key(rt, 'Mouse2', true)
    ticks(rt, 1)
    expect(rt.stance.requested).toBe(false)
    key(rt, 'Mouse2', false)
    key(rt, 'Mouse2', true)
    ticks(rt, 1)
    expect(rt.stance.requested).toBe(true)
    rt.setStanceMode('hold')
    ticks(rt, 1)
    expect(rt.stance.requested).toBe(false)
  })

  it('blur/pause (input reset) drops the stance; the still-held button does not bring it back', () => {
    const rt = setup()
    key(rt, 'Mouse2', true)
    ticks(rt, 2)
    expect(rt.stance.requested).toBe(true)
    rt.input.clear()
    expect(rt.stance.requested).toBe(false)
    ticks(rt, 10)
    expect(rt.stance.requested).toBe(false)
  })

  it('Esc (cancelStance) leaves it until the right button is pressed again', () => {
    const rt = setup()
    key(rt, 'Mouse2', true)
    ticks(rt, 2)
    expect(rt.cancelStance()).toBe(true)
    ticks(rt, 10)
    expect(rt.stance.requested).toBe(false)
    expect(rt.cancelStance()).toBe(false)
    key(rt, 'Mouse2', false)
    ticks(rt, 1)
    key(rt, 'Mouse2', true)
    ticks(rt, 1)
    expect(rt.stance.requested).toBe(true)
  })

  it('releasing mid-swing: the swing finishes with the same cost and hit rules', () => {
    const rt = setup([{ x: 0, y: 0, z: 1 }])
    rt.player.facing = 0
    key(rt, 'Mouse2', true)
    key(rt, 'Mouse0', true)
    ticks(rt, 1)
    key(rt, 'Mouse0', false)
    key(rt, 'Mouse2', false)
    ticks(rt, 1)
    expect(rt.stance.requested).toBe(false)
    expect(rt.combatPosture).toBe(true)
    ticks(rt, 30)
    expect([...rt.zombies.values()][0].health).toBe(GAME_CONFIG.zombie.health - 25)
    expect(rt.player.stamina).toBeLessThan(GAME_CONFIG.player.maxStamina)
    expect(rt.combatPosture).toBe(false)
  })

  it('death drops the stance; the save never holds stance or aim', () => {
    const rt = setup()
    key(rt, 'Mouse2', true)
    ticks(rt, 2)
    const save = JSON.stringify(rt.createSnapshot())
    expect(save).not.toMatch(/"stance"|aimYaw|clickOutside|"requested"|toggled/)
    rt.player.health = 0
    rt.player.alive = false
    ticks(rt, 1)
    expect(rt.stance.requested).toBe(false)
  })
})

describe('CS1 E from the stance', () => {
  const hut: BuildingDef = {
    id: 'hut', name: 'Hut', center: { x: 0, z: 0 }, size: { w: 6, d: 6 }, height: 3, wallThickness: 0.3,
    wallColor: '#fff', roofColor: '#000', floorColor: '#888',
    doors: [{ id: 'door-hut', name: 'Cửa', side: 'S', offset: 0, width: 1.4 }],
    containers: [{ id: 'ct-hut', name: 'Tủ', position: { x: 0, y: 0.5, z: -2.5 }, size: [1, 1, 0.6], color: '#000' }],
  }

  it('E leaves the stance, opens the container, and the held right button does not re-enter it', () => {
    const rt = new GameRuntime({ ...field(), buildings: [hut], walls: generateBuildingWalls(hut), doors: generateDoorPlacements(hut), containers: hut.containers })
    rt.player.position = { x: 0, y: 0, z: -1.5 }
    rt.player.facing = Math.PI
    rt.cursorWorld = { x: 0, y: 0, z: -3 }
    key(rt, 'Mouse2', true)
    ticks(rt, 2)
    expect(rt.stance.requested).toBe(true)
    expect(rt.currentInteractable?.id).toBe('ct-hut')
    key(rt, 'KeyE', true)
    ticks(rt, 1)
    key(rt, 'KeyE', false)
    expect(rt.openContainerId).toBe('ct-hut')
    expect(rt.stance.requested).toBe(false)
    rt.closeAllUi()
    ticks(rt, 10)
    expect(rt.stance.requested).toBe(false)
  })
})
