import { GAME_CONFIG } from '../core/config'
import type { ZombieState } from '../entities/zombie'
import type { Vec2, Vec3, ZombieAIState } from '../../types'

export interface ZombieStepResult {
  /** Vận tốc mong muốn trên mặt phẳng XZ (đã gồm knockback). */
  velocity: Vec2
  /** true nếu zombie thực hiện một đòn đánh trong tick này. */
  attack: boolean
  transition: { from: ZombieAIState; to: ZombieAIState } | null
}

export interface ZombieAIContext {
  /**
   * Kiểm tra zombie có thể nhìn thấy mục tiêu (không bị tường, cửa đóng chắn).
   * Runtime cung cấp raycast physics; mặc định (test) luôn trả về true.
   */
  canReach: (zombie: ZombieState, target: Vec3) => boolean
  /** Tìm đường trên lưới điều hướng; null nếu không có đường. Mặc định: đi thẳng. */
  findPath?: (from: Vec3, to: Vec3) => Vec3[] | null
  /** Đoạn thẳng không cắt vật cản trên lưới. Mặc định: luôn đúng. */
  hasLineOfWalk?: (from: Vec3, to: Vec3) => boolean
  /** Phiên bản lưới điều hướng; đổi thì path cũ bị bỏ. */
  getNavVersion?: () => number
}

const DEFAULT_CONTEXT: ZombieAIContext = { canReach: () => true }

/**
 * FSM: IDLE → CHASE ⇄ ATTACK, CHASE → SEARCH (mất dấu) → CHASE | IDLE; mọi
 * trạng thái có thể sang DEAD. Hàm thuần: chỉ thay đổi `zombie` và trả về vận
 * tốc/đòn đánh mong muốn; physics bên ngoài giải quyết va chạm.
 */
export function stepZombie(
  zombie: ZombieState,
  target: Vec3,
  targetAlive: boolean,
  dt: number,
  cfg = GAME_CONFIG.zombie,
  ctx: ZombieAIContext = DEFAULT_CONTEXT,
  navCfg = GAME_CONFIG.nav,
): ZombieStepResult {
  const result: ZombieStepResult = { velocity: { x: 0, z: 0 }, attack: false, transition: null }

  if (zombie.ai === 'DEAD') {
    zombie.deadTimer += dt
    zombie.hitFlashTimer = Math.max(0, zombie.hitFlashTimer - dt)
    return result
  }
  if (zombie.health <= 0) {
    result.transition = transition(zombie, 'DEAD')
    return result
  }

  zombie.attackCooldown = Math.max(0, zombie.attackCooldown - dt)
  zombie.hitFlashTimer = Math.max(0, zombie.hitFlashTimer - dt)
  zombie.repathTimer = Math.max(0, zombie.repathTimer - dt)
  decayKnockback(zombie, dt, cfg.knockbackDamping)

  const dx = target.x - zombie.position.x
  const dz = target.z - zombie.position.z
  const dist = Math.hypot(dx, dz)

  zombie.detectTimer -= dt
  if (zombie.detectTimer <= 0) {
    zombie.detectTimer = cfg.detectInterval
    const range = zombie.ai === 'IDLE' ? cfg.detectRange : cfg.chaseRange
    zombie.seesTarget = targetAlive && dist <= range && ctx.canReach(zombie, target)
    if (zombie.seesTarget) zombie.lastKnownTarget = { x: target.x, y: target.y, z: target.z }
  }
  const sees = zombie.seesTarget

  // Bị khựng: chỉ trôi theo knockback, hủy đòn đang vung.
  if (zombie.staggerTimer > 0) {
    zombie.staggerTimer = Math.max(0, zombie.staggerTimer - dt)
    zombie.attackWindup = -1
    result.velocity = { x: zombie.knockback.x, z: zombie.knockback.z }
    return result
  }

  switch (zombie.ai) {
    case 'IDLE': {
      if (sees) result.transition = transition(zombie, 'CHASE')
      break
    }
    case 'CHASE': {
      if (!sees) {
        zombie.loseTargetTimer = 0
        result.transition = transition(zombie, 'SEARCH')
        break
      }
      if (dist <= cfg.attackRange) {
        clearPath(zombie)
        zombie.attackWindup = -1
        result.transition = transition(zombie, 'ATTACK')
        break
      }
      result.velocity = moveTowards(zombie, target, dt, cfg.speed, ctx, navCfg)
      break
    }
    case 'SEARCH': {
      if (sees) {
        zombie.loseTargetTimer = 0
        result.transition = transition(zombie, 'CHASE')
        break
      }
      zombie.loseTargetTimer += dt
      const goal = zombie.lastKnownTarget
      const arrived = !goal || Math.hypot(goal.x - zombie.position.x, goal.z - zombie.position.z) <= navCfg.waypointReachDist
      if ((arrived && zombie.loseTargetTimer >= cfg.loseTargetDelay) || zombie.loseTargetTimer >= cfg.searchTimeout) {
        zombie.loseTargetTimer = 0
        zombie.lastKnownTarget = null
        clearPath(zombie)
        result.transition = transition(zombie, 'IDLE')
        break
      }
      if (goal && !arrived) result.velocity = moveTowards(zombie, goal, dt, cfg.speed, ctx, navCfg)
      break
    }
    case 'ATTACK': {
      if (!targetAlive) {
        zombie.attackWindup = -1
        result.transition = transition(zombie, 'IDLE')
        break
      }
      if (dist > cfg.attackRange * 1.15 || !sees) {
        zombie.attackWindup = -1
        result.transition = transition(zombie, 'CHASE')
        break
      }
      zombie.facing = Math.atan2(dx, dz)
      if (zombie.attackWindup < 0) {
        if (zombie.attackCooldown <= 0) zombie.attackWindup = cfg.attackWindup
      } else {
        zombie.attackWindup -= dt
        if (zombie.attackWindup <= 0) {
          zombie.attackWindup = -1
          zombie.attackCooldown = cfg.attackCooldown
          // Kiểm tra lại tường chắn đúng tại thời điểm gây sát thương, không dùng cache phát hiện.
          if (dist <= cfg.attackRange * 1.15 && ctx.canReach(zombie, target)) result.attack = true
        }
      }
      break
    }
  }

  result.velocity.x += zombie.knockback.x
  result.velocity.z += zombie.knockback.z
  return result
}

