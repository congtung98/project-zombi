import { describe, expect, it } from 'vitest'
import { GameRuntime } from './runtime'
import { GAME_CONFIG } from './config'
import type { MapData } from '../world/mapData'
import { generateBuildingWalls, generateDoorPlacements, type BuildingDef } from '../world/buildings'
import { addItem } from '../systems/inventory'
import { attackPhase } from '../systems/combat'
import { angleDiff } from '../systems/stance'

/** CS1b: swing timeline (wind-up/align → commit → strike → recovery), buffer and interrupts. */
const DT = 1 / 60
const DEG = Math.PI / 180
const CS = GAME_CONFIG.combatStance
const MELEE = GAME_CONFIG.melee
const HP = GAME_CONFIG.zombie.health

function field(zombieSpawns: MapData['zombieSpawns'] = []): MapData {
  return { id: 'field', size: 20, playerSpawn: { x: 0, y: 0, z: 0 }, zombieSpawns, buildings: [], walls: [], doors: [], containers: [], roads: [] }
}

/** Armed player at the origin facing +Z, zombies frozen where the test puts them. */
function setup(spawns: MapData['zombieSpawns'] = [], map?: MapData) {
  const rt = new GameRuntime(map ?? field(spawns))
  for (const z of rt.zombies.values()) z.staggerTimer = 1e6
  addItem(rt.player.inventory, 'baseball_bat', 1)
  expect(rt.equipItem(rt.player.inventory.slots.find(Boolean)!.id)).toBe(true)
  rt.player.facing = 0
  return { rt, zombies: [...rt.zombies.values()] }
}

const key = (rt: GameRuntime, code: string, down: boolean) => rt.input.simulateKey(code, down)
function click(rt: GameRuntime) {
  key(rt, 'Mouse0', true)
  rt.tick(DT)
  key(rt, 'Mouse0', false)
}
/** Hold the stance aimed at (x, z) and let the body settle on it. */
function aim(rt: GameRuntime, x: number, z: number, settle = 0) {
  rt.cursorWorld = { x, y: 0, z }
  key(rt, 'Mouse2', true)
  for (let i = 0; i < settle; i++) rt.tick(DT)
}
/** Tick until `done` or `max` seconds; returns the elapsed simulation time. */
function until(rt: GameRuntime, done: () => boolean, max = 2): number {
  let t = 0
  while (!done() && t < max) {
    rt.tick(DT)
    t += DT
  }
  return t
}

