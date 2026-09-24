import type { Inventory } from '../game/systems/inventory'
import type { Vec3, ZombieAIState } from './index'
import type { Equipment } from '../game/entities/items'
import type { DoorState } from '../game/world/doors'
import type { CharacterAppearance } from '../game/entities/appearance'

/**
 * v1 (Phase 1) → v2 (item instances, door state) → v3 (P2-S2 melee containers) → v4 (P2-S3
 * name + appearance) → v5 (P2-S4 material containers; crafted items are ordinary instances).
 * Older versions migrate in memory; unknown versions are rejected without overwriting the
 * original. Timed actions (craft/repair in progress) are never part of a save.
 */
export const SAVE_SCHEMA_VERSION = 5

export interface SavedPlayer {
  name: string
  appearance: CharacterAppearance
  position: Vec3
  facing: number
  health: number
  stamina: number
  hunger: number
  thirst: number
  kills: number
  inventory: Inventory
  equipment: Equipment
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
  position?: Vec3
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
  doors: DoorState[]
  containers: SavedContainer[]
  /** Chỉ zombie còn sống; xác không cần khôi phục. */
  zombies: SavedZombie[]
  spawn: { nextZombieId: number; timer: number; counter: number }
  cameraZoom: number
}

/** Thông tin tóm tắt để hiện ở menu Continue. */
export interface SaveSummary {
  name: string
  savedAt: number
  day: number
  timeLabel: string
  health: number
  kills: number
}
