import { runtime } from '../game/core/runtime'
import { isEmpty } from '../game/systems/inventory'
import { useInventoryStore } from '../stores/inventoryStore'
import { SlotGrid } from './Inventory'

/** Panel container đang mở: click ô = lấy; "Lấy tất cả" chỉ chuyển phần còn chỗ. */
export function ContainerPanel() {
  const container = useInventoryStore((s) => s.container)
  if (!container) return null
  const empty = isEmpty(container.items)

  return (
    <div className="inv-panel inv-panel-container">
      <div className="inv-header">
        <h3>{container.name}</h3>
        <button type="button" className="inv-close" onClick={() => runtime.closeContainer()} title="Đóng (E)">
          ×
        </button>
      </div>
      {empty ? (
        <div className="inv-empty">Trống</div>
      ) : (
        <SlotGrid inv={container.items} columns={4} title="Trái: lấy" onClick={(i) => runtime.takeFromContainer(i)} />
      )}
      <div className="inv-footer">
        <button type="button" disabled={empty} onClick={() => runtime.takeAll()}>
          Lấy tất cả
        </button>
      </div>
    </div>
  )
}

/** Lớp phủ inventory: túi bên trái, container (nếu mở) bên phải. Chặn click xuống canvas. */
export function InventoryOverlay() {
  const open = useInventoryStore((s) => s.open)
  if (!open) return null
  return (
    <div className="inv-overlay" onContextMenu={(e) => e.preventDefault()}>
      <InventoryPanelLazy />
      <ContainerPanel />
    </div>
  )
}

// Tách import để tránh vòng import giữa Inventory.tsx và ContainerPanel.tsx.
import { InventoryPanel as InventoryPanelLazy } from './Inventory'
