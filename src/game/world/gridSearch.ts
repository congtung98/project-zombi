/**
 * A* / Dijkstra on a walkability grid, restricted to a rectangle of cells, with working buffers
 * allocated once and reused (R1 stamps: a cell's score/parent are valid only when its `visited`
 * stamp equals the current search). Shared by `NavGrid` (whole-grid A*) and `NavTiles` (searches
 * inside one chunk tile).
 */

export interface CellBounds {
  c0: number
  c1: number
  r0: number
  r1: number
}

export class GridSearch {
  readonly cols: number
  readonly rows: number
  private readonly blocked: Uint8Array
  readonly gScore: Float32Array
  readonly cameFrom: Int32Array
  private readonly visited: Uint32Array
  private readonly closedStamp: Uint32Array
  private stamp = 0
  private readonly heap = new MinHeap()
  /** Searches run (instrumentation). */
  searches = 0

  constructor(cols: number, rows: number, blocked: Uint8Array) {
    this.cols = cols
    this.rows = rows
    this.blocked = blocked
    const total = cols * rows
    this.gScore = new Float32Array(total)
    this.cameFrom = new Int32Array(total)
    this.visited = new Uint32Array(total)
    this.closedStamp = new Uint32Array(total)
  }

  private walkable(cx: number, cz: number, b: CellBounds): boolean {
    return cx >= b.c0 && cz >= b.r0 && cx <= b.c1 && cz <= b.r1 && this.blocked[cz * this.cols + cx] === 0
  }

  /**
   * A* 8 hướng, không cắt góc, within `bounds`; cells of the path from start to goal, or null
   * (unreachable inside the bounds, or more than `maxExpansions` cells expanded).
   */
  astar(startIdx: number, goalIdx: number, bounds: CellBounds, maxExpansions: number): number[] | null {
    const cols = this.cols
    const gx = goalIdx % cols
    const gz = (goalIdx - gx) / cols
    this.searches += 1
    const stamp = this.nextStamp()
    const { gScore, cameFrom, visited } = this
    const closed = this.closedStamp
    const open = this.heap
    open.clear()

    const sx = startIdx % cols
    gScore[startIdx] = 0
    cameFrom[startIdx] = -1
    visited[startIdx] = stamp
    open.push(startIdx, heuristic(sx, (startIdx - sx) / cols, gx, gz))

    let expansions = 0
    while (open.size > 0) {
      const current = open.pop()
      if (current === goalIdx) return this.reconstruct(current)
      if (closed[current] === stamp) continue
      closed[current] = stamp
      if (++expansions > maxExpansions) return null

      const cx = current % cols
      const cz = (current - cx) / cols
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue
          const nx = cx + dx
          const nz = cz + dz
          if (!this.walkable(nx, nz, bounds)) continue
          // Không cắt góc: đi chéo chỉ khi hai ô kề theo trục đều trống.
          if (dx !== 0 && dz !== 0 && (!this.walkable(cx + dx, cz, bounds) || !this.walkable(cx, cz + dz, bounds))) continue
          const nIdx = nz * cols + nx
          if (closed[nIdx] === stamp) continue
          // Same arithmetic as before: a double sum of the stored Float32 score (identical paths).
          const tentative = gScore[current] + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1)
          if (visited[nIdx] !== stamp || tentative < gScore[nIdx]) {
            visited[nIdx] = stamp
            gScore[nIdx] = tentative
            cameFrom[nIdx] = current
            open.push(nIdx, tentative + heuristic(nx, nz, gx, gz))
          }
        }
      }
    }
    return null
  }

  /**
   * Dijkstra from `startIdx` inside `bounds` until every target is settled (or nothing is left);
   * returns the cost to each reached target.
   */
  distances(startIdx: number, targets: readonly number[], bounds: CellBounds): Map<number, number> {
    const cols = this.cols
    this.searches += 1
    const stamp = this.nextStamp()
    const { gScore, visited } = this
    const closed = this.closedStamp
    const open = this.heap
    open.clear()
    const wanted = new Set(targets)
    const out = new Map<number, number>()
    gScore[startIdx] = 0
    visited[startIdx] = stamp
    open.push(startIdx, 0)
    while (open.size > 0 && out.size < wanted.size) {
      const current = open.pop()
      if (closed[current] === stamp) continue
      closed[current] = stamp
      if (wanted.has(current)) out.set(current, gScore[current])
      const cx = current % cols
      const cz = (current - cx) / cols
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue
          const nx = cx + dx
          const nz = cz + dz
          if (!this.walkable(nx, nz, bounds)) continue
          if (dx !== 0 && dz !== 0 && (!this.walkable(cx + dx, cz, bounds) || !this.walkable(cx, cz + dz, bounds))) continue
          const nIdx = nz * cols + nx
          if (closed[nIdx] === stamp) continue
          const tentative = gScore[current] + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1)
          if (visited[nIdx] !== stamp || tentative < gScore[nIdx]) {
            visited[nIdx] = stamp
            gScore[nIdx] = tentative
            open.push(nIdx, tentative)
          }
        }
      }
    }
    return out
  }

  /** New search stamp; on wrap-around (after 4 billion searches) the stamp arrays are reset. */
  private nextStamp(): number {
    this.stamp += 1
    if (this.stamp >= 0xffffffff) {
      this.visited.fill(0)
      this.closedStamp.fill(0)
      this.stamp = 1
    }
    return this.stamp
  }

  private reconstruct(end: number): number[] {
    const out: number[] = []
    let cur = end
    while (cur !== -1) {
      out.push(cur)
      cur = this.cameFrom[cur]
    }
    out.reverse()
    return out
  }
}

/** Octile distance in cells (8-neighbour moves, diagonal √2). */
export function heuristic(ax: number, az: number, bx: number, bz: number): number {
  const dx = Math.abs(ax - bx)
  const dz = Math.abs(az - bz)
  return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)
}

/** Heap nhị phân tối thiểu theo f-score cho A*. */
export class MinHeap {
  private items: number[] = []
  private scores: number[] = []

  get size(): number {
    return this.items.length
  }

  clear(): void {
    this.items.length = 0
    this.scores.length = 0
  }

  push(item: number, score: number): void {
    this.items.push(item)
    this.scores.push(score)
    let i = this.items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.scores[parent] <= this.scores[i]) break
      this.swap(i, parent)
      i = parent
    }
  }

  pop(): number {
    const top = this.items[0]
    const lastItem = this.items.pop()!
    const lastScore = this.scores.pop()!
    if (this.items.length > 0) {
      this.items[0] = lastItem
      this.scores[0] = lastScore
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < this.items.length && this.scores[l] < this.scores[m]) m = l
        if (r < this.items.length && this.scores[r] < this.scores[m]) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return top
  }

  private swap(a: number, b: number): void {
    const ti = this.items[a]
    this.items[a] = this.items[b]
    this.items[b] = ti
    const ts = this.scores[a]
    this.scores[a] = this.scores[b]
    this.scores[b] = ts
  }
}
