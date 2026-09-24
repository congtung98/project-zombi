import { GAME_CONFIG } from '../core/config'
import type { EntityId, Vec2, Vec3, ZombieAIState } from '../../types'

export interface ZombieState {
  id: EntityId
  health: number
  ai: ZombieAIState
  position: Vec3
  facing: number
  attackCooldown: number
  /** Thời gian vung tay còn lại; < 0 nghĩa là chưa bắt đầu vung. */
  attackWindup: number
  detectTimer: number
  loseTargetTimer: number
  /** Kết quả lần kiểm tra phát hiện gần nhất (cache giữa các lần kiểm tra). */
  seesTarget: boolean
  /** Vị trí cuối cùng còn thấy người chơi; dùng khi SEARCH. */
  lastKnownTarget: Vec3 | null

  /** Đường đi hiện tại (waypoint thế giới) và chỉ số waypoint kế tiếp. */
  path: Vec3[]
  pathIndex: number
  /** Đích mà `path` đã được tính cho; đổi xa hơn ngưỡng thì tìm lại. */
  pathGoal: Vec3 | null
  /** Phiên bản lưới điều hướng lúc tính path (cửa đổi trạng thái thì tăng). */
  pathNavVersion: number
  repathTimer: number
  stuckTimer: number
  lastPosition: Vec3

  /** Vận tốc bị đẩy lùi (knockback), giảm dần theo thời gian. */
  knockback: Vec2
  /** Khựng sau khi trúng đòn: không di chuyển, không đánh. */
  staggerTimer: number
  /** Cho view: nhấp nháy khi trúng đòn. */
  hitFlashTimer: number
  /** Thời gian đã chết (giây), cho animation ngã. */
  deadTimer: number
}

export function createZombieState(id: EntityId, spawn: Vec3): ZombieState {
  return {
    id,
    health: GAME_CONFIG.zombie.health,
    ai: 'IDLE',
    position: { ...spawn },
    facing: 0,
    attackCooldown: 0,
    attackWindup: -1,
    detectTimer: 0,
    loseTargetTimer: 0,
    seesTarget: false,
    lastKnownTarget: null,
    path: [],
    pathIndex: 0,
    pathGoal: null,
    pathNavVersion: -1,
    repathTimer: 0,
    stuckTimer: 0,
    lastPosition: { ...spawn },
    knockback: { x: 0, z: 0 },
    staggerTimer: 0,
    hitFlashTimer: 0,
    deadTimer: 0,
  }
}
