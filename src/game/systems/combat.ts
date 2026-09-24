import { GAME_CONFIG } from '../core/config'
import type { PlayerState } from '../entities/player'
import type { MeleeStats } from '../entities/items'
import type { Vec3 } from '../../types'

export interface MeleeTarget {
  id: string
  position: Vec3
  radius: number
  alive: boolean
}

export interface ConeFilter {
  range: number
  halfAngleDeg: number
}

/**
 * Chọn các mục tiêu trúng đòn: còn sống, trong tầm (tính tới mép), nằm trong
 * hình quạt theo hướng nhìn (dot product) và không bị tường che (`isBlocked`,
 * thường là raycast physics). Mỗi mục tiêu xuất hiện tối đa một lần.
 */
export function resolveConeHits<T extends MeleeTarget>(
  origin: Vec3,
  facing: number,
  targets: Iterable<T>,
  filter: ConeFilter,
  isBlocked: (target: T) => boolean = () => false,
): T[] {
  const fx = Math.sin(facing)
  const fz = Math.cos(facing)
  const minDot = Math.cos((filter.halfAngleDeg * Math.PI) / 180)
  const hits: T[] = []
  const seen = new Set<string>()
  for (const t of targets) {
    if (!t.alive || seen.has(t.id)) continue
    const dx = t.position.x - origin.x
    const dz = t.position.z - origin.z
    const dist = Math.hypot(dx, dz)
    if (dist - t.radius > filter.range) continue
    const dot = dist > 1e-4 ? (dx * fx + dz * fz) / dist : 1
    if (dot < minDot) continue
    if (isBlocked(t)) continue
    seen.add(t.id)
    hits.push(t)
  }
  return hits
}

/**
 * Bắt đầu một cú vung nếu đủ điều kiện (còn sống, hết cooldown, đủ stamina) với
 * cooldown/stamina của vũ khí. Trừ stamina ngay, cấp attackId mới và mở cửa sổ
 * trúng đòn chờ `hitDelay` (dùng chung mọi melee).
 */
export function startAttack(
  player: PlayerState,
  stats: Pick<MeleeStats, 'cooldown' | 'stamina'> = GAME_CONFIG.melee,
  limits = GAME_CONFIG.player,
  weaponId: string | null = null,
): boolean {
  if (!player.alive || player.attackCooldown > 0 || player.stamina < stats.stamina) return false
  player.stamina = Math.max(0, player.stamina - stats.stamina)
  player.staminaRegenTimer = limits.staminaRegenDelay
  player.attackCooldown = stats.cooldown
  player.attackTimer = 0
  player.attackHitPending = true
  player.attackId += 1
  player.attackWeaponId = weaponId
  return true
}

/** Space đẩy: chi phí và cooldown riêng, không có cửa sổ trễ. */
export function startPush(player: PlayerState, cfg = GAME_CONFIG.push, limits = GAME_CONFIG.player): boolean {
  if (!player.alive || player.pushCooldown > 0 || player.stamina < cfg.stamina) return false
  player.stamina = Math.max(0, player.stamina - cfg.stamina)
  player.staminaRegenTimer = limits.staminaRegenDelay
  player.pushCooldown = cfg.cooldown
  return true
}

/**
 * Tiến các bộ đếm combat của người chơi. Trả về true đúng một lần cho mỗi cú
 * vung, tại tick mà khung gây sát thương xảy ra.
 */
export function tickPlayerCombat(player: PlayerState, dt: number, cfg = GAME_CONFIG.melee): boolean {
  player.attackCooldown = Math.max(0, player.attackCooldown - dt)
  player.pushCooldown = Math.max(0, player.pushCooldown - dt)
  if (player.attackTimer < 0) return false

  player.attackTimer += dt
  let hitNow = false
  if (player.attackHitPending && player.attackTimer >= cfg.hitDelay) {
    player.attackHitPending = false
    hitNow = true
  }
  if (player.attackTimer >= cfg.swingDuration) player.attackTimer = -1
  return hitNow
}

/** Góc quay quanh Y để nhìn từ `from` tới `to` trên mặt phẳng XZ. */
export function facingTowards(from: Vec3, to: Vec3): number {
  return Math.atan2(to.x - from.x, to.z - from.z)
}
