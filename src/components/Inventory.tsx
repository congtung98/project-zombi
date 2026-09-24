import { getItemDef } from '../game/entities/items'
import { runtime } from '../game/core/runtime'
import { countUsedSlots, type Inventory as InventoryData, type ItemStack } from '../game/systems/inventory'
import { useInventoryStore } from '../stores/inventoryStore'

interface SlotProps {
  stack: ItemStack | null
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
      title={def ? `${def.name} ×${stack!.quantity}\n${def.description}\n${title}` : ''}
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
        title={looting ? 'Trái: cất vào tủ · Phải: dùng' : 'Trái: dùng'}
        onClick={(i) => (looting ? runtime.putIntoContainer(i) : runtime.consumeItem(i))}
        onContextMenu={(i) => runtime.consumeItem(i)}
      />
      <div className="inv-hint">
        {looting ? (
          <>
            <kbd>Trái</kbd> cất vào tủ · <kbd>Phải</kbd> dùng
          </>
        ) : (
          <>
            <kbd>Trái</kbd> dùng · <kbd>I</kbd> đóng
          </>
        )}
      </div>
    </div>
  )
}
