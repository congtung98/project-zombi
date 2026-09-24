import { create } from 'zustand'
import type { GameRuntime } from '../game/core/runtime'
import { cloneInventory, type Inventory } from '../game/systems/inventory'

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
  container: ContainerSnapshot | null
  sync: (rt: GameRuntime) => void
  reset: () => void
}

export const useInventoryStore = create<InventoryUiState>((set) => ({
  open: false,
  bag: { slots: [] },
  container: null,

  sync: (rt) => {
    const c = rt.openContainer
    const name = c ? (rt.interactables.find((i) => i.id === c.id)?.name ?? c.id) : ''
    set({
      open: rt.inventoryOpen,
      bag: cloneInventory(rt.player.inventory),
      container: c ? { id: c.id, name, items: cloneInventory(c.items) } : null,
    })
  },

  reset: () => set({ open: false, bag: { slots: [] }, container: null }),
}))
