import { getItemDef, type ItemId, type ItemInstance, type ToolTag } from '../entities/items'
import type { Recipe } from '../entities/recipes'
import { addItem, cloneInventory, removeQuantity, type Inventory } from './inventory'
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

/** Units of one instance a recipe will consume (INV-LOOT: reserved when the action starts). */
export interface InputUse {
  instanceId: string
  quantity: number
}

export interface RecipeCheck {
  ok: boolean
  failure: CraftFailure | null
  inputs: InputCheck[]
  tools: ToolCheck[]
  repair: RepairPreview | null
  output: { itemId: ItemId; quantity: number } | null
  /** Concrete inputs, main inventory first then the worn bag; null when the inputs are missing. */
  plan: InputUse[] | null
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
 * Where a recipe takes its inputs from (INV-LOOT Q2): the usable inventories in order (main, then
 * the worn bag), what may be consumed (favorites and equipped items are protected), and how many
 * units of an instance are free (quantity minus what another action holds). The output goes to the
 * first inventory. A single inventory is the same as `{ inventories: [inv] }`.
 */
export interface CraftSources {
  inventories: readonly Inventory[]
  /** True for instances that must never be consumed automatically. */
  protect?: (item: ItemInstance) => boolean
  /** Units of the instance free for this recipe; default its quantity. */
  available?: (item: ItemInstance) => number
}

function sources(src: Inventory | CraftSources): Required<CraftSources> {
  const s = 'inventories' in src ? src : { inventories: [src] }
  return { inventories: s.inventories, protect: s.protect ?? (() => false), available: s.available ?? ((i) => i.quantity) }
}

function findIn(invs: readonly Inventory[], id: string | null): ItemInstance | undefined {
  if (!id) return undefined
  for (const inv of invs) {
    const item = inv.items.find((i) => i.id === id)
    if (item) return item
  }
  return undefined
}

/** Inputs taken in a stable order: the first inventory first, then list order; partial stacks allowed. */
function planInputs(src: Required<CraftSources>, recipe: Recipe, used: ReadonlySet<string>): { inputs: InputCheck[]; plan: InputUse[] | null } {
  const plan: InputUse[] = []
  let complete = true
  const inputs = recipe.inputs.map((input) => {
    let have = 0
    let need = input.quantity
    for (const inv of src.inventories) {
      for (const item of inv.items) {
        if (item.itemId !== input.itemId || used.has(item.id) || src.protect(item)) continue
        const free = Math.max(0, Math.min(item.quantity, src.available(item)))
        have += free
        const take = Math.min(free, need)
        if (take > 0) {
          plan.push({ instanceId: item.id, quantity: take })
          need -= take
        }
      }
    }
    if (need > 0) complete = false
    return { itemId: input.itemId, need: input.quantity, have, ok: have >= input.quantity }
  })
  return { inputs, plan: complete ? plan : null }
}

/**
 * Check a recipe without changing anything. Tool candidates exclude the repair target and each other
 * (a tool may be equipped, it is worn, not consumed); `fixedTools` pins the instances reserved when
 * the action started. Output space is simulated on copies after the planned inputs are consumed (a
 * stack used up frees its slot).
 */
export function checkRecipe(from: Inventory | CraftSources, recipe: Recipe, targetId: string | null, fixedTools?: readonly string[]): RecipeCheck {
  const src = sources(from)
  let failure: CraftFailure | null = null
  const fail = (reason: CraftFailure) => {
    failure ??= reason
  }

  let repair: RepairPreview | null = null
  if (recipe.kind === 'repair') {
    const target = findIn(src.inventories, targetId)
    if (!target) fail('no-target')
    else if (target.kind !== 'weapon' || getItemDef(target.itemId).repairGroup !== recipe.group) fail('not-repairable')
    else {
      const max = getItemDef(target.itemId).maxCondition!
      repair = { targetId: target.id, itemId: target.itemId, before: target.condition, after: Math.min(max, target.condition + recipe.amount), max }
      if (target.condition >= max) fail('full-condition')
    }
  }

  const used = new Set<string>(targetId ? [targetId] : [])
  const { inputs, plan } = planInputs(src, recipe, used)
  if (!plan) fail('missing-input')

  const tools = recipe.tools.map((req, n) => {
    const pinned = fixedTools?.[n]
    let candidate: ItemInstance | undefined
    for (const inv of src.inventories) {
      candidate = inv.items.find((i) => !used.has(i.id) && (pinned === undefined || i.id === pinned) && src.available(i) >= 1 && isUsableTool(i, req.tag))
      if (candidate) break
    }
    if (candidate) used.add(candidate.id)
    return { tag: req.tag, instanceId: candidate?.id ?? null, ok: candidate !== undefined }
  })
  if (tools.some((t) => !t.ok)) fail('missing-tool')

  const output = recipe.kind === 'craft' ? { ...recipe.output } : null
  if (output && failure === null && !simulate(src.inventories, recipe, null, [], plan!).ok) fail('no-space')

  return { ok: failure === null, failure, inputs, tools, repair, output, plan }
}

/**
 * Atomic completion: re-check everything, then consume exactly the planned inputs (the reserved
 * instances; any other plan when none is given), wear tools, update the target or create the output
 * on copies and write every inventory back only when each step succeeded. Nothing changes on
 * failure, so a cancelled or invalid completion never loses or duplicates items.
 */
export function commitRecipe(from: Inventory | CraftSources, recipe: Recipe, targetId: string | null, toolIds: readonly string[], plan?: readonly InputUse[]): CommitResult {
  const prepared = prepareRecipe(from, recipe, targetId, toolIds, plan)
  if (!prepared.ok) return prepared
  prepared.inventories.forEach((inv, n) => {
    inv.items = prepared.trials[n].items
    inv.nextItemId = prepared.trials[n].nextItemId
  })
  return { ok: true, outputId: prepared.outputId, repair: prepared.repair, toolWear: prepared.toolWear }
}

/**
 * The completion of `commitRecipe` computed on copies without writing anything: the live inventories
 * and what each becomes. AX1: the recipe action turns it into one gameplay transaction.
 */
export type PreparedRecipe =
  | { ok: true; inventories: Inventory[]; trials: Inventory[]; outputId: string | null; repair: RepairPreview | null; toolWear: ToolWear[] }
  | { ok: false; failure: CraftFailure }

export function prepareRecipe(from: Inventory | CraftSources, recipe: Recipe, targetId: string | null, toolIds: readonly string[], plan?: readonly InputUse[]): PreparedRecipe {
  const src = sources(from)
  const check = checkRecipe(src, recipe, targetId, toolIds)
  if (!check.ok) return { ok: false, failure: check.failure! }
  const use = plan ?? check.plan!
  // The planned instances must still hold what they promised (and match the recipe's inputs).
  for (const input of recipe.inputs) {
    const planned = use.filter((u) => findIn(src.inventories, u.instanceId)?.itemId === input.itemId).reduce((n, u) => n + u.quantity, 0)
    if (planned < input.quantity) return { ok: false, failure: 'missing-input' }
  }
  for (const u of use) if ((findIn(src.inventories, u.instanceId)?.quantity ?? 0) < u.quantity) return { ok: false, failure: 'missing-input' }
  const result = simulate(src.inventories, recipe, targetId, check.tools.map((t) => t.instanceId!), use)
  if (!result.ok) return { ok: false, failure: 'no-space' }
  return { ok: true, inventories: [...src.inventories], trials: result.trials, outputId: result.outputId, repair: check.repair, toolWear: result.toolWear }
}

function simulate(invs: readonly Inventory[], recipe: Recipe, targetId: string | null, toolIds: readonly string[], plan: readonly InputUse[]) {
  const trials = invs.map(cloneInventory)
  const main = trials[0]
  const before = new Set(invs[0].items.map((i) => i.id))
  for (const u of plan) for (const t of trials) if (removeQuantity(t, u.instanceId, u.quantity).removed > 0) break
  const toolWear: ToolWear[] = []
  recipe.tools.forEach((req, n) => {
    const tool = trials.flatMap((t) => t.items).find((i) => i.id === toolIds[n])
    if (tool?.kind !== 'weapon' || req.wear <= 0) return
    tool.condition = Math.max(0, tool.condition - req.wear)
    toolWear.push({ id: tool.id, itemId: tool.itemId, condition: tool.condition, broke: tool.condition === 0 })
  })
  if (recipe.kind === 'repair') {
    const target = trials.flatMap((t) => t.items).find((i) => i.id === targetId)
    if (target?.kind === 'weapon') target.condition = Math.min(getItemDef(target.itemId).maxCondition!, target.condition + recipe.amount)
  }
  let outputId: string | null = null
  if (recipe.kind === 'craft') {
    if (addItem(main, recipe.output.itemId, recipe.output.quantity).remainder > 0) return { ok: false as const }
    outputId = main.items.find((i) => i.itemId === recipe.output.itemId && !before.has(i.id))?.id ?? null
  }
  return { ok: true as const, trials, outputId, toolWear }
}
