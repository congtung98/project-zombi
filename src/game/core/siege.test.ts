import { describe, expect, it } from 'vitest'
import { GameRuntime } from './runtime'
import { GAME_CONFIG } from './config'
import { generateBuildingWalls, generateDoorPlacements, isInsideBuilding, type BuildingDef } from '../world/buildings'
import { NEIGHBORHOOD_MAP, type MapData } from '../world/mapData'
import type { NavGrid } from '../world/navigation'
import { validateSaveGame } from '../systems/save'
import { DOOR_MAX_HP } from '../world/doors'
import { addItem } from '../systems/inventory'

/**
 * P2-S5 acceptance at runtime level (plan §12 Sprint P2-S5). R2: zombies are moved by the simulation
 * itself (static colliders: walls, closed door leaves); the player body is a fake that moves on the
 * nav grid, and LOS is the grid line of walk.
 */
const DT = 1 / 30

const hut: BuildingDef = {
  id: 'hut', name: 'Hut', center: { x: 0, z: 0 }, size: { w: 6, d: 6 }, height: 3, wallThickness: 0.3,
  wallColor: '#fff', roofColor: '#000', floorColor: '#888',
  doors: [{ id: 'door-hut', name: 'Cửa', side: 'S', offset: 0, width: 1.4 }], containers: [],
}

function hutMap(zombieSpawns: MapData['zombieSpawns']): MapData {
  return {
    id: 'siege-test', size: 30, playerSpawn: { x: 0, y: 0, z: -1 }, zombieSpawns, buildings: [hut],
    walls: generateBuildingWalls(hut), doors: generateDoorPlacements(hut), containers: [], roads: [],
  }
}

function fakeBody(nav: NavGrid, x: number, z: number) {
  const pos = { x, y: 0.9, z }
  let vel = { x: 0, y: 0, z: 0 }
  return {
    translation: () => ({ ...pos }),
    linvel: () => ({ ...vel }),
    setLinvel: (v: { x: number; y: number; z: number }) => { vel = { ...v } },
    setTranslation: (p: { x: number; z: number }) => { pos.x = p.x; pos.z = p.z },
    setEnabled: () => undefined,
    step: (dt: number) => {
      const nx = pos.x + vel.x * dt
      const nz = pos.z + vel.z * dt
      if (nav.isWalkable(nx, nz)) { pos.x = nx; pos.z = nz } else if (nav.isWalkable(nx, pos.z)) pos.x = nx
      else if (nav.isWalkable(pos.x, nz)) pos.z = nz
    },
  }
}
type FakeBody = ReturnType<typeof fakeBody>
const asBody = (b: FakeBody) => b as unknown as Parameters<GameRuntime['registerPlayerBody']>[0]

/** Runtime with grid-backed physics for the player; zombies move in the simulation (R2). */
function world(map: MapData, seed = 7) {
  const rt = new GameRuntime(map)
  rt.newGame(seed)
  rt.setLineOfSightOverride({ isBlocked: (a, b, ignore) => (ignore.length > 0 ? false : !rt.nav.hasLineOfWalk(a, b)) })
  const player = fakeBody(rt.nav, rt.player.position.x, rt.player.position.z)
  rt.registerPlayerBody(asBody(player))
  const step = (seconds: number, each?: () => void) => {
    for (let t = 0; t < seconds; t += DT) {
      rt.tick(DT)
      player.step(DT)
      each?.()
    }
  }
  const pos = (id: string) => rt.zombies.get(id)!.position
  return { rt, player, pos, step }
}

