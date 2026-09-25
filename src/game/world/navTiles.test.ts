import { describe, expect, it } from 'vitest'
import { GAME_CONFIG } from '../core/config'
import { createRng } from '../systems/loot'
import type { Vec3 } from '../../types'
import { GridSearch } from './gridSearch'
import { NavGrid } from './navigation'
import { buildStressMap } from './stressMap'

/** Reference: 4-connected labels flooded over the whole grid (the pre-R3b implementation). */
function floodLabels(nav: NavGrid): Int32Array {
  const total = nav.cols * nav.rows
  const labels = new Int32Array(total).fill(-1)
  const queue = new Int32Array(total)
  let next = 0
  for (let seed = 0; seed < total; seed++) {
    const sx = seed % nav.cols
    if (!nav.isWalkableCell(sx, (seed - sx) / nav.cols) || labels[seed] >= 0) continue
    let head = 0
    let tail = 0
    queue[tail++] = seed
    labels[seed] = next
    while (head < tail) {
      const idx = queue[head++]
      const cx = idx % nav.cols
      const cz = (idx - cx) / nav.cols
      for (const [nx, nz] of [[cx - 1, cz], [cx + 1, cz], [cx, cz - 1], [cx, cz + 1]]) {
        if (!nav.isWalkableCell(nx, nz)) continue
        const n = nz * nav.cols + nx
        if (labels[n] >= 0) continue
        labels[n] = next
        queue[tail++] = n
      }
    }
    next += 1
  }
  return labels
}

