import { GAME_CONFIG } from '../core/config'
import type { JobView } from '../systems/actionQueue'
import type { ActionCancelReason } from '../systems/timedAction'
import { applyMutation } from './effects'
import { getAction } from './registry'
import type { ActionChain, ActionContext, ActionFailure, ActionJob, ActionType } from './types'
import type { ActionWorld } from './world'

/** Time sums of many small steps drift by float error: a step within this of its end is done (s). */
const STEP_EPSILON = 1e-9

export interface EnqueueOptions {
  /** The request's ID (the first job of a request carries it; a repeat is refused). */
  requestId?: string | null
  /** Shared by the jobs of one request that depend on each other in order. */
  chain?: ActionChain | null
}

export type EnqueueResult =
  | { ok: true; job: ActionJob; state: 'running' | 'queued' | 'not-started' }
  | { ok: false; reason: ActionFailure }

/**
 * AX1 (docs/character-action-ax0.md §1, §5): the one executor. Every request of the `queue` lane goes
 * through here: refused when it repeats a request or the queue is full, queued in order, started when
 * its turn comes (the definition checks again and reserves), advanced by simulation time only (the
 * game's pause stops it), committed once as a single transaction, cleaned up on every path.
 */
export class ActionSystem {
  /** The queue; the first job is the running one. Never saved (a save holds only committed state). */
  jobs: ActionJob[] = []
  private nextId = 1
  /** Request IDs seen lately (a double click that sends the same request twice runs it once). */
  private readonly recent: string[] = []
  private readonly recentSet = new Set<string>()

  private readonly w: ActionWorld
  private readonly cfg: typeof GAME_CONFIG.actions

  constructor(w: ActionWorld, cfg = GAME_CONFIG.actions) {
    this.w = w
    this.cfg = cfg
  }

  get head(): ActionJob | null {
    return this.jobs[0] ?? null
  }

  /** Why a new request would be refused before any feature check, or null. */
  refusal(requestId: string | null | undefined): ActionFailure | null {
    if (requestId && this.recentSet.has(requestId)) return 'DUPLICATE'
    if (this.jobs.length >= this.cfg.queueLimit) return 'QUEUE_FULL'
    return null
  }

  /**
   * Add an accepted request. It starts at once when nothing runs (and leaves again when it cannot
   * start: `not-started`, the definition reported why), else it waits its turn (`action:queued`).
   */
  enqueue<Data>(type: ActionType, ctx: ActionContext, data: Data, label: string, opts: EnqueueOptions = {}): EnqueueResult {
    const requestId = opts.requestId ?? null
    const refused = this.refusal(requestId)
    if (refused) return { ok: false, reason: refused }
    if (requestId) this.remember(requestId)
    const def = getAction<Data>(type)
    const job: ActionJob<Data> = { id: this.nextId++, requestId, type, label, def, ctx, status: 'queued', step: null, data, chain: opts.chain ?? null }
    this.jobs.push(job as ActionJob)
    if (this.jobs[0] !== (job as ActionJob)) {
      this.w.events.queue('action:queued', { id: job.id, label })
      return { ok: true, job: job as ActionJob, state: 'queued' }
    }
    return { ok: true, job: job as ActionJob, state: this.begin(job as ActionJob) ? 'running' : 'not-started' }
  }

  /**
   * Advance by `dt` seconds of simulation. Several steps may finish in one tick: the time left after
   * a step goes to the next, so the pace never depends on the frame rate.
   */
  tick(dt: number): void {
    let budget = Math.max(0, dt)
    for (let guard = 0; guard < 100_000 && this.jobs.length > 0; guard++) {
      const job = this.jobs[0]
      if (!job.step && !this.begin(job)) continue
      const step = job.step!
      const need = step.duration - step.elapsed
      if (budget < need - STEP_EPSILON) {
        step.elapsed += budget
        return
      }
      budget = Math.max(0, budget - need)
      step.elapsed = step.duration
      this.commit(job)
    }
  }

