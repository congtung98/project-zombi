import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { runtime } from '../game/core/runtime'
import { useWorldMenuStore } from '../stores/worldMenuStore'
import { useSettingsStore } from '../stores/settingsStore'
import { newRequestId } from './inventory/commands'

/**
 * AX5 (WIS §10, FB §1): the right-click menu of a world object, next to the pointer and kept inside
 * the viewport. Entries are the object's options from its provider; a disabled one says why. A click
 * (or Enter) sends the option with a new request ID; the runtime checks it again on the object's
 * state now. Arrows move, Esc closes (the game's Esc layers), a press on the world closes it.
 */
export function WorldContextMenu() {
  const menu = useWorldMenuStore((s) => s.menu)
  const scale = useSettingsStore((s) => s.uiScale)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: -9999, top: -9999 })

  useLayoutEffect(() => {
    const el = ref.current
    const canvas = document.querySelector('canvas')
    if (!el || !menu || !canvas) return
    const r = canvas.getBoundingClientRect()
    // Pointer position in the (scaled) UI layer's pixels.
    const x = ((menu.ndc.x + 1) / 2 * r.width + r.left) / scale
    const y = ((1 - menu.ndc.y) / 2 * r.height + r.top) / scale
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = window.innerWidth / scale
    const vh = window.innerHeight / scale
    const left = x + 4 + w > vw - 4 ? Math.max(4, x - 4 - w) : x + 4
    const top = y + 4 + h > vh - 4 ? Math.max(4, vh - 4 - h) : y + 4
    setPos((p) => (p.left === left && p.top === top ? p : { left, top }))
  }, [menu, scale])

  // Keyboard focus on the first entry when a menu opens (not again when its options refresh).
  const targetId = menu?.targetId ?? null
  useEffect(() => {
    if (targetId) ref.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()
  }, [targetId])

  // The runtime owns the menu: a New Game or a load dropped it even if no close event was drawn.
  if (!menu || runtime.worldMenu?.targetId !== menu.targetId) return null

  const onKeyDown = (e: KeyboardEvent) => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown') buttons[(i + 1) % buttons.length]?.focus()
    else if (e.key === 'ArrowUp') buttons[(i - 1 + buttons.length) % buttons.length]?.focus()
    else return
    e.preventDefault()
  }

  return (
    <div className="inv-layer" style={{ transform: `scale(${scale})`, width: `${100 / scale}vw`, height: `${100 / scale}vh` }} onContextMenu={(e) => e.preventDefault()}>
      <div ref={ref} className="inv-menu world-menu" role="menu" aria-label={menu.name} data-ui-keys data-world-menu style={pos} onKeyDown={onKeyDown}>
        <div className="world-menu-title">{menu.name}</div>
        {menu.options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="menuitem"
            className="inv-menu-item"
            data-option={o.id}
            disabled={o.disabled !== null}
            title={o.disabled ?? undefined}
            onClick={() => runtime.selectMenuOption(o.id, newRequestId())}
          >
            <span>{o.label}</span>
            {o.disabled && <small className="inv-menu-reason">{o.disabled}</small>}
          </button>
        ))}
        {menu.options.length === 0 && <div className="inv-menu-item" aria-disabled>Không có thao tác</div>}
      </div>
    </div>
  )
}
