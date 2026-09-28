/**
 * Input manager: lưu trạng thái phím/chuột từ DOM event và được đọc trong
 * vòng cập nhật game. Không đọc DOM trực tiếp trong tick.
 */
export type ActionName =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'run'
  | 'attack'
  | 'stance'
  | 'push'
  | 'interact'
  | 'inventory'
  | 'pause'
  | 'debug'
  | 'visionDebug'
  | 'lightingDebug'
  | 'perfHud'
  | 'cancelAction'

export const KEY_BINDINGS: Record<ActionName, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  attack: ['Mouse0'],
  // CS1: hold (or toggle, settings) the right button for the combat stance.
  stance: ['Mouse2'],
  push: ['Space'],
  interact: ['KeyE'],
  inventory: ['KeyI'],
  pause: ['Escape'],
  debug: ['F3'],
  visionDebug: ['F4'],
  lightingDebug: ['F6'],
  perfHud: ['F7'],
  cancelAction: ['KeyX'],
}

/** Keys a focused UI list uses for itself (never game input while it has focus). */
const UI_NAV_CODES = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'NumpadEnter', 'Home', 'End', 'Space', 'ContextMenu'])

/** Phím cần chặn hành vi mặc định của trình duyệt (cuộn trang, ...). */
const PREVENT_DEFAULT_CODES = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3', 'F4', 'F6', 'F7'])

/**
 * `PointerEvent.buttons` bits → codes. A second button pressed while another is held fires no
 * `pointerdown` (only a `pointermove` with new `buttons`), so presses and releases come from the mask.
 */
const MOUSE_BITS: readonly (readonly [number, string])[] = [[1, 'Mouse0'], [2, 'Mouse2'], [4, 'Mouse1']]

export interface PointerState {
  /** Tọa độ chuẩn hóa -1..1 trên canvas. */
  ndcX: number
  ndcY: number
  insideCanvas: boolean
}

type EdgeListener = () => void

export class InputManager {
  private down = new Set<string>()
  private pressedThisFrame = new Set<string>()
  /** Codes that were held when each code of this frame was pressed (chords resolved between ticks). */
  private heldAtPress = new Map<string, readonly string[]>()
  private edgeListeners = new Map<ActionName, Set<EdgeListener>>()
  private clearListeners = new Set<EdgeListener>()
  private attached = false
  private canvas: HTMLElement | null = null
  /** Mouse buttons seen pressed on the canvas (bitmask like `PointerEvent.buttons`). */
  private mouseButtons = 0
  /** Buttons held since a press outside the canvas (a UI row being dragged): never world presses. */
  private uiButtons = 0

  readonly pointer: PointerState = { ndcX: 0, ndcY: 0, insideCanvas: false }

