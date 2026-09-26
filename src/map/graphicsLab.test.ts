import { describe, expect, it } from 'vitest'
import { bundledWorldCatalog, loadBundledWorld } from './content'
import { GameRuntime } from '../game/core/runtime'
import { collectStaticItems } from '../game/rendering/staticBatchData'

/**
 * G0: the graphics lab (`content/maps/graphics-lab`, live, not frozen: later graphics sprints add
 * visual fields to it). It is the fixed comparison scene of the graphics plan, so it must keep what
 * the plan asks for: a model house with a living room, a kitchen and a bedroom plus an upper storey,
 * a second copy of the same prefab (turned) to catch cross-talk, a street with sidewalks, a yard with
 * a fence, trees and a car. The points below are the scene positions of scripts/g0-graphics-baseline.mjs.
 */

const A = 'c0_0/house-a'
const B = 'c0_0/house-b'
const loaded = () => loadBundledWorld('graphics-lab')

describe('graphics lab world', () => {
  it('is hidden from the menu and loads', () => {
    expect(bundledWorldCatalog().find((w) => w.worldId === 'graphics-lab')?.listed).toBe(false)
    const { map, docs } = loaded()
    expect(map.id).toBe('graphics-lab')
    const instances = [...docs.chunks.values()].flatMap((c) => c.instances)
    expect(instances.map((i) => [i.instanceId, i.prefabId, i.quarterTurns])).toEqual([
      [A, 'building/lab-house', 0],
      [B, 'building/lab-house', 2],
    ])
  })

  it('has the rooms, storeys and outdoor pieces the comparison scene needs', () => {
    const { map } = loaded()
    for (const id of [A, B]) {
      const rooms = (map.rooms ?? []).filter((r) => r.id.startsWith(`${id}/`))
      expect(rooms.map((r) => [r.name, r.floorY ?? 0]).sort()).toEqual(
        [
          ['Bếp', 0],
          ['Hành lang tầng trên', 3],
          ['Phòng khách', 0],
          ['Phòng ngủ', 0],
          ['Phòng ngủ tầng trên', 3],
        ].sort(),
      )
      expect(map.buildings.find((b) => b.id === id)?.storeys).toBe(2)
      expect((map.stairs ?? []).filter((s) => s.buildingId === id)).toHaveLength(1)
    }
    expect(map.roads.map((r) => r.id).sort()).toEqual(['c0_0/roads/path-a', 'c0_0/roads/path-b', 'c0_0/roads/sidewalk-n', 'c0_0/roads/sidewalk-s', 'c0_0/roads/street'])
    expect(map.trees?.length).toBeGreaterThanOrEqual(3)
    expect(map.walls.some((w) => w.id === 'c0_0/objects/car')).toBe(true)
    expect(map.walls.filter((w) => w.id.startsWith('c0_0/objects/fence-')).length).toBeGreaterThanOrEqual(4)
  })

  it('both copies draw the same pieces (one prefab, shared looks)', () => {
    const rt = new GameRuntime({ ...loaded().map, zombieSpawns: [] })
    const items = collectStaticItems(rt.map, rt.staticColliders)
    const of = (id: string) => items.filter((i) => i.buildingId === id)
    expect(of(A).length).toBeGreaterThan(50)
    expect(of(B).length).toBe(of(A).length)
    const colours = (id: string) => of(id).map((i) => i.color).sort()
    expect(colours(B)).toEqual(colours(A))
  })

  it('the baseline script scenes stand where they should', () => {
    const rt = new GameRuntime({ ...loaded().map, zombieSpawns: [] })
    // Outside on the north sidewalk, in A's living room, upstairs in A's bedroom.
    expect(rt.buildingAt({ x: 15, z: 20.3 })).toBeNull()
    expect(rt.buildingAt({ x: 13, z: 13.5 })).toBe(A)
    expect(rt.buildingAt({ x: 15, z: 13.5 })).toBe(A)
    const room = (x: number, z: number, floorY: number) => (rt.map.rooms ?? []).find((r) => (r.floorY ?? 0) === floorY && x > r.bounds.minX && x < r.bounds.maxX && z > r.bounds.minZ && z < r.bounds.maxZ)?.name
    expect(room(13, 13.5, 0)).toBe('Phòng khách')
    expect(room(15, 13.5, 3)).toBe('Phòng ngủ tầng trên')
    // The frozen zombies of the script stand on open ground (no collider under them).
    const zombies = [[20, 23.5], [26, 25], [30, 22.5], [9, 25.5], [18, 6.2], [20.3, 9.2], [41, 36], [36, 28]]
    for (const [x, z] of zombies) {
      const blocked = rt.map.walls.find((w) => Math.abs(x - w.position.x) < w.size[0] / 2 + 0.3 && Math.abs(z - w.position.z) < w.size[2] / 2 + 0.3)
      expect(blocked?.id, `zombie at ${x}, ${z}`).toBeUndefined()
    }
  })
})
