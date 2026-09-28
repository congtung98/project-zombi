import { create } from 'zustand'
import type { Rect, WindowId } from '../components/inventory/layout'
import { DEFAULT_QUERY, type CategoryFilter, type SortState } from '../components/inventory/rows'
import { EMPTY_SELECTION, type Selection } from '../components/inventory/selection'
import type { InventoryKey } from '../game/systems/inventoryCommands'

/** The two table windows (crafting has no table). */
export type PanelId = 'inventory' | 'loot'

export interface WindowState {
  /** null = the default layout for the current viewport and HUD. */
  rect: Rect | null
  /** Pinned = stays open when the pointer leaves; unpinned windows collapse after a short delay. */
  pinned: boolean
  /** Collapsed to the title bar by the player. */
  collapsed: boolean
}

export interface TableState {
  /** The inventory shown (main / worn bag, or the container), by key, never by tab index. */
  activeKey: InventoryKey | null
  search: string
  category: CategoryFilter
  sort: SortState
  expanded: string[]
  selection: Selection
}

export type Popup =
  | { kind: 'menu'; panel: PanelId; source: InventoryKey; instanceIds: string[]; x: number; y: number }
  | { kind: 'inspect'; panel: PanelId; source: InventoryKey; instanceId: string; x: number; y: number }
  /** INV-LOOT S4: how many of a stack to move (Shift+drag or the menu), checked again when it moves. */
  | { kind: 'quantity'; panel: PanelId; source: InventoryKey; instanceId: string; destination: InventoryKey; x: number; y: number }
  | null

/** Rows being dragged to another window or tab (their instances resolved when the drag started). */
export interface DragState {
  source: InventoryKey
  instanceIds: string[]
  x: number
  y: number
  /** The drop target under the pointer (a list or a tab of another inventory), for its highlight. */
  target: InventoryKey | null
}

export interface Hover {
  source: InventoryKey
  instanceIds: string[]
  x: number
  y: number
}

interface InventoryUiState {
  windows: Record<WindowId, WindowState>
  /** Z-order, last on top. */
  order: WindowId[]
  focused: WindowId | null
  craftingOpen: boolean
  tables: Record<PanelId, TableState>
  popup: Popup
  hover: Hover | null
  drag: DragState | null
  /** Compact mode (one window): which panel is shown. */
  compactTab: PanelId
  /**
   * INV-LOOT S5: the player is in the combat stance. Every window collapses to its title bar while it
   * lasts (pinned ones too, like PZ); pinned windows come back when it ends, unpinned ones stay
   * collapsed until the pointer comes back over them.
   */
  stance: boolean
  setRect: (id: WindowId, rect: Rect) => void
  togglePin: (id: WindowId) => void
  setCollapsed: (id: WindowId, collapsed: boolean) => void
  focus: (id: WindowId) => void
  setCraftingOpen: (open: boolean) => void
  patchTable: (panel: PanelId, patch: Partial<TableState>) => void
  openPopup: (popup: Popup) => void
  closePopup: () => boolean
  setHover: (hover: Hover | null) => void
  setDrag: (drag: DragState | null) => void
  setCompactTab: (tab: PanelId) => void
  setStance: (active: boolean) => void
  /**
   * New Game, load or back to the menu: nothing of the previous world stays referenced (selection,
   * menu, hover card, drag, loot tab), INV-LOOT T22. Layout preferences and sort/filter stay.
   */
  resetSession: () => void
  resetLayout: () => void
}

const STORAGE_KEY = 'zombie-outbreak.inventory-layout.v1'
const WINDOW_IDS: WindowId[] = ['inventory', 'loot', 'crafting']
/** New players get pinned windows: nothing disappears on its own until they choose so. */
const DEFAULT_WINDOW: WindowState = { rect: null, pinned: true, collapsed: false }

function defaultWindows(): Record<WindowId, WindowState> {
  return { inventory: { ...DEFAULT_WINDOW }, loot: { ...DEFAULT_WINDOW }, crafting: { ...DEFAULT_WINDOW } }
}

