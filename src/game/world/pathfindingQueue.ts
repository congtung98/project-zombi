import type { Vec3 } from '../../types'
import type { SimLevel } from '../entities/zombie'

/**
 * R2 pathfinding queue: zombies do not run A* inside their AI update. The AI files a request (one per
 * zombie: a new request replaces the pending one), the runtime processes the queue after the AI pass
 * within a time and count budget, and the result is written back to the zombie for its next update.
 * Priority: ACTIVE before NEAR before DORMANT, then first come first served.
 */

export interface PathRequest {
  id: string
  goal: Vec3
  level: SimLevel
  /** Arrival order (FIFO within a level). */
  seq: number
}

const LEVEL_RANK: Record<SimLevel, number> = { ACTIVE: 0, NEAR: 1, DORMANT: 2 }

export interface PathBudget {
  maxPathsPerTick: number
  maxPathMs: number
}

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? () => performance.now() : () => Date.now()

export class PathfindingQueue {
  private readonly pending = new Map<string, PathRequest>()
  private seq = 0
  /** Requests accepted / deduplicated (replaced a pending one) / served, since the last `resetStats`. */
  readonly stats = { requested: 0, deduped: 0, served: 0 }

  get size(): number {
    return this.pending.size
  }

  has(id: string): boolean {
    return this.pending.has(id)
  }

  /** File (or refresh) the request of one zombie; returns false when it replaced a pending one. */
  request(id: string, goal: Vec3, level: SimLevel): boolean {
    const existing = this.pending.get(id)
    if (existing) {
      existing.goal = { ...goal }
      existing.level = level
      this.stats.deduped += 1
      return false
    }
    this.pending.set(id, { id, goal: { ...goal }, level, seq: this.seq++ })
    this.stats.requested += 1
    return true
  }

  cancel(id: string): void {
    this.pending.delete(id)
  }

  clear(): void {
    this.pending.clear()
  }

  /**
   * Serve requests in priority order until the count or time budget is spent (at least one per call
   * when any is pending). `serve` computes and applies the path; it returns false for a stale
   * request (zombie gone) that cost nothing.
   */
  process(budget: PathBudget, serve: (req: PathRequest) => boolean): number {
    if (this.pending.size === 0) return 0
    const order = Array.from(this.pending.values()).sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.seq - b.seq)
    const start = now()
    let served = 0
    for (const req of order) {
      if (served >= budget.maxPathsPerTick) break
      if (served > 0 && Number.isFinite(budget.maxPathMs) && now() - start >= budget.maxPathMs) break
      this.pending.delete(req.id)
      if (serve(req)) served += 1
    }
    this.stats.served += served
    return served
  }

  resetStats(): void {
    this.stats.requested = 0
    this.stats.deduped = 0
    this.stats.served = 0
  }
}
