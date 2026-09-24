import type { ItemId } from '../entities/items'
import type { Recipe } from '../entities/recipes'
import type { RecipeCheck } from './crafting'
import { countItem, type Inventory } from './inventory'

/**
 * Items promised to the running action: counts per stackable type plus individual instances
 * (repair target, tools). They stay in the bag and are only consumed at commit, but cannot be
 * dropped or stored meanwhile, so the same materials can never pay for two things.
 */
export interface Reservation {
  counts: Partial<Record<ItemId, number>>
  instanceIds: string[]
}

/** Runtime-only (never saved): a save during an action holds the state before it. */
export interface TimedAction {
  /** Unique per runtime; a completion for a stale id is ignored. */
  id: number
  recipe: Recipe
  targetId: string | null
  /** World object the action works on (door for S6 barricades); a zombie hit on it cancels. */
  worldTargetId: string | null
  /** Tool instances chosen at start, in recipe order. */
  toolIds: string[]
  label: string
  /** Seconds of simulation time. */
  duration: number
  elapsed: number
  reservation: Reservation
}

export type ActionCancelReason = 'moved' | 'attacked' | 'hit' | 'cancelled' | 'dead' | 'target-damaged'

export function reservationFor(recipe: Recipe, targetId: string | null, check: RecipeCheck): Reservation {
  const counts: Partial<Record<ItemId, number>> = {}
  for (const input of recipe.inputs) counts[input.itemId] = (counts[input.itemId] ?? 0) + input.quantity
  const instanceIds = check.tools.flatMap((t) => (t.instanceId ? [t.instanceId] : []))
  if (targetId) instanceIds.push(targetId)
  return { counts, instanceIds }
}

/** True if taking `quantity` out of `slot` would touch a reserved instance or dip below a reserved count. */
export function reservationBlocks(inv: Inventory, reservation: Reservation | null, slot: number, quantity: number): boolean {
  const item = inv.slots[slot]
  if (!reservation || !item) return false
  if (reservation.instanceIds.includes(item.id)) return true
  const reserved = reservation.counts[item.itemId] ?? 0
  return reserved > 0 && countItem(inv, item.itemId) - Math.min(quantity, item.quantity) < reserved
}

/** Advance by simulation time; true once the action reached its duration. */
export function advanceAction(action: TimedAction, dt: number): boolean {
  action.elapsed = Math.min(action.duration, action.elapsed + Math.max(0, dt))
  return action.elapsed >= action.duration
}
