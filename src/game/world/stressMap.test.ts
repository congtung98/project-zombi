import { describe, expect, it } from 'vitest'
import { GAME_CONFIG } from '../core/config'
import { GameRuntime } from '../core/runtime'
import { isInsideBuilding } from './buildings'
import { NEIGHBORHOOD_MAP, mapRooms, mapWindows } from './mapData'
import { NavGrid } from './navigation'
import { buildStressMap } from './stressMap'

describe('dev stress map (R0)', () => {
  const map = buildStressMap(4)

  it('tiles the neighbourhood 4 × 4: 48 buildings, 160 zombie spawns, one outer boundary', () => {
    expect(map.size).toBe(NEIGHBORHOOD_MAP.size * 4)
    expect(map.buildings).toHaveLength(NEIGHBORHOOD_MAP.buildings.length * 16)
    expect(map.zombieSpawns).toHaveLength(160)
    expect(map.maxActiveZombies).toBe(160)
    expect(map.walls.filter((w) => w.id.startsWith('world/boundary-'))).toHaveLength(4)
    expect(mapRooms(map)).toHaveLength(mapRooms(NEIGHBORHOOD_MAP).length * 16)
    expect(mapWindows(map)).toHaveLength(mapWindows(NEIGHBORHOOD_MAP).length * 16)
  })

  it('gives every wall, door, container, window, room and zone a unique ID', () => {
    const ids = [
      ...map.walls.map((w) => w.id),
      ...map.doors.map((d) => d.id),
      ...map.containers.map((c) => c.id),
      ...mapWindows(map).map((w) => w.id),
      ...mapRooms(map).map((r) => r.id),
      ...mapRooms(map).flatMap((r) => (r.lamp ? [r.lamp.id] : [])),
      ...(map.zombieZones ?? []).map((z) => z.id),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('places every zombie spawn outdoors on a walkable cell, all in one connected region', () => {
    const nav = new NavGrid(map, GAME_CONFIG.nav)
    const region = nav.componentAt(map.zombieSpawns[0].x, map.zombieSpawns[0].z)
    for (const p of map.zombieSpawns) {
      expect(nav.isWalkable(p.x, p.z)).toBe(true)
      expect(map.buildings.some((b) => isInsideBuilding(b, p.x, p.z, 0.5))).toBe(false)
      expect(nav.componentAt(p.x, p.z)).toBe(region)
    }
  })

  it('starts a runnable game with 160 zombies and loot in every container', () => {
    const rt = new GameRuntime(map)
    rt.newGame(7)
    expect(rt.zombies.size).toBe(160)
    expect(rt.world.containers.size).toBe(map.containers.length)
    for (let i = 0; i < 30; i++) rt.tick(1 / 30)
    expect(rt.player.alive).toBe(true)
  })

  it('the single-tile map keeps the original layout', () => {
    const one = buildStressMap(1)
    expect(one.walls.map((w) => w.position)).toEqual(NEIGHBORHOOD_MAP.walls.map((w) => w.position))
    expect(one.doors.map((d) => d.center)).toEqual(NEIGHBORHOOD_MAP.doors.map((d) => d.center))
  })
})