function isRect(v: unknown): v is Rect {
  const r = v as Rect
  return !!r && [r.x, r.y, r.w, r.h].every((n) => typeof n === 'number' && Number.isFinite(n))
}

/** Layout preferences are per browser (localStorage), never part of a save game; bad data = defaults. */
function loadWindows(): Record<WindowId, WindowState> {
  const windows = defaultWindows()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return windows
    const parsed = JSON.parse(raw) as Partial<Record<WindowId, Partial<WindowState>>>
    for (const id of WINDOW_IDS) {
      const w = parsed[id]
      if (!w) continue
      windows[id] = { rect: isRect(w.rect) ? w.rect : null, pinned: w.pinned !== false, collapsed: w.collapsed === true }
    }
  } catch {
    // Storage blocked or corrupt: defaults.
  }
  return windows
}

function saveWindows(windows: Record<WindowId, WindowState>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(windows))
  } catch {
    // Storage blocked: the layout just is not remembered.
  }
}

function emptyTable(): TableState {
  return { activeKey: null, search: '', category: 'all', sort: DEFAULT_QUERY.sort, expanded: [], selection: EMPTY_SELECTION }
}

export const useInventoryUiStore = create<InventoryUiState>((set, get) => ({
  windows: loadWindows(),
  order: ['crafting', 'inventory', 'loot'],
  focused: null,
  craftingOpen: false,
  tables: { inventory: { ...emptyTable(), activeKey: 'main' }, loot: emptyTable() },
  popup: null,
  hover: null,
  drag: null,
  compactTab: 'inventory',
  stance: false,

  setRect: (id, rect) => {
    const windows = { ...get().windows, [id]: { ...get().windows[id], rect } }
    saveWindows(windows)
    set({ windows })
  },
  togglePin: (id) => {
    const w = get().windows[id]
    const windows = { ...get().windows, [id]: { ...w, pinned: !w.pinned } }
    saveWindows(windows)
    set({ windows })
  },
  setCollapsed: (id, collapsed) => {
    const windows = { ...get().windows, [id]: { ...get().windows[id], collapsed } }
    saveWindows(windows)
    set({ windows })
  },
  focus: (id) => {
    const { order, focused } = get()
    if (focused === id && order[order.length - 1] === id) return
    set({ focused: id, order: [...order.filter((w) => w !== id), id] })
  },
  setCraftingOpen: (craftingOpen) => set({ craftingOpen, ...(craftingOpen ? {} : { focused: get().focused === 'crafting' ? null : get().focused }) }),
  patchTable: (panel, patch) => set({ tables: { ...get().tables, [panel]: { ...get().tables[panel], ...patch } } }),
  openPopup: (popup) => set({ popup, hover: null }),
  /** Close the open popup; true if there was one (Escape handles one layer per press). */
  closePopup: () => {
    if (!get().popup) return false
    set({ popup: null })
    return true
  },
  setHover: (hover) => {
    const prev = get().hover
    if (prev === hover || (prev && hover && prev.x === hover.x && prev.y === hover.y && prev.instanceIds.join() === hover.instanceIds.join())) return
    set({ hover })
  },
  setDrag: (drag) => set({ drag, ...(drag ? { hover: null } : {}) }),
  setCompactTab: (compactTab) => set({ compactTab }),
  // Entering the stance closes what would float over the aim (menu, hover card, a drag in progress).
  setStance: (stance) => {
    if (get().stance === stance) return
    set(stance ? { stance, popup: null, hover: null, drag: null } : { stance })
  },
  resetSession: () => {
    const { tables } = get()
    set({
      popup: null, hover: null, drag: null, stance: false, compactTab: 'inventory',
      tables: {
        inventory: { ...tables.inventory, activeKey: 'main', expanded: [], selection: EMPTY_SELECTION },
        loot: { ...tables.loot, activeKey: null, expanded: [], selection: EMPTY_SELECTION },
      },
    })
  },
  resetLayout: () => {
    const windows = defaultWindows()
    saveWindows(windows)
    set({ windows })
  },
}))
