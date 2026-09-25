import { describe, expect, it } from 'vitest'
import { migrationInterval, nearestZone, planMigration, type HordeMember } from './horde'
import { pickSpawnPoint } from './spawn'
import { createRng } from './loot'
import { GAME_CONFIG } from '../core/config'
import { NEIGHBORHOOD_MAP, type ZoneDef } from '../world/mapData'
import { NavGrid } from '../world/navigation'
import { isInsideBuilding } from '../world/buildings'

const zones: ZoneDef[] = [
  { id: 'a', name: 'A', center: { x: 0, y: 0, z: 0 }, radius: 3 },
  { id: 'b', name: 'B', center: { x: 20, y: 0, z: 0 }, radius: 3 },
  { id: 'c', name: 'C', center: { x: 0, y: 0, z: 20 }, radius: 3 },
]
const member = (id: string, zoneId: string, ai: HordeMember['ai'] = 'IDLE'): HordeMember => ({ id, zoneId, ai })

describe('horde migration director', () => {
  it('moves every living member of a zone with enough calm zombies to a different zone', () => {
    const members = [member('1', 'a'), member('2', 'a', 'WANDER'), member('3', 'a', 'CHASE'), member('4', 'a', 'DEAD'), member('5', 'b')]
    const plan = planMigration(members, zones, createRng(1))!
    expect(plan.from).toBe('a')
    expect(plan.to).not.toBe('a')
    // Hunters come along (they keep hunting for now); the dead do not.
    expect(plan.ids.sort()).toEqual(['1', '2', '3'])
  })

  it('needs minGroupSize idle/wandering members; migrating or hunting ones do not count', () => {
    const min = GAME_CONFIG.horde.minGroupSize
    expect(planMigration([member('1', 'a'), member('2', 'a', 'MIGRATE'), member('3', 'a', 'SEARCH')], zones, createRng(2))).toBeNull()
    expect(planMigration(Array.from({ length: min }, (_, i) => member(String(i), 'b', 'WANDER')), zones, createRng(2))?.from).toBe('b')
    expect(planMigration([member('1', 'a'), member('2', 'a')], zones.slice(0, 1), createRng(2))).toBeNull()
  })

  it('prefers emptier zones and is reproducible from the same RNG seed', () => {
    const members = [member('1', 'a'), member('2', 'a'), ...Array.from({ length: 6 }, (_, i) => member(`b${i}`, 'b', 'CHASE'))]
    const counts = { b: 0, c: 0 }
    for (let seed = 0; seed < 400; seed++) counts[planMigration(members, zones, createRng(seed))!.to as 'b' | 'c'] += 1
    // Weights 1/(1+6) vs 1/(1+0): the empty zone wins about 7 times out of 8.
    expect(counts.c).toBeGreaterThan(counts.b * 4)
    expect(planMigration(members, zones, createRng(99))).toEqual(planMigration(members, zones, createRng(99)))
  })

  it('intervals stay within [intervalMin, intervalMax]; nearestZone picks by centre distance', () => {
    for (let seed = 0; seed < 50; seed++) {
      const t = migrationInterval(createRng(seed))
      expect(t).toBeGreaterThanOrEqual(GAME_CONFIG.horde.intervalMin)
      expect(t).toBeLessThanOrEqual(GAME_CONFIG.horde.intervalMax)
    }
    expect(nearestZone({ x: 18, y: 0, z: 3 }, zones)?.id).toBe('b')
    expect(nearestZone({ x: 0, y: 0, z: 0 }, undefined)).toBeNull()
  })
})

describe('neighbourhood zones and spawn points', () => {
  const nav = new NavGrid(NEIGHBORHOOD_MAP, GAME_CONFIG.nav)
  it('zone centres are outdoors, walkable and all in one connected region', () => {
    const region = nav.componentAt(NEIGHBORHOOD_MAP.playerSpawn.x, NEIGHBORHOOD_MAP.playerSpawn.z)
    const outdoor = nav.componentAt(0, -1)
    expect(region).not.toBe(outdoor) // the player starts inside the closed safehouse
    for (const zone of NEIGHBORHOOD_MAP.zombieZones!) {
      expect(NEIGHBORHOOD_MAP.buildings.some((b) => isInsideBuilding(b, zone.center.x, zone.center.z, zone.radius))).toBe(false)
      expect(nav.isWalkable(zone.center.x, zone.center.z)).toBe(true)
      expect(nav.componentAt(zone.center.x, zone.center.z)).toBe(outdoor)
    }
  })

  it('every hand-placed spawn point is allowed and each belongs to a zone', () => {
    for (const p of NEIGHBORHOOD_MAP.zombieSpawns) {
      expect(nav.isWalkable(p.x, p.z)).toBe(true)
      expect(NEIGHBORHOOD_MAP.buildings.some((b) => isInsideBuilding(b, p.x, p.z, 0.5))).toBe(false)
      expect(nearestZone(p, NEIGHBORHOOD_MAP.zombieZones)).not.toBeNull()
    }
  })

  it('pickSpawnPoint skips points the caller disallows (interiors, new colliders)', () => {
    const points = [{ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }]
    for (let seed = 0; seed < 20; seed++) {
      expect(pickSpawnPoint(points, { playerPos: { x: -30, y: 0, z: 0 }, aliveZombies: [], isAllowed: (p) => p.x !== 0 }, createRng(seed))).toEqual(points[1])
    }
    expect(pickSpawnPoint(points, { playerPos: { x: -30, y: 0, z: 0 }, aliveZombies: [], isAllowed: () => false }, createRng(1))).toBeNull()
  })
})

describe('nav regions and door slots', () => {
  const nav = () => new NavGrid(NEIGHBORHOOD_MAP, GAME_CONFIG.nav)
  it('a closed door separates regions; opening or breaking it joins them and bumps the revision', () => {
    const g = nav()
    const inside = { x: -14, y: 0, z: -14 }
    const outside = { x: -13, y: 0, z: -7 }
    expect(g.componentAt(inside.x, inside.z)).not.toBe(g.componentAt(outside.x, outside.z))
    expect(g.findPath(outside, inside)).toBeNull()
    expect(g.findDoorRoute(outside, inside)?.doorId).toBe('door-safehouse')
    g.setDoorState('door-safehouse', 'destroyed')
    expect(g.componentAt(inside.x, inside.z)).toBe(g.componentAt(outside.x, outside.z))
    expect(g.findDoorRoute(outside, inside)).toMatchObject({ doorId: null, side: -1 })
  })

  it('each door side has two walkable contact slots within reach of the door centre', () => {
    const g = nav()
    // Slots are only used against a closed door (the bedroom door starts open; its leaf is elsewhere then).
    for (const id of g.portals.keys()) g.setDoorState(id, 'closed')
    for (const [id, portal] of g.portals) {
      for (const side of [0, 1] as const) {
        expect(portal.slots[side]).toHaveLength(2)
        for (const slot of portal.slots[side]) {
          expect(g.isWalkable(slot.x, slot.z), `${id}:${side}`).toBe(true)
          expect(Math.hypot(slot.x - portal.center.x, slot.z - portal.center.z)).toBeLessThanOrEqual(GAME_CONFIG.structure.reach)
        }
      }
    }
  })
})
