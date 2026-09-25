import { ITEMS, type ItemId } from '../entities/items'
import { addItem, createInventory, type Inventory } from './inventory'
import { DOOR_MAX_HP } from '../world/doors'
import { NEIGHBORHOOD_MAP, mapRooms, mapWindows, type MapData } from '../world/mapData'
import { CONTAINERS_ADDED_V3, CONTAINERS_ADDED_V5, DOORS_ADDED_V7, WALL_PREFIXES_ADDED_V7, legacyContentFor, type LegacyContent } from '../world/legacyContent'
import { LOOT_TABLES } from '../world/lootTables'
import { generateContainerLoot } from './loot'
import { nearestZone } from './horde'
import { GAME_CONFIG } from '../core/config'
import { DEFAULT_APPEARANCE, DEFAULT_PLAYER_NAME, isAppearance, isValidName } from '../entities/appearance'
import { SAVE_SCHEMA_VERSION, type SaveGame, type SaveSummary } from '../../types/save'
import type { Vec3, ZombieAIState } from '../../types'

/** `fromVersion` is the stored schema before any in-memory migration. */
export type SaveValidation =
  | { ok: true; save: SaveGame; migrated: boolean; fromVersion: number }
  | { ok: false; reason: 'corrupt' | 'incompatible' | 'wrong-map'; detail: string }

const V1_STATES: ZombieAIState[] = ['IDLE', 'CHASE', 'SEARCH', 'ATTACK', 'DEAD']
const AI_STATES_V1: ReadonlySet<string> = new Set(V1_STATES)
/** v6 (P2-S5) adds wander, migration and door siege states. */
const AI_STATES_V6: ReadonlySet<string> = new Set<ZombieAIState>([...V1_STATES, 'WANDER', 'MIGRATE', 'APPROACH_STRUCTURE', 'ATTACK_STRUCTURE'])
const SIEGE_STATES: ReadonlySet<string> = new Set(['APPROACH_STRUCTURE', 'ATTACK_STRUCTURE'])

/** First save schema that uses stable content IDs (map content, docs/map-content-format.md). */
const CONTENT_IDS_VERSION = 8

/**
 * Validate current snapshots or migrate v1, without mutating input. Reject invalid
 * ownership, capacity and unknown schemas before the runtime or storage changes.
 * `map` is the current map; saves older than v8 of a world that became data-driven are checked
 * and migrated against its frozen legacy map, then renamed to stable IDs (v7 → v8).
 */
