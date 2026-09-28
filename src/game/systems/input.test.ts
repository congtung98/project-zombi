import { describe, expect, it } from 'vitest'
import { InputManager } from './input'

/** Drive the manager's DOM handlers directly (no DOM in the test environment). */
function setup() {
  const input = new InputManager()
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), setPointerCapture: () => {} }
  const raw = input as unknown as Record<string, (e: Partial<PointerEvent>) => void> & { canvas: unknown }
  raw.canvas = canvas
  const ev = (target: unknown, buttons: number, button = 0) => ({ target, buttons, button, pointerId: 1, clientX: 50, clientY: 50 }) as unknown as Partial<PointerEvent>
  return { input, canvas, raw, ev }
}

describe('input: mouse presses come from the canvas only (INV-LOOT S6, T23)', () => {
  it('a button pressed on the UI and dragged over the canvas is never a world press', () => {
    const { input, canvas, raw, ev } = setup()
    // Pressed on a row (no canvas pointerdown), then carried across the world.
    raw.onAnyPointerDown(ev({ tagName: 'DIV' }, 1, 0))
    raw.onPointerMove(ev(canvas, 1))
    raw.onPointerMove(ev(canvas, 1))
    expect(input.wasPressed('attack')).toBe(false)
    expect(input.isDown('attack')).toBe(false)
    // Released over the canvas: still nothing, and the next real click counts.
    raw.onPointerUp(ev(canvas, 0, 0))
    raw.onAnyPointerDown(ev(canvas, 1, 0))
    raw.onPointerDown(ev(canvas, 1, 0))
    expect(input.wasPressed('attack')).toBe(true)
  })

  it('after a lost capture the buttons still held on the canvas are found again from the next move', () => {
    const { input, canvas, raw, ev } = setup()
    raw.onAnyPointerDown(ev(canvas, 2, 2))
    raw.onPointerDown(ev(canvas, 2, 2))
    raw.onLostCapture(ev(canvas, 2))
    expect(input.isDown('stance')).toBe(false)
    input.endFrame()
    // Chrome reports the chorded left press as a move with both bits.
    raw.onPointerMove(ev(canvas, 3))
    expect(input.isDown('stance')).toBe(true)
    expect(input.wasPressed('attack')).toBe(true)
  })

  it('a second button pressed while one pressed on the canvas is held is a chord (only a move reports it)', () => {
    const { input, canvas, raw, ev } = setup()
    raw.onAnyPointerDown(ev(canvas, 2, 2))
    raw.onPointerDown(ev(canvas, 2, 2))
    expect(input.isDown('stance')).toBe(true)
    input.endFrame()
    raw.onPointerMove(ev(canvas, 3))
    expect(input.wasPressed('attack')).toBe(true)
    expect(input.wasPressedWhileHeld('attack', 'stance')).toBe(true)
    raw.onPointerUp(ev(canvas, 0, 2))
    expect(input.isDown('attack')).toBe(false)
    expect(input.isDown('stance')).toBe(false)
  })
})
