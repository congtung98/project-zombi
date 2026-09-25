import { describe, expect, it } from 'vitest'
import { PathfindingQueue } from './pathfindingQueue'

const P = (x: number) => ({ x, y: 0, z: 0 })

describe('pathfinding queue (R2)', () => {
  it('keeps one pending request per zombie (a new one replaces the goal)', () => {
    const q = new PathfindingQueue()
    expect(q.request('a', P(1), 'ACTIVE')).toBe(true)
    expect(q.request('a', P(2), 'ACTIVE')).toBe(false)
    expect(q.size).toBe(1)
    const goals: number[] = []
    q.process({ maxPathsPerTick: 10, maxPathMs: Infinity }, (r) => {
      goals.push(r.goal.x)
      return true
    })
    expect(goals).toEqual([2])
    expect(q.stats).toEqual({ requested: 1, deduped: 1, served: 1 })
  })

  it('serves ACTIVE before NEAR before DORMANT, FIFO inside a level, within the count budget', () => {
    const q = new PathfindingQueue()
    q.request('d1', P(0), 'DORMANT')
    q.request('n1', P(0), 'NEAR')
    q.request('a1', P(0), 'ACTIVE')
    q.request('a2', P(0), 'ACTIVE')
    q.request('n2', P(0), 'NEAR')
    const order: string[] = []
    const serve = (r: { id: string }) => {
      order.push(r.id)
      return true
    }
    expect(q.process({ maxPathsPerTick: 3, maxPathMs: Infinity }, serve)).toBe(3)
    expect(order).toEqual(['a1', 'a2', 'n1'])
    expect(q.size).toBe(2)
    q.process({ maxPathsPerTick: 3, maxPathMs: Infinity }, serve)
    expect(order).toEqual(['a1', 'a2', 'n1', 'n2', 'd1'])
  })

  it('always serves at least one request even with no time left, and skips stale ones for free', () => {
    const q = new PathfindingQueue()
    q.request('gone', P(0), 'ACTIVE')
    q.request('a', P(0), 'ACTIVE')
    q.request('b', P(0), 'ACTIVE')
    const served: string[] = []
    q.process({ maxPathsPerTick: 5, maxPathMs: 0 }, (r) => {
      if (r.id === 'gone') return false
      served.push(r.id)
      return true
    })
    expect(served).toEqual(['a'])
    expect(q.size).toBe(1)
    q.cancel('b')
    expect(q.size).toBe(0)
  })
})