export function validateSaveGame(data: unknown, expectedMapId: string, map?: MapData): SaveValidation {
  if (!isRecord(data)) return corrupt('không phải object')
  if (typeof data.schemaVersion !== 'number') return corrupt('thiếu schemaVersion')
  const version = data.schemaVersion
  const legacyV1 = version === 1
  if (!Number.isInteger(version) || version < 1 || version > SAVE_SCHEMA_VERSION) {
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
    !(legacyV1 ? isLegacyInventory(player.inventory) : isInventory(player.inventory))
  ) {
    return corrupt('player')
  }
  // v4+: name and appearance are option IDs only; unknown IDs are rejected, never guessed.
  if (version >= 4 && (!isValidName(player.name) || !isAppearance(player.appearance))) return corrupt('player name/appearance')

  if (!Array.isArray(data.doors) || !data.doors.every((d) => isRecord(d) && typeof d.id === 'string' && (legacyV1
    ? typeof d.open === 'boolean'
    : ['open', 'closed', 'destroyed'].includes(String(d.state)) && isFiniteNumber(d.hp) && d.hp >= 0 && d.hp <= DOOR_MAX_HP && (d.state === 'destroyed' ? d.hp === 0 : d.hp > 0)))) {
    return corrupt('doors')
  }
  if (
    !Array.isArray(data.containers) ||
    !data.containers.every((c) => isRecord(c) && typeof c.id === 'string' && typeof c.opened === 'boolean' &&
      (legacyV1 ? isLegacyInventory(c.items) : isInventory(c.items)) && (c.position === undefined || !legacyV1 && isVec3(c.position)))
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
        (version >= 6 ? AI_STATES_V6 : AI_STATES_V1).has(z.ai) &&
        (z.lastKnownTarget === null || isVec3(z.lastKnownTarget)) &&
        (version < 6 || isZombieV6(z)),
    )
  ) {
    return corrupt('zombies')
  }
  if (version >= 6) {
    const horde = data.horde
    if (!isRecord(horde) || !isFiniteNumber(horde.timer) || horde.timer < 0 || !Number.isSafeInteger(horde.counter) || Number(horde.counter) < 0) return corrupt('horde')
  }
  if (version >= 7 && !isLighting(data.lighting)) return corrupt('lighting')
  if (version >= CONTENT_IDS_VERSION && (!Number.isSafeInteger(data.contentVersion) || Number(data.contentVersion) < 0)) return corrupt('contentVersion')
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
  const current = map ?? (expectedMapId === NEIGHBORHOOD_MAP.id ? NEIGHBORHOOD_MAP : undefined)
  const legacy = current && version < CONTENT_IDS_VERSION ? legacyContentFor(current) : undefined
  const knownMap = legacy ? legacy.map : current
  if (current && version >= CONTENT_IDS_VERSION && data.contentVersion !== (current.contentVersion ?? 0)) {
    // No content migrations exist yet: a save of another content revision cannot be mapped.
    return { ok: false, reason: 'incompatible', detail: `contentVersion ${String(data.contentVersion)}, cần ${current.contentVersion ?? 0}` }
  }
  const containers = data.containers as unknown as SaveGame['containers']
  if ((player.inventory as Inventory).slots.length !== GAME_CONFIG.inventory.slots) return corrupt('player inventory capacity')
  if (knownMap) {
    const doors = data.doors as { id: string }[]
    // Saves older than v7 predate the bedroom door; migration adds it in its initial state.
    const doorNewerThanSave = (id: string) => version < 7 && DOORS_ADDED_V7.has(id)
    const requiredDoors = knownMap.doors.filter((d) => !doorNewerThanSave(d.id))
    if (doors.some((d) => doorNewerThanSave(d.id))) return corrupt('door newer than schema')
    if (doors.length !== requiredDoors.length || requiredDoors.some((d) => !doors.some((s) => s.id === d.id))) return corrupt('door IDs do not match map')
    if (version >= 7) {
      const lighting = data.lighting as SaveGame['lighting']
      const sameIds = (saved: { id: string }[], ids: string[]) => saved.length === ids.length && ids.every((id) => saved.some((s) => s.id === id))
      if (!sameIds(lighting.curtains, mapWindows(knownMap).map((w) => w.id))) return corrupt('curtain IDs do not match map')
      if (!sameIds(lighting.lamps, mapRooms(knownMap).flatMap((r) => (r.lamp ? [r.lamp.id] : [])))) return corrupt('lamp IDs do not match map')
    }
    // Saves older than v3/v5 predate the P2-S2/P2-S4 containers; migration seeds them once.
    const newerThanSave = (id: string) => (version < 3 && CONTAINERS_ADDED_V3.has(id)) || (version < 5 && CONTAINERS_ADDED_V5.has(id))
    const required = knownMap.containers.filter((c) => !newerThanSave(c.id))
    if (required.some((c) => !containers.some((s) => s.id === c.id))) return corrupt('missing map container')
    if (version >= 6) {
      // Zones and siege doors must exist on this map.
      for (const z of data.zombies as { zoneId: string | null; structureTargetId: string | null }[]) {
        if (z.zoneId !== null && !knownMap.zombieZones?.some((zone) => zone.id === z.zoneId)) return corrupt('zombie zone')
        if (z.structureTargetId !== null && !knownMap.doors.some((d) => d.id === z.structureTargetId)) return corrupt('zombie door target')
      }
    }
    for (const c of containers) {
      if (newerThanSave(c.id)) return corrupt('container newer than schema')
      const fixed = knownMap.containers.some((d) => d.id === c.id)
      if (fixed ? c.position !== undefined : legacyV1 || !c.id.startsWith('drop:') || !c.position) return corrupt('unknown container')
      if (c.items.slots.length !== (fixed ? GAME_CONFIG.inventory.containerSlots : 1)) return corrupt('container capacity')
      if (c.position && (Math.abs(c.position.x) > knownMap.size / 2 || Math.abs(c.position.z) > knownMap.size / 2)) return corrupt('drop outside map')
    }
  }
  if (legacyV1) return migratePhase1(data, expectedMapId, current)
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
  if (version === 2) return migrateV2(save, expectedMapId, current, knownMap)
  if (version === 3) return migrateV3(save, expectedMapId, current)
  if (version === 4) return migrateV4(save, expectedMapId, current, knownMap)
  if (version === 5) return migrateV5(save, expectedMapId, current, knownMap)
  if (version === 6) return migrateV6(save, expectedMapId, current, knownMap)
  if (version === 7) return migrateV7(save, expectedMapId, current, legacy)
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