/** Đẩy lùi zombie khỏi `from` một quãng `distance` và làm khựng `stagger` giây. */
export function applyKnockback(zombie: ZombieState, from: Vec3, distance: number, stagger: number, cfg = GAME_CONFIG.zombie): void {
  if (zombie.ai === 'DEAD') return
  let dx = zombie.position.x - from.x
  let dz = zombie.position.z - from.z
  const len = Math.hypot(dx, dz)
  if (len < 1e-4) {
    dx = Math.sin(zombie.facing) * -1
    dz = Math.cos(zombie.facing) * -1
  } else {
    dx /= len
    dz /= len
  }
  const speed = distance * cfg.knockbackDamping
  zombie.knockback.x = dx * speed
  zombie.knockback.z = dz * speed
  zombie.staggerTimer = Math.max(zombie.staggerTimer, stagger)
  zombie.attackWindup = -1
  zombie.hitFlashTimer = 0.15
}

/** Gây sát thương; trả về true nếu zombie vừa chết trong lần gọi này. */
export function damageZombie(zombie: ZombieState, amount: number): boolean {
  if (zombie.ai === 'DEAD' || amount <= 0) return false
  zombie.health = Math.max(0, zombie.health - amount)
  zombie.hitFlashTimer = 0.15
  if (zombie.health <= 0) {
    zombie.ai = 'DEAD'
    zombie.attackWindup = -1
    zombie.knockback.x = 0
    zombie.knockback.z = 0
    clearPath(zombie)
    return true
  }
  return false
}

function decayKnockback(zombie: ZombieState, dt: number, damping: number): void {
  const k = zombie.knockback
  if (k.x === 0 && k.z === 0) return
  const f = Math.exp(-damping * dt)
  k.x *= f
  k.z *= f
  if (Math.hypot(k.x, k.z) < 0.05) {
    k.x = 0
    k.z = 0
  }
}

function clearPath(zombie: ZombieState): void {
  zombie.path = []
  zombie.pathIndex = 0
  zombie.pathGoal = null
  zombie.stuckTimer = 0
}

/**
 * Chọn hướng đi tới `goal`: đi thẳng nếu lưới cho phép, nếu không thì bám theo
 * path A*. Tìm đường lại khi đích dời xa, lưới đổi (cửa), hết path hoặc kẹt.
 */
function moveTowards(
  zombie: ZombieState,
  goal: Vec3,
  dt: number,
  speed: number,
  ctx: ZombieAIContext,
  navCfg: typeof GAME_CONFIG.nav,
): Vec2 {
  const pos = zombie.position
  let waypoint: Vec3 = goal

  if (ctx.findPath && !(ctx.hasLineOfWalk?.(pos, goal) ?? true)) {
    const goalMoved = !zombie.pathGoal || Math.hypot(goal.x - zombie.pathGoal.x, goal.z - zombie.pathGoal.z) > navCfg.repathTargetDelta
    const navVersion = ctx.getNavVersion?.() ?? -1
    const navChanged = navVersion !== zombie.pathNavVersion
    const exhausted = zombie.pathIndex >= zombie.path.length
    const stuck = zombie.stuckTimer >= navCfg.stuckTime
    if ((goalMoved || navChanged || exhausted || stuck) && (zombie.repathTimer <= 0 || navChanged)) {
      const path = ctx.findPath(pos, goal)
      zombie.path = path ?? []
      zombie.pathIndex = 0
      zombie.pathGoal = { ...goal }
      zombie.pathNavVersion = navVersion
      zombie.repathTimer = navCfg.repathInterval
      zombie.stuckTimer = 0
    }
    while (
      zombie.pathIndex < zombie.path.length - 1 &&
      Math.hypot(zombie.path[zombie.pathIndex].x - pos.x, zombie.path[zombie.pathIndex].z - pos.z) <= navCfg.waypointReachDist
    ) {
      zombie.pathIndex += 1
    }
    if (zombie.pathIndex < zombie.path.length) waypoint = zombie.path[zombie.pathIndex]
  } else {
    clearPath(zombie)
  }

  // Phát hiện kẹt: gần như không dịch chuyển dù muốn đi.
  const moved = Math.hypot(pos.x - zombie.lastPosition.x, pos.z - zombie.lastPosition.z)
  zombie.stuckTimer = moved < speed * dt * 0.25 ? zombie.stuckTimer + dt : 0
  zombie.lastPosition.x = pos.x
  zombie.lastPosition.z = pos.z

  const dx = waypoint.x - pos.x
  const dz = waypoint.z - pos.z
  const d = Math.hypot(dx, dz)
  if (d < 1e-4) return { x: 0, z: 0 }
  zombie.facing = Math.atan2(dx, dz)
  return { x: (dx / d) * speed, z: (dz / d) * speed }
}

function transition(zombie: ZombieState, to: ZombieAIState): { from: ZombieAIState; to: ZombieAIState } {
  const from = zombie.ai
  zombie.ai = to
  return { from, to }
}
