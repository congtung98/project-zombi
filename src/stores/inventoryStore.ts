import { create } from 'zustand'
import type { GameRuntime } from '../game/core/runtime'
import { cloneInventory, createInventory, type Inventory } from '../game/systems/inventory'

/** Running timed action as the UI needs it (buttons disable, the target shows "đang sửa"). */
export interface ActionSnapshot {
  id: number
  recipeId: string
  targetId: string | null
  label: string
}

interface ContainerSnapshot {
  id: string
  name: string
  items: Inventory
}

/**
 * Snapshot túi đồ và panel container cho React. Nguồn sự thật là
 * `runtime.player.inventory` và `runtime.world.containers`; App gọi `sync`
 * khi runtime phát `inventory:changed` (không đồng bộ mỗi frame).
 */
interface InventoryUiState {
  open: boolean
  bag: Inventory
  weaponInstanceId: string | null
  container: ContainerSnapshot | null
  action: ActionSnapshot | null
  sync: (rt: GameRuntime) => void
  reset: () => void
}

export const useInventoryStore = create<InventoryUiState>((set) => ({
  open: false,
  bag: createInventory(0, 'ui'),
  weaponInstanceId: null,
  container: null,
  action: null,

  sync: (rt) => {
    const c = rt.openContainer
    const name = c ? (rt.interactables.find((i) => i.id === c.id)?.name ?? c.id) : ''
    set({
      open: rt.inventoryOpen,
      bag: cloneInventory(rt.player.inventory),
      weaponInstanceId: rt.player.equipment.weaponInstanceId,
      container: c ? { id: c.id, name, items: cloneInventory(c.items) } : null,
      action: rt.action ? { id: rt.action.id, recipeId: rt.action.recipe.id, targetId: rt.action.targetId, label: rt.action.label } : null,
    })
  },

  reset: () => set({ open: false, bag: createInventory(0, 'ui'), weaponInstanceId: null, container: null, action: null }),
}))
