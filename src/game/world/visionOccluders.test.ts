import { describe, expect, it } from 'vitest'
import { createRng } from '../systems/loot'
import { buildVisionOccluders, segmentBoxEntry, type VisionOccluder } from './visionOccluders'
import { buildStressMap } from './stressMap'
import type { Vec3 } from '../../types'

/** The pre-R1 full scan, kept as the reference. */
function bruteFirst(items: readonly VisionOccluder[], from: Vec3, to: Vec3): VisionOccluder | null {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
  for (const o of items) {
    if (o.max.x < Math.min(from.x, to.x) || o.min.x > Math.max(from.x, to.x)) continue
    if (o.max.y < Math.min(from.y, to.y) || o.min.y > Math.max(from.y, to.y)) continue
    if (o.max.z < Math.min(from.z, to.z) || o.min.z > Math.max(from.z, to.z)) continue
    if (o.isBlocking && !o.isBlocking()) continue
    if (segmentBoxEntry(from, d, o.min, o.max) <= 1) return o
  }
  return null
}

function bruteClear(items: readonly VisionOccluder[], from: Vec3, to: Vec3): number {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
  let best = 1
  for (const o of items) {
    if (o.isBlocking && !o.isBlocking()) continue
    best = Math.min(best, segmentBoxEntry(from, d, o.min, o.max))
  }
  return best
}

describe('vision occluder index (R1)', () => {
  it('returns the same first blocker and clear fraction as a full scan, and tests far fewer boxes', () => {
    const map = buildStressMap(4)
    const doors = new Map(map.doors.map((d, i) => [d.id, i % 3 === 0 ? ('open' as const) : ('closed' as const)]))
    const set = buildVisionOccluders(map, (id) => doors.get(id), 1.5, (id) => id.endsWith('-n'))
    const rng = createRng(11)
    let rays = 0
    for (let i = 0; i < 2000; i++) {
      const from = { x: (rng() - 0.5) * 190, y: 1.6, z: (rng() - 0.5) * 190 }
      const a = rng() * Math.PI * 2
      const len = rng() * 20
      const to = { x: from.x + Math.cos(a) * len, y: 1.2, z: from.z + Math.sin(a) * len }
      expect(set.firstBlocker(from, to)?.id ?? null).toBe(bruteFirst(set.all, from, to)?.id ?? null)
      expect(set.clearFraction(from, to)).toBe(bruteClear(set.all, from, to))
      rays += 1
    }
    // The index only narrows the candidates: box tests per ray stay far below the occluder count.
    expect(set.testCount / rays).toBeLessThan(10)
    expect(set.all.length).toBeGreaterThan(800)
  })

  it('add / remove keep the index in sync (dynamic occluders such as barricades)', () => {
    const map = buildStressMap(1)
    const set = buildVisionOccluders(map, () => 'closed', 1.5)
    const from = { x: 0, y: 1.6, z: 30 }
    const to = { x: 0, y: 1.2, z: 34 }
    expect(set.firstBlocker(from, to)).toBeNull()
    set.add({ id: 'test-board', kind: 'wall', min: { x: -1, y: 0, z: 31 }, max: { x: 1, y: 3, z: 31.2 } })
    expect(set.firstBlocker(from, to)?.id).toBe('test-board')
    expect(set.clearFraction(from, to)).toBeCloseTo(0.25, 5)
    set.remove('test-board')
    expect(set.firstBlocker(from, to)).toBeNull()
  })
})