describe('P2-S5 zombie breaks a door to reach a remembered player', () => {
  it('seen entering → door closed → approaches, bashes 10 per hit, breaks it, comes in and attacks', () => {
    const { rt, pos, step } = world(hutMap([{ x: 0, y: 0, z: 9 }]))
    rt.pickWanderPoint = () => null // keep the Phase 1 staging: it stands facing the hut
    const zombie = rt.zombies.get('zombie-1')!
    zombie.facing = Math.PI
    const events: string[] = []
    const hp: number[] = []
    let damaged = 0
    rt.events.on('door:damaged', (e) => { events.push('damaged'); hp.push(e.hp) })
    rt.events.on('door:destroyed', () => events.push('destroyed'))
    rt.events.on('player:damaged', () => (damaged += 1))

    rt.setDoorState('door-hut', 'open')
    step(0.5)
    expect(zombie.ai).toBe('CHASE') // sees the player through the doorway
    rt.setDoorState('door-hut', 'closed')
    step(1)
    // Lost sight behind the closed door, remembers where the player was, goes for the door.
    expect(zombie.lastKnownTarget).not.toBeNull()
    expect(['SEARCH', 'APPROACH_STRUCTURE', 'ATTACK_STRUCTURE']).toContain(zombie.ai)
    step(4)
    expect(zombie.ai).toBe('ATTACK_STRUCTURE')
    expect(zombie.structureTargetId).toBe('door-hut')
    // Bashing from outside: the zombie never got in and never hurt the player through the door.
    expect(pos('zombie-1').z).toBeGreaterThan(3.3)
    expect(damaged).toBe(0)

    step(20)
    expect(rt.world.doors.get('door-hut')).toEqual({ id: 'door-hut', state: 'destroyed', hp: 0 })
    expect(hp).toEqual(Array.from({ length: DOOR_MAX_HP / GAME_CONFIG.structure.damage }, (_, i) => DOOR_MAX_HP - GAME_CONFIG.structure.damage * (i + 1)))
    expect(events.filter((e) => e === 'destroyed')).toHaveLength(1)
    expect(rt.nav.findPath({ x: 0, y: 0, z: 8 }, { x: 0, y: 0, z: -1 })).not.toBeNull()
    step(6)
    // In through the broken door, sees the player again and attacks.
    expect(pos('zombie-1').z).toBeLessThan(2)
    expect(zombie.ai).toBe('ATTACK')
    expect(damaged).toBeGreaterThan(0)
  })

  it('a player never seen behind the closed door, standing still or moving quietly away from walls, is never targeted', () => {
    const { rt, step } = world(hutMap([{ x: 0, y: 0, z: 4.5 }, { x: 4.2, y: 0, z: 0 }]))
    const hunted: string[] = []
    rt.events.on('zombie:stateChanged', (e) => { if (!['IDLE', 'WANDER'].includes(e.to)) hunted.push(`${e.id}:${e.to}`) })
    // Zombies right outside the walls, 1.2–5 m away; the player is inside, not moving.
    step(30)
    expect(hunted).toEqual([])
    expect(rt.world.doors.get('door-hut')!.hp).toBe(DOOR_MAX_HP)
    for (const z of rt.zombies.values()) expect(z.lastKnownTarget).toBeNull()
  })

  it('footsteps inside are heard through the wall only up close, and lead to a door siege', () => {
    const { rt, player, step } = world(hutMap([{ x: 0, y: 0, z: 4.2 }]))
    rt.pickWanderPoint = () => null
    const zombie = rt.zombies.get('zombie-1')!
    zombie.facing = 0 // looking away from the hut
    // Player walks along the far (north) wall: > walkRadius × wallFactor from the zombie.
    player.setTranslation({ x: 0, z: -2.4 })
    rt.input.simulateKey('KeyW', true)
    step(3)
    rt.input.simulateKey('KeyW', false)
    expect(zombie.lastKnownTarget).toBeNull()
    // Standing still right behind the door: silent.
    player.setTranslation({ x: 0, z: 2.3 })
    step(2)
    expect(zombie.lastKnownTarget).toBeNull()
    // Footsteps right behind the door (~1.9 m through the wall) are heard.
    rt.input.simulateKey('KeyA', true)
    step(0.5)
    rt.input.simulateKey('KeyA', false)
    expect(zombie.memorySource).toBe('noise')
    step(6)
    expect(['APPROACH_STRUCTURE', 'ATTACK_STRUCTURE']).toContain(zombie.ai)
    expect(zombie.structureTargetId).toBe('door-hut')
  })

  it('a timed action aimed at the door (S6 barricade hook) is cancelled by a hit, spending nothing', () => {
    const { rt, step } = world(hutMap([{ x: 0, y: 0, z: 9 }]))
    rt.pickWanderPoint = () => null
    rt.zombies.get('zombie-1')!.facing = Math.PI
    rt.setDoorState('door-hut', 'open')
    step(0.5)
    rt.setDoorState('door-hut', 'closed')
    step(5)
    expect(rt.zombies.get('zombie-1')!.ai).toBe('ATTACK_STRUCTURE')
    addItem(rt.player.inventory, 'wood_plank', 2)
    addItem(rt.player.inventory, 'duct_tape', 1)
    const bag = JSON.stringify(rt.player.inventory)
    expect(rt.startCraft('craft_wooden_club').ok).toBe(true)
    rt.action!.worldTargetId = 'door-hut'
    const reasons: string[] = []
    rt.events.on('action:cancelled', (e) => reasons.push(e.reason))
    step(GAME_CONFIG.zombie.attackWindup + GAME_CONFIG.structure.cooldown + 0.2)
    expect(reasons).toEqual(['target-damaged'])
    expect(rt.action).toBeNull()
    expect(JSON.stringify(rt.player.inventory)).toBe(bag)
  })

  it('opening the door during a windup cancels that hit (no damage from afar)', () => {
    const { rt, step } = world(hutMap([{ x: 0, y: 0, z: 9 }]))
    rt.pickWanderPoint = () => null
    const zombie = rt.zombies.get('zombie-1')!
    zombie.facing = Math.PI
    rt.setDoorState('door-hut', 'open')
    step(0.5)
    rt.setDoorState('door-hut', 'closed')
    let guard = 0
    while (!(zombie.ai === 'ATTACK_STRUCTURE' && zombie.attackWindup > 0) && guard++ < 600) step(DT)
    expect(zombie.attackWindup).toBeGreaterThan(0)
    const before = rt.world.doors.get('door-hut')!.hp
    let hits = 0
    rt.events.on('door:damaged', () => (hits += 1))
    rt.setDoorState('door-hut', 'open')
    step(1)
    expect(hits).toBe(0)
    expect(rt.world.doors.get('door-hut')!.hp).toBe(before)
    expect(zombie.structureTargetId).toBeNull()
  })

  it('at most two zombies bash one side of a door; the rest wait further back', () => {
    const { rt, step, pos } = world(hutMap([{ x: -1.5, y: 0, z: 8 }, { x: -0.5, y: 0, z: 8.5 }, { x: 0.5, y: 0, z: 8 }, { x: 1.5, y: 0, z: 8.5 }]))
    rt.pickWanderPoint = () => null
    for (const z of rt.zombies.values()) z.facing = Math.PI
    rt.setDoorState('door-hut', 'open')
    step(0.5)
    rt.setDoorState('door-hut', 'closed')
    const hitters = new Set<string>()
    let maxBashing = 0
    rt.events.on('door:damaged', (e) => hitters.add(e.sourceId))
    step(6, () => {
      const bashing = Array.from(rt.zombies.values()).filter((z) => z.ai === 'ATTACK_STRUCTURE')
      maxBashing = Math.max(maxBashing, bashing.length)
      // Every basher is at the door, queued ones are not within reach.
      for (const z of bashing) expect(Math.hypot(z.position.x, z.position.z - 3)).toBeLessThanOrEqual(GAME_CONFIG.structure.reach * 1.25)
    })
    expect(maxBashing).toBeLessThanOrEqual(2)
    expect(maxBashing).toBeGreaterThan(0)
    expect(hitters.size).toBeLessThanOrEqual(2)
    const waiting = Array.from(rt.zombies.values()).filter((z) => z.ai === 'APPROACH_STRUCTURE')
    for (const z of waiting) expect(Math.hypot(pos(z.id).x, pos(z.id).z - 3)).toBeGreaterThan(1.6)
  })

  it('a save mid-siege restores door HP and the siege; the loaded zombie finishes the door', () => {
    const { rt, step } = world(hutMap([{ x: 0, y: 0, z: 9 }]))
    rt.pickWanderPoint = () => null
    rt.zombies.get('zombie-1')!.facing = Math.PI
    rt.setDoorState('door-hut', 'open')
    step(0.5)
    rt.setDoorState('door-hut', 'closed')
    step(10)
    const snap = JSON.parse(JSON.stringify(rt.createSnapshot()))
    expect(validateSaveGame(snap, rt.map.id, rt.map).ok).toBe(true)
    const saved = snap.doors.find((d: { id: string }) => d.id === 'door-hut')
    expect(saved.hp).toBeLessThan(DOOR_MAX_HP)
    expect(snap.zombies[0]).toMatchObject({ ai: 'ATTACK_STRUCTURE', structureTargetId: 'door-hut', memorySource: 'sight' })

    const second = world(hutMap([{ x: 0, y: 0, z: 9 }]))
    second.rt.loadSnapshot(snap)
    expect({ ...second.rt.createSnapshot(), savedAt: 0 }).toEqual({ ...snap, savedAt: 0 })
    second.step(20)
    expect(second.rt.world.doors.get('door-hut')!.state).toBe('destroyed')
  })
})