/** v7 lighting inputs: unique IDs, booleans only (derived light is never stored). */
function isLighting(v: unknown): boolean {
  if (!isRecord(v) || typeof v.electricity !== 'boolean' || !Array.isArray(v.curtains) || !Array.isArray(v.lamps)) return false
  const unique = (list: unknown[], flag: string) => {
    const ids = new Set<string>()
    for (const e of list) {
      if (!isRecord(e) || typeof e.id !== 'string' || !e.id || typeof e[flag] !== 'boolean' || ids.has(e.id)) return false
      ids.add(e.id)
    }
    return true
  }
  return unique(v.curtains, 'closed') && unique(v.lamps, 'on')
}

/** Memory is all-or-nothing; siege states always name their door and keep the memory they chase. */
function isZombieV6(z: Record<string, unknown>): boolean {
  if (!isFiniteNumber(z.memoryAge) || z.memoryAge < 0) return false
  if (z.memorySource !== null && z.memorySource !== 'sight' && z.memorySource !== 'noise') return false
  if ((z.lastKnownTarget === null) !== (z.memorySource === null)) return false
  if (z.zoneId !== null && typeof z.zoneId !== 'string') return false
  if (z.structureTargetId !== null && typeof z.structureTargetId !== 'string') return false
  const siege = SIEGE_STATES.has(String(z.ai))
  return siege ? z.structureTargetId !== null && z.lastKnownTarget !== null : z.structureTargetId === null
}

function isLegacyInventory(v: unknown): boolean {
  return isRecord(v) && Array.isArray(v.slots) && v.slots.every((s) => s === null ||
    isRecord(s) && typeof s.itemId === 'string' && Object.hasOwn(ITEMS, s.itemId) &&
    ['food', 'drink', 'medical'].includes(ITEMS[s.itemId as ItemId].kind) &&
    Number.isSafeInteger(s.quantity) && Number(s.quantity) > 0 && Number(s.quantity) <= ITEMS[s.itemId as ItemId].stackLimit)
}

/** Pure deterministic v1 → v2. Original data is never mutated; storage owns backup/commit. */
function migratePhase1(data: Record<string, unknown>, mapId: string, current?: MapData): SaveValidation {
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
  const checked = validateSaveGame(save, mapId, current)
  return checked.ok ? { ...checked, migrated: true, fromVersion: 1 } : checked
}

/**
 * Add the map containers in `added` that the save lacks, seeded by hash(worldSeed, id) exactly
 * like New Game. Existing containers (looted or not) are never rerolled; fixed containers keep
 * map order and drops follow, matching `createSnapshot`.
 */
function seedAddedContainers(save: SaveGame, added: ReadonlySet<string>, map?: MapData): void {
  if (!map) return
  const byId = new Map(save.containers.map((c) => [c.id, c]))
  const fixed = map.containers.flatMap((def) => {
    const existing = byId.get(def.id)
    if (existing) return [existing]
    if (!added.has(def.id)) return []
    const items = generateContainerLoot(def.loot ? LOOT_TABLES[def.loot] : undefined, save.worldSeed, def.id, GAME_CONFIG.inventory.containerSlots)
    return [{ id: def.id, opened: false, items }]
  })
  const fixedIds = new Set(map.containers.map((c) => c.id))
  save.containers = [...fixed, ...save.containers.filter((c) => !fixedIds.has(c.id))]
}