  attach(canvas: HTMLElement): void {
    if (this.attached) this.detach()
    this.canvas = canvas
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    document.addEventListener('visibilitychange', this.onVisibility)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointerdown', this.onAnyPointerDown, true)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointercancel', this.onPointerCancel)
    canvas.addEventListener('lostpointercapture', this.onLostCapture)
    canvas.addEventListener('pointerleave', this.onPointerLeave)
    this.attached = true
  }

  detach(): void {
    if (!this.attached) return
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.canvas?.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointerdown', this.onAnyPointerDown, true)
    this.uiButtons = 0
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointercancel', this.onPointerCancel)
    this.canvas?.removeEventListener('lostpointercapture', this.onLostCapture)
    this.canvas?.removeEventListener('pointerleave', this.onPointerLeave)
    this.canvas = null
    this.attached = false
    this.clear()
  }

  /**
   * Xóa mọi phím đang giữ (khi tab mất focus, pause, đổi màn hình). Listeners (the runtime's stance
   * and queued attack) reset with it, so nothing held before the reset acts afterwards.
   */
  clear(): void {
    this.down.clear()
    this.pressedThisFrame.clear()
    this.heldAtPress.clear()
    this.mouseButtons = 0
    for (const fn of this.clearListeners) fn()
  }

  /** Called after every `clear()`. */
  onClear(fn: EdgeListener): () => void {
    this.clearListeners.add(fn)
    return () => {
      this.clearListeners.delete(fn)
    }
  }

  /** Đăng ký hành động cạnh lên (edge) dùng cho UI: pause, inventory, debug. */
  onAction(action: ActionName, fn: EdgeListener): () => void {
    let set = this.edgeListeners.get(action)
    if (!set) {
      set = new Set()
      this.edgeListeners.set(action, set)
    }
    set.add(fn)
    return () => {
      set.delete(fn)
    }
  }

  isDown(action: ActionName): boolean {
    for (const code of KEY_BINDINGS[action]) {
      if (this.down.has(code)) return true
    }
    return false
  }

  /** Đúng một lần cho mỗi lần nhấn, được xóa ở cuối tick. */
  wasPressed(action: ActionName): boolean {
    for (const code of KEY_BINDINGS[action]) {
      if (this.pressedThisFrame.has(code)) return true
    }
    return false
  }

  /**
   * `action` was pressed this frame while `other` was held at that moment, even if `other` has been
   * released since (a right-button release in the same frame as the left click keeps the chord).
   */
  wasPressedWhileHeld(action: ActionName, other: ActionName): boolean {
    for (const code of KEY_BINDINGS[action]) {
      const held = this.heldAtPress.get(code)
      if (held && this.pressedThisFrame.has(code) && KEY_BINDINGS[other].some((o) => held.includes(o))) return true
    }
    return false
  }

  /** Gọi ở cuối mỗi tick simulation. */
  endFrame(): void {
    this.pressedThisFrame.clear()
    this.heldAtPress.clear()
  }

  /** Mô phỏng nhấn phím (dùng cho test). */
  simulateKey(code: string, isDown: boolean): void {
    if (isDown) this.press(code)
    else this.down.delete(code)
  }

  private press(code: string): void {
    if (!this.down.has(code)) {
      this.heldAtPress.set(code, [...this.down])
      this.down.add(code)
      this.pressedThisFrame.add(code)
      this.dispatchEdge(code)
    }
  }

  private dispatchEdge(code: string): void {
    for (const [action, codes] of Object.entries(KEY_BINDINGS) as [ActionName, string[]][]) {
      if (!codes.includes(code)) continue
      const set = this.edgeListeners.get(action)
      if (!set) continue
      for (const fn of set) fn()
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // Text fields (character name, settings) keep every key, including Space and arrows, and never
    // drive the game; nor do keys composing text with an IME.
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
    if (e.isComposing) return
    // INV-LOOT: a focused item table or menu keeps its navigation keys and shortcuts (Ctrl+A is not
    // "walk left"); WASD and the other game keys still work while it has focus.
    if (target?.closest?.('[data-ui-keys]') && (UI_NAV_CODES.has(e.code) || e.ctrlKey || e.metaKey)) return
    if (PREVENT_DEFAULT_CODES.has(e.code)) e.preventDefault()
    if (e.repeat) return
    this.press(e.code)
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code)
  }

  private onBlur = (): void => {
    this.clear()
  }

  private onVisibility = (): void => {
    if (document.hidden) this.clear()
  }

  /**
   * Presses and releases from the `buttons` mask. Presses count only for events on the canvas (a
   * click on a UI panel never reaches the world); releases count anywhere, so a button let go
   * outside the canvas never sticks.
   */
  private syncButtons(buttons: number, onCanvas: boolean): void {
    for (const [bit, code] of MOUSE_BITS) {
      const was = (this.mouseButtons & bit) !== 0
      const now = (buttons & bit) !== 0
      if (now && !was && onCanvas) {
        this.mouseButtons |= bit
        this.press(code)
      } else if (!now && was) {
        this.mouseButtons &= ~bit
        this.down.delete(code)
      }
    }
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.updatePointer(e)
    // Keep the moves and the release while the button is held outside the canvas.
    try {
      this.canvas?.setPointerCapture(e.pointerId)
    } catch {
      // Synthetic or already-released pointer: the window listeners still see the release.
    }
    // `button` is the one that changed; `buttons` is every button now held (not the same numbering).
    this.syncButtons(e.buttons | buttonBit(e.button), true)
  }

  private onPointerUp = (e: PointerEvent): void => {
    const held = e.buttons & ~buttonBit(e.button)
    this.uiButtons &= held
    this.syncButtons(held, false)
  }

  private onPointerMove = (e: PointerEvent): void => {
    const onCanvas = e.target === this.canvas
    if (onCanvas) this.updatePointer(e)
    // A new bit in a move is a chord (or held buttons found again after a lost capture); a button
    // held since a press on the UI (a row dragged across the world) is never one (INV-LOOT S6, T23).
    this.uiButtons &= e.buttons
    this.syncButtons(e.buttons & ~this.uiButtons, onCanvas)
  }

  /** Any press anywhere (capture phase): the buttons pressed outside the canvas are the UI's. */
  private onAnyPointerDown = (e: PointerEvent): void => {
    if (e.target !== this.canvas) this.uiButtons |= e.buttons | buttonBit(e.button)
  }

  /** The browser took the pointer away (gesture, dialog…): release everything and reset intents. */
  private onPointerCancel = (): void => {
    this.clear()
  }

  private onLostCapture = (): void => {
    // A normal release loses the capture too, after `pointerup` (nothing held then).
    if (this.mouseButtons !== 0) this.clear()
  }

  private onPointerLeave = (): void => {
    this.pointer.insideCanvas = false
  }

  private updatePointer(e: PointerEvent): void {
    if (!this.canvas) return
    const rect = this.canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    // Captured moves outside the canvas keep the last aim instead of mapping off-screen points.
    if (x < 0 || x > 1 || y < 0 || y > 1) {
      this.pointer.insideCanvas = false
      return
    }
    this.pointer.ndcX = x * 2 - 1
    this.pointer.ndcY = -(y * 2 - 1)
    this.pointer.insideCanvas = true
  }
}

/** `PointerEvent.button` (0 left, 1 middle, 2 right) → its `buttons` bit (1 left, 4 middle, 2 right). */
function buttonBit(button: number): number {
  return button === 0 ? 1 : button === 1 ? 4 : button === 2 ? 2 : 0
}
