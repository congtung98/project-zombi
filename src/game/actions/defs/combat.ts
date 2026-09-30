import { registerAction } from '../registry'
import { ACTION, type ActionDefinition, type ActionJob, type ActionType } from '../types'
import type { ActionWorld } from '../world'
import type { CharacterState } from '../characterState'

/**
 * AX5 (FB §13, docs/character-action-ax0.md §8.5): combat as actions of the `combat` lane. The stance,
 * a swing and a shove are started by the same executor as every other action and carry a context
 * with their target (the zombie right-clicked, or the aim); their timing, hit window, damage and wear
 * stay in the combat code (`systems/combat.ts`, `runtime.stepCombat`), which already runs them
 * frame-rate independent and was balanced by the soak. The state machine reads the result
 * (COMBAT_STANCE, ATTACKING) like any other fact.
 */
export interface SwingData { yaw: number }
export type StanceData = Record<string, never>
export type ShoveData = Record<string, never>

const view = (job: ActionJob) => ({ id: job.id, kind: 'interact' as const, label: job.label, stepProgress: 0, stepRemaining: 0, done: 0, total: 1 })

function combat<Data>(type: ActionType, characterState: CharacterState, start: (w: ActionWorld, job: ActionJob<Data>) => boolean): ActionDefinition<Data> {
  return {
    type,
    lane: 'combat',
    characterState,
    // Combat interrupts other actions; nothing interrupts a swing but the combat code itself.
    interrupt: { move: 'allow', hit: 'allow', attack: 'allow', stance: 'allow' },
    presentation: { anim: 'none' },
    begin: (job, w) => (start(w, job) ? { duration: 0, elapsed: 0 } : null),
    commit: () => ({ next: 'done' }),
    view,
  }
}

/** Entering the stance: remembers its target (a zombie right-clicked), null for the ground. */
export const COMBAT_STANCE = registerAction(combat<StanceData>(ACTION.COMBAT_STANCE, 'COMBAT_STANCE', (w, job) => {
  w.setCombatTarget(job.ctx.target.kind === 'character' ? job.ctx.target.entityId : null)
  return true
}))

/** A swing toward the aim at the click (CS1b): its cost, cooldown and hit are the combat code's. */
export const MELEE_ATTACK = registerAction(combat<SwingData>(ACTION.MELEE_ATTACK, 'ATTACKING', (w, job) => w.startSwing(job.data.yaw)))

/** A shove (Space) toward the cursor. */
export const SHOVE = registerAction(combat<ShoveData>(ACTION.SHOVE, 'ATTACKING', (w) => w.startShove()))
