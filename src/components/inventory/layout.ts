/**
 * INV-LOOT window geometry in UI pixels (screen pixels divided by the UI scale). Pure, so defaults,
 * clamping and the compact decision are tested without a browser.
 */
export type WindowId = 'inventory' | 'loot' | 'crafting'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface View {
  w: number
  h: number
}

/** Space the HUD really uses at each side, measured from its elements (never hard-coded corners). */
export interface SafeArea {
  top: number
  left: number
  right: number
  bottom: number
  /** Bottom edge of the top-right HUD box (clock), the loot window starts below it. */
  topRight: number
  /** Top edge of the bottom-left HUD box (stats), windows on the left end above it. */
  bottomLeft: number
}

export const MIN_W = 340
export const MIN_H = 220
export const DEFAULT_W = 480
export const DEFAULT_H = 360
export const GAP = 16
export const TITLE_H = 30
/** Part of the title bar that must stay on screen so the window can always be dragged back. */
export const GRIP = 96

export const NO_SAFE_AREA: SafeArea = { top: 0, left: 0, right: 0, bottom: 0, topRight: 0, bottomLeft: Infinity }

/** Tallest a window may be: it never covers the whole game. */
export function maxHeight(view: View): number {
  return Math.max(MIN_H, Math.floor(view.h * 0.75))
}

/** Too narrow for two windows side by side: one window with Inventory / Loot tabs. */
export function isCompact(view: View): boolean {
  return view.w < 2 * MIN_W + 3 * GAP
}

/** Size within [min, max] and a position that keeps a grip of the title bar on screen. */
export function clampRect(r: Rect, view: View): Rect {
  const w = Math.round(Math.min(Math.max(r.w, MIN_W), Math.max(MIN_W, view.w - 2 * 8)))
  const h = Math.round(Math.min(Math.max(r.h, MIN_H), maxHeight(view)))
  const x = Math.round(Math.min(Math.max(r.x, GRIP - w), view.w - GRIP))
  const y = Math.round(Math.min(Math.max(r.y, 0), view.h - TITLE_H))
  return { x, y, w, h }
}

/**
 * Default layout: Inventory top-left, Loot top-right below the clock, Crafting under Inventory;
 * about 480×360 at 1920×1080, narrower when two do not fit, never taller than the space above the
 * bottom-left HUD.
 */
export function defaultLayout(view: View, safe: SafeArea = NO_SAFE_AREA): Record<WindowId | 'compact', Rect> {
  const w = Math.max(MIN_W, Math.min(DEFAULT_W, Math.floor((view.w - safe.left - safe.right - 3 * GAP) / 2)))
  const top = safe.top + GAP
  const leftRoom = Math.min(view.h - safe.bottom, safe.bottomLeft) - GAP - top
  const h = Math.max(MIN_H, Math.min(DEFAULT_H, maxHeight(view), Math.floor(leftRoom)))
  const inventory = clampRect({ x: safe.left + GAP, y: top, w, h }, view)
  const lootTop = Math.max(top, safe.topRight + GAP)
  const loot = clampRect({ x: view.w - safe.right - GAP - w, y: lootTop, w, h: Math.min(h, view.h - safe.bottom - GAP - lootTop) }, view)
  const craftTop = inventory.y + inventory.h + GAP
  const craftRoom = Math.min(view.h - safe.bottom, safe.bottomLeft) - GAP - craftTop
  const crafting = craftRoom >= MIN_H
    ? clampRect({ x: inventory.x, y: craftTop, w: MIN_W, h: Math.min(320, craftRoom) }, view)
    : clampRect({ x: Math.round((view.w - MIN_W) / 2), y: top, w: MIN_W, h: 320 }, view)
  // Compact (one window, tabs): the full width between the clock above and the stats below.
  const compactTop = Math.max(top, safe.topRight + GAP)
  const compactRoom = Math.min(view.h - safe.bottom, safe.bottomLeft) - GAP - compactTop
  const compact = clampRect({ x: safe.left + GAP, y: compactTop, w: view.w - safe.left - safe.right - 2 * GAP, h: Math.min(DEFAULT_H, compactRoom) }, view)
  return { inventory, loot, crafting, compact }
}