  /**
   * Commit the running job `id` now if its step has run its full time (a stale or early call does
   * nothing). Returns whether a gameplay change was applied.
   */
  complete(id: number): boolean {
    const job = this.jobs[0]
    if (!job || job.id !== id || !job.step || job.step.elapsed < job.step.duration) return false
    return this.commit(job)
  }

  /** Cancel every job (the running step changes nothing; steps already committed stay). */
  cancelAll(reason: ActionCancelReason): boolean {
    const head = this.jobs[0]
    if (!head) return false
    const dropped = this.jobs.length - 1
    const all = this.jobs
    this.jobs = []
    this.w.ledger.clear()
    for (const job of all) job.status = 'cancelled'
    this.w.events.queue('action:cancelled', { id: head.id, label: head.label, reason, dropped })
    head.def.cancelled?.(head, this.w)
    this.w.inventoryChanged()
    return true
  }

  /** Cancel one job: the running one (the next starts on the next tick) or a waiting one. */
  cancel(id: number, reason: ActionCancelReason): boolean {
    const index = this.jobs.findIndex((j) => j.id === id)
    if (index < 0) return false
    const job = this.jobs[index]
    this.leave(job, 'cancelled')
    this.w.ledger.release(job.id)
    this.w.events.queue('action:cancelled', { id: job.id, label: job.label, reason, dropped: 0 })
    job.def.cancelled?.(job, this.w)
    this.w.inventoryChanged()
    return true
  }

  /** New Game, load: no job, no reservation, no remembered request (nothing is announced). */
  clear(): void {
    this.jobs = []
    this.w.ledger.clear()
    this.recent.length = 0
    this.recentSet.clear()
  }

  /** Units of an instance that queued work still counts on. */
  claimed(instanceId: string): number {
    let n = 0
    for (const job of this.jobs) n += job.def.claims?.(job, instanceId) ?? 0
    return n
  }

  view(): JobView | null {
    const head = this.jobs[0]
    return head ? head.def.view(head) : null
  }

  /** Its turn: the definition checks again and reserves; false when it left the queue instead. */
  private begin(job: ActionJob): boolean {
    if (job.chain?.broken) {
      // What it depended on did not happen (nothing taken, nothing opened): it leaves quietly.
      this.leave(job, 'cancelled')
      this.w.inventoryChanged()
      return false
    }
    const step = job.def.begin(job, this.w)
    if (step) {
      job.step = step
      job.status = 'running'
      return true
    }
    this.leave(job, job.status === 'queued' ? 'failed' : 'completed')
    job.def.ended?.(job, this.w)
    return false
  }

  /**
   * The step ran its full time: its reservations are released, the definition checks everything
   * again and describes the change, which is applied as one transaction (all of it or nothing).
   */
  private commit(job: ActionJob): boolean {
    const step = job.step!
    job.status = 'committing'
    job.step = null
    this.w.ledger.release(job.id)
    const outcome = job.def.commit(job, this.w, step)
    let applied = false
    if (outcome.mutation) {
      const result = applyMutation(outcome.mutation, { player: this.w.player, events: this.w.events })
      if (!result.ok) {
        this.leave(job, 'failed')
        this.w.events.queue('action:failed', { id: job.id, label: job.label, reason: result.failure })
        job.def.ended?.(job, this.w)
        this.w.inventoryChanged()
        return false
      }
      applied = true
    }
    if (outcome.next === 'done') this.leave(job, 'completed')
    else job.status = 'running'
    return applied
  }

  /** Out of the queue with its final status; a job that did not do its part breaks its chain. */
  private leave(job: ActionJob, status: 'completed' | 'failed' | 'cancelled'): void {
    const index = this.jobs.indexOf(job)
    if (index >= 0) this.jobs.splice(index, 1)
    job.status = status
    if (job.chain && !(status === 'completed' && (job.def.succeeded?.(job) ?? true))) job.chain.broken = true
  }

  private remember(requestId: string): void {
    this.recent.push(requestId)
    this.recentSet.add(requestId)
    while (this.recent.length > this.cfg.recentRequests) this.recentSet.delete(this.recent.shift()!)
  }
}
