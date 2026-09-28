import type { Recipe } from '../entities/recipes'
import type { InputUse } from './crafting'

/**
 * A running craft or repair (INV-LOOT S4: a recipe job of the action queue once it started).
 * Runtime-only (never saved): a save during an action holds the state before it. Its inputs, tools and
 * target are held in the runtime's reservation ledger under `id` while it runs.
 */
export interface TimedAction {
  /** Unique per runtime; a completion for a stale id is ignored. */
  id: number
  recipe: Recipe
  targetId: string | null
  /** World object the action works on (door for S6 barricades); a zombie hit on it cancels. */
  worldTargetId: string | null
  /** Tool instances chosen at start, in recipe order. */
  toolIds: string[]
  /** The concrete inputs chosen at start (main inventory first, then the worn bag). */
  plan: InputUse[]
  label: string
  /** Seconds of simulation time. */
  duration: number
  elapsed: number
}

export type ActionCancelReason = 'moved' | 'attacked' | 'hit' | 'cancelled' | 'dead' | 'target-damaged' | 'unreachable'
