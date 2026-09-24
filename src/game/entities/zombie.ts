import { GAME_CONFIG } from '../core/config'
import type { EntityId, Vec2, Vec3, ZombieAIState } from '../../types'

/** How the remembered position was learnt (plan §10.1): seen, or heard (footsteps, being hit). */
export type MemorySource = 'sight' | 'noise'

export interface ZombieState {
  id: EntityId
  health: number
  ai: ZombieAIState
  position: Vec3
  facing: number
  attackCooldown: number
  /** Thời gian vung tay còn lại; < 0 nghĩa là chưa bắt đầu vung. Dùng cho cả đòn đập cửa. */
  attackWindup: number
  detectTimer: number
  loseTargetTimer: number
  /** Kết quả lần kiểm tra phát hiện gần nhất (cache giữa các lần kiểm tra). */
  seesTarget: boolean
  /** Vị trí nhớ gần nhất của người chơi (thấy hoặc nghe); null = không nhớ gì. */
  lastKnownTarget: Vec3 | null
  /** Seconds since the memory was last refreshed; memory expires after `memoryDuration`. */
  memoryAge: number
  memorySource: MemorySource | null

  /** Wander rest time left while IDLE. */
  restTimer: number
  /** WANDER/MIGRATE destination; null = pick one. */
  moveTarget: Vec3 | null
  /** Time spent on the current WANDER/MIGRATE leg. */
  moveTimer: number
  /** Horde zone (group) the zombie belongs to; null on maps without zones. */
  zoneId: string | null
  /** Wander anchor when there is no zone: the spawn point (not saved). */
  home: Vec3
  /** Counter for the deterministic wander RNG (not saved). */
  wanderCount: number

  /** Door being approached/bashed; its side (0/1 of the nav portal), approach point and contact slot. */
  structureTargetId: string | null
  structureSide: number
  structureApproach: Vec3 | null
  structureSlot: Vec3 | null
  /** Seconds bashing without new information about the player. */
  siegeTimer: number

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

export function createZombieState(id: EntityId, spawn: Vec3, zoneId: string | null = null): ZombieState {
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
    memoryAge: 0,
    memorySource: null,
    restTimer: 0,
    moveTarget: null,
    moveTimer: 0,
    zoneId,
    home: { ...spawn },
    wanderCount: 0,
    structureTargetId: null,
    structureSide: 0,
    structureApproach: null,
    structureSlot: null,
    siegeTimer: 0,
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

/** Hunting states track the player all around and show red eyes; the rest are unaware. */
export const UNAWARE_STATES: ReadonlySet<ZombieAIState> = new Set(['IDLE', 'WANDER', 'MIGRATE'])
