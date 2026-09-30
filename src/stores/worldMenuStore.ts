import { create } from 'zustand'

/**
 * AX5: the world object's context menu as the UI shows it. The runtime owns the menu (its target and
 * version, `runtime.worldMenu`) and sends its options through `interaction:menu`; this is only the
 * snapshot to draw (never a second copy of what the object allows).
 */
export interface WorldMenuView {
  targetId: string
  name: string
  options: { id: string; label: string; disabled: string | null }[]
  /** Where the right press was, in normalized device coordinates of the canvas. */
  ndc: { x: number; y: number }
}

interface WorldMenuState {
  menu: WorldMenuView | null
  show: (menu: WorldMenuView) => void
  clear: () => void
}

export const useWorldMenuStore = create<WorldMenuState>((set) => ({
  menu: null,
  show: (menu) => set({ menu }),
  clear: () => set({ menu: null }),
}))
