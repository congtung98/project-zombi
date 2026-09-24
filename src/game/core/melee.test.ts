import { describe, expect, it } from 'vitest'
import { GameRuntime } from './runtime'
import { GAME_CONFIG } from './config'
import type { MapData } from '../world/mapData'
import type { ItemId } from '../entities/items'
import { addItem } from '../systems/inventory'
import { validateSaveGame } from '../systems/save'
import type { WeaponInstance } from '../systems/weapons'

/** Open field, no walls: only the melee rules decide what is hit. */
function field(zombieSpawns: MapData['zombieSpawns']): MapData {
  return { id: 'field', size: 20, playerSpawn: { x: 0, y: 0, z: 0 }, zombieSpawns, buildings: [], walls: [], doors: [], containers: [], roads: [] }
}

const DT = 1 / 60

function give(rt: GameRuntime, itemId: ItemId, condition?: number): WeaponInstance {
  addItem(rt.player.inventory, itemId, 1, { condition })
  return rt.player.inventory.slots.findLast((i) => i?.itemId === itemId) as WeaponInstance
}

function arm(rt: GameRuntime, itemId: ItemId = 'baseball_bat', condition?: number): WeaponInstance {
  const w = give(rt, itemId, condition)
  expect(rt.equipItem(w.id)).toBe(true)
  return w
}

/** Press attack once, run through the hit window, then wait out the weapon cooldown. */
function swing(rt: GameRuntime) {
  rt.input.simulateKey('Mouse0', true)
  rt.tick(DT)
  rt.input.simulateKey('Mouse0', false)
  for (let t = 0; t < 2; t += DT) rt.tick(DT)
}

function setup(spawns: MapData['zombieSpawns']) {
  const rt = new GameRuntime(field(spawns))
  rt.player.facing = Math.PI / 2 // nhìn về +X
  // Freeze zombies so positions stay exactly where the test put them.
  for (const z of rt.zombies.values()) z.staggerTimer = 1e6
  return { rt, zombies: Array.from(rt.zombies.values()) }
}

describe('P2-S2 unarmed start', () => {
  it('New Game has no weapon; clicking attack only hints, while Space push still works', () => {
    const { rt, zombies } = setup([{ x: 1, y: 0, z: 0 }])
    expect(rt.player.inventory.slots.every((s) => s === null)).toBe(true)
    expect(rt.player.equipment.weaponInstanceId).toBeNull()
    const hints: unknown[] = []
    rt.events.on('player:unarmed', (e) => hints.push(e))
    swing(rt)
    expect(hints).toHaveLength(1)
    expect(rt.player.stamina).toBe(GAME_CONFIG.player.maxStamina)
    expect(zombies[0].health).toBe(GAME_CONFIG.zombie.health)

    rt.input.simulateKey('Space', true)
    rt.tick(DT)
    rt.input.simulateKey('Space', false)
    expect(zombies[0].knockback.x).toBeGreaterThan(0)
    expect(zombies[0].health).toBe(GAME_CONFIG.zombie.health)
  })
})

