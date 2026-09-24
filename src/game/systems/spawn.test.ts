import { describe, expect, it } from 'vitest'
import { pickSpawnPoint, spawnInterval } from './spawn'
import { createRng } from './loot'
import { GAME_CONFIG } from '../core/config'

const cfg = { ...GAME_CONFIG.spawn, minDistance: 10, minZombieGap: 2 }
const points = [
  { x: 0, y: 0, z: 0 },
  { x: 15, y: 0, z: 0 },
  { x: 0, y: 0, z: 15 },
  { x: -20, y: 0, z: 0 },
]

describe('pickSpawnPoint', () => {
  it('never picks a point closer than minDistance to the player', () => {
    const rng = createRng(1)
    for (let i = 0; i < 50; i++) {
      const p = pickSpawnPoint(points, { playerPos: { x: 0, y: 0, z: 0 }, aliveZombies: [] }, rng, cfg)
      expect(p).not.toBeNull()
      expect(Math.hypot(p!.x, p!.z)).toBeGreaterThanOrEqual(10)
    }
  })

  it('skips points occupied by a living zombie and returns null when nothing is valid', () => {
    const rng = createRng(2)
    const occupied = [
      { x: 15, y: 0, z: 0.5 },
      { x: 0, y: 0, z: 15 },
      { x: -20, y: 0, z: 0 },
    ]
    expect(pickSpawnPoint(points, { playerPos: { x: 0, y: 0, z: 0 }, aliveZombies: occupied }, rng, cfg)).toBeNull()
    expect(pickSpawnPoint(points, { playerPos: { x: 0, y: 0, z: 0 }, aliveZombies: occupied.slice(1) }, rng, cfg)).toEqual(points[1])
  })

  it('prefers points hidden from the player when any exist', () => {
    const rng = createRng(3)
    for (let i = 0; i < 20; i++) {
      const p = pickSpawnPoint(
        points,
        { playerPos: { x: 0, y: 0, z: 0 }, aliveZombies: [], isHiddenFromPlayer: (pt) => pt.x === -20 },
        rng,
        cfg,
      )
      expect(p).toEqual(points[3])
    }
  })

  it('is deterministic for the same rng seed', () => {
    const a = pickSpawnPoint(points, { playerPos: { x: 0, y: 0, z: 0 }, aliveZombies: [] }, createRng(77), cfg)
    const b = pickSpawnPoint(points, { playerPos: { x: 0, y: 0, z: 0 }, aliveZombies: [] }, createRng(77), cfg)
    expect(a).toEqual(b)
  })

  it('night interval is shorter than day interval', () => {
    expect(spawnInterval(true)).toBeLessThan(spawnInterval(false))
  })
})
