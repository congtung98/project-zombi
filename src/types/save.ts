import type { Inventory } from '../game/systems/inventory'
import type { Vec3, ZombieAIState } from './index'
import type { Equipment } from '../game/entities/items'
import type { DoorState } from '../game/world/doors'
import type { CharacterAppearance } from '../game/entities/appearance'
import type { MemorySource } from '../game/entities/zombie'

/**
 * v1 (Phase 1) → v2 (item instances, door state) → v3 (P2-S2 melee containers) → v4 (P2-S3
 * name + appearance) → v5 (P2-S4 material containers; crafted items are ordinary instances) → v6
 * (P2-S5 zombie perception memory, wander/migration zones, door siege target, horde director) → v7
 * (building lighting: curtains, lamps, grid power; the house bedroom door) → v8 (map content:
 * stable content IDs such as `c-1_-1/safehouse/door`, plus the content revision).
 * Older versions migrate in memory; unknown versions are rejected without overwriting the
 * original. Timed actions (craft/repair in progress) and derived room light are never saved.
 */
export const SAVE_SCHEMA_VERSION = 8

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
  /** Remembered player position (seen or heard); null = none. */
  lastKnownTarget: Vec3 | null
  /** v6: seconds since the memory was refreshed (0 without memory). */
  memoryAge: number
  memorySource: MemorySource | null
  /** v6: horde zone (group); null on maps without zones. */
  zoneId: string | null
  /** v6: door being approached/bashed (APPROACH_STRUCTURE / ATTACK_STRUCTURE only). */
  structureTargetId: string | null
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
  /** v8: content revision of the world (`world.json` contentVersion; 0 for hand-made maps). */
  contentVersion: number
  worldSeed: number
  clock: { elapsed: number; timeOfDay: number; day: number }
  player: SavedPlayer
  doors: DoorState[]
  containers: SavedContainer[]
  /** Chỉ zombie còn sống; xác không cần khôi phục. */
  zombies: SavedZombie[]
  spawn: { nextZombieId: number; timer: number; counter: number }
  /** v6: seconds to the next horde migration attempt and the attempt counter (seeds its RNG). */
  horde: { timer: number; counter: number }
  /** v7: lighting inputs only (room light is recomputed after load). */
  lighting: SavedLighting
  cameraZoom: number
}

export interface SavedLighting {
  curtains: { id: string; closed: boolean }[]
  lamps: { id: string; on: boolean }[]
  electricity: boolean
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
