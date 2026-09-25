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

/** Phím cần chặn hành vi mặc định của trình duyệt (cuộn trang, ...). */
const PREVENT_DEFAULT_CODES = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3', 'F4', 'F6', 'F7'])

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
  private edgeListeners = new Map<ActionName, Set<EdgeListener>>()
  private attached = false
  private canvas: HTMLElement | null = null

  readonly pointer: PointerState = { ndcX: 0, ndcY: 0, insideCanvas: false }

  attach(canvas: HTMLElement): void {
    if (this.attached) this.detach()
    this.canvas = canvas
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerleave', this.onPointerLeave)
    this.attached = true
  }

  detach(): void {
    if (!this.attached) return
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.canvas?.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointerup', this.onPointerUp)
    this.canvas?.removeEventListener('pointermove', this.onPointerMove)
    this.canvas?.removeEventListener('pointerleave', this.onPointerLeave)
    this.canvas = null
    this.attached = false
    this.clear()
  }

  /** Xóa mọi phím đang giữ (khi tab mất focus, pause, đổi màn hình). */
  clear(): void {
    this.down.clear()
    this.pressedThisFrame.clear()
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

  /** Gọi ở cuối mỗi tick simulation. */
  endFrame(): void {
    this.pressedThisFrame.clear()
  }

  /** Mô phỏng nhấn phím (dùng cho test). */
  simulateKey(code: string, isDown: boolean): void {
    if (isDown) this.press(code)
    else this.down.delete(code)
  }

  private press(code: string): void {
    if (!this.down.has(code)) {
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
    // Text fields (character name) keep every key, including Space and arrows, and never drive the game.
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
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

  private onPointerDown = (e: PointerEvent): void => {
    this.updatePointer(e)
    this.press('Mouse' + e.button)
  }

  private onPointerUp = (e: PointerEvent): void => {
    this.down.delete('Mouse' + e.button)
  }

  private onPointerMove = (e: PointerEvent): void => {
    this.updatePointer(e)
  }

  private onPointerLeave = (): void => {
    this.pointer.insideCanvas = false
  }

  private updatePointer(e: PointerEvent): void {
    if (!this.canvas) return
    const rect = this.canvas.getBoundingClientRect()
    this.pointer.ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1)
    this.pointer.insideCanvas = true
  }
}
