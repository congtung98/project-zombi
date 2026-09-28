import { getItemDef } from '../game/entities/items'
import { CRAFT_RECIPES, RECIPES, type Recipe } from '../game/entities/recipes'
import { runtime } from '../game/core/runtime'
import { checkRecipe, type CraftSources, type RecipeCheck } from '../game/systems/crafting'
import { useInventoryStore } from '../stores/inventoryStore'
import { ACTION_FAILURE_TEXT } from './craftText'

const TOOL_NAME = { hammer: 'Búa', pry: 'Xà beng' } as const

/** Inputs (have/need), tools and time of a recipe; missing parts are highlighted. */
export function RecipeRequirements({ recipe, check }: { recipe: Recipe; check: RecipeCheck }) {
  return (
    <ul className="recipe-reqs">
      {check.inputs.map((input) => {
        const def = getItemDef(input.itemId)
        return (
          <li key={input.itemId} className={input.ok ? 'req-ok' : 'req-missing'}>
            {def.icon} {def.name} {Math.min(input.have, input.need)}/{input.need}
            {!input.ok && <small> (thiếu {input.need - input.have})</small>}
          </li>
        )
      })}
      {check.tools.map((tool) => (
        <li key={tool.tag} className={tool.ok ? 'req-ok' : 'req-missing'}>
          🛠 {TOOL_NAME[tool.tag]} còn độ bền {tool.ok ? '✓' : '✗'}
        </li>
      ))}
      {recipe.tools.length === 0 && <li className="req-ok">Không cần dụng cụ</li>}
      <li className="req-time">⏱ {recipe.duration} s · di chuyển/đánh/trúng đòn sẽ hủy</li>
    </ul>
  )
}

/**
 * Craft list of the Crafting window (INV-LOOT D4: its own window). Checks run on the UI snapshot of
 * the main inventory (pure function); the runtime re-checks on start and again at commit.
 */
export function CraftingList() {
  const bag = useInventoryStore((s) => s.bag)
  const worn = useInventoryStore((s) => s.worn)
  const weaponId = useInventoryStore((s) => s.weaponInstanceId)
  const backId = useInventoryStore((s) => s.backInstanceId)
  const action = useInventoryStore((s) => s.action)
  const reserved = new Set(action?.reservedIds ?? [])
  // INV-LOOT Q2: main inventory then the worn bag; favorites, equipped and reserved items not counted.
  const sources: CraftSources = {
    inventories: worn ? [bag, worn.inventory] : [bag],
    protect: (i) => !!i.favorite || i.id === weaponId || i.id === backId,
    available: (i) => (reserved.has(i.id) ? 0 : i.quantity),
  }
  return (
    <div className="inv-craft">
      {CRAFT_RECIPES.map((id) => {
        const recipe = RECIPES[id]
        if (recipe.kind !== 'craft') return null
        const check = checkRecipe(sources, recipe, null)
        const out = getItemDef(recipe.output.itemId)
        const running = action?.recipeId === recipe.id
        // Another action running: this one waits its turn (it is checked again then), never refused as busy.
        const reason = check.failure ? ACTION_FAILURE_TEXT[action && check.failure === 'missing-input' ? 'missing-carried' : check.failure] : null
        return (
          <div key={id} className="recipe">
            <h4>
              {out.icon} {out.name}
            </h4>
            {out.melee && (
              <p className="recipe-out">
                Sát thương {out.melee.damage} · Tầm {out.melee.range} m · Độ bền {out.maxCondition}/{out.maxCondition}
              </p>
            )}
            <RecipeRequirements recipe={recipe} check={check} />
            {reason && <p className="recipe-reason">Chưa làm được: {reason}.</p>}
            <div className="item-actions">
              {running ? (
                <button type="button" onClick={() => runtime.cancelAction()}>
                  Hủy (X)
                </button>
              ) : (
                <button type="button" disabled={reason !== null} onClick={() => runtime.startCraft(id)}>
                  {action ? `Xếp hàng chế tạo (${recipe.duration} s)` : `Chế tạo (${recipe.duration} s)`}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
