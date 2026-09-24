import { ITEMS, type ItemId } from '../entities/items'
import { addItem, createInventory, type Inventory } from './inventory'
import { DOOR_MAX_HP } from '../world/doors'
import { CONTAINERS_ADDED_V3, NEIGHBORHOOD_MAP, type MapData } from '../world/mapData'
import { LOOT_TABLES } from '../world/lootTables'
import { generateContainerLoot } from './loot'
import { GAME_CONFIG } from '../core/config'
import { DEFAULT_APPEARANCE, DEFAULT_PLAYER_NAME, isAppearance, isValidName } from '../entities/appearance'
import { SAVE_SCHEMA_VERSION, type SaveGame, type SaveSummary } from '../../types/save'
import type { Vec3, ZombieAIState } from '../../types'

/** `fromVersion` is the stored schema before any in-memory migration. */
export type SaveValidation =
  | { ok: true; save: SaveGame; migrated: boolean; fromVersion: number }
  | { ok: false; reason: 'corrupt' | 'incompatible' | 'wrong-map'; detail: string }

const AI_STATES: ReadonlySet<string> = new Set<ZombieAIState>(['IDLE', 'CHASE', 'SEARCH', 'ATTACK', 'DEAD'])

/**
 * Validate current snapshots or migrate v1, without mutating input. Reject invalid
 * ownership, capacity and unknown schemas before the runtime or storage changes.
 */
