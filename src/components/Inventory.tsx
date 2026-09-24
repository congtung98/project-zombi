import { useState, type MouseEvent } from 'react'
import { getItemDef, type ItemInstance } from '../game/entities/items'
import { runtime } from '../game/core/runtime'
import { countUsedSlots, type Inventory as InventoryData } from '../game/systems/inventory'
import { conditionLevel, weaponHitDamage } from '../game/systems/weapons'
import { checkRecipe } from '../game/systems/crafting'
import { repairRecipeFor } from '../game/entities/recipes'
import { useInventoryStore, type ActionSnapshot } from '../stores/inventoryStore'
import { RecipeRequirements } from './CraftingPanel'
import { ACTION_FAILURE_TEXT } from './craftText'

const LEVEL_TEXT = { ok: 'Tốt', low: 'Sắp hỏng (≤ 25%)', broken: 'HỎNG — sát thương còn 20%' } as const

/** Tooltip/detail text for one instance; weapons show damage, condition and broken state. */
function describeItem(item: ItemInstance): string[] {
  const def = getItemDef(item.itemId)
  if (item.kind !== 'weapon' || !def.melee) return [`${def.name} ×${item.quantity}`, def.description]
  const m = def.melee
  const level = conditionLevel(item.itemId, item.condition)
  const damage = weaponHitDamage(item.itemId, item.condition)
  return [
    def.name,
    `Sát thương ${damage}${level === 'broken' ? ` (gốc ${m.damage})` : ''} · Tầm ${m.range} m · Hồi ${m.cooldown} s · Thể lực ${m.stamina}`,
    `Độ bền ${item.condition}/${def.maxCondition} · ${LEVEL_TEXT[level]}`,
    def.description,
  ]
}

interface SlotProps {
  stack: ItemInstance | null
  title: string
  equipped?: boolean
  selected?: boolean
  onClick?: (e: MouseEvent) => void
  onContextMenu?: () => void
}

/** Một ô: icon, số lượng, thanh độ bền; viền xanh = đang cầm, viền vàng = đang chọn. */
export function ItemSlot({ stack, title, equipped, selected, onClick, onContextMenu }: SlotProps) {
  const def = stack ? getItemDef(stack.itemId) : null
  const level = stack?.kind === 'weapon' ? conditionLevel(stack.itemId, stack.condition) : null
  const classes = ['slot', stack && 'slot-filled', equipped && 'slot-equipped', selected && 'slot-selected', level === 'broken' && 'slot-broken']
  return (
    <button
      type="button"
      className={classes.filter(Boolean).join(' ')}
      disabled={!stack}
      title={stack ? `${describeItem(stack).join('\n')}\n${title}` : ''}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu?.()
      }}
    >
      {def && stack && (
        <>
          {equipped && <span className="slot-badge">E</span>}
          <span className="slot-icon" aria-hidden>
            {def.icon}
          </span>
          <span className="slot-name">{def.name}</span>
          {stack.quantity > 1 && <span className="slot-qty">{stack.quantity}</span>}
          {stack.kind === 'weapon' && (
            <>
              {level === 'broken' && <span className="slot-broken-tag">HỎNG</span>}
              <span className={`slot-cond ${level}`} aria-label={`Độ bền ${stack.condition}/${def.maxCondition}`}>
                <span style={{ width: `${(stack.condition / def.maxCondition!) * 100}%` }} />
              </span>
            </>
          )}
        </>
      )}
    </button>
  )
}

export function SlotGrid({
  inv,
  columns,
  title,
  equippedId,
  selectedId,
  onClick,
  onContextMenu,
}: {
  inv: InventoryData
  columns: number
  title: string
  equippedId?: string | null
  selectedId?: string | null
  onClick: (slot: number, e: MouseEvent) => void
  onContextMenu?: (slot: number) => void
}) {
  return (
    <div className="slot-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {inv.slots.map((stack, i) => (
        <ItemSlot
          key={i}
          stack={stack}
          title={title}
          equipped={!!stack && stack.id === equippedId}
          selected={!!stack && stack.id === selectedId}
          onClick={(e) => onClick(i, e)}
          onContextMenu={onContextMenu ? () => onContextMenu(i) : undefined}
        />
      ))}
    </div>
  )
}

/**
 * Repair preview for a weapon (plan §7.2): condition actually gained (capped at max), materials
 * lost, time, and what is missing. Checked on the UI snapshot; the runtime re-checks on start/commit.
 */
function RepairInfo({ item, bag, action }: { item: ItemInstance; bag: InventoryData; action: ActionSnapshot | null }) {
  const recipe = repairRecipeFor(item.itemId)
  if (!recipe || item.kind !== 'weapon') return null
  const check = checkRecipe(bag, recipe, item.id)
  const r = check.repair
  const running = action?.targetId === item.id
  return (
    <div className="repair-box">
      {r && (
        <p className="stat-line">
          {r.before >= r.max ? `Độ bền đã đầy (${r.max}/${r.max})` : `Sửa: độ bền ${r.before} → ${r.after}/${r.max} (+${r.after - r.before})`}
        </p>
      )}
      <RecipeRequirements recipe={recipe} check={check} />
      {running && <p className="recipe-running">Đang sửa…</p>}
    </div>
  )
}

