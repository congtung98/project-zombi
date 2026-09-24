import type { Inventory } from '../game/systems/inventory'
import type { Vec3, ZombieAIState } from './index'

/** Tăng khi đổi cấu trúc; bản lưu khác phiên bản bị từ chối rõ ràng (không nạp sai). */
export const SAVE_SCHEMA_VERSION = 1

export interface SavedPlayer {
  position: Vec3
  facing: number
  health: number
  stamina: number
  hunger: number
  thirst: number
  kills: number
  inventory: Inventory
}

export interface SavedZombie {
  id: string
  position: Vec3
  facing: number
  health: number
  ai: ZombieAIState
  lastKnownTarget: Vec3 | null
}

export interface SavedContainer {
  id: string
  opened: boolean
  items: Inventory
}

/**
 * Snapshot toàn bộ simulation ở ranh giới một tick. Chỉ gồm dữ liệu thuần
 * (không body, không Map) để ghi thẳng vào IndexedDB.
 */
export interface SaveGame {
  schemaVersion: number
  savedAt: number
  mapId: string
  worldSeed: number
  clock: { elapsed: number; timeOfDay: number; day: number }
  player: SavedPlayer
  doors: { id: string; open: boolean }[]
  containers: SavedContainer[]
  /** Chỉ zombie còn sống; xác không cần khôi phục. */
  zombies: SavedZombie[]
  spawn: { nextZombieId: number; timer: number; counter: number }
  cameraZoom: number
}

/** Thông tin tóm tắt để hiện ở menu Continue. */
export interface SaveSummary {
  savedAt: number
  day: number
  timeLabel: string
  health: number
  kills: number
}