describe('P2-S2 melee wear', () => {
  it('one swing hitting two zombies damages each once and wears the weapon once', () => {
    const { rt, zombies } = setup([{ x: 1.2, y: 0, z: 0.4 }, { x: 1.2, y: 0, z: -0.4 }])
    const bat = arm(rt)
    const worn: number[] = []
    const damaged: string[] = []
    rt.events.on('weapon:worn', (e) => worn.push(e.condition))
    rt.events.on('zombie:damaged', (e) => damaged.push(e.id))
    swing(rt)
    expect(damaged.sort()).toEqual(zombies.map((z) => z.id).sort())
    for (const z of zombies) expect(z.health).toBe(GAME_CONFIG.zombie.health - 25)
    expect(worn).toEqual([79])
    expect(bat.condition).toBe(79)
  })

  it('a swing that hits nothing costs no condition', () => {
    const { rt } = setup([{ x: -3, y: 0, z: 0 }])
    const bat = arm(rt)
    const swings: number[] = []
    rt.events.on('player:attacked', (e) => swings.push(e.hitIds.length))
    swing(rt)
    expect(swings).toEqual([0])
    expect(bat.condition).toBe(80)
  })

  it('condition 1: the hit deals full damage, then the weapon breaks; the next hit deals 20%', () => {
    const { rt, zombies } = setup([{ x: 1, y: 0, z: 0 }])
    const bat = arm(rt, 'baseball_bat', 1)
    const broken: string[] = []
    rt.events.on('weapon:broken', (e) => broken.push(e.id))
    swing(rt)
    expect(zombies[0].health).toBe(25)
    expect(bat.condition).toBe(0)
    expect(broken).toEqual([bat.id])
    swing(rt)
    expect(zombies[0].health).toBe(20)
    expect(broken).toHaveLength(1) // broken is announced once, not on every weak hit
    // Broken stays owned, equipped and equipable.
    expect(rt.player.equipment.weaponInstanceId).toBe(bat.id)
    expect(rt.equipItem(null)).toBe(true)
    expect(rt.equipItem(bat.id)).toBe(true)
  })

  it('warns once when condition drops into the low band', () => {
    const { rt } = setup([{ x: 1, y: 0, z: 0 }])
    arm(rt, 'baseball_bat', 21)
    const low: string[] = []
    rt.events.on('weapon:lowCondition', (e) => low.push(e.name))
    swing(rt)
    swing(rt)
    expect(low).toEqual(['Gậy bóng chày'])
  })

  it('uses the equipped weapon stats: the hammer is short and fast, the bat reaches farther', () => {
    const { rt, zombies } = setup([{ x: 2, y: 0, z: 0 }]) // edge at 1.6: bat reach 2.0, hammer 1.3
    const hammer = arm(rt, 'hammer')
    rt.input.simulateKey('Mouse0', true)
    rt.tick(DT)
    rt.input.simulateKey('Mouse0', false)
    expect(rt.player.attackCooldown).toBeCloseTo(0.8 - DT, 5)
    expect(rt.player.stamina).toBe(GAME_CONFIG.player.maxStamina - 10)
    for (let t = 0; t < 2; t += DT) rt.tick(DT)
    expect(zombies[0].health).toBe(GAME_CONFIG.zombie.health)
    expect(hammer.condition).toBe(100)

    arm(rt, 'baseball_bat')
    swing(rt)
    expect(zombies[0].health).toBe(GAME_CONFIG.zombie.health - 25)
  })

  it('only the weapon that started the swing wears; two bats keep separate conditions', () => {
    const { rt } = setup([{ x: 1, y: 0, z: 0 }])
    const a = give(rt, 'baseball_bat', 50)
    const b = give(rt, 'baseball_bat', 70)
    expect(rt.equipItem(a.id)).toBe(true)
    rt.input.simulateKey('Mouse0', true)
    rt.tick(DT)
    rt.input.simulateKey('Mouse0', false)
    expect(rt.equipItem(b.id)).toBe(false) // cannot swap mid-swing
    for (let t = 0; t < 2; t += DT) rt.tick(DT)
    expect([a.condition, b.condition]).toEqual([49, 70])
  })

  it('reload never restores condition, and broken weapons stay broken', () => {
    const { rt } = setup([{ x: 1, y: 0, z: 0 }])
    const bat = arm(rt, 'baseball_bat', 2)
    const spare = give(rt, 'metal_pipe', 33)
    swing(rt)
    swing(rt)
    expect(bat.condition).toBe(0)
    const snap = JSON.parse(JSON.stringify(rt.createSnapshot()))
    const v = validateSaveGame(snap, 'field', rt.map)
    expect(v.ok).toBe(true)
    if (!v.ok) return
    const rt2 = new GameRuntime(field([]))
    rt2.loadSnapshot(v.save)
    const weapons = rt2.player.inventory.slots.filter((i): i is WeaponInstance => i?.kind === 'weapon')
    expect(weapons.map((w) => [w.id, w.condition])).toEqual([[bat.id, 0], [spare.id, 33]])
    expect(rt2.player.equipment.weaponInstanceId).toBe(bat.id)
  })
})
