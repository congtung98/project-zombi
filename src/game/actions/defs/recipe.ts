import { getItemDef } from '../../entities/items'
import type { Recipe } from '../../entities/recipes'
import { checkRecipe, prepareRecipe, type InputUse } from '../../systems/crafting'
import { reconcileEquipment } from '../../systems/equipment'
import type { TimedAction } from '../../systems/timedAction'
import { INTERRUPT_ALL, type CharacterState } from '../characterState'
import { eventEffect, inventorySignature, type GameplayEffect } from '../effects'
import { registerAction } from '../registry'
import { ACTION, type ActionDefinition, type ActionJob, type ActionType } from '../types'

/**
 * CRAFT and REPAIR (plan §7, INV-LOOT Q3; AX1 moved them from the runtime into definitions, rules
 * unchanged): accepted only when what is carried and free covers them, checked again and reserved
 * when their turn comes, committed as one transaction prepared on copies of the inventories.
 */
export interface RecipeData {
  recipe: Recipe
  targetId: string | null
  /** Set when the job starts (validated and reserved); null while it waits. It is the job's step. */
  action: TimedAction | null
  /**
   * Inputs this waiting recipe counts on (its plan when queued): later queued actions cannot count on
   * them too. Checked and planned again when it starts.
   */
  claims: InputUse[]
}

export type RecipeJob = ActionJob<RecipeData>

/** The running craft/repair of a job, or null (another action, or still waiting). */
export function recipeAction(job: ActionJob | null | undefined): TimedAction | null {
  return job && (job.type === ACTION.CRAFT || job.type === ACTION.REPAIR) ? (job as RecipeJob).data.action : null
}

/** The recipe of a job (waiting or running), or null. */
export function recipeData(job: ActionJob): RecipeData | null {
  return job.type === ACTION.CRAFT || job.type === ACTION.REPAIR ? (job as RecipeJob).data : null
}

export function recipeActionType(recipe: Recipe): ActionType {
  return recipe.kind === 'craft' ? ACTION.CRAFT : ACTION.REPAIR
}

function recipeDefinition(type: ActionType, characterState: CharacterState): ActionDefinition<RecipeData> {
  return {
    type,
    lane: 'queue',
    characterState,
    // As before AX1: the stance does not stop work, a swing, a shove, a blow or walking does.
    interrupt: { ...INTERRUPT_ALL, stance: 'allow' },
    presentation: { anim: 'work' },

    /** Its turn: check again and reserve its inputs, tools and target, else fail with the reason. */
    begin(job, w) {
      const d = job.data
      const check = checkRecipe(w.craftSources(job.id), d.recipe, d.targetId)
      if (!check.ok) {
        w.events.queue('action:failed', { id: job.id, label: job.label, reason: check.failure! })
        w.inventoryChanged()
        return null
      }
      const toolIds = check.tools.map((t) => t.instanceId!)
      d.action = { id: job.id, recipe: d.recipe, targetId: d.targetId, worldTargetId: null, toolIds, plan: check.plan!, label: job.label, duration: d.recipe.duration, elapsed: 0 }
      for (const u of check.plan!) w.ledger.reserve(job.id, 'recipe', u.instanceId, u.quantity)
      for (const t of toolIds) w.ledger.reserve(job.id, 'recipe', t, 1)
      if (d.targetId) w.ledger.reserve(job.id, 'recipe', d.targetId, 1)
      w.events.queue('action:started', { id: job.id, kind: d.recipe.kind, label: job.label, duration: d.recipe.duration })
      w.inventoryChanged()
      return d.action
    },

    /**
     * Check everything again and consume exactly the reserved inputs, wear the tools, update the
     * target or create the output: prepared on copies, written as one change. Nothing on failure.
     */
    commit(job, w) {
      const action = job.data.action!
      const { recipe, label } = action
      const prepared = prepareRecipe(w.craftSources(job.id), recipe, action.targetId, action.toolIds, action.plan)
      if (!prepared.ok) {
        w.events.queue('action:failed', { id: job.id, label, reason: prepared.failure })
        w.inventoryChanged()
        return { next: 'done' }
      }
      const effects: GameplayEffect[] = prepared.inventories.map((inventory, n) => ({
        type: 'inventory.write' as const,
        inventory,
        base: inventorySignature(inventory),
        items: prepared.trials[n].items,
        nextItemId: prepared.trials[n].nextItemId,
      }))
      effects.push({ type: 'after', run: () => reconcileEquipment(w.player.inventory, w.player.equipment) })
      for (const wear of prepared.toolWear) {
        effects.push(eventEffect('weapon:worn', { id: wear.id, itemId: wear.itemId, condition: wear.condition }))
        if (wear.broke) effects.push(eventEffect('weapon:broken', { id: wear.id, itemId: wear.itemId, name: getItemDef(wear.itemId).name }))
      }
      effects.push(eventEffect('action:completed', {
        id: job.id,
        kind: recipe.kind,
        recipeId: recipe.id,
        label,
        outputItemId: recipe.kind === 'craft' ? recipe.output.itemId : null,
        outputId: prepared.outputId,
        repair: prepared.repair,
      }))
      effects.push({ type: 'after', run: () => w.inventoryChanged() })
      return { next: 'done', mutation: { effects } }
    },

    claims(job, instanceId) {
      if (job.data.action) return 0
      let n = 0
      for (const c of job.data.claims) if (c.instanceId === instanceId) n += c.quantity
      return n
    },

    view(job) {
      const a = job.data.action
      return { id: job.id, kind: job.data.recipe.kind, label: job.label, stepProgress: a ? a.elapsed / a.duration : 0, stepRemaining: a ? Math.max(0, a.duration - a.elapsed) : job.data.recipe.duration, done: 0, total: 1 }
    },
  }
}

export const CRAFT = registerAction(recipeDefinition(ACTION.CRAFT, 'CRAFTING'))
export const REPAIR = registerAction(recipeDefinition(ACTION.REPAIR, 'REPAIRING'))