describe('CS1b swing timing', () => {
  it('already facing the aim: the hit lands at hitDelay, as before (no extra delay)', () => {
    const { rt, zombies } = setup([{ x: 0, y: 0, z: 1.2 }])
    aim(rt, 0, 5, 1)
    click(rt)
    const t = DT + until(rt, () => zombies[0].health < HP)
    expect(t).toBeGreaterThanOrEqual(MELEE.hitDelay)
    expect(t).toBeLessThan(MELEE.hitDelay + 2 * DT)
  })

  it('a click behind the back turns first: nothing is hit before the body faces the swing', () => {
    const { rt, zombies } = setup([{ x: 0, y: 0, z: 1.2 }, { x: 0, y: 0, z: -1.2 }])
    const [front, back] = zombies
    // Stance on, aimed ahead; then the cursor goes behind and the click comes at once.
    aim(rt, 0, 5, 2)
    rt.cursorWorld = { x: 0, y: 0, z: -5 }
    let maxStep = 0
    let prev = rt.player.facing
    let hitAt = -1
    key(rt, 'Mouse0', true)
    for (let t = DT; t < 1; t += DT) {
      rt.tick(DT)
      key(rt, 'Mouse0', false)
      maxStep = Math.max(maxStep, Math.abs(angleDiff(prev, rt.player.facing)))
      prev = rt.player.facing
      if (hitAt < 0 && back.health < HP) {
        hitAt = t
        // The body faces the swing when it lands (within the tolerance, closing in during the strike).
        expect(Math.abs(angleDiff(rt.player.facing, Math.PI))).toBeLessThanOrEqual(CS.alignToleranceDeg * DEG)
      }
    }
    expect(front.health).toBe(HP)
    expect(back.health).toBe(HP - 25)
    // Turning 180° at 630°/s ≈ 0.29 s, then the strike: slower than a hit ahead, but bounded.
    expect(hitAt).toBeGreaterThan(0.28)
    expect(hitAt).toBeLessThan(0.45)
    expect(maxStep).toBeLessThanOrEqual(CS.turnSpeedDeg * DEG * DT + 1e-9)
  })

  it('moving the cursor to the other side mid-strike changes neither the swing nor its hit arc', () => {
    const { rt, zombies } = setup([{ x: 1.2, y: 0, z: 0 }, { x: -1.2, y: 0, z: 0 }])
    const [right, left] = zombies
    aim(rt, 5, 0, 20) // +X
    click(rt)
    until(rt, () => rt.player.attackCommitted)
    const committed = rt.player.attackYaw
    rt.cursorWorld = { x: -5, y: 0, z: 0 }
    until(rt, () => rt.player.attackTimer < 0)
    expect(rt.player.attackYaw).toBe(committed)
    expect(right.health).toBe(HP - 25)
    expect(left.health).toBe(HP)
  })

  it('phases: wind-up, strike, recovery, then none; the swing direction is fixed from the commit', () => {
    const { rt } = setup()
    aim(rt, 0, 5, 1)
    click(rt)
    const seen: string[] = []
    until(rt, () => {
      const p = attackPhase(rt.player)
      if (seen.at(-1) !== p) seen.push(p)
      return p === 'none'
    })
    expect(seen).toEqual(['windup', 'strike', 'recovery', 'none'])
  })

  it('a body that cannot turn (another controller holding it) drops the swing after the timeout, cost kept', () => {
    const { rt, zombies } = setup([{ x: 0, y: 0, z: -1.2 }])
    const cancelled: unknown[] = []
    rt.events.on('player:attackCancelled', (e) => cancelled.push(e))
    aim(rt, 0, 5, 1)
    rt.cursorWorld = { x: 0, y: 0, z: -5 }
    click(rt)
    const stamina = rt.player.stamina
    let t = 0
    while (rt.player.attackTimer >= 0 && t < 2) {
      rt.player.facing = 0 // locked facing
      rt.tick(DT)
      t += DT
    }
    expect(cancelled).toEqual([{ reason: 'align-timeout' }])
    expect(t).toBeGreaterThan(CS.alignTimeout - DT)
    expect(t).toBeLessThan(CS.alignTimeout + 3 * DT)
    expect(zombies[0].health).toBe(HP)
    expect(rt.player.stamina).toBe(stamina)
    expect(rt.player.attackCooldown).toBeGreaterThan(0)
  })

  it('a long frame (0.1 s steps) still lands exactly one hit', () => {
    const { rt, zombies } = setup([{ x: 0, y: 0, z: 1.2 }])
    aim(rt, 0, 5, 1)
    let hits = 0
    rt.events.on('zombie:damaged', () => (hits += 1))
    key(rt, 'Mouse0', true)
    rt.tick(0.1)
    key(rt, 'Mouse0', false)
    for (let i = 0; i < 8; i++) rt.tick(0.1)
    expect(hits).toBe(1)
    expect(zombies[0].health).toBe(HP - 25)
  })
})

