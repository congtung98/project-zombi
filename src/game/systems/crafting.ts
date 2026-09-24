import { getItemDef, type ItemId, type ToolTag } from '../entities/items'
import type { Recipe } from '../entities/recipes'
import { addItem, cloneInventory, countItem, removeItem, type Inventory } from './inventory'
import { isUsableTool } from './weapons'

/** First blocking reason, in the order the UI explains it. */
export type CraftFailure = 'no-target' | 'not-repairable' | 'full-condition' | 'missing-input' | 'missing-tool' | 'no-space'

export interface InputCheck {
  itemId: ItemId
  need: number
  have: number
  ok: boolean
}

export interface ToolCheck {
  tag: ToolTag
  /** Usable instance that would be used (and worn); null when none qualifies. */
  instanceId: string | null
  ok: boolean
}

export interface RepairPreview {
  targetId: string
  itemId: ItemId
  before: number
  /** Capped at max; the UI shows the condition actually gained. */
  after: number
  max: number
}

export interface RecipeCheck {
  ok: boolean
  failure: CraftFailure | null
  inputs: InputCheck[]
  tools: ToolCheck[]
  repair: RepairPreview | null
  output: { itemId: ItemId; quantity: number } | null
}

export interface ToolWear {
  id: string
  itemId: ItemId
  condition: number
  broke: boolean
}

export type CommitResult =
  | { ok: true; outputId: string | null; repair: RepairPreview | null; toolWear: ToolWear[] }
  | { ok: false; failure: CraftFailure }

/**
 * Check a recipe against the bag without changing it. Tool candidates exclude the repair target
 * and each other; `fixedTools` pins the instances reserved when the action started. Output space
 * is simulated on a copy after the inputs are consumed (a stack used up frees its slot).
 */
export function checkRecipe(inv: Inventory, recipe: Recipe, targetId: string | null, fixedTools?: readonly string[]): RecipeCheck {
  let failure: CraftFailure | null = null
  const fail = (reason: CraftFailure) => {
    failure ??= reason
  }

  let repair: RepairPreview | null = null
  if (recipe.kind === 'repair') {
    const target = targetId ? inv.slots.find((i) => i?.id === targetId) : undefined
    if (!target) fail('no-target')
    else if (target.kind !== 'weapon' || getItemDef(target.itemId).repairGroup !== recipe.group) fail('not-repairable')
    else {
      const max = getItemDef(target.itemId).maxCondition!
      repair = { targetId: target.id, itemId: target.itemId, before: target.condition, after: Math.min(max, target.condition + recipe.amount), max }
      if (target.condition >= max) fail('full-condition')
    }
  }

  const inputs = recipe.inputs.map((input) => {
    const have = countItem(inv, input.itemId)
    return { itemId: input.itemId, need: input.quantity, have, ok: have >= input.quantity }
  })
  if (inputs.some((i) => !i.ok)) fail('missing-input')

  const used = new Set<string>(targetId ? [targetId] : [])
  const tools = recipe.tools.map((req, n) => {
    const pinned = fixedTools?.[n]
    const candidate = inv.slots.find((i) => i !== null && !used.has(i.id) && (pinned === undefined || i.id === pinned) && isUsableTool(i, req.tag))
    if (candidate) used.add(candidate.id)
    return { tag: req.tag, instanceId: candidate?.id ?? null, ok: candidate !== undefined }
  })
  if (tools.some((t) => !t.ok)) fail('missing-tool')

  const output = recipe.kind === 'craft' ? { ...recipe.output } : null
  if (output && failure === null && !simulate(inv, recipe, null, []).ok) fail('no-space')

  return { ok: failure === null, failure, inputs, tools, repair, output }
}

/**
 * Atomic completion: re-check everything, then consume inputs, wear tools, update the target or
 * create the output on a copy and write it back only when every step succeeded. Nothing changes
 * on failure, so a cancelled or invalid completion never loses or duplicates items.
 */
export function commitRecipe(inv: Inventory, recipe: Recipe, targetId: string | null, toolIds: readonly string[]): CommitResult {
  const check = checkRecipe(inv, recipe, targetId, toolIds)
  if (!check.ok) return { ok: false, failure: check.failure! }
  const result = simulate(inv, recipe, targetId, check.tools.map((t) => t.instanceId!))
  if (!result.ok) return { ok: false, failure: 'no-space' }
  inv.slots = result.trial.slots
  inv.nextItemId = result.trial.nextItemId
  return { ok: true, outputId: result.outputId, repair: check.repair, toolWear: result.toolWear }
}

function simulate(inv: Inventory, recipe: Recipe, targetId: string | null, toolIds: readonly string[]) {
  const trial = cloneInventory(inv)
  const before = new Set(inv.slots.flatMap((i) => (i ? [i.id] : [])))
  for (const input of recipe.inputs) removeItem(trial, input.itemId, input.quantity)
  const toolWear: ToolWear[] = []
  recipe.tools.forEach((req, n) => {
    const tool = trial.slots.find((i) => i?.id === toolIds[n])
    if (tool?.kind !== 'weapon' || req.wear <= 0) return
    tool.condition = Math.max(0, tool.condition - req.wear)
    toolWear.push({ id: tool.id, itemId: tool.itemId, condition: tool.condition, broke: tool.condition === 0 })
  })
  if (recipe.kind === 'repair') {
    const target = trial.slots.find((i) => i?.id === targetId)
    if (target?.kind === 'weapon') target.condition = Math.min(getItemDef(target.itemId).maxCondition!, target.condition + recipe.amount)
  }
  let outputId: string | null = null
  if (recipe.kind === 'craft') {
    if (addItem(trial, recipe.output.itemId, recipe.output.quantity).remainder > 0) return { ok: false as const }
    outputId = trial.slots.find((i) => i !== null && i.itemId === recipe.output.itemId && !before.has(i.id))?.id ?? null
  }
  return { ok: true as const, trial, outputId, toolWear }
}
