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

/** A tab of the loot window: the floor or a container, by key; `inReach` false = shown, nothing moves. */
export interface LootTab {
  key: InventoryKey
  name: string
  used: number
  capacity: number | null
  inReach: boolean
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
  /** The loot window is open (a container or the floor). */
  lootOpen: boolean
  /** The loot window's container is within reach now. */
  lootInReach: boolean
  /** Floor first, then the containers in reach (by name), plus the shown one if it went out of reach. */
  lootTabs: LootTab[]
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

const FLOOR_NAME = 'Dưới đất'

function sameTabs(a: LootTab[], b: LootTab[]): boolean {
  return a.length === b.length && a.every((t, i) => t.key === b[i].key && t.used === b[i].used && t.inReach === b[i].inReach && t.name === b[i].name)
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
  lootOpen: false,
  lootInReach: true,
  lootTabs: [],
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
    const nameOf = (id: string) => rt.interactables.find((i) => i.id === id)?.name ?? id
    const name = c ? nameOf(c.id) : ''
    // The floor view lists the floor items in reach; each row is a real instance of its own cell
    // (the runtime re-checks every item's position when it moves), never a copy that can be changed.
    const floorItems = rt.nearbyFloorIds.flatMap((id) => {
      const found = rt.world.floor.find(id)
      return found ? [found.item] : []
    })
    const floor: Inventory = { id: 'floor', kind: 'floor', nextItemId: 1, items: floorItems, slotCapacity: null }
    const lootView = !rt.lootOpen ? null
      : c ? share(prev.lootView, containerKey(c.id), name, c.items, inventoryWeight(c.items, bags))
        : share(prev.lootView, 'floor', FLOOR_NAME, floor, inventoryWeight(floor, bags))
    const tabIds = c && !rt.nearbyContainerIds.includes(c.id) ? [...rt.nearbyContainerIds, c.id] : rt.nearbyContainerIds
    // Two containers with the same name (two canteen fridges) get a number so their tabs differ.
    const names = tabIds.map(nameOf)
    const seen = new Map<string, number>()
    const lootTabs: LootTab[] = [
      { key: 'floor', name: FLOOR_NAME, used: floorItems.length, capacity: null, inReach: true },
      ...tabIds.map((id, i) => {
        const box = rt.world.containers.get(id)!
        const n = (seen.get(names[i]) ?? 0) + 1
        seen.set(names[i], n)
        const label = names.filter((x) => x === names[i]).length > 1 ? `${names[i]} ${n}` : names[i]
        return { key: containerKey(id), name: label, used: box.items.items.length, capacity: box.items.slotCapacity, inReach: id !== c?.id || rt.lootInReach }
      }),
    ]
    const bagWeights: Record<string, number> = {}
    for (const inv of [rt.player.inventory, ...(wornLive ? [wornLive] : []), ...(lootView ? [lootView.inventory] : [])]) {
      for (const i of inv.items) if (i.kind === 'bag') bagWeights[i.id] = itemWeight(i, bags)
    }
    const a = rt.action
    set({
      open: rt.inventoryOpen,
      bag: main.inventory,
      main,
      worn,
      lootView,
      lootOpen: rt.lootOpen,
      lootInReach: rt.lootInReach,
      lootTabs: sameTabs(prev.lootTabs, lootTabs) ? prev.lootTabs : lootTabs,
      weaponInstanceId: rt.player.equipment.weaponInstanceId,
      backInstanceId: rt.player.equipment.backInstanceId,
      weightKg: main.weightKg,
      bagWeights,
      container: c && lootView ? { id: c.id, name, items: lootView.inventory } : null,
      action: a ? { id: a.id, recipeId: a.recipe.id, targetId: a.targetId, label: a.label, reservedIds: [...a.reservation.instanceIds] } : null,
    })
  },

  reset: () => set({ open: false, bag: emptyMain().inventory, main: emptyMain(), worn: null, lootView: null, lootOpen: false, lootInReach: true, lootTabs: [], weaponInstanceId: null, backInstanceId: null, weightKg: 0, bagWeights: {}, container: null, action: null }),
}))