/** Pure deterministic v2 → v3: seed the P2-S2 melee containers once. */
function migrateV2(source: SaveGame, mapId: string, current?: MapData, map?: MapData): SaveValidation {
  const save = structuredClone(source)
  save.schemaVersion = 3
  seedAddedContainers(save, CONTAINERS_ADDED_V3, map)
  const checked = validateSaveGame(save, mapId, current)
  return checked.ok ? { ...checked, migrated: true, fromVersion: 2 } : checked
}

/** Pure v3 → v4: characters made before character creation get the default name and look. */
function migrateV3(source: SaveGame, mapId: string, current?: MapData): SaveValidation {
  const save = structuredClone(source)
  save.schemaVersion = 4
  save.player = { ...save.player, name: DEFAULT_PLAYER_NAME, appearance: { ...DEFAULT_APPEARANCE } }
  const checked = validateSaveGame(save, mapId, current)
  return checked.ok ? { ...checked, migrated: true, fromVersion: 3 } : checked
}

/**
 * Pure v4 → v5 (P2-S4): seed the three material containers once, like v2 → v3. Nothing else
 * changes; timed actions are never saved, so there is no action state to convert.
 */
function migrateV4(source: SaveGame, mapId: string, current?: MapData, map?: MapData): SaveValidation {
  const save = structuredClone(source)
  save.schemaVersion = 5
  seedAddedContainers(save, CONTAINERS_ADDED_V5, map)
  const checked = validateSaveGame(save, mapId, current)
  return checked.ok ? { ...checked, migrated: true, fromVersion: 4 } : checked
}

/**
 * Pure v5 → v6 (P2-S5): zombies keep state, HP and position; a remembered position counts as a
 * fresh sighting, each zombie joins the zone nearest to it, no door siege is in progress and the
 * horde director starts its first countdown. Items, doors and containers are untouched.
 */
function migrateV5(source: SaveGame, mapId: string, current?: MapData, map?: MapData): SaveValidation {
  const save = structuredClone(source)
  save.schemaVersion = 6
  save.zombies = save.zombies.map((z) => ({
    ...z,
    memoryAge: 0,
    memorySource: z.lastKnownTarget ? 'sight' : null,
    zoneId: nearestZone(z.position, map?.zombieZones)?.id ?? null,
    structureTargetId: null,
  }))
  save.horde = { timer: GAME_CONFIG.horde.intervalMin, counter: 0 }
  const checked = validateSaveGame(save, mapId, current)
  return checked.ok ? { ...checked, migrated: true, fromVersion: 5 } : checked
}

/** Clearance kept from a wall added in v7 when moving a migrated player/zombie out of it. */
const V7_WALL_CLEARANCE = 0.45

/** Push a point out of the added walls (nearest face, along the thin axis), else leave it. */
function outOfAddedWalls(p: Vec3, map: MapData): Vec3 {
  const out = { ...p }
  for (const w of map.walls) {
    if (!WALL_PREFIXES_ADDED_V7.some((prefix) => w.id.startsWith(prefix))) continue
    // Overhead pieces (the lintel above the new door) block nobody, like in the nav grid.
    if (w.position.y - w.size[1] / 2 >= 1.6) continue
    const hx = w.size[0] / 2 + V7_WALL_CLEARANCE
    const hz = w.size[2] / 2 + V7_WALL_CLEARANCE
    const dx = out.x - w.position.x
    const dz = out.z - w.position.z
    if (Math.abs(dx) >= hx || Math.abs(dz) >= hz) continue
    if (hx - Math.abs(dx) < hz - Math.abs(dz)) out.x = w.position.x + Math.sign(dx || 1) * (hx + 0.05)
    else out.z = w.position.z + Math.sign(dz || 1) * (hz + 0.05)
  }
  return out
}

