import type { Vec3 } from '../../types'
import type { InventoryKey } from '../systems/inventoryCommands'
import type { JobView } from '../systems/actionQueue'
import type { CharacterState, InterruptPolicy } from './characterState'
import type { ActionWorld } from './world'

/**
 * AX1 (docs/character-action-ax0.md §2): the contract every action shares. Input and the interaction
 * layer only ever build an `ActionContext`; the Action System is the one place that turns it into a
 * gameplay change; animation only reads what runs. Nothing here holds Three.js objects or item copies.
 */

/** Action types are plain strings so a feature registers new ones without touching a central union. */
export type ActionType = string

/** The types the core registers (more come with their sprints: EAT, DRINK, OPEN_CONTAINER, ...). */
export const ACTION = {
  TRANSFER: 'TRANSFER',
  CRAFT: 'CRAFT',
  REPAIR: 'REPAIR',
  EAT: 'EAT',
  DRINK: 'DRINK',
  HEAL: 'HEAL',
  OPEN_ITEM: 'OPEN_ITEM',
} as const

/** What an action works on: IDs only, never a render object or a copy of an item. */
export type TargetRef =
  | { kind: 'item'; instanceId: string; inventory: InventoryKey | null }
  | { kind: 'inventory'; key: InventoryKey }
  | { kind: 'world'; objectId: string; objectType: string; version: number }
  | { kind: 'character'; entityId: string }
  | { kind: 'ground'; point: Vec3 }
  | { kind: 'self' }

export type ActionSource = 'inventory-menu' | 'world-menu' | 'left-click' | 'key-e' | 'double-click' | 'drag' | 'hotkey' | 'combat' | 'system'

/** FB §11: actor, target, item, position, action type. */
export interface ActionContext {
  /** Only the player acts in this phase; kept a string for NPCs later. */
  actorId: 'player'
  type: ActionType
  target: TargetRef
  /** The item used to do it when it is not the target (a bandage applied to `self`). */
  item?: { instanceId: string; inventory: InventoryKey | null }
  /** Cursor hit point or the anchor the actor stands at. */
  position?: Vec3
  source: ActionSource
}

/**
 * Shared refusal codes of the Action System itself (CAS §5.2). Feature reasons that already exist
 * (a transfer's `TransferRefusal`, a recipe's `CraftFailure`) keep their own names in their events.
 */
export type ActionFailure = 'DUPLICATE' | 'QUEUE_FULL' | 'TARGET_CHANGED' | 'MISSING_ITEM' | 'RESERVED'

/** Who runs it: timed and in order, at once inside the tick, or by the combat code's own timing. */
export type ActionLane = 'queue' | 'immediate' | 'combat'

/** Pose groups the animation layer knows; the action names one, never a pose or a clip (FB §7). */
export type AnimGroup = 'none' | 'work' | 'reach' | 'eat' | 'drink' | 'medical'

export interface ActionPresentation {
  anim: AnimGroup
  prop?: { from: 'target-item' | 'item' | 'tool'; hand: 'right' | 'left' }
  /** Put the weapon away while the hands are busy (given back on completion or cancel). */
  hideWeapon?: boolean
}

export type ActionStatus = 'queued' | 'approaching' | 'running' | 'committing' | 'completed' | 'cancelled' | 'failed'

/** The timed part of a job; a feature may extend it (a transfer step knows its instance and units). */
export interface ActionStep {
  duration: number
  elapsed: number
}

/**
 * AX2: jobs queued by one request that depend on each other in order (take it from the container,
 * open it, eat it). When one of them ends without doing its part, the chain is broken and the jobs
 * after it leave the queue without running.
 */
export interface ActionChain {
  broken: boolean
}

/** One accepted request in the queue. `id` is its execution ID: it commits at most once. */
export interface ActionJob<Data = unknown> {
  id: number
  /** The request it came from (null for internal/legacy calls); a repeat is refused as `DUPLICATE`. */
  requestId: string | null
  type: ActionType
  label: string
  def: ActionDefinition<Data>
  ctx: ActionContext
  status: ActionStatus
  step: ActionStep | null
  data: Data
  chain: ActionChain | null
}

/** A step's end: another step follows (a transfer), or the job is done. */
export type CommitNext = 'step' | 'done'

export interface CommitOutcome {
  next: CommitNext
  /** The gameplay change, applied by the Action System as one transaction (nothing when absent). */
  mutation?: import('./effects').Mutation
}

/**
 * What an action is (FB §3): lane, character state, interrupt rules and presentation are data; the
 * hooks decide and describe the change, the Action System runs the lifecycle and applies it.
 */
export interface ActionDefinition<Data = unknown> {
  type: ActionType
  lane: ActionLane
  /** The character's state while it runs (FB §4). */
  characterState: CharacterState
  /** Which interruptions cancel it (FB §3 "interruptible"). */
  interrupt: InterruptPolicy
  presentation: ActionPresentation
  /**
   * Its turn: check again and reserve, returning the next timed step, or null when nothing (more)
   * can run — the job then leaves the queue through `ended('exhausted')`. Reports its own refusal.
   */
  begin(job: ActionJob<Data>, w: ActionWorld): ActionStep | null
  /**
   * The step ran its full time (its reservations are already released): check everything again and
   * describe the change. Returning no mutation changes nothing (a failure it reported itself).
   */
  commit(job: ActionJob<Data>, w: ActionWorld, step: ActionStep): CommitOutcome
  /** Left the queue without a cancel: nothing more to do, or it could not start. */
  ended?(job: ActionJob<Data>, w: ActionWorld): void
  /** Cancelled (reservations already released, `action:cancelled` already queued). */
  cancelled?(job: ActionJob<Data>, w: ActionWorld): void
  /** Whether it did its part (a chain goes on only then); default: it completed. */
  succeeded?(job: ActionJob<Data>): boolean
  /** Units of an instance this job still counts on (so later requests never count on them too). */
  claims?(job: ActionJob<Data>, instanceId: string): number
  /** Progress for the HUD and the inventory window. */
  view(job: ActionJob<Data>): JobView
}
