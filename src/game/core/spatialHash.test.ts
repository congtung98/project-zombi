import { describe, expect, it } from 'vitest'
import { createRng } from '../systems/loot'
import { SpatialHash } from './spatialHash'

interface P {
  id: string
  x: number
  z: number
  hx: number
  hz: number
}

function bruteBox(items: P[], minX: number, minZ: number, maxX: number, maxZ: number): string[] {
  return items.filter((p) => p.x + p.hx >= minX && p.x - p.hx <= maxX && p.z + p.hz >= minZ && p.z - p.hz <= maxZ).map((p) => p.id)
}

function bruteRadius(items: P[], x: number, z: number, r: number): string[] {
  return items.filter((p) => {
    const dx = Math.max(p.x - p.hx - x, 0, x - (p.x + p.hx))
    const dz = Math.max(p.z - p.hz - z, 0, z - (p.z + p.hz))
    return dx * dx + dz * dz <= r * r
  }).map((p) => p.id)
}

describe('SpatialHash (R1)', () => {
  it('matches a brute-force scan, in insertion order, for points and boxes across cells', () => {
    const rng = createRng(42)
    const hash = new SpatialHash<P>(4)
    const items: P[] = []
    for (let i = 0; i < 400; i++) {
      const p = { id: `p${i}`, x: (rng() - 0.5) * 120, z: (rng() - 0.5) * 120, hx: i % 3 === 0 ? rng() * 6 : 0, hz: i % 3 === 0 ? rng() * 6 : 0 }
      items.push(p)
      hash.insert(p.id, p, p.x, p.z, p.hx, p.hz)
    }
    for (let q = 0; q < 200; q++) {
      const x = (rng() - 0.5) * 130
      const z = (rng() - 0.5) * 130
      const r = rng() * 15
      expect(hash.queryAABB(x - r, z - r, x + r, z + r).map((p) => p.id)).toEqual(bruteBox(items, x - r, z - r, x + r, z + r))
      expect(hash.queryRadius(x, z, r).map((p) => p.id)).toEqual(bruteRadius(items, x, z, r))
    }
  })

  it('keeps the insertion order when items move, and drops removed items', () => {
    const hash = new SpatialHash<string>(2)
    hash.insert('a', 'a', 0, 0)
    hash.insert('b', 'b', 10, 10)
    hash.insert('c', 'c', 1, 1)
    hash.update('b', 0.5, 0.5)
    expect(hash.queryRadius(0, 0, 3)).toEqual(['a', 'b', 'c'])
    hash.remove('a')
    expect(hash.queryRadius(0, 0, 3)).toEqual(['b', 'c'])
    expect(hash.has('a')).toBe(false)
    // Re-inserting puts the item last (like removing from and pushing onto a list).
    hash.insert('a', 'a', 0, 0)
    expect(hash.queryRadius(0, 0, 3)).toEqual(['b', 'c', 'a'])
    hash.update('c', 50, 50)
    expect(hash.queryRadius(0, 0, 3)).toEqual(['b', 'a'])
    expect(hash.queryRadius(50, 50, 0)).toEqual(['c'])
    expect(hash.size).toBe(3)
  })

  it('handles negative coordinates and items spanning many cells once', () => {
    const hash = new SpatialHash<string>(1)
    hash.insert('wall', 'wall', -10, -10, 8, 0.2)
    expect(hash.queryAABB(-20, -11, 0, -9)).toEqual(['wall'])
    expect(hash.queryRadius(-3, -10, 1)).toEqual(['wall'])
    expect(hash.queryRadius(-10, -12, 1)).toEqual([])
  })
})