function randomWalkable(nav: NavGrid, rng: () => number, half: number): Vec3 {
  for (;;) {
    const p = { x: (rng() * 2 - 1) * half, y: 0, z: (rng() * 2 - 1) * half }
    if (nav.isWalkable(p.x, p.z)) return p
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

describe('nav tiles (R3b)', () => {
  const map = buildStressMap(4)
  const nav = new NavGrid(map, GAME_CONFIG.nav)
  const half = map.size / 2

  function expectSameRegions(seed: number) {
    const ref = floodLabels(nav)
    const rng = createRng(seed)
    for (let i = 0; i < 3000; i++) {
      const a = randomWalkable(nav, rng, half)
      const b = i % 3 === 0 ? { x: a.x + (rng() - 0.5) * 16, y: 0, z: a.z + (rng() - 0.5) * 16 } : randomWalkable(nav, rng, half)
      if (!nav.isWalkable(b.x, b.z)) continue
      const ca = nav.worldToCell(a.x, a.z)
      const cb = nav.worldToCell(b.x, b.z)
      const same = ref[ca.cz * nav.cols + ca.cx] === ref[cb.cz * nav.cols + cb.cx]
      expect(nav.componentAt(a.x, a.z) === nav.componentAt(b.x, b.z), `${JSON.stringify(a)} ~ ${JSON.stringify(b)}`).toBe(same)
    }
  }

  it('tiles follow the 32 m chunks: an 8 × 8 tile grid on the 200 m stress map', () => {
    expect([nav.tiles.tilesX, nav.tiles.tilesZ]).toEqual([8, 8])
  })

  it('regions match a whole-grid flood, before and after doors close, open and break', () => {
    expectSameRegions(1)
    const doors = map.doors.map((d) => d.id)
    for (const id of doors) nav.setDoorState(id, 'closed')
    expectSameRegions(2)
    for (const [i, id] of doors.entries()) nav.setDoorState(id, i % 3 === 0 ? 'open' : i % 3 === 1 ? 'destroyed' : 'closed')
    expectSameRegions(3)
    nav.resetDoors()
    expectSameRegions(4)
  })

  it('closing a building\'s doors seals it off; opening one joins it again (only its tiles relabel)', () => {
    const house = map.buildings.find((b) => b.id.endsWith('t2-1-house'))!
    const inside = { x: house.center.x - 2, y: 0, z: house.center.z }
    const outside = { x: house.center.x, y: 0, z: house.center.z - house.size.d / 2 - 3 }
    const doors = map.doors.filter((d) => d.buildingId === house.id).map((d) => d.id)
    for (const id of doors) nav.setDoorState(id, 'closed')
    expect(nav.componentAt(inside.x, inside.z)).not.toBe(nav.componentAt(outside.x, outside.z))
    expect(nav.findPath(outside, inside)).toBeNull()
    nav.setDoorState(doors[0], 'open')
    expect(nav.componentAt(inside.x, inside.z)).toBe(nav.componentAt(outside.x, outside.z))
    expect(nav.findPath(outside, inside)).not.toBeNull()
    nav.resetDoors()
  })

  it('long routes through the tile graph are valid and within 15 % of the optimal A* length', () => {
    const rng = createRng(77)
    const exact = new GridSearch(nav.cols, nav.rows, (nav as unknown as { blocked: Uint8Array }).blocked)
    let checked = 0
    let worst = 1
    const before = nav.tiles.hierarchicalSearches
    while (checked < 40) {
      const a = randomWalkable(nav, rng, half)
      const b = randomWalkable(nav, rng, half)
      if (Math.hypot(a.x - b.x, a.z - b.z) < 90 || nav.routeKind(a, b) !== 'search') continue
      const path = nav.findPath(a, b)
      expect(path, `${JSON.stringify(a)} → ${JSON.stringify(b)}`).not.toBeNull()
      let prev = a
      for (const p of path!) {
        expect(nav.hasLineOfWalk(prev, p)).toBe(true)
        prev = p
      }
      expect(prev).toEqual({ x: b.x, y: 0, z: b.z })
      const ca = nav.worldToCell(a.x, a.z)
      const cb = nav.worldToCell(b.x, b.z)
      const cells = exact.astar(ca.cz * nav.cols + ca.cx, cb.cz * nav.cols + cb.cx, { c0: 0, c1: nav.cols - 1, r0: 0, r1: nav.rows - 1 }, 1e9)!
      const optimal = exact.gScore[cb.cz * nav.cols + cb.cx] * nav.cellSize
      expect(cells).not.toBeNull()
      worst = Math.max(worst, pathLength(a, path!) / Math.max(optimal, 1))
      checked++
    }
    expect(nav.tiles.hierarchicalSearches - before).toBe(40)
    expect(worst).toBeLessThan(1.15)
  })

  it('after door changes, long routes stay valid and do not depend on whether the tile graph was warmed', () => {
    const a = new NavGrid(map, GAME_CONFIG.nav)
    const b = new NavGrid(map, GAME_CONFIG.nav)
    const rng = createRng(31)
    for (const [i, d] of map.doors.entries()) {
      const state = i % 4 === 0 ? 'open' : i % 4 === 1 ? 'destroyed' : 'closed'
      a.setDoorState(d.id, state)
      b.setDoorState(d.id, state)
    }
    b.tiles.warm(Infinity) // a computes its edges lazily during the searches below
    let long = 0
    for (let i = 0; i < 40; i++) {
      const p = randomWalkable(a, rng, half)
      const q = randomWalkable(a, rng, half)
      const pa = a.findPath(p, q)
      expect(pa).toEqual(b.findPath(p, q))
      expect(pa !== null).toBe(a.componentAt(p.x, p.z) === a.componentAt(q.x, q.z))
      if (!pa) continue
      let prev = p
      for (const w of pa) {
        expect(a.hasLineOfWalk(prev, w)).toBe(true)
        prev = w
      }
      if (Math.hypot(p.x - q.x, p.z - q.z) > 70) long++
    }
    expect(long).toBeGreaterThan(5)
  })

  it('a long route costs a few milliseconds at most, far below one whole-map A*', () => {
    const rng = createRng(5)
    const pairs: [Vec3, Vec3][] = []
    while (pairs.length < 30) {
      const a = randomWalkable(nav, rng, half)
      const b = randomWalkable(nav, rng, half)
      if (Math.hypot(a.x - b.x, a.z - b.z) > 120 && nav.routeKind(a, b) === 'search') pairs.push([a, b])
    }
    for (const [a, b] of pairs) nav.findPath(a, b) // warm the lazy tile graphs
    // Best of three per route: the suite runs in parallel workers, one scheduler/GC pause must not fail it.
    let worst = 0
    for (const [a, b] of pairs) {
      let best = Infinity
      for (let k = 0; k < 3; k++) {
        const t = performance.now()
        nav.findPath(a, b)
        best = Math.min(best, performance.now() - t)
      }
      worst = Math.max(worst, best)
    }
    expect(worst).toBeLessThan(8)
  })
})
