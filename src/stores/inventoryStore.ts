import { create } from 'zustand'
import type { GameRuntime } from '../game/core/runtime'
import { cloneInventory, createInventory, type Inventory } from '../game/systems/inventory'
import { inventoryWeight, itemWeight, wornBagContents } from '../game/systems/bags'
import { containerKey, type InventoryKey } from '../game/systems/inventoryCommands'

/** Running timed action as the UI needs it (buttons disable, the target shows "đang sửa"). */
export interface ActionSnapshot {
  id: number
  recipeId: string
  targetId: string | null
  label: string
  /** Instances promised to the action (shown "Đang dùng"). */
  reservedIds: string[]
}

interface ContainerSnapshot {
  id: string
  name: string
  items: Inventory
}

/** One inventory as a window shows it, addressed by its key. */
export interface InventoryView {
  key: InventoryKey
  name: string
  inventory: Inventory
  /** Everything in it, bags with their contents, each once (display only, never a limit). */
  weightKg: number
}

/**
 * Snapshot túi đồ và các inventory mở được cho React. Nguồn sự thật là runtime; App gọi `sync` khi
 * runtime phát `inventory:changed` (không đồng bộ mỗi frame). An inventory whose content did not
 * change keeps the same object, so memoized rows of an untouched window do not re-render.
 */
interface InventoryUiState {
  open: boolean
  /** Main inventory (kept as `bag` for the crafting checks). */
  bag: Inventory
  main: InventoryView
  worn: InventoryView | null
  lootView: InventoryView | null
  weaponInstanceId: string | null
  /** INV-LOOT: the worn bag (slot Back), null when none. */
  backInstanceId: string | null
  /** Carried weight: main inventory with every bag's contents counted once (display only). */
  weightKg: number
  /** Weight of each bag instance with its contents, for the rows. */
  bagWeights: Record<string, number>
  container: ContainerSnapshot | null
  action: ActionSnapshot | null
  sync: (rt: GameRuntime) => void
  reset: () => void
}

const emptyMain = (): InventoryView => ({ key: 'main', name: 'Túi chính', inventory: createInventory(0, 'ui', 'player'), weightKg: 0 })

function same(a: Inventory, b: Inventory): boolean {
  return a.slotCapacity === b.slotCapacity && a.items.length === b.items.length && JSON.stringify(a.items) === JSON.stringify(b.items)
}

/** The previous snapshot when nothing changed, else a fresh copy. */
function share(prev: InventoryView | null, key: InventoryKey, name: string, live: Inventory, weightKg: number): InventoryView {
  if (prev && prev.key === key && prev.name === name && prev.weightKg === weightKg && same(prev.inventory, live)) return prev
  return { key, name, inventory: cloneInventory(live), weightKg }
}

export const useInventoryStore = create<InventoryUiState>((set, get) => ({
  open: false,
  bag: emptyMain().inventory,
  main: emptyMain(),
  worn: null,
  lootView: null,
  weaponInstanceId: null,
  backInstanceId: null,
  weightKg: 0,
  bagWeights: {},
  container: null,
  action: null,

  sync: (rt) => {
    const prev = get()
    const bags = rt.world.bags
    const main = share(prev.main, 'main', 'Túi chính', rt.player.inventory, inventoryWeight(rt.player.inventory, bags))
    const wornLive = wornBagContents(rt.player.inventory, rt.player.equipment, bags)
    const worn = wornLive ? share(prev.worn, 'worn', 'Balo đang đeo', wornLive, inventoryWeight(wornLive, bags)) : null
    const c = rt.openContainer
    const name = c ? (rt.interactables.find((i) => i.id === c.id)?.name ?? c.id) : ''
    const lootView = c ? share(prev.lootView, containerKey(c.id), name, c.items, inventoryWeight(c.items, bags)) : null
    const bagWeights: Record<string, number> = {}
    for (const inv of [rt.player.inventory, ...(wornLive ? [wornLive] : []), ...(c ? [c.items] : [])]) {
      for (const i of inv.items) if (i.kind === 'bag') bagWeights[i.id] = itemWeight(i, bags)
    }
    const a = rt.action
    set({
      open: rt.inventoryOpen,
      bag: main.inventory,
      main,
      worn,
      lootView,
      weaponInstanceId: rt.player.equipment.weaponInstanceId,
      backInstanceId: rt.player.equipment.backInstanceId,
      weightKg: main.weightKg,
      bagWeights,
      container: c && lootView ? { id: c.id, name, items: lootView.inventory } : null,
      action: a ? { id: a.id, recipeId: a.recipe.id, targetId: a.targetId, label: a.label, reservedIds: [...a.reservation.instanceIds] } : null,
    })
  },

  reset: () => set({ open: false, bag: emptyMain().inventory, main: emptyMain(), worn: null, lootView: null, weaponInstanceId: null, backInstanceId: null, weightKg: 0, bagWeights: {}, container: null, action: null }),
}))
