import { getItemDef, type ItemId, type RepairGroup, type ToolTag } from './items'

/**
 * Recipe data (plan §7.2–7.3). Numbers are starting values for playtest. Recipes are pure data;
 * `systems/crafting.ts` checks and commits them, `GameRuntime` runs them as timed actions.
 */
export type RecipeId = 'craft_wooden_club' | 'repair_wood' | 'repair_metal'

export interface RecipeInput {
  itemId: ItemId
  quantity: number
}

export interface ToolRequirement {
  tag: ToolTag
  /** Condition the tool loses when the action commits (never on cancel). */
  wear: number
}

interface RecipeBase {
  /** RecipeId for shipped recipes; tests may pass ad-hoc recipes to the pure functions. */
  id: string
  name: string
  inputs: readonly RecipeInput[]
  tools: readonly ToolRequirement[]
  /** Seconds of game time (pauses with the simulation). */
  duration: number
}

export interface CraftRecipe extends RecipeBase {
  kind: 'craft'
  output: { itemId: ItemId; quantity: number }
}

/** Restores a fixed amount on one weapon instance of `group`, capped at its max condition. */
export interface RepairRecipe extends RecipeBase {
  kind: 'repair'
  group: RepairGroup
  amount: number
}

export type Recipe = CraftRecipe | RepairRecipe

export const RECIPES = {
  craft_wooden_club: {
    id: 'craft_wooden_club', kind: 'craft', name: 'Gậy gỗ tự chế',
    inputs: [{ itemId: 'wood_plank', quantity: 2 }, { itemId: 'duct_tape', quantity: 1 }],
    tools: [], duration: 4, output: { itemId: 'wooden_club', quantity: 1 },
  },
  // No tool needed to repair (plan §7.2): a broken hammer must never lock progress.
  repair_wood: {
    id: 'repair_wood', kind: 'repair', name: 'Sửa đồ gỗ', group: 'wood', amount: 30,
    inputs: [{ itemId: 'wood_plank', quantity: 1 }, { itemId: 'duct_tape', quantity: 1 }],
    tools: [], duration: 4,
  },
  repair_metal: {
    id: 'repair_metal', kind: 'repair', name: 'Sửa đồ kim loại', group: 'metal', amount: 25,
    inputs: [{ itemId: 'scrap_metal', quantity: 1 }, { itemId: 'duct_tape', quantity: 1 }],
    tools: [], duration: 5,
  },
} satisfies Record<RecipeId, Recipe>

/** Recipes listed in the crafting panel (repairs start from a weapon's detail card). */
export const CRAFT_RECIPES: readonly RecipeId[] = ['craft_wooden_club']

export function repairRecipeFor(itemId: ItemId): RepairRecipe | null {
  const group = getItemDef(itemId).repairGroup
  if (!group) return null
  for (const recipe of Object.values(RECIPES)) if (recipe.kind === 'repair' && recipe.group === group) return recipe
  return null
}
