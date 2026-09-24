import { ITEMS } from '../entities/items'
import type { Inventory } from './inventory'
import { SAVE_SCHEMA_VERSION, type SaveGame, type SaveSummary } from '../../types/save'
import type { Vec3, ZombieAIState } from '../../types'

export type SaveValidation =
  | { ok: true; save: SaveGame }
  | { ok: false; reason: 'corrupt' | 'incompatible' | 'wrong-map'; detail: string }

const AI_STATES: ReadonlySet<string> = new Set<ZombieAIState>(['IDLE', 'CHASE', 'SEARCH', 'ATTACK', 'DEAD'])

/**
 * Kiểm tra dữ liệu đọc từ IndexedDB trước khi nạp: đúng phiên bản schema, đúng
 * bản đồ, mọi trường bắt buộc đúng kiểu và số hữu hạn. Không lặng lẽ nạp sai.
 */
export function validateSaveGame(data: unknown, expectedMapId: string): SaveValidation {
  if (!isRecord(data)) return corrupt('không phải object')
  if (typeof data.schemaVersion !== 'number') return corrupt('thiếu schemaVersion')
  if (data.schemaVersion !== SAVE_SCHEMA_VERSION) {
    return { ok: false, reason: 'incompatible', detail: `schemaVersion ${data.schemaVersion}, cần ${SAVE_SCHEMA_VERSION}` }
  }
  if (typeof data.mapId !== 'string') return corrupt('thiếu mapId')
  if (data.mapId !== expectedMapId) return { ok: false, reason: 'wrong-map', detail: `mapId ${data.mapId}` }

  if (!isFiniteNumber(data.savedAt) || !isFiniteNumber(data.worldSeed) || !isFiniteNumber(data.cameraZoom)) {
    return corrupt('savedAt/worldSeed/cameraZoom')
  }
  const clock = data.clock
  if (!isRecord(clock) || !isFiniteNumber(clock.elapsed) || !isFiniteNumber(clock.timeOfDay) || !isFiniteNumber(clock.day)) {
    return corrupt('clock')
  }

  const player = data.player
  if (
    !isRecord(player) ||
    !isVec3(player.position) ||
    !isFiniteNumber(player.facing) ||
    !isFiniteNumber(player.health) ||
    !isFiniteNumber(player.stamina) ||
    !isFiniteNumber(player.hunger) ||
    !isFiniteNumber(player.thirst) ||
    !isFiniteNumber(player.kills) ||
    !isInventory(player.inventory)
  ) {
    return corrupt('player')
  }

  if (!Array.isArray(data.doors) || !data.doors.every((d) => isRecord(d) && typeof d.id === 'string' && typeof d.open === 'boolean')) {
    return corrupt('doors')
  }
  if (
    !Array.isArray(data.containers) ||
    !data.containers.every((c) => isRecord(c) && typeof c.id === 'string' && typeof c.opened === 'boolean' && isInventory(c.items))
  ) {
    return corrupt('containers')
  }
  if (
    !Array.isArray(data.zombies) ||
    !data.zombies.every(
      (z) =>
        isRecord(z) &&
        typeof z.id === 'string' &&
        isVec3(z.position) &&
        isFiniteNumber(z.facing) &&
        isFiniteNumber(z.health) &&
        typeof z.ai === 'string' &&
        AI_STATES.has(z.ai) &&
        (z.lastKnownTarget === null || isVec3(z.lastKnownTarget)),
    )
  ) {
    return corrupt('zombies')
  }
  const spawn = data.spawn
  if (!isRecord(spawn) || !isFiniteNumber(spawn.nextZombieId) || !isFiniteNumber(spawn.timer) || !isFiniteNumber(spawn.counter)) {
    return corrupt('spawn')
  }
  // Zombie ID phải là duy nhất, nếu không load sẽ nhân đôi/ghi đè.
  const ids = new Set<string>()
  for (const z of data.zombies as { id: string }[]) {
    if (ids.has(z.id)) return corrupt(`zombie id trùng: ${z.id}`)
    ids.add(z.id)
  }

  return { ok: true, save: data as unknown as SaveGame }
}

export function summarizeSave(save: SaveGame): SaveSummary {
  const totalMinutes = Math.floor(save.clock.timeOfDay * 24 * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return {
    savedAt: save.savedAt,
    day: save.clock.day,
    timeLabel: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    health: save.player.health,
    kills: save.player.kills,
  }
}

function corrupt(detail: string): SaveValidation {
  return { ok: false, reason: 'corrupt', detail }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isVec3(v: unknown): v is Vec3 {
  return isRecord(v) && isFiniteNumber(v.x) && isFiniteNumber(v.y) && isFiniteNumber(v.z)
}

function isInventory(v: unknown): v is Inventory {
  if (!isRecord(v) || !Array.isArray(v.slots)) return false
  return v.slots.every(
    (s) =>
      s === null ||
      (isRecord(s) && typeof s.itemId === 'string' && s.itemId in ITEMS && isFiniteNumber(s.quantity) && s.quantity > 0),
  )
}