describe('CS1b clicks during a swing', () => {
  it('spamming the left button never queues more than one swing and never skips the recovery', () => {
    const { rt, zombies } = setup([{ x: 0, y: 0, z: 1.2 }])
    aim(rt, 0, 5, 1)
    let swings = 0
    let hits = 0
    rt.events.on('player:attacked', () => (swings += 1))
    rt.events.on('zombie:damaged', () => (hits += 1))
    const starts: number[] = []
    let last = rt.player.attackId
    for (let t = 0; t < 2.5; t += DT) {
      key(rt, 'Mouse0', true)
      rt.tick(DT)
      key(rt, 'Mouse0', false)
      if (rt.player.attackId !== last) {
        starts.push(t)
        last = rt.player.attackId
      }
      zombies[0].position = { x: 0, y: 0, z: 1.2 }
      zombies[0].health = HP // never dies: every swing must land exactly once
    }
    // One swing per cooldown (1 s): the clicks in between never stack.
    expect(starts).toHaveLength(3)
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(MELEE.cooldown - 1e-6)
    expect(hits).toBe(swings)
  })

  it('a click early in the recovery is dropped; one near its end is queued and starts when ready', () => {
    const { rt } = setup()
    aim(rt, 0, 5, 1)
    click(rt)
    until(rt, () => rt.player.attackTimer < 0)
    // Early (cooldown ≈ 0.65 s left): dropped.
    click(rt)
    expect(rt.pendingAttack).toBeNull()
    until(rt, () => rt.player.attackCooldown <= CS.bufferWindow - 2 * DT)
    const id = rt.player.attackId
    rt.cursorWorld = { x: 5, y: 0, z: 0 }
    click(rt)
    expect(rt.pendingAttack).not.toBeNull()
    // The queued click keeps its own aim snapshot and starts right after the cooldown.
    const t = until(rt, () => rt.player.attackId !== id)
    expect(t).toBeLessThanOrEqual(CS.bufferWindow)
    expect(rt.player.attackYaw).toBeCloseTo(Math.PI / 2, 9)
    expect(rt.pendingAttack).toBeNull()
  })

  it('releasing the stance (or Esc) drops a queued click; the swing in progress still finishes', () => {
    const { rt, zombies } = setup([{ x: 0, y: 0, z: 1.2 }])
    aim(rt, 0, 5, 1)
    const queue = () => {
      click(rt)
      until(rt, () => rt.player.attackTimer < 0)
      rt.player.attackCooldown = 0.1 // near the end: the next click is queued
      click(rt)
      expect(rt.pendingAttack).not.toBeNull()
    }
    queue()
    const id = rt.player.attackId
    key(rt, 'Mouse2', false)
    rt.tick(DT)
    expect(rt.pendingAttack).toBeNull()
    for (let i = 0; i < 30; i++) rt.tick(DT)
    expect(rt.player.attackId).toBe(id)

    aim(rt, 0, 5, 1)
    queue()
    expect(rt.cancelStance()).toBe(true)
    expect(rt.pendingAttack).toBeNull()

    // Esc mid-swing: the swing lands and completes (no free cancel), nothing queued afterwards.
    key(rt, 'Mouse2', false)
    rt.tick(DT)
    aim(rt, 0, 5, 1)
    until(rt, () => rt.player.attackCooldown <= 0)
    expect(zombies[0].ai).toBe('DEAD') // two hits above
    const fresh = rt.spawnZombie({ x: 0, y: 0, z: 1.2 })
    fresh.staggerTimer = 1e6
    click(rt)
    expect(rt.cancelStance()).toBe(true)
    until(rt, () => rt.player.attackTimer < 0)
    expect(fresh.health).toBe(HP - 25)
  })

  it('death mid-wind-up: the swing never lands', () => {
    const { rt, zombies } = setup([{ x: 0, y: 0, z: -1.2 }])
    aim(rt, 0, 5, 1)
    rt.cursorWorld = { x: 0, y: 0, z: -5 }
    click(rt)
    rt.tick(DT)
    rt.player.health = 0
    rt.player.alive = false
    for (let i = 0; i < 60; i++) rt.tick(DT)
    expect(zombies[0].health).toBe(HP)
    expect(rt.player.attackTimer).toBeLessThan(0)
  })

  it('the stance hint: a queued click and a blur/pause reset never swing by themselves', () => {
    const { rt } = setup()
    aim(rt, 0, 5, 1)
    click(rt)
    until(rt, () => rt.player.attackTimer < 0)
    rt.player.attackCooldown = 0.1
    click(rt)
    expect(rt.pendingAttack).not.toBeNull()
    rt.input.clear()
    const id = rt.player.attackId
    for (let i = 0; i < 90; i++) rt.tick(DT)
    expect(rt.player.attackId).toBe(id)
  })
})

describe('CS1b E during a swing', () => {
  const hut: BuildingDef = {
    id: 'hut', name: 'Hut', center: { x: 0, z: 0 }, size: { w: 6, d: 6 }, height: 3, wallThickness: 0.3,
    wallColor: '#fff', roofColor: '#000', floorColor: '#888',
    doors: [{ id: 'door-hut', name: 'Cửa', side: 'S', offset: 0, width: 1.4 }],
    containers: [{ id: 'ct-hut', name: 'Tủ', position: { x: 0, y: 0.5, z: -2.5 }, size: [1, 1, 0.6], color: '#000' }],
  }

  it('E in the middle of a swing is dropped (not queued); after the swing it works', () => {
    const { rt } = setup([], { ...field(), buildings: [hut], walls: generateBuildingWalls(hut), doors: generateDoorPlacements(hut), containers: hut.containers })
    rt.player.position = { x: 0, y: 0, z: -1.5 }
    rt.player.facing = Math.PI
    const blocked: unknown[] = []
    rt.events.on('player:interactBlocked', (e) => blocked.push(e))
    aim(rt, 0, -3, 2)
    click(rt)
    key(rt, 'KeyE', true)
    rt.tick(DT)
    key(rt, 'KeyE', false)
    expect(blocked).toHaveLength(1)
    expect(rt.openContainerId).toBeNull()
    until(rt, () => rt.player.attackTimer < 0)
    expect(rt.openContainerId).toBeNull()
    key(rt, 'KeyE', true)
    rt.tick(DT)
    key(rt, 'KeyE', false)
    expect(rt.openContainerId).toBe('ct-hut')
    expect(rt.stance.requested).toBe(false)
  })

  it('E and a left click in the same frame: the swing wins, E is dropped', () => {
    const { rt } = setup([], { ...field(), buildings: [hut], walls: generateBuildingWalls(hut), doors: generateDoorPlacements(hut), containers: hut.containers })
    rt.player.position = { x: 0, y: 0, z: -1.5 }
    rt.player.facing = Math.PI
    aim(rt, 0, -3, 2)
    key(rt, 'Mouse0', true)
    key(rt, 'KeyE', true)
    rt.tick(DT)
    key(rt, 'Mouse0', false)
    key(rt, 'KeyE', false)
    expect(rt.player.attackTimer).toBeGreaterThanOrEqual(0)
    until(rt, () => rt.player.attackTimer < 0)
    expect(rt.openContainerId).toBeNull()
  })
})