export function validateSaveGame(data: unknown, expectedMapId: string, map?: MapData): SaveValidation {
  if (!isRecord(data)) return corrupt('không phải object')
  if (typeof data.schemaVersion !== 'number') return corrupt('thiếu schemaVersion')
  const version = data.schemaVersion
  const legacy = version === 1
  if (version !== 1 && version !== 2 && version !== 3 && version !== SAVE_SCHEMA_VERSION) {
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
    !(legacy ? isLegacyInventory(player.inventory) : isInventory(player.inventory))
  ) {
    return corrupt('player')
  }
  // v4+: name and appearance are option IDs only; unknown IDs are rejected, never guessed.
  if (version >= 4 && (!isValidName(player.name) || !isAppearance(player.appearance))) return corrupt('player name/appearance')

  if (!Array.isArray(data.doors) || !data.doors.every((d) => isRecord(d) && typeof d.id === 'string' && (legacy
    ? typeof d.open === 'boolean'
    : ['open', 'closed', 'destroyed'].includes(String(d.state)) && isFiniteNumber(d.hp) && d.hp >= 0 && d.hp <= DOOR_MAX_HP && (d.state === 'destroyed' ? d.hp === 0 : d.hp > 0)))) {
    return corrupt('doors')
  }
  if (
    !Array.isArray(data.containers) ||
    !data.containers.every((c) => isRecord(c) && typeof c.id === 'string' && typeof c.opened === 'boolean' &&
      (legacy ? isLegacyInventory(c.items) : isInventory(c.items)) && (c.position === undefined || !legacy && isVec3(c.position)))
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

  for (const collection of [data.doors, data.containers]) {
    const ids = new Set<string>()
    for (const entry of collection as { id: string }[]) {
      if (!entry.id || ids.has(entry.id)) return corrupt(`id trùng: ${entry.id}`)
      ids.add(entry.id)
    }
  }
  const knownMap = map ?? (expectedMapId === NEIGHBORHOOD_MAP.id ? NEIGHBORHOOD_MAP : undefined)
  const containers = data.containers as unknown as SaveGame['containers']
  if ((player.inventory as Inventory).slots.length !== GAME_CONFIG.inventory.slots) return corrupt('player inventory capacity')
  if (knownMap) {
    const doors = data.doors as { id: string }[]
    if (doors.length !== knownMap.doors.length || knownMap.doors.some((d) => !doors.some((s) => s.id === d.id))) return corrupt('door IDs do not match map')
    // Saves older than v3 predate the P2-S2 containers; migration seeds them once.
    const required = knownMap.containers.filter((c) => version >= 3 || !CONTAINERS_ADDED_V3.has(c.id))
    if (required.some((c) => !containers.some((s) => s.id === c.id))) return corrupt('missing map container')
    for (const c of containers) {
      if (version < 3 && CONTAINERS_ADDED_V3.has(c.id)) return corrupt('container newer than schema')
      const fixed = knownMap.containers.some((d) => d.id === c.id)
      if (fixed ? c.position !== undefined : legacy || !c.id.startsWith('drop:') || !c.position) return corrupt('unknown container')
      if (c.items.slots.length !== (fixed ? GAME_CONFIG.inventory.containerSlots : 1)) return corrupt('container capacity')
      if (c.position && (Math.abs(c.position.x) > knownMap.size / 2 || Math.abs(c.position.z) > knownMap.size / 2)) return corrupt('drop outside map')
    }
  }
  if (legacy) return migratePhase1(data, expectedMapId, knownMap)
  const save = data as unknown as SaveGame
  const owners = new Set<string>()
  const inventoryIds = new Set<string>()
  const inventories = [save.player.inventory, ...save.containers.map((c) => c.items)]
  for (const inv of inventories) {
    if (inventoryIds.has(inv.id)) return corrupt('duplicate inventory namespace')
    inventoryIds.add(inv.id)
    for (const item of inv.slots) {
      if (!item) continue
      if (owners.has(item.id)) return corrupt(`item ownership trùng: ${item.id}`)
      owners.add(item.id)
    }
  }
  // Counters must not reuse an ID, including items transferred to another owner.
  for (const inv of inventories) for (const id of owners) {
    if (!id.startsWith(`${inv.id}:`)) continue
    const suffix = id.slice(inv.id.length + 1)
    if (/^\d+$/.test(suffix) && Number(suffix) >= inv.nextItemId) return corrupt('item counter would reuse ID')
  }
  if (!isRecord(player.equipment)) return corrupt('equipment')
  const weaponId = player.equipment.weaponInstanceId
  if (weaponId !== null && (typeof weaponId !== 'string' || !save.player.inventory.slots.some((i) => i?.id === weaponId && i.kind === 'weapon'))) return corrupt('equipment owner/reference')
  if (version === 2) return migrateV2(save, expectedMapId, knownMap)
  if (version === 3) return migrateV3(save, expectedMapId, knownMap)
  return { ok: true, save, migrated: false, fromVersion: version }
}

export function summarizeSave(save: SaveGame): SaveSummary {
  const totalMinutes = Math.floor(save.clock.timeOfDay * 24 * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return {
    name: save.player.name,
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
  if (!isRecord(v) || typeof v.id !== 'string' || !v.id || !Number.isSafeInteger(v.nextItemId) || Number(v.nextItemId) < 1 || !Array.isArray(v.slots)) return false
  return v.slots.every(
    (s) => {
      if (s === null) return true
      if (!isRecord(s) || typeof s.id !== 'string' || !s.id || typeof s.itemId !== 'string' || !Object.hasOwn(ITEMS, s.itemId)) return false
      const def = ITEMS[s.itemId as ItemId]
      if (!Number.isSafeInteger(s.quantity) || Number(s.quantity) <= 0 || Number(s.quantity) > def.stackLimit) return false
      if (def.kind === 'weapon') return s.kind === 'weapon' && s.quantity === 1 && isFiniteNumber(s.condition) && s.condition >= 0 && s.condition <= def.maxCondition! && s.fuel === undefined
      if (def.kind === 'tool') return s.kind === 'tool' && s.quantity === 1 && s.condition === undefined && (def.maxFuel === undefined ? s.fuel === undefined : isFiniteNumber(s.fuel) && s.fuel >= 0 && s.fuel <= def.maxFuel)
      return s.kind === 'stack' && s.condition === undefined && s.fuel === undefined
    },
  )
}

function isLegacyInventory(v: unknown): boolean {
  return isRecord(v) && Array.isArray(v.slots) && v.slots.every((s) => s === null ||
    isRecord(s) && typeof s.itemId === 'string' && Object.hasOwn(ITEMS, s.itemId) &&
    ['food', 'drink', 'medical'].includes(ITEMS[s.itemId as ItemId].kind) &&
    Number.isSafeInteger(s.quantity) && Number(s.quantity) > 0 && Number(s.quantity) <= ITEMS[s.itemId as ItemId].stackLimit)
}

/** Pure deterministic v1 → v2. Original data is never mutated; storage owns backup/commit. */
function migratePhase1(data: Record<string, unknown>, mapId: string, map?: MapData): SaveValidation {
  const save = structuredClone(data) as unknown as SaveGame
  const convert = (old: Inventory, id: string): Inventory => {
    const inv = createInventory(old.slots.length, id)
    inv.slots = old.slots.map((s) => s ? { id: `${id}:${inv.nextItemId++}`, itemId: s.itemId, kind: 'stack', quantity: s.quantity } : null)
    return inv
  }
  save.schemaVersion = 2
  save.player.inventory = convert(save.player.inventory, 'player')
  save.player.equipment = { weaponInstanceId: null }
  save.containers = save.containers.map((c) => ({ ...c, items: convert(c.items, `loot:${save.worldSeed}:${c.id}`) }))
  save.doors = (data.doors as { id: string; open: boolean }[]).map((d) => ({ id: d.id, state: d.open ? 'open' : 'closed', hp: DOOR_MAX_HP }))
  const bag = save.player.inventory
  if (bag.slots.includes(null)) {
    addItem(bag, 'baseball_bat', 1)
    save.player.equipment.weaponInstanceId = bag.slots.find((i) => i?.kind === 'weapon')!.id
  } else {
    // A non-solid loot bag at the saved player position is reachable without crossing a wall.
    const items = createInventory(1, 'legacy-bat')
    addItem(items, 'baseball_bat', 1)
    save.containers.push({ id: 'drop:legacy-bat', opened: false, position: { ...save.player.position, y: 0 }, items })
  }
  // Continue through v2 → v3 with the same validator, so both steps are checked.
  const checked = validateSaveGame(save, mapId, map)
  return checked.ok ? { ...checked, migrated: true, fromVersion: 1 } : checked
}

/**
 * Pure deterministic v2 → v3: add each P2-S2 map container the save lacks, seeded by
 * hash(worldSeed, id) exactly like New Game. Existing containers (looted or not) are never
 * rerolled; fixed containers keep map order and drops follow, matching `createSnapshot`.
 */
function migrateV2(source: SaveGame, mapId: string, map?: MapData): SaveValidation {
  const save = structuredClone(source)
  save.schemaVersion = 3
  if (map) {
    const byId = new Map(save.containers.map((c) => [c.id, c]))
    const fixed = map.containers.map((def) => byId.get(def.id) ?? {
      id: def.id,
      opened: false,
      items: generateContainerLoot(def.loot ? LOOT_TABLES[def.loot] : undefined, save.worldSeed, def.id, GAME_CONFIG.inventory.containerSlots),
    })
    const fixedIds = new Set(map.containers.map((c) => c.id))
    save.containers = [...fixed, ...save.containers.filter((c) => !fixedIds.has(c.id))]
  }
  const checked = validateSaveGame(save, mapId, map)
  return checked.ok ? { ...checked, migrated: true, fromVersion: 2 } : checked
}

/** Pure v3 → v4: characters made before character creation get the default name and look. */
function migrateV3(source: SaveGame, mapId: string, map?: MapData): SaveValidation {
  const save = structuredClone(source)
  save.schemaVersion = 4
  save.player = { ...save.player, name: DEFAULT_PLAYER_NAME, appearance: { ...DEFAULT_APPEARANCE } }
  const checked = validateSaveGame(save, mapId, map)
  return checked.ok ? { ...checked, migrated: true, fromVersion: 3 } : checked
}
