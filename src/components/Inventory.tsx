import { getItemDef, type ItemInstance } from '../game/entities/items'
import { runtime } from '../game/core/runtime'
import { countUsedSlots, type Inventory as InventoryData } from '../game/systems/inventory'
import { useInventoryStore } from '../stores/inventoryStore'

interface SlotProps {
  stack: ItemInstance | null
  title: string
  onClick?: () => void
  onContextMenu?: () => void
}

/** Một ô: icon + số lượng; tooltip ghi tên/mô tả. Ô trống không bấm được. */
export function ItemSlot({ stack, title, onClick, onContextMenu }: SlotProps) {
  const def = stack ? getItemDef(stack.itemId) : null
  return (
    <button
      type="button"
      className={`slot${stack ? ' slot-filled' : ''}`}
      disabled={!stack}
      title={def ? `${def.name} ×${stack!.quantity}\n${stack?.kind === 'weapon' ? `Condition ${stack.condition}/${def.maxCondition}\n` : ''}${def.description}\n${title}` : ''}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu?.()
      }}
    >
      {def && (
        <>
          <span className="slot-icon" aria-hidden>
            {def.icon}
          </span>
          <span className="slot-name">{def.name}</span>
          {stack?.kind === 'weapon' && <span>{stack.condition}/{def.maxCondition}</span>}
          {stack!.quantity > 1 && <span className="slot-qty">{stack!.quantity}</span>}
        </>
      )}
    </button>
  )
}

export function SlotGrid({
  inv,
  columns,
  title,
  onClick,
  onContextMenu,
}: {
  inv: InventoryData
  columns: number
  title: string
  onClick: (slot: number) => void
  onContextMenu?: (slot: number) => void
}) {
  return (
    <div className="slot-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {inv.slots.map((stack, i) => (
        <ItemSlot
          key={i}
          stack={stack}
          title={title}
          onClick={() => onClick(i)}
          onContextMenu={onContextMenu ? () => onContextMenu(i) : undefined}
        />
      ))}
    </div>
  )
}

/**
 * Túi đồ 12 ô. Không có container: click = dùng. Có container mở: click = cất
 * vào container, chuột phải = dùng. Mọi thao tác gọi thẳng runtime; store chỉ
 * cập nhật lại từ sự kiện `inventory:changed`.
 */
export function InventoryPanel() {
  const bag = useInventoryStore((s) => s.bag)
  const container = useInventoryStore((s) => s.container)
  const equippedId = useInventoryStore((s) => s.weaponInstanceId)
  const used = countUsedSlots(bag)
  const looting = container !== null

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
        title={looting ? 'Trái: cất vào tủ · Phải: dùng/trang bị' : 'Trái: dùng/trang bị/bỏ trang bị'}
        onClick={(i) => (looting ? runtime.putIntoContainer(i) : runtime.activateItem(i))}
        onContextMenu={(i) => runtime.activateItem(i)}
      />
      <p>Đang cầm: {bag.slots.find((s) => s?.id === equippedId)?.itemId ? 'Gậy bóng chày' : 'Tay không'}</p>
      {bag.slots.map((item, i) => item?.kind === 'weapon' ? (
        <button key={item.id} type="button" onClick={() => runtime.dropItem(i)}>Thả gậy ({item.condition}/{getItemDef(item.itemId).maxCondition})</button>
      ) : null)}
      <div className="inv-hint">
        {looting ? (
          <>
            <kbd>Trái</kbd> cất vào tủ · <kbd>Phải</kbd> dùng/trang bị
          </>
        ) : (
          <>
            <kbd>Trái</kbd> dùng/trang bị · <kbd>I</kbd> đóng
          </>
        )}
      </div>
    </div>
  )
}
