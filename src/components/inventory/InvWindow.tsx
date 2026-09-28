import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { clampRect, TITLE_H, type Rect, type View, type WindowId } from './layout'
import { useInventoryUiStore } from '../../stores/inventoryUiStore'
import { Glyph } from './ItemIcon'
import { L } from './labels'

/**
 * Unpinned windows collapse this long after the pointer and focus left them (INV-LOOT S5: long
 * enough to pass by and come back, like PZ), or at once when the player presses on the game world.
 */
export const AUTO_COLLAPSE_MS = 1500

interface Props {
  id: WindowId
  title: ReactNode
  /** Accessible name. */
  label: string
  view: View
  scale: number
  defaultRect: Rect
  onClose: () => void
  /** Extra title bar buttons (left of pin/collapse/close). */
  tools?: ReactNode
  children: ReactNode
}

type Gesture = { kind: 'move' | 'resize'; startX: number; startY: number; from: Rect; pointerId: number }

/**
 * A floating tool window: drag by the title bar, resize from the corner, pin, collapse, close. The
 * position is clamped so a grip of the title bar always stays on screen (also after a viewport or UI
 * scale change); the rect is stored only when a gesture ends.
 */
export function InvWindow({ id, title, label, view, scale, defaultRect, onClose, tools, children }: Props) {
  const state = useInventoryUiStore((s) => s.windows[id])
  const z = useInventoryUiStore((s) => s.order.indexOf(id))
  // A menu or inspect card open from any window keeps every window as it is (it lives in a portal).
  const hasPopup = useInventoryUiStore((s) => s.popup !== null)
  // INV-LOOT S5: the combat stance collapses every window (pinned too) while it lasts.
  const stance = useInventoryUiStore((s) => s.stance)
  const { setRect, togglePin, setCollapsed, focus } = useInventoryUiStore.getState()
  const [live, setLive] = useState<Rect | null>(null)
  const [autoCollapsed, setAutoCollapsed] = useState(false)
  const gesture = useRef<Gesture | null>(null)
  const timer = useRef<number | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const rect = clampRect(live ?? state.rect ?? defaultRect, view)
  const collapsed = state.collapsed || stance || (!state.pinned && autoCollapsed)

  const cancelTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => cancelTimer, [])

  // An unpinned window leaves the stance collapsed (it opens again under the pointer); a pinned one
  // comes back by itself.
  const pinned = state.pinned
  useEffect(() => useInventoryUiStore.subscribe((s, prev) => {
    if (!s.stance || prev.stance) return
    cancelTimer()
    if (!pinned) setAutoCollapsed(true)
  }), [pinned])

  // A press on the game world (the canvas) collapses an open unpinned window at once.
  const open = !state.pinned && !state.collapsed && !autoCollapsed
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof HTMLCanvasElement)) return
      cancelTimer()
      setAutoCollapsed(true)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [open])

  const expand = () => {
    cancelTimer()
    // Passing over a window while aiming never opens it.
    if (!useInventoryUiStore.getState().stance) setAutoCollapsed(false)
  }

  const scheduleCollapse = () => {
    cancelTimer()
    // Not while an item is dragged out of it (the rows being carried stay in view).
    if (state.pinned || gesture.current || hasPopup || useInventoryUiStore.getState().drag) return
    timer.current = window.setTimeout(() => {
      timer.current = null
      // Typing in the search field or working the table keeps it open; a title bar button that kept
      // the focus after a click does not.
      if (!root.current?.querySelector('.inv-window-body')?.contains(document.activeElement)) setAutoCollapsed(true)
    }, AUTO_COLLAPSE_MS)
  }

  const start = (kind: Gesture['kind']) => (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, select')) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    gesture.current = { kind, startX: e.clientX, startY: e.clientY, from: rect, pointerId: e.pointerId }
    focus(id)
  }
  const move = (e: ReactPointerEvent) => {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    const dx = (e.clientX - g.startX) / scale
    const dy = (e.clientY - g.startY) / scale
    setLive(g.kind === 'move' ? { ...g.from, x: g.from.x + dx, y: g.from.y + dy } : { ...g.from, w: g.from.w + dx, h: g.from.h + dy })
  }
  const end = (e: ReactPointerEvent) => {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    gesture.current = null
    if (live) setRect(id, clampRect(live, view))
    setLive(null)
  }

  return (
    <div
      ref={root}
      className={`inv-window${collapsed ? ' inv-window-collapsed' : ''}`}
      data-inv-window={id}
      role="dialog"
      aria-label={label}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: collapsed ? TITLE_H : rect.h, zIndex: 10 + Math.max(0, z) }}
      onPointerDownCapture={() => focus(id)}
      onPointerEnter={expand}
      onPointerLeave={scheduleCollapse}
      onFocusCapture={expand}
      onBlurCapture={() => {
        if (!state.pinned) scheduleCollapse()
      }}
    >
      <div className="inv-titlebar" style={{ height: TITLE_H }} onPointerDown={start('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <div className="inv-title">{title}</div>
        <div className="inv-title-tools">
          {tools}
          <button type="button" className="inv-tool" title={state.pinned ? L.unpin : L.pin} aria-pressed={state.pinned} onClick={() => {
              setAutoCollapsed(false)
              togglePin(id)
            }}>
            <Glyph name={state.pinned ? 'pinned' : 'pin'} />
          </button>
          <button type="button" className="inv-tool" title={state.collapsed ? L.expand : L.collapse} aria-expanded={!state.collapsed} onClick={() => setCollapsed(id, !state.collapsed)}>
            <Glyph name={state.collapsed ? 'expand' : 'collapse'} />
          </button>
          <button type="button" className="inv-tool" title={L.close} onClick={onClose}>
            <Glyph name="close" />
          </button>
        </div>
      </div>
      {!collapsed && (
        <>
          <div className="inv-window-body">{children}</div>
          <div className="inv-resize" aria-hidden onPointerDown={start('resize')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
        </>
      )}
    </div>
  )
}
