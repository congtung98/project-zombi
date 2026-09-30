/**
 * AX1 (docs/character-action-ax0.md §3, FB §4): the character's state machine. Pure data and
 * functions: the runtime reports what is true this tick (facts) and asks whether an interruption stops
 * the running action; it never keeps a second copy of gameplay state.
 */

export const CHARACTER_STATES = [
  'IDLE', 'MOVING', 'APPROACHING', 'COMBAT_STANCE', 'ATTACKING', 'INTERACTING', 'LOOTING',
  'EATING', 'DRINKING', 'HEALING', 'CRAFTING', 'REPAIRING', 'BUILDING', 'DEAD',
] as const
export type CharacterState = (typeof CHARACTER_STATES)[number]

/** States of a running action of the `queue` lane (the character is busy with its hands). */
export const ACTION_STATES: readonly CharacterState[] = ['INTERACTING', 'LOOTING', 'EATING', 'DRINKING', 'HEALING', 'CRAFTING', 'REPAIRING', 'BUILDING']

/** What can interrupt a running action. */
export type InterruptKind = 'move' | 'hit' | 'attack' | 'stance'

/** Per action (FB §3 "interruptible"): `cancel` stops it and the whole queue, `allow` lets it run on. */
export interface InterruptPolicy {
  /** The player walks (WASD). */
  move: 'cancel' | 'allow'
  /** A blow lands (slow starvation damage never interrupts). */
  hit: 'cancel' | 'allow'
  /** The player swings or shoves. */
  attack: 'cancel' | 'allow'
  /** The combat stance starts. */
  stance: 'cancel' | 'allow'
}

/** The default of item and world actions: anything the player does or suffers stops it. */
export const INTERRUPT_ALL: InterruptPolicy = { move: 'cancel', hit: 'cancel', attack: 'cancel', stance: 'cancel' }

/** What is true for the character this tick (read from the simulation, never stored twice). */
export interface CharacterFacts {
  alive: boolean
  /** Walking or running this tick. */
  moving: boolean
  /** Walking on its own to an action's anchor (AX6). */
  approaching: boolean
  /** The combat stance is asked for. */
  stance: boolean
  /** A swing or a shove is in progress. */
  swinging: boolean
  /** State of the running action, or null when the queue is idle. */
  action: CharacterState | null
}

/**
 * The state these facts mean. Order is the priority when several hold: death, then a swing (the
 * body is committed to it), then the running action, then walking to it, then the stance, then
 * plain movement. An action may run in the stance when its policy allows it (a transfer, INV-LOOT S5).
 */
export function deriveState(f: CharacterFacts): CharacterState {
  if (!f.alive) return 'DEAD'
  if (f.swinging) return 'ATTACKING'
  if (f.action) return f.action
  if (f.approaching) return 'APPROACHING'
  if (f.stance) return 'COMBAT_STANCE'
  return f.moving ? 'MOVING' : 'IDLE'
}

const FREE: readonly CharacterState[] = ['IDLE', 'MOVING', 'COMBAT_STANCE']

/**
 * Allowed transitions (FB §4 "Allowed Transitions"). From an action state the next job of the queue
 * may start at once, so action → action is allowed. Death leaves only through a reset (New Game or
 * load) to IDLE. A change the table does not allow is a bug the tests look for (`violations`).
 */
export const TRANSITIONS: Readonly<Record<CharacterState, readonly CharacterState[]>> = (() => {
  const busy = [...ACTION_STATES]
  const all: CharacterState[] = [...CHARACTER_STATES]
  const t: Record<CharacterState, readonly CharacterState[]> = {} as Record<CharacterState, readonly CharacterState[]>
  for (const s of CHARACTER_STATES) t[s] = all.filter((x) => x !== s)
  // An action ends by completing (the next job starts, or walks to its anchor), a cancel (moving,
  // a hit, a swing) or death.
  for (const s of busy) t[s] = [...FREE, 'ATTACKING', 'DEAD', ...busy.filter((x) => x !== s), 'APPROACHING']
  t.APPROACHING = [...FREE, 'ATTACKING', 'DEAD', ...busy]
  t.DEAD = ['IDLE']
  return t
})()

export function canTransition(from: CharacterState, to: CharacterState): boolean {
  return from === to || TRANSITIONS[from].includes(to)
}

/** Whether `kind` stops an action with this policy (FB §4 "Interrupt Conditions"). */
export function interrupts(kind: InterruptKind, policy: InterruptPolicy): boolean {
  return policy[kind] === 'cancel'
}

/**
 * The character's current state, updated once per tick from the facts. It follows the facts even
 * through a transition the table does not allow (the simulation is the truth), and records it.
 */
export class CharacterStateMachine {
  state: CharacterState = 'IDLE'
  /** Transitions the table does not allow, as they happened (dev/test diagnostics; capped). */
  readonly violations: { from: CharacterState; to: CharacterState }[] = []

  update(facts: CharacterFacts): { from: CharacterState; to: CharacterState } | null {
    const to = deriveState(facts)
    const from = this.state
    if (to === from) return null
    if (!canTransition(from, to) && this.violations.length < 32) this.violations.push({ from, to })
    this.state = to
    return { from, to }
  }

  /** New Game, load: back to IDLE whatever it was (a dead character included). */
  reset(): void {
    this.state = 'IDLE'
  }
}