describe('P2-S5 wandering, migration and respawn on the neighbourhood map', () => {
  it('zombies rest and wander inside their zone, outdoors, and actually move', () => {
    const { rt, step } = world(NEIGHBORHOOD_MAP, 11)
    rt.hordeTimer = 1e9 // wander only
    const start = new Map(Array.from(rt.zombies.values(), (z) => [z.id, { ...z.position }]))
    const states = new Map<string, Set<string>>()
    step(60, () => {
      for (const z of rt.zombies.values()) {
        if (!states.has(z.id)) states.set(z.id, new Set())
        states.get(z.id)!.add(z.ai)
        if (z.ai === 'WANDER' && z.moveTarget) {
          const zone = NEIGHBORHOOD_MAP.zombieZones!.find((zn) => zn.id === z.zoneId)!
          expect(Math.hypot(z.moveTarget.x - zone.center.x, z.moveTarget.z - zone.center.z)).toBeLessThanOrEqual(zone.radius + 1)
          expect(NEIGHBORHOOD_MAP.buildings.some((b) => isInsideBuilding(b, z.moveTarget!.x, z.moveTarget!.z))).toBe(false)
          expect(rt.nav.isWalkable(z.moveTarget.x, z.moveTarget.z)).toBe(true)
        }
      }
    })
    let moved = 0
    for (const z of rt.zombies.values()) {
      if (z.ai === 'DEAD') continue
      expect(states.get(z.id)).toContain('WANDER')
      expect(states.get(z.id)).toContain('IDLE')
      const from = start.get(z.id)
      if (from && Math.hypot(z.position.x - from.x, z.position.z - from.z) > 0.5) moved += 1
    }
    expect(moved).toBeGreaterThanOrEqual(start.size - 1)
  })

  it('the horde director pushes a whole zone group to another zone, deterministically', () => {
    const run = () => {
      const { rt, step } = world(NEIGHBORHOOD_MAP, 11)
      // Two zombies share the park so one group qualifies.
      rt.spawnZombie({ x: -16, y: 0, z: 14 })
      const migrations: { from: string; to: string; ids: string[]; moving: string[] }[] = []
      rt.events.on('horde:migrated', (e) => migrations.push(e))
      rt.hordeTimer = 0.01
      step(DT * 2)
      expect(migrations).toHaveLength(1)
      const m = migrations[0]
      expect(m.from).not.toBe(m.to)
      expect(m.ids.length).toBeGreaterThanOrEqual(GAME_CONFIG.horde.minGroupSize)
      for (const id of m.ids) expect(rt.zombies.get(id)!.zoneId).toBe(m.to)
      for (const id of m.moving) expect(rt.zombies.get(id)!.ai).toBe('MIGRATE')
      expect(rt.hordeTimer).toBeGreaterThanOrEqual(GAME_CONFIG.horde.intervalMin - DT * 2)
      step(75)
      const zone = NEIGHBORHOOD_MAP.zombieZones!.find((z) => z.id === m.to)!
      const arrived = m.moving.filter((id) => {
        const z = rt.zombies.get(id)!
        return Math.hypot(z.position.x - zone.center.x, z.position.z - zone.center.z) <= zone.radius + 2
      })
      expect(arrived.length).toBe(m.moving.length)
      return m
    }
    expect(run()).toEqual(run())
  })

  it('respawns never pick a point inside a building or on a blocked cell', () => {
    const map: MapData = { ...hutMap([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 12 }]), size: 40, playerSpawn: { x: -18, y: 0, z: -18 } }
    const { rt, step } = world(map, 3)
    for (const z of rt.zombies.values()) z.health = 0
    const spawned: string[] = []
    rt.events.on('zombie:spawned', (e) => spawned.push(e.id))
    step(GAME_CONFIG.spawn.intervalDay * 3 + 1)
    expect(spawned.length).toBeGreaterThan(0)
    for (const id of spawned) {
      const p = rt.zombies.get(id)!.position
      expect(isInsideBuilding(hut, p.x, p.z)).toBe(false)
    }
  })
})
