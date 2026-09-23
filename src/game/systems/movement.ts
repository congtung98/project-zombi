import { GAME_CONFIG } from '../core/config'
import type { PlayerState } from '../entities/player'
import type { Vec2, Vec3 } from '../../types'

export interface CameraBasis {
  /** Hướng "lên màn hình" chiếu xuống mặt phẳng XZ. */
  forward: Vec2
  /** Hướng "phải màn hình" chiếu xuống mặt phẳng XZ. */
  right: Vec2
}

/**
 * Tính hệ trục di chuyển từ offset camera để W luôn đi "lên màn hình"
 * bất kể góc isometric được chọn.
 */
export function computeCameraBasis(offset: Vec3): CameraBasis {
  const len = Math.hypot(offset.x, offset.z) || 1
  const forward = { x: -offset.x / len, z: -offset.z / len }
  const right = { x: -forward.z, z: forward.x }
  return { forward, right }
}

export interface MoveKeys {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
}

/** Vector di chuyển chuẩn hóa trên mặt phẳng XZ; đi chéo không nhanh hơn. */
export function computeMoveDirection(keys: MoveKeys, basis: CameraBasis): Vec2 {
  let fwd = 0
  let side = 0
  if (keys.forward) fwd += 1
  if (keys.back) fwd -= 1
  if (keys.right) side += 1
  if (keys.left) side -= 1
  const x = basis.forward.x * fwd + basis.right.x * side
  const z = basis.forward.z * fwd + basis.right.z * side
  const len = Math.hypot(x, z)
  if (len < 1e-6) return { x: 0, z: 0 }
  return { x: x / len, z: z / len }
}

export interface SpeedResult {
  speed: number
  running: boolean
}

/**
 * Quyết định tốc độ và cập nhật stamina cho chuyển động của người chơi.
 * Chạy tiêu stamina; hồi khi ngừng chạy sau một khoảng chờ.
 */
export function resolvePlayerSpeed(
  player: PlayerState,
  wantsRun: boolean,
  moving: boolean,
  dt: number,
  cfg = GAME_CONFIG.player,
): SpeedResult {
  if (!player.alive) {
    player.isRunning = false
    return { speed: 0, running: false }
  }

  const canStartRun = player.stamina >= cfg.minStaminaToRun
  const canContinueRun = player.stamina > 0
  const running = moving && wantsRun && (player.isRunning ? canContinueRun : canStartRun)

  if (running) {
    player.stamina = Math.max(0, player.stamina - cfg.sprintStaminaPerSec * dt)
    player.staminaRegenTimer = cfg.staminaRegenDelay
  }
  player.isRunning = running

  return { speed: moving ? (running ? cfg.runSpeed : cfg.walkSpeed) : 0, running }
}

/** Hồi stamina theo thời gian khi không tiêu hao. Gọi ở bước survival của tick. */
export function regenStamina(player: PlayerState, dt: number, cfg = GAME_CONFIG.player): void {
  if (player.staminaRegenTimer > 0) {
    player.staminaRegenTimer = Math.max(0, player.staminaRegenTimer - dt)
    return
  }
  player.stamina = Math.min(cfg.maxStamina, player.stamina + cfg.staminaRegenPerSec * dt)
}

/** Xoay góc mượt theo đường ngắn nhất, không phụ thuộc FPS. */
export function dampAngle(current: number, target: number, smoothing: number, dt: number): number {
  let diff = target - current
  diff = Math.atan2(Math.sin(diff), Math.cos(diff))
  const t = 1 - Math.exp(-smoothing * dt)
  return current + diff * t
}