/**
 * Pure v6 → v7 (building lighting): the bedroom door is added in its initial state (open), curtains
 * open, lamps off, the grid powered; a player or zombie standing where the new partition is gets
 * moved beside it. Everything else is untouched.
 */
function migrateV6(source: SaveGame, mapId: string, current?: MapData, map?: MapData): SaveValidation {
  const save = structuredClone(source)
  save.schemaVersion = 7
  if (map) {
    for (const d of map.doors) {
      if (DOORS_ADDED_V7.has(d.id) && !save.doors.some((s) => s.id === d.id)) {
        save.doors.push({ id: d.id, state: d.initialState ?? 'closed', hp: DOOR_MAX_HP })
      }
    }
    save.player.position = outOfAddedWalls(save.player.position, map)
    save.zombies = save.zombies.map((z) => ({ ...z, position: outOfAddedWalls(z.position, map) }))
  }
  save.lighting = {
    curtains: map ? mapWindows(map).map((w) => ({ id: w.id, closed: false })) : [],
    lamps: map ? mapRooms(map).flatMap((r) => (r.lamp ? [{ id: r.lamp.id, on: false }] : [])) : [],
    electricity: true,
  }
  const checked = validateSaveGame(save, mapId, current)
  return checked.ok ? { ...checked, migrated: true, fromVersion: 6 } : checked
}

/** Entries in the order of `order` (how the runtime snapshots them); unknown IDs (drops) after, kept in order. */
function inMapOrder<T extends { id: string }>(list: T[], order: readonly { id: string }[]): T[] {
  const rank = new Map(order.map((o, i) => [o.id, i]))
  const at = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER
  return list.map((x, i) => ({ x, i })).sort((a, b) => at(a.x.id) - at(b.x.id) || a.i - b.i).map(({ x }) => x)
}

/**
 * Pure v7 → v8 (map content): the save records the content revision, and on a world whose IDs
 * changed (the neighbourhood) every stored map ID is renamed through the legacy table: doors,
 * map containers, curtains (windows), lamps, zombie zones and siege doors. Dropped bags keep
 * their `drop:` IDs; inventory and item IDs never change. Lists follow the current map order
 * (like `createSnapshot`). An ID missing from the table is left as is, so the v8
 * validation rejects the save (the original stays in storage) instead of dropping that state.
 */
function migrateV7(source: SaveGame, mapId: string, current?: MapData, legacy?: LegacyContent): SaveValidation {
  const save = structuredClone(source)
  save.schemaVersion = 8
  save.contentVersion = current?.contentVersion ?? 0
  if (current && legacy) {
    const { ids } = legacy
    const rename = (table: Record<string, string>, id: string) => table[id] ?? id
    save.doors = inMapOrder(save.doors.map((d) => ({ ...d, id: rename(ids.doors, d.id) })), current.doors)
    const renamed = save.containers.map((c) => (c.id.startsWith('drop:') ? c : { ...c, id: rename(ids.containers, c.id) }))
    save.containers = inMapOrder(renamed, current.containers)
    save.lighting = {
      ...save.lighting,
      curtains: inMapOrder(save.lighting.curtains.map((c) => ({ ...c, id: rename(ids.windows, c.id) })), mapWindows(current)),
      lamps: inMapOrder(save.lighting.lamps.map((l) => ({ ...l, id: rename(ids.lamps, l.id) })), mapRooms(current).flatMap((r) => (r.lamp ? [r.lamp] : []))),
    }
    save.zombies = save.zombies.map((z) => ({
      ...z,
      zoneId: z.zoneId === null ? null : rename(ids.zones, z.zoneId),
      structureTargetId: z.structureTargetId === null ? null : rename(ids.doors, z.structureTargetId),
    }))
  }
  const checked = validateSaveGame(save, mapId, current)
  return checked.ok ? { ...checked, migrated: true, fromVersion: 7 } : checked
}
