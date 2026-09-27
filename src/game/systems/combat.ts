import { GAME_CONFIG } from '../core/config'
import type { PlayerState } from '../entities/player'
import type { MeleeStats } from '../entities/items'
import type { Vec3 } from '../../types'
import { angleDiff } from './stance'

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
 * Bắt đầu một cú vung nếu đủ điều kiện (còn sống, không đang vung, hết cooldown, đủ stamina) với
 * cooldown/stamina của vũ khí. Trừ stamina ngay, cấp attackId mới. CS1b: `yaw` is the aim snapshot
 * of the click; the swing winds up while the body turns toward it and only strikes once it faces it.
 */
export function startAttack(
  player: PlayerState,
  stats: Pick<MeleeStats, 'cooldown' | 'stamina'> = GAME_CONFIG.melee,
  limits = GAME_CONFIG.player,
  weaponId: string | null = null,
  yaw: number = player.facing,
): boolean {
  if (!canStartAttack(player, stats)) return false
  player.stamina = Math.max(0, player.stamina - stats.stamina)
  player.staminaRegenTimer = limits.staminaRegenDelay
  player.attackCooldown = stats.cooldown
  player.attackTimer = 0
  player.attackHitPending = true
  player.attackId += 1
  player.attackWeaponId = weaponId
  player.attackYaw = yaw
  player.attackCommitted = false
  player.attackAlignTime = 0
  return true
}

export function canStartAttack(player: PlayerState, stats: Pick<MeleeStats, 'stamina'> = GAME_CONFIG.melee): boolean {
  return player.alive && player.attackTimer < 0 && player.attackCooldown <= 0 && player.stamina >= stats.stamina
}

/** Seconds until a new swing may start (the swing in progress, then the cooldown). */
export function attackReadyIn(player: PlayerState, cfg = GAME_CONFIG.melee): number {
  const swing = player.attackTimer >= 0 ? (player.attackCommitted ? cfg.swingDuration - player.attackTimer : Infinity) : 0
  return Math.max(swing, player.attackCooldown)
}

/** End the swing in progress without its hit (alignment timeout, death). The cost stays paid. */
export function cancelSwing(player: PlayerState): boolean {
  if (player.attackTimer < 0) return false
  player.attackTimer = -1
  player.attackHitPending = false
  player.attackCommitted = false
  return true
}

export type AttackPhase = 'none' | 'windup' | 'strike' | 'recovery'

/**
 * CS1b phases (combat clock authoritative, the pose only reads them): wind-up/align until committed,
 * strike from the commit to the hit, recovery to the end of the swing (then the weapon cooldown).
 */
export function attackPhase(player: PlayerState, cfg = GAME_CONFIG.melee): AttackPhase {
  if (player.attackTimer < 0) return 'none'
  if (!player.attackCommitted) return 'windup'
  return player.attackTimer < cfg.hitDelay ? 'strike' : 'recovery'
}

/** Space đẩy: chi phí và cooldown riêng, không có cửa sổ trễ. */
export function startPush(player: PlayerState, cfg = GAME_CONFIG.push, limits = GAME_CONFIG.player): boolean {
  if (!player.alive || player.pushCooldown > 0 || player.stamina < cfg.stamina) return false
  player.stamina = Math.max(0, player.stamina - cfg.stamina)
  player.staminaRegenTimer = limits.staminaRegenDelay
  player.pushCooldown = cfg.cooldown
  return true
}

export type MeleeTick = 'hit' | 'cancelled' | null

/**
 * Tiến các bộ đếm combat của người chơi. Trả về 'hit' đúng một lần cho mỗi cú vung, tại tick mà
 * khung gây sát thương xảy ra (a long tick crossing it still counts), 'cancelled' when a swing could
 * not face its direction in time.
 *
 * CS1b: the wind-up runs for `windup` seconds while the body turns toward `attackYaw`. If the body
 * does not face it yet (within `alignToleranceDeg`), the swing holds cocked, and the weapon cooldown
 * holds with it, so the recovery after the hit keeps its old length. Once aligned the swing commits
 * (`attackCommitted`, direction fixed) and runs as before: hit at `hitDelay`, end at `swingDuration`.
 */
export function tickPlayerCombat(player: PlayerState, dt: number, cfg = GAME_CONFIG.melee, stance = GAME_CONFIG.combatStance): MeleeTick {
  player.pushCooldown = Math.max(0, player.pushCooldown - dt)
  if (player.attackTimer < 0) {
    player.attackCooldown = Math.max(0, player.attackCooldown - dt)
    return null
  }

  let rest = dt
  if (!player.attackCommitted) {
    player.attackAlignTime += dt
    const reach = Math.max(0, Math.min(dt, stance.windup - player.attackTimer))
    player.attackTimer += reach
    player.attackCooldown = Math.max(0, player.attackCooldown - reach)
    rest = dt - reach
    if (player.attackTimer < stance.windup - 1e-9) return null
    const aligned = Math.abs(angleDiff(player.facing, player.attackYaw)) <= (stance.alignToleranceDeg * Math.PI) / 180
    if (!aligned) {
      if (player.attackAlignTime > stance.alignTimeout) {
        cancelSwing(player)
        return 'cancelled'
      }
      return null
    }
    player.attackCommitted = true
  }

  player.attackCooldown = Math.max(0, player.attackCooldown - rest)
  player.attackTimer += rest
  let hitNow = false
  if (player.attackHitPending && player.attackTimer >= cfg.hitDelay) {
    player.attackHitPending = false
    hitNow = true
  }
  if (player.attackTimer >= cfg.swingDuration) {
    player.attackTimer = -1
    player.attackCommitted = false
  }
  return hitNow ? 'hit' : null
}

/** Góc quay quanh Y để nhìn từ `from` tới `to` trên mặt phẳng XZ. */
export function facingTowards(from: Vec3, to: Vec3): number {
  return Math.atan2(to.x - from.x, to.z - from.z)
}
