import { beforeAll, describe, expect, it } from 'vitest'
import RAPIER from '@dimforge/rapier3d-compat'
import { DOOR_LAB_MAP } from './doorLab'
import { NavGrid } from './navigation'
import { GAME_CONFIG } from '../core/config'
import { doorLeafTransform, type DoorStatus } from './doors'
import { generateBuildingWalls, generateDoorPlacements, type BuildingDef } from './buildings'
import { GameRuntime } from '../core/runtime'
import { createZombieState } from '../entities/zombie'
import { stepZombie } from '../systems/ai'

beforeAll(async () => { await RAPIER.init() })

describe('dynamic door spike', () => {
  it('revisions change only with topology; destroyed clears both corridor and open leaf; reload agrees', () => {
    const rt = new GameRuntime(DOOR_LAB_MAP)
    const nav = rt.nav
    const initial = nav.version
    rt.setDoorState('lab-door', 'closed')
    expect(nav.version).toBe(initial)
    rt.world.doors.get('lab-door')!.hp = 50
    expect(nav.version).toBe(initial)
    rt.setDoorState('lab-door', 'open')
    expect(nav.isWalkable(-0.7, 2.2)).toBe(false)
    rt.setDoorState('lab-door', 'destroyed')
    expect(nav.version).toBe(initial + 2)
    expect(nav.isWalkable(-0.7, 2.2)).toBe(true)
    expect(nav.isWalkable(0, 3)).toBe(true)
    const save = rt.createSnapshot()
    rt.loadSnapshot(save)
    expect(rt.world.doors.get('lab-door')).toEqual({ id: 'lab-door', hp: 0, state: 'destroyed' })
    expect(nav.findPath({ x: 0, y: 0, z: 6 }, { x: 0, y: 0, z: 0 })).not.toBeNull()
  })

  it('chooses a door on the route, not the nearer unrelated door; prefers an already open alternative', () => {
    const targetRoom = structuredClone(DOOR_LAB_MAP.buildings[0])
    targetRoom.doors.push({ id: 'back-door', name: 'Back', side: 'N', offset: 0, width: 1.4 })
    const unrelated: BuildingDef = { ...structuredClone(targetRoom), id: 'unrelated', center: { x: 5, z: 7 }, size: { w: 4, d: 4 }, doors: [{ id: 'near-door', name: 'Near', side: 'W', offset: 0, width: 1.4 }] }
    const map = { ...DOOR_LAB_MAP, size: 30, buildings: [targetRoom, unrelated], walls: [...generateBuildingWalls(targetRoom), ...generateBuildingWalls(unrelated)], doors: [...generateDoorPlacements(targetRoom), ...generateDoorPlacements(unrelated)] }
    const nav = new NavGrid(map, GAME_CONFIG.nav)
    const from = { x: 1.8, y: 0, z: 7 }
    const to = { x: 0, y: 0, z: 0 }
    const version = nav.version
    const route = nav.findDoorRoute(from, to)!
    expect(route.doorId).toBe('lab-door')
    expect(route.approach.z).toBeGreaterThan(3)
    expect(nav.findPath(from, route.approach)).not.toBeNull()
    expect(nav.findPath(from, to)).toBeNull() // planning cannot mutate walkability
    expect(nav.version).toBe(version)
    nav.setDoorOpen('back-door', true)
    expect(nav.findDoorRoute(from, to)?.doorId).toBeNull()
  })

  it('finds a chain through multiple closed portals, and refuses a room with no portal', () => {
    const first = DOOR_LAB_MAP.buildings[0]
    const second: BuildingDef = { ...structuredClone(first), id: 'second', center: { x: 0, z: -8 }, doors: [{ id: 'second-door', name: 'Second', side: 'S', offset: 0, width: 1.4 }] }
    const map = { ...DOOR_LAB_MAP, size: 30, buildings: [first, second], walls: [...generateBuildingWalls(first), ...generateBuildingWalls(second)], doors: [...generateDoorPlacements(first), ...generateDoorPlacements(second)] }
    const nav = new NavGrid(map, GAME_CONFIG.nav)
    const route = nav.findDoorRoute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -8 })
    expect(route?.doorId).toBe('lab-door')
    const sealed = { ...second, doors: [] }
    const closed = new NavGrid({ ...map, walls: [...generateBuildingWalls(first), ...generateBuildingWalls(sealed)], doors: generateDoorPlacements(first) }, GAME_CONFIG.nav)
    expect(closed.findDoorRoute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -8 })).toBeNull()
  })

  it.each(['closed', 'open', 'destroyed'] as const)('Rapier capsule and AI path obey the %s door', (state: DoorStatus) => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    try {
      world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.5, 10).setTranslation(0, -0.5, 0))
      for (const wall of DOOR_LAB_MAP.walls) {
        world.createCollider(RAPIER.ColliderDesc.cuboid(wall.size[0] / 2, wall.size[1] / 2, wall.size[2] / 2).setTranslation(wall.position.x, wall.position.y, wall.position.z))
      }
      const leaf = doorLeafTransform(DOOR_LAB_MAP.doors[0], state)
      if (leaf) world.createCollider(RAPIER.ColliderDesc.cuboid(...leaf.halfExtents).setTranslation(leaf.center.x, leaf.center.y, leaf.center.z).setRotation({ x: 0, y: Math.sin(leaf.angle / 2), z: 0, w: Math.cos(leaf.angle / 2) }))
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.9, 6).lockRotations().setCanSleep(false))
      world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.3).setFriction(0), body)
      const nav = new NavGrid(DOOR_LAB_MAP, GAME_CONFIG.nav)
      nav.setDoorState('lab-door', state)
      const zombie = createZombieState('test-zombie', { x: 0, y: 0.9, z: 6 })
      zombie.ai = 'CHASE'
      const target = { x: 0, y: 0.9, z: 0 }
      for (let i = 0; i < 240; i++) {
        zombie.position = { ...body.translation() }
        const step = stepZombie(zombie, target, true, 1 / 60, GAME_CONFIG.zombie, {
          canReach: () => true, // exercise pathing; closed case also deliberately pushes into the collider
          findPath: (a, b) => nav.findPath(a, b), hasLineOfWalk: (a, b) => nav.hasLineOfWalk(a, b), getNavVersion: () => nav.version,
        })
        body.setLinvel({ x: step.velocity.x, y: body.linvel().y, z: state === 'closed' ? -2 : step.velocity.z }, true)
        world.step()
      }
      if (state === 'closed') expect(body.translation().z).toBeGreaterThan(3.3)
      else expect(body.translation().z).toBeLessThan(2)
    } finally { world.free() }
  })

  it('a chasing zombie repaths after closing and destroying its door', () => {
    const nav = new NavGrid(DOOR_LAB_MAP, GAME_CONFIG.nav)
    const zombie = createZombieState('z', { x: 0, y: 0.9, z: 6 })
    zombie.ai = 'CHASE'
    const context = { canReach: () => true, findPath: (a: typeof zombie.position, b: typeof a) => nav.findPath(a, b), hasLineOfWalk: (a: typeof zombie.position, b: typeof a) => nav.hasLineOfWalk(a, b), getNavVersion: () => nav.version }
    const step = () => stepZombie(zombie, { x: 1, y: 0.9, z: -1 }, true, 0.1, GAME_CONFIG.zombie, context)
    nav.setDoorState('lab-door', 'open')
    for (let i = 0; i < 8; i++) step()
    nav.setDoorState('lab-door', 'closed')
    for (let i = 0; i < 8; i++) step()
    expect(step().velocity).toEqual({ x: 0, z: 0 })
    nav.setDoorState('lab-door', 'destroyed')
    for (let i = 0; i < 8; i++) step()
    expect(step().velocity.z).toBeLessThan(0)
  })
})
