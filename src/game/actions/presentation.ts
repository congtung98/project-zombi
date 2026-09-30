import type { ItemId } from '../entities/items'
import type { ActionJob, AnimGroup } from './types'

/**
 * AX3 (FB §7, docs/character-action-ax0.md §7): what the running action shows, as plain data for the
 * animation layer. The action only names a pose group and a prop; which pose, clip or model shows it
 * is the view's business (a procedural pose today, an AnimationMixer later). Time comes from the
 * simulation clock (the job's step): a missing pose or prop never changes when the action completes.
 */
export interface ActionPresentationView {
  group: Exclude<AnimGroup, 'none'>
  /** Seconds into the running step. */
  elapsed: number
  /** 0..1 of the running step. */
  progress: number
  /** The item in a hand while it runs (null: nothing held). */
  prop: { itemId: ItemId; hand: 'right' | 'left' } | null
  /** Put the weapon away meanwhile (it stays equipped). */
  hideWeapon: boolean
}

/** The presentation of a job while its step runs, or null (waiting, committing, nothing to show). */
export function presentationOf(job: ActionJob | null): ActionPresentationView | null {
  if (!job || job.status !== 'running' || !job.step) return null
  const p = job.def.presentation
  if (p.anim === 'none') return null
  const step = job.step
  const itemId = p.prop ? job.def.propItem?.(job) ?? null : null
  return {
    group: p.anim,
    elapsed: step.elapsed,
    progress: step.duration > 0 ? Math.min(1, step.elapsed / step.duration) : 1,
    prop: p.prop && itemId ? { itemId, hand: p.prop.hand } : null,
    hideWeapon: p.hideWeapon === true,
  }
}
