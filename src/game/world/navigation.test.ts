import { describe, expect, it } from 'vitest'
import { NavGrid } from './navigation'
import { generateBuildingWalls, generateDoorPlacements, type BuildingDef } from './buildings'
import type { MapData } from './mapData'
import { GAME_CONFIG } from '../core/config'
import type { Vec3 } from '../../types'

const hut: BuildingDef = {
  id: 'hut',
  name: 'Hut',
  center: { x: 0, z: 0 },
  size: { w: 6, d: 6 },
  height: 3,
  wallThickness: 0.3,
  wallColor: '#fff',
  roofColor: '#000',
  floorColor: '#888',
  doors: [{ id: 'door-hut', name: 'Cửa', side: 'S', offset: 0, width: 1.4 }],
  containers: [],
}

function makeMap(): MapData {
  return {
    id: 'test',
    size: 20,
    playerSpawn: { x: 0, y: 0, z: 0 },
    zombieSpawns: [],
    buildings: [hut],
    walls: [
      ...generateBuildingWalls(hut),
      // Bức tường rời dài theo Z ở x = 6, để kiểm tra đi vòng.
      { id: 'wall-free', position: { x: 6, y: 1, z: 0 }, size: [0.3, 2, 8] },
    ],
    doors: generateDoorPlacements(hut),
    containers: [],
    roads: [],
  }
}

function pathLength(from: Vec3, path: Vec3[]): number {
  let len = 0
  let prev = from
  for (const p of path) {
    len += Math.hypot(p.x - prev.x, p.z - prev.z)
    prev = p
  }
  return len
}

/** Mọi đoạn của path phải đi qua ô trống trên lưới (không cắt tường). */
function pathIsWalkable(grid: NavGrid, from: Vec3, path: Vec3[]): boolean {
  let prev = from
  for (const p of path) {
    if (!grid.hasLineOfWalk(prev, p)) return false
    prev = p
  }
  return true
}

describe('NavGrid', () => {
  const grid = () => new NavGrid(makeMap(), GAME_CONFIG.nav)

  it('marks walls (inflated by the agent radius) as blocked and open ground as walkable', () => {
    const g = grid()
    expect(g.isWalkable(-8, -8)).toBe(true)
    expect(g.isWalkable(6, 0)).toBe(false)
    // Sát tường trong bán kính tác nhân cũng bị chặn; xa hơn thì đi được.
    expect(g.isWalkable(6.3, 0)).toBe(false)
    expect(g.isWalkable(7.2, 0)).toBe(true)
    // Trong nhà đi được (sàn không có collider).
    expect(g.isWalkable(0, 0)).toBe(true)
  })

  it('routes around a free-standing wall instead of through it', () => {
    const g = grid()
    const from = { x: 4, y: 0, z: 0 }
    const to = { x: 8, y: 0, z: 0 }
    const path = g.findPath(from, to)
    expect(path).not.toBeNull()
    expect(pathIsWalkable(g, from, path!)).toBe(true)
    // Đường vòng phải dài hơn đường thẳng (4) vì phải qua đầu tường ở z = ±4.
    expect(pathLength(from, path!)).toBeGreaterThan(8)
    expect(path![path!.length - 1]).toEqual(to)
  })

  it('cannot enter the hut while the door is closed, and can once it is open', () => {
    const g = grid()
    const outside = { x: 0, y: 0, z: 6 }
    const inside = { x: 0, y: 0, z: -1 }
    expect(g.findPath(outside, inside)).toBeNull()

    const v = g.version
    g.setDoorOpen('door-hut', true)
    expect(g.version).toBe(v + 1)
    const path = g.findPath(outside, inside)
    expect(path).not.toBeNull()
    expect(pathIsWalkable(g, outside, path!)).toBe(true)
    // Đường phải đi qua ô cửa (x ≈ 0, z ≈ 3).
    const passesDoor = [outside, ...path!].some((p, i, arr) => {
      if (i === 0) return false
      const a = arr[i - 1]
      const t = (3 - a.z) / (p.z - a.z || 1e-9)
      if (t < 0 || t > 1) return false
      const x = a.x + (p.x - a.x) * t
      return Math.abs(x) < 0.8
    })
    expect(passesDoor).toBe(true)

    g.setDoorOpen('door-hut', false)
    expect(g.findPath(outside, inside)).toBeNull()
  })

  it('an open door leaf blocks the cells it swings into', () => {
    const g = grid()
    g.setDoorOpen('door-hut', true)
    // Bản lề ở x = -0.7, z = 3; cánh mở quay vào trong (-Z) → vùng quanh (-0.7, 2.3) bị chặn.
    expect(g.isWalkable(-0.7, 2.2)).toBe(false)
    // Ô cửa vẫn đi được.
    expect(g.isWalkable(0, 3)).toBe(true)
  })

  it('hasLineOfWalk agrees with the grid and straight paths are returned as one waypoint', () => {
    const g = grid()
    expect(g.hasLineOfWalk({ x: -8, y: 0, z: -8 }, { x: -8, y: 0, z: 8 })).toBe(true)
    expect(g.hasLineOfWalk({ x: 4, y: 0, z: 0 }, { x: 8, y: 0, z: 0 })).toBe(false)
    const path = g.findPath({ x: -8, y: 0, z: -8 }, { x: -8, y: 0, z: 8 })
    expect(path).toEqual([{ x: -8, y: 0, z: 8 }])
  })

  it('snaps a start point inside a wall to the nearest walkable cell', () => {
    const g = grid()
    const path = g.findPath({ x: 6, y: 0, z: 0 }, { x: -8, y: 0, z: 0 })
    expect(path).not.toBeNull()
    expect(path!.length).toBeGreaterThan(0)
  })
})
