import { GAME_CONFIG } from '../core/config'
import type { EntityId, Vec3, ZombieAIState } from '../../types'

export interface ZombieState {
  id: EntityId
  health: number
  ai: ZombieAIState
  position: Vec3
  facing: number
  attackCooldown: number
  detectTimer: number
  loseTargetTimer: number
  /** Kết quả lần kiểm tra phát hiện gần nhất (cache giữa các lần kiểm tra). */
  seesTarget: boolean
}

export function createZombieState(id: EntityId, spawn: Vec3): ZombieState {
  return {
    id,
    health: GAME_CONFIG.zombie.health,
    ai: 'IDLE',
    position: { ...spawn },
    facing: 0,
    attackCooldown: 0,
    detectTimer: 0,
    loseTargetTimer: 0,
    seesTarget: false,
  }
}
