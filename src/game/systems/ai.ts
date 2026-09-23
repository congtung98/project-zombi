import { GAME_CONFIG } from '../core/config'
import type { ZombieState } from '../entities/zombie'
import type { Vec2, Vec3, ZombieAIState } from '../../types'

export interface ZombieStepResult {
  /** Vận tốc mong muốn trên mặt phẳng XZ. */
  velocity: Vec2
  /** true nếu zombie thực hiện một đòn đánh trong tick này. */
  attack: boolean
  transition: { from: ZombieAIState; to: ZombieAIState } | null
}

export interface ZombieAIContext {
  /**
   * Kiểm tra zombie có thể tiếp cận/nhìn thấy mục tiêu (không bị tường, cửa đóng chắn).
   * Runtime cung cấp raycast physics; mặc định (test) luôn trả về true.
   */
  canReach: (zombie: ZombieState, target: Vec3) => boolean
}

const DEFAULT_CONTEXT: ZombieAIContext = { canReach: () => true }

/**
 * FSM tối thiểu: IDLE → CHASE → ATTACK → CHASE; mọi trạng thái có thể sang DEAD.
 * Hàm thuần: chỉ thay đổi `zombie` và trả về vận tốc/đòn đánh mong muốn.
 */
export function stepZombie(
  zombie: ZombieState,
  target: Vec3,
  targetAlive: boolean,
  dt: number,
  cfg = GAME_CONFIG.zombie,
  ctx: ZombieAIContext = DEFAULT_CONTEXT,
): ZombieStepResult {
  const result: ZombieStepResult = { velocity: { x: 0, z: 0 }, attack: false, transition: null }

  if (zombie.ai === 'DEAD') return result
  if (zombie.health <= 0) {
    result.transition = transition(zombie, 'DEAD')
    return result
  }

  zombie.attackCooldown = Math.max(0, zombie.attackCooldown - dt)

  const dx = target.x - zombie.position.x
  const dz = target.z - zombie.position.z
  const dist = Math.hypot(dx, dz)

  zombie.detectTimer -= dt
  if (zombie.detectTimer <= 0) {
    zombie.detectTimer = cfg.detectInterval
    zombie.seesTarget = targetAlive && dist <= cfg.detectRange && ctx.canReach(zombie, target)
  }
  const sees = zombie.seesTarget

  switch (zombie.ai) {
    case 'IDLE': {
      if (sees) result.transition = transition(zombie, 'CHASE')
      break
    }
    case 'CHASE': {
      if (!sees) {
        zombie.loseTargetTimer += dt
        if (zombie.loseTargetTimer >= cfg.loseTargetDelay) {
          zombie.loseTargetTimer = 0
          result.transition = transition(zombie, 'IDLE')
          break
        }
      } else {
        zombie.loseTargetTimer = 0
      }
      if (sees && dist <= cfg.attackRange) {
        result.transition = transition(zombie, 'ATTACK')
        break
      }
      if (dist > 1e-4) {
        result.velocity = { x: (dx / dist) * cfg.speed, z: (dz / dist) * cfg.speed }
        zombie.facing = Math.atan2(dx, dz)
      }
      break
    }
    case 'ATTACK': {
      if (!targetAlive) {
        result.transition = transition(zombie, 'IDLE')
        break
      }
      if (dist > cfg.attackRange * 1.15 || !sees) {
        result.transition = transition(zombie, 'CHASE')
        break
      }
      zombie.facing = Math.atan2(dx, dz)
      // Kiểm tra lại tường chắn đúng tại thời điểm gây sát thương, không dùng cache phát hiện.
      if (zombie.attackCooldown <= 0 && ctx.canReach(zombie, target)) {
        zombie.attackCooldown = cfg.attackCooldown
        result.attack = true
      }
      break
    }
  }

  return result
}

function transition(zombie: ZombieState, to: ZombieAIState): { from: ZombieAIState; to: ZombieAIState } {
  const from = zombie.ai
  zombie.ai = to
  return { from, to }
}