/** Selected bag item: stats plus Equip/Use, Store, Drop and (weapons) Repair as a timed action. */
function ItemDetail({ item, slot, equipped, looting, bag, action }: { item: ItemInstance; slot: number; equipped: boolean; looting: boolean; bag: InventoryData; action: ActionSnapshot | null }) {
  const [name, ...lines] = describeItem(item)
  const def = getItemDef(item.itemId)
  const level = item.kind === 'weapon' ? conditionLevel(item.itemId, item.condition) : null
  const recipe = item.kind === 'weapon' ? repairRecipeFor(item.itemId) : null
  const repairCheck = recipe ? checkRecipe(bag, recipe, item.id) : null
  const repairing = action?.targetId === item.id
  const repairBlock = action && !repairing ? ACTION_FAILURE_TEXT.busy : repairCheck?.failure ? ACTION_FAILURE_TEXT[repairCheck.failure] : null
  const consumable = def.kind === 'food' || def.kind === 'drink' || def.kind === 'medical'
  return (
    <div className="item-detail">
      <h4>
        {def.icon} {name} {equipped && <small>(đang cầm)</small>}
      </h4>
      {lines.map((line, i) => (
        <p key={i} className={item.kind !== 'weapon' ? undefined : i === 0 ? 'stat-line' : i === 1 ? `stat-line status-${level}` : undefined}>
          {line}
        </p>
      ))}
      {def.kind === 'material' && <p>Vật liệu: dùng khi sửa vũ khí (thẻ vũ khí) hoặc chế tạo (bảng bên cạnh).</p>}
      <RepairInfo item={item} bag={bag} action={action} />
      <div className="item-actions">
        {item.kind === 'weapon' && (
          <button type="button" onClick={() => runtime.equipItem(equipped ? null : item.id)}>
            {equipped ? 'Bỏ trang bị' : 'Trang bị'}
          </button>
        )}
        {consumable && (
          <button type="button" onClick={() => runtime.consumeItem(slot)}>
            Dùng
          </button>
        )}
        {looting && (
          <button type="button" onClick={() => runtime.putIntoContainer(slot)}>
            Cất vào tủ
          </button>
        )}
        <button type="button" onClick={() => runtime.dropItem(slot)}>
          Thả xuống
        </button>
        {recipe &&
          (repairing ? (
            <button type="button" onClick={() => runtime.cancelAction()}>
              Hủy sửa (X)
            </button>
          ) : (
            <button type="button" disabled={repairBlock !== null} title={repairBlock ? `Chưa sửa được: ${repairBlock}` : undefined} onClick={() => runtime.startRepair(item.id)}>
              Sửa ({recipe.duration} s)
            </button>
          ))}
      </div>
      {recipe && repairBlock && !repairing && <p className="recipe-reason">Chưa sửa được: {repairBlock}.</p>}
    </div>
  )
}

/**
 * Túi đồ 12 ô. Trái: chọn món và xem chi tiết/hành động. Phải: dùng hoặc
 * trang bị/bỏ trang bị nhanh. Shift+trái khi đang mở tủ: cất nhanh. Mọi thao tác
 * gọi thẳng runtime; store chỉ cập nhật lại từ sự kiện `inventory:changed`.
 */
export function InventoryPanel() {
  const bag = useInventoryStore((s) => s.bag)
  const container = useInventoryStore((s) => s.container)
  const equippedId = useInventoryStore((s) => s.weaponInstanceId)
  const action = useInventoryStore((s) => s.action)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const used = countUsedSlots(bag)
  const looting = container !== null
  const selectedSlot = selectedId ? bag.slots.findIndex((s) => s?.id === selectedId) : -1
  const selected = selectedSlot >= 0 ? bag.slots[selectedSlot] : null
  const equipped = bag.slots.find((s) => s?.id === equippedId)

  return (
    <div className="inv-panel">
      <div className="inv-header">
        <h3>Túi đồ</h3>
        <span className="inv-count">
          {used}/{bag.slots.length}
        </span>
      </div>
      <SlotGrid
        inv={bag}
        columns={4}
        title={looting ? 'Trái: chi tiết · Shift+trái: cất vào tủ · Phải: dùng/trang bị' : 'Trái: chi tiết · Phải: dùng/trang bị'}
        equippedId={equippedId}
        selectedId={selected?.id ?? null}
        onClick={(i, e) => {
          const item = bag.slots[i]
          if (!item) return
          if (looting && e.shiftKey) runtime.putIntoContainer(i)
          else setSelectedId(selected?.id === item.id ? null : item.id)
        }}
        onContextMenu={(i) => runtime.activateItem(i)}
      />
      {selected ? (
        <ItemDetail item={selected} slot={selectedSlot} equipped={selected.id === equippedId} looting={looting} bag={bag} action={action} />
      ) : (
        <p className="inv-hint">Đang cầm: {equipped ? getItemDef(equipped.itemId).name : 'Tay không (Space để đẩy)'}</p>
      )}
      <div className="inv-hint">
        <kbd>Trái</kbd> chi tiết · <kbd>Phải</kbd> dùng/trang bị{looting && <> · <kbd>Shift</kbd>+trái cất</>} · <kbd>I</kbd> đóng
      </div>
    </div>
  )
}
