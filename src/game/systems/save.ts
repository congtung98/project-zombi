import { ITEMS, type ItemId, type ItemInstance } from '../entities/items'
import { type Inventory, type InventoryKind } from './inventory'
import { DOOR_MAX_HP } from '../world/doors'
import { NEIGHBORHOOD_MAP, mapBounds, mapRooms, mapWindows, type MapData } from '../world/mapData'
import { CONTAINERS_ADDED_V3, CONTAINERS_ADDED_V5, DOORS_ADDED_V7, LEGACY_CONTENT_VERSION, WALL_PREFIXES_ADDED_V7, legacyContentFor, type LegacyContent } from '../world/legacyContent'
import { planContentMigration, statefulIds, type StatefulIds } from '../../map/contentMigration'
import { zoneFor } from '../world/zones'
import { LOOT_TABLES } from '../world/lootTables'
import { applyBonusLoot, generateContainerLoot, seedContainer, type BonusLootRule } from './loot'
import { bagInstanceIdOf, type BagStore } from './bags'
import { FloorStore, floorCellId, type SavedFloorCell } from './floor'
import { nearestZone } from './horde'
import { GAME_CONFIG } from '../core/config'
import { DEFAULT_APPEARANCE, DEFAULT_PLAYER_NAME, isAppearance, isValidName } from '../entities/appearance'
import { SAVE_SCHEMA_VERSION, type LegacyInventory, type SaveGame, type SaveSummary, type SavedContainer } from '../../types/save'
import type { Vec3, ZombieAIState } from '../../types'

/** Outcome of one bonus loot rule applied to an older save (INV-LOOT, `lootPatches`). */
export interface LootPatchReport {
  rule: string
  itemId: ItemId
  /** Suitable map containers the player never opened (the recorded `opened` flag), i.e. considered. */
  eligible: number
  /** Items added (the rule's seeded roll hit and a slot was free). */
  added: number
  /** Containers the roll picked but that had no free slot (nothing added, nothing removed). */
  full: number
}

/** `fromVersion` is the stored schema before any in-memory migration. */
export type SaveValidation =
  /** `contentFrom`: the save was written for this older content revision and was mapped onto the current one (M8). */
  | { ok: true; save: SaveGame; migrated: boolean; fromVersion: number; contentFrom?: number; lootPatch?: LootPatchReport[] }
  | { ok: false; reason: 'corrupt' | 'incompatible' | 'wrong-map'; detail: string }

const V1_STATES: ZombieAIState[] = ['IDLE', 'CHASE', 'SEARCH', 'ATTACK', 'DEAD']
const AI_STATES_V1: ReadonlySet<string> = new Set(V1_STATES)
/** v6 (P2-S5) adds wander, migration and door siege states. */
const AI_STATES_V6: ReadonlySet<string> = new Set<ZombieAIState>([...V1_STATES, 'WANDER', 'MIGRATE', 'APPROACH_STRUCTURE', 'ATTACK_STRUCTURE'])
const SIEGE_STATES: ReadonlySet<string> = new Set(['APPROACH_STRUCTURE', 'ATTACK_STRUCTURE'])

/** First save schema that uses stable content IDs (map content, docs/map-content-format.md). */
const CONTENT_IDS_VERSION = 8
/** First save schema with list inventories, bags and loot patches (INV-LOOT). */
const LIST_INVENTORY_VERSION = 10
/** First save schema with floor items instead of dropped-bag containers (INV-LOOT S3). */
const FLOOR_VERSION = 11

type LegacySavedContainer = Omit<SavedContainer, 'items'> & { items: LegacyInventory }

/** A save older than v10 (validated at its own version): slot-array inventories, no bags. */
type LegacySaveGame = Omit<SaveGame, 'player' | 'containers' | 'bags' | 'lootPatches' | 'floor'> & {
  player: Omit<SaveGame['player'], 'inventory' | 'equipment'> & { inventory: LegacyInventory; equipment: { weaponInstanceId: string | null } }
  containers: LegacySavedContainer[]
}

type AnySave = SaveGame | LegacySaveGame

/** Instances of an inventory in either stored shape (slot array before v10, list since). */
function instancesOf(inv: Inventory | LegacyInventory): ItemInstance[] {
  return 'items' in inv ? inv.items : inv.slots.filter((s): s is ItemInstance => s !== null)
}

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
  const listShape = version >= LIST_INVENTORY_VERSION
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
    !(legacyV1 ? isLegacyInventory(player.inventory) : listShape ? isListInventory(player.inventory, 'player') : isSlotInventory(player.inventory))
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
      (legacyV1 ? isLegacyInventory(c.items) : listShape ? isListInventory(c.items, c.position === undefined ? 'container' : 'drop') : isSlotInventory(c.items)) &&
      (c.position === undefined || !legacyV1 && version < FLOOR_VERSION && isVec3(c.position)))
  ) {
    return corrupt('containers')
  }
  if (listShape) {
    if (!Array.isArray(data.bags) || !data.bags.every((b) => isListInventory(b, 'bag'))) return corrupt('bags')
    const patches = data.lootPatches
    if (!Array.isArray(patches) || !patches.every((p) => typeof p === 'string' && p !== '') || new Set(patches).size !== patches.length) return corrupt('lootPatches')
  }
  if (version >= FLOOR_VERSION && (!Array.isArray(data.floor) || !data.floor.every(isFloorCell))) return corrupt('floor')
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
    // An older content revision maps through the world's content migrations (M8); a newer one never.
    if (Number(data.contentVersion) < (current.contentVersion ?? 0)) return migrateContent(data as unknown as AnySave, expectedMapId, current)
    return { ok: false, reason: 'incompatible', detail: `contentVersion ${String(data.contentVersion)}, cần ${current.contentVersion ?? 0}` }
  }
  const containers = data.containers as unknown as (SavedContainer | LegacySavedContainer)[]
  // Before v10 the player's capacity was the slot count; since v10 the saved capacity is kept as is.
  if (!listShape && (player.inventory as unknown as LegacyInventory).slots.length !== GAME_CONFIG.inventory.slots) return corrupt('player inventory capacity')
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
      if (fixed ? c.position !== undefined : legacyV1 || version >= FLOOR_VERSION || !c.id.startsWith('drop:') || !c.position) return corrupt('unknown container')
      // Before v10 the slot count was the map rule; since v10 a map container keeps its saved capacity.
      const capacity = 'items' in c.items ? c.items.slotCapacity : c.items.slots.length
      if (listShape ? !fixed && capacity !== 1 : capacity !== (fixed ? GAME_CONFIG.inventory.containerSlots : 1)) return corrupt('container capacity')
      const area = mapBounds(knownMap)
      if (c.position && (c.position.x < area.minX || c.position.x > area.maxX || c.position.z < area.minZ || c.position.z > area.maxZ)) return corrupt('drop outside map')
    }
    if (version >= FLOOR_VERSION) {
      const area = mapBounds(knownMap)
      for (const cell of data.floor as SavedFloorCell[]) {
        for (const { position: p } of cell.positions) if (p.x < area.minX || p.x > area.maxX || p.z < area.minZ || p.z > area.maxZ) return corrupt('floor item outside map')
      }
    }
  }
  if (legacyV1) return migratePhase1(data, expectedMapId, current)
  const owners = new Set<string>()
  const inventoryIds = new Set<string>()
  const playerInventory = player.inventory as unknown as Inventory | LegacyInventory
  const bagRecords = listShape ? (data.bags as Inventory[]) : []
  const floorCells = version >= FLOOR_VERSION ? (data.floor as SavedFloorCell[]).map((c) => c.items) : []
  const inventories = [playerInventory, ...containers.map((c) => c.items), ...floorCells, ...bagRecords]
  for (const inv of inventories) {
    if (inventoryIds.has(inv.id)) return corrupt('duplicate inventory namespace')
    inventoryIds.add(inv.id)
    for (const item of instancesOf(inv)) {
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
  const carried = instancesOf(playerInventory)
  const weaponId = player.equipment.weaponInstanceId
  if (weaponId !== null && (typeof weaponId !== 'string' || !carried.some((i) => i.id === weaponId && i.kind === 'weapon'))) return corrupt('equipment owner/reference')
  if (listShape) {
    const backId = player.equipment.backInstanceId
    if (backId !== null && (typeof backId !== 'string' || !carried.some((i) => i.id === backId && i.kind === 'bag'))) return corrupt('worn bag owner/reference')
    // Every bag instance (carried, in a container, dropped) has exactly one contents record and back.
    const bagIds = new Set(inventories.filter((inv) => !bagRecords.includes(inv as Inventory)).flatMap((inv) => instancesOf(inv).filter((i) => i.kind === 'bag').map((i) => i.id)))
    if (bagRecords.length !== bagIds.size || bagRecords.some((b) => !bagIds.has(bagInstanceIdOf(b.id)))) return corrupt('bag contents records')
  }
  if (!listShape) {
    const save = data as unknown as LegacySaveGame
    if (version === 2) return migrateV2(save, expectedMapId, current, knownMap)
    if (version === 3) return migrateV3(save, expectedMapId, current)
    if (version === 4) return migrateV4(save, expectedMapId, current, knownMap)
    if (version === 5) return migrateV5(save, expectedMapId, current, knownMap)
    if (version === 6) return migrateV6(save, expectedMapId, current, knownMap)
    if (version === 7) return migrateV7(save, expectedMapId, current, legacy)
    if (version === 8) return migrateV8(save, expectedMapId, current)
    return migrateV9(save, expectedMapId, current)
  }
  const save = data as unknown as SaveGame
  if (version === 10) return migrateV10(save, expectedMapId, current)
  // Released bonus loot rules this world has not had yet (an older save): applied once, recorded.
  if (current && GAME_CONFIG.bonusLoot.some((r) => !save.lootPatches.includes(r.id))) return patchLoot(save, expectedMapId, current)
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

/**
 * One stored instance: known item, quantity within the stack limit, state matching its kind. An item
 * this version does not know (INV-LOOT S5, T19) is accepted with a sound shape (ID, positive whole
 * quantity, kind named, favorite as the version allows) and loaded as a recovery item that keeps
 * its payload (`recovery.ts`); the stand-in ID itself is never a stored item.
 */
function isInstance(s: unknown, allowV10: boolean): s is ItemInstance {
  if (!isRecord(s) || typeof s.id !== 'string' || !s.id || typeof s.itemId !== 'string' || !s.itemId || s.itemId === 'unknown_item') return false
  if (!Object.hasOwn(ITEMS, s.itemId)) {
    return typeof s.kind === 'string' && Number.isSafeInteger(s.quantity) && Number(s.quantity) > 0 && (s.favorite === undefined || (allowV10 && s.favorite === true))
  }
  const def = ITEMS[s.itemId as ItemId]
  // Favorites and bags exist since v10 only.
  if (s.favorite !== undefined && !(allowV10 && s.favorite === true)) return false
  if (!Number.isSafeInteger(s.quantity) || Number(s.quantity) <= 0 || Number(s.quantity) > def.stackLimit) return false
  if (def.kind === 'weapon') return s.kind === 'weapon' && s.quantity === 1 && isFiniteNumber(s.condition) && s.condition >= 0 && s.condition <= def.maxCondition! && s.fuel === undefined
  if (def.kind === 'tool') return s.kind === 'tool' && s.quantity === 1 && s.condition === undefined && (def.maxFuel === undefined ? s.fuel === undefined : isFiniteNumber(s.fuel) && s.fuel >= 0 && s.fuel <= def.maxFuel)
  if (def.kind === 'bag') return allowV10 && s.kind === 'bag' && s.quantity === 1 && s.condition === undefined && s.fuel === undefined
  return s.kind === 'stack' && s.condition === undefined && s.fuel === undefined
}

/** v2–v9 inventory: slot array with `null` for empty slots. */
function isSlotInventory(v: unknown): v is LegacyInventory {
  if (!isRecord(v) || typeof v.id !== 'string' || !v.id || !Number.isSafeInteger(v.nextItemId) || Number(v.nextItemId) < 1 || !Array.isArray(v.slots)) return false
  return v.slots.every((s) => s === null || isInstance(s, false))
}

/**
 * v10 inventory of the expected kind: a list with a positive saved capacity. More items than the
 * capacity is accepted (overcapacity from older data is kept, never truncated); a bag's contents
 * never hold a bag.
 */
function isListInventory(v: unknown, kind: InventoryKind): v is Inventory {
  if (!isRecord(v) || typeof v.id !== 'string' || !v.id || v.kind !== kind || !Number.isSafeInteger(v.nextItemId) || Number(v.nextItemId) < 1 || !Array.isArray(v.items)) return false
  if (kind === 'floor' ? v.slotCapacity !== null : !Number.isSafeInteger(v.slotCapacity) || Number(v.slotCapacity) <= 0) return false
  if (kind === 'bag' && !v.id.startsWith('bag:')) return false
  return v.items.every((s) => isInstance(s, true) && !(kind === 'bag' && s.kind === 'bag'))
}

/**
 * v11 floor cell: a non-empty `floor` inventory named like the cell, one position per item (no more,
 * no fewer) and every position inside that cell (1 m, same storey).
 */
function isFloorCell(v: unknown): v is SavedFloorCell {
  if (!isRecord(v) || typeof v.id !== 'string' || !v.id.startsWith('floor:') || !isFiniteNumber(v.y) || !Array.isArray(v.positions)) return false
  if (!isListInventory(v.items, 'floor') || v.items.id !== v.id || v.items.items.length === 0) return false
  const ids = new Set(v.items.items.map((i) => i.id))
  if (v.positions.length !== ids.size) return false
  return v.positions.every((p) => isRecord(p) && typeof p.id === 'string' && ids.has(p.id) && isVec3(p.position) && floorCellId(p.position) === v.id)
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

/** Slot array → list, same instances in slot order; the slot count becomes the saved capacity. */
function fromSlots(inv: LegacyInventory, kind: InventoryKind): Inventory {
  return { id: inv.id, kind, nextItemId: inv.nextItemId, items: inv.slots.filter((s): s is ItemInstance => s !== null), slotCapacity: inv.slots.length }
}

/** Generated list → slot array of `size` for a migration step older than v10 (the list never exceeds it). */
function toSlots(inv: Inventory, size: number): LegacyInventory {
  return { id: inv.id, nextItemId: inv.nextItemId, slots: Array.from({ length: size }, (_, i) => inv.items[i] ?? null) }
}

/** Pure deterministic v1 → v2. Original data is never mutated; storage owns backup/commit. */
function migratePhase1(data: Record<string, unknown>, mapId: string, current?: MapData): SaveValidation {
  const save = structuredClone(data) as unknown as LegacySaveGame
  const convert = (old: LegacyInventory, id: string): LegacyInventory => {
    const inv: LegacyInventory = { id, nextItemId: 1, slots: [] }
    inv.slots = old.slots.map((s) => s ? { id: `${id}:${inv.nextItemId++}`, itemId: s.itemId, kind: 'stack', quantity: s.quantity } : null)
    return inv
  }
  const bat = (inv: LegacyInventory): ItemInstance => ({ id: `${inv.id}:${inv.nextItemId++}`, itemId: 'baseball_bat', kind: 'weapon', quantity: 1, condition: ITEMS.baseball_bat.maxCondition! })
  save.schemaVersion = 2
  save.player.inventory = convert(save.player.inventory, 'player')
  save.player.equipment = { weaponInstanceId: null }
  save.containers = save.containers.map((c) => ({ ...c, items: convert(c.items, `loot:${save.worldSeed}:${c.id}`) }))
  save.doors = (data.doors as { id: string; open: boolean }[]).map((d) => ({ id: d.id, state: d.open ? 'open' : 'closed', hp: DOOR_MAX_HP }))
  const bag = save.player.inventory
  const free = bag.slots.indexOf(null)
  if (free >= 0) {
    const weapon = bat(bag)
    bag.slots[free] = weapon
    save.player.equipment.weaponInstanceId = weapon.id
  } else {
    // A non-solid loot bag at the saved player position is reachable without crossing a wall.
    const items: LegacyInventory = { id: 'legacy-bat', nextItemId: 1, slots: [null] }
    items.slots[0] = bat(items)
    save.containers.push({ id: 'drop:legacy-bat', opened: false, position: { ...save.player.position, y: 0 }, items })
  }
  // Continue through v2 → v3 with the same validator, so both steps are checked.
  const checked = validateSaveGame(save, mapId, current)
  return checked.ok ? { ...checked, migrated: true, fromVersion: 1 } : checked
}

/**
 * Add the map containers in `added` that the save lacks, seeded by hash(worldSeed, id) exactly
 * like New Game. Existing containers (looted or not) are never rerolled; fixed containers keep
 * map order and drops follow, matching `createSnapshot`. Before v10 the result is a slot array and
 * carries no bonus loot (the v10 loot patch gives it to unopened containers, these included); since
 * v10 it is exactly New Game's container, bonus loot and bag contents included.
 */
function seedAddedContainers(save: AnySave, added: ReadonlySet<string>, map?: MapData): void {
  if (!map) return
  const list = save.schemaVersion >= LIST_INVENTORY_VERSION
  const slots = GAME_CONFIG.inventory.containerSlots
  const bags: BagStore = new Map(list ? (save as SaveGame).bags.map((b) => [bagInstanceIdOf(b.id), b]) : [])
  const containers = save.containers as (SavedContainer | LegacySavedContainer)[]
  const byId = new Map(containers.map((c) => [c.id, c]))
  const fixed = map.containers.flatMap((def) => {
    const existing = byId.get(def.id)
    if (existing) return [existing]
    if (!added.has(def.id)) return []
    const items = list
      ? seedContainer(def.loot, save.worldSeed, def.id, slots, bags, LOOT_TABLES)
      : toSlots(generateContainerLoot(def.loot ? LOOT_TABLES[def.loot] : undefined, save.worldSeed, def.id, slots), slots)
    return [{ id: def.id, opened: false, items }]
  })
  const fixedIds = new Set(map.containers.map((c) => c.id))
  save.containers = [...fixed, ...containers.filter((c) => !fixedIds.has(c.id))] as typeof save.containers
  if (list) (save as SaveGame).bags = [...bags.values()]
}

/** Pure deterministic v2 → v3: seed the P2-S2 melee containers once. */
function migrateV2(source: LegacySaveGame, mapId: string, current?: MapData, map?: MapData): SaveValidation {
  const save = structuredClone(source)
  save.schemaVersion = 3
  seedAddedContainers(save, CONTAINERS_ADDED_V3, map)
  const checked = validateSaveGame(save, mapId, current)
  return checked.ok ? { ...checked, migrated: true, fromVersion: 2 } : checked
}

/** Pure v3 → v4: characters made before character creation get the default name and look. */
function migrateV3(source: LegacySaveGame, mapId: string, current?: MapData): SaveValidation {
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
function migrateV4(source: LegacySaveGame, mapId: string, current?: MapData, map?: MapData): SaveValidation {
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
function migrateV5(source: LegacySaveGame, mapId: string, current?: MapData, map?: MapData): SaveValidation {
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
function migrateV6(source: LegacySaveGame, mapId: string, current?: MapData, map?: MapData): SaveValidation {
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
function migrateV7(source: LegacySaveGame, mapId: string, current?: MapData, legacy?: LegacyContent): SaveValidation {
  const save = structuredClone(source)
  save.schemaVersion = 8
  // The legacy table targets content v1; later revisions follow the content migrations (M8).
  save.contentVersion = legacy ? LEGACY_CONTENT_VERSION : (current?.contentVersion ?? 0)
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

/**
 * Pure v8 → v9 (M11b storeys): `y` of every stored position becomes the feet height. Before v9 the
 * world had one storey, so everything stood on the ground: the player's body centre, zombies,
 * memories and dropped bags all get y = 0. Nothing else changes.
 */
function migrateV8(source: LegacySaveGame, mapId: string, current?: MapData): SaveValidation {
  const save = structuredClone(source)
  save.schemaVersion = 9
  const ground = (p: Vec3): Vec3 => ({ ...p, y: 0 })
  save.player.position = ground(save.player.position)
  save.zombies = save.zombies.map((z) => ({ ...z, position: ground(z.position), lastKnownTarget: z.lastKnownTarget ? ground(z.lastKnownTarget) : null }))
  save.containers = save.containers.map((c) => (c.position ? { ...c, position: ground(c.position) } : c))
  const checked = validateSaveGame(save, mapId, current)
  return checked.ok ? { ...checked, migrated: true, fromVersion: 8 } : checked
}

/**
 * Pure v9 → v10 (INV-LOOT): every inventory becomes a list of the same instances in slot order, with
 * its old slot count as the saved capacity (main 12, map containers 8, dropped bags 1) and a kind;
 * IDs, quantities, conditions and the equipped weapon never change; nothing is worn on the back and
 * no bag exists yet. The released bonus loot rules then run once through `patchLoot` (v10 check).
 */
function migrateV9(source: LegacySaveGame, mapId: string, current?: MapData): SaveValidation {
  const save = structuredClone(source) as unknown as SaveGame
  save.schemaVersion = 10
  save.player.inventory = fromSlots(source.player.inventory, 'player')
  save.player.equipment = { weaponInstanceId: source.player.equipment.weaponInstanceId, backInstanceId: null }
  save.containers = source.containers.map((c) => ({ ...structuredClone(c), items: fromSlots(c.items, c.position ? 'drop' : 'container') }))
  save.bags = []
  save.lootPatches = []
  const checked = validateSaveGame(save, mapId, current)
  return checked.ok ? { ...checked, migrated: true, fromVersion: 9 } : checked
}

/**
 * Apply every released bonus loot rule this save has not had (INV-LOOT, `lootPatches`), once:
 * - only map containers whose recorded `opened` flag is false (set only when the player opened them
 *   with E, saved since Phase 1): a container that still holds items is not assumed unopened;
 * - only containers whose loot table the rule names, and only into a free slot: nothing is removed,
 *   replaced or merged;
 * - the rule's own seed stream per container, so the result equals a New Game with the same seed;
 * - the rule is recorded even when nothing qualifies (the report says so); the item's ID is
 *   deterministic, so running the patch again can never add a second one.
 */
function patchLoot(source: SaveGame, mapId: string, map: MapData): SaveValidation {
  const save = structuredClone(source)
  const bags: BagStore = new Map(save.bags.map((b) => [bagInstanceIdOf(b.id), b]))
  const tables = new Map(map.containers.map((c) => [c.id, c.loot]))
  const reports: LootPatchReport[] = []
  const rules: readonly BonusLootRule[] = GAME_CONFIG.bonusLoot
  for (const rule of rules) {
    if (save.lootPatches.includes(rule.id)) continue
    const report: LootPatchReport = { rule: rule.id, itemId: rule.itemId, eligible: 0, added: 0, full: 0 }
    for (const c of save.containers) {
      const table = tables.get(c.id)
      if (c.position || c.opened || !table || !rule.tables.includes(table)) continue
      report.eligible += 1
      const outcome = applyBonusLoot(c.items, table, save.worldSeed, c.id, rule, bags)
      if (outcome === 'added') report.added += 1
      else if (outcome === 'full') report.full += 1
    }
    save.lootPatches.push(rule.id)
    reports.push(report)
  }
  save.bags = [...bags.values()]
  const checked = validateSaveGame(save, mapId, map)
  return checked.ok ? { ...checked, migrated: true, fromVersion: source.schemaVersion, lootPatch: [...reports, ...(checked.lootPatch ?? [])] } : checked
}

/**
 * Pure v10 → v11 (INV-LOOT S3): every dropped bag becomes floor items at the position it lay, with
 * the same instances (IDs, quantities, conditions, bag contents); the bag containers go away. Nothing
 * else changes.
 */
function migrateV10(source: SaveGame, mapId: string, current?: MapData): SaveValidation {
  const save = structuredClone(source)
  save.schemaVersion = FLOOR_VERSION
  const floor = new FloorStore()
  for (const c of save.containers) {
    if (!c.position) continue
    for (const item of c.items.items) {
      const cell = floor.cellAt(c.position)
      cell.items.items.push(item)
      floor.sync(cell, c.position)
    }
  }
  save.containers = save.containers.filter((c) => !c.position)
  save.floor = floor.serialize()
  const checked = validateSaveGame(save, mapId, current)
  return checked.ok ? { ...checked, migrated: true, fromVersion: 10 } : checked
}

/** Stateful IDs of a map (M8): what a save of its content revision holds state for. */
export function mapStatefulIds(map: MapData): StatefulIds {
  return statefulIds([{ doors: map.doors, containers: map.containers, windows: mapWindows(map), rooms: mapRooms(map), zones: map.zombieZones ?? [] }])
}

/** Clearance kept from a solid when moving a migrated player/zombie/bag out of it (M8). */
const SOLID_CLEARANCE = 0.45
/** Solids whose bottom is above this block nobody (the nav grid's overhead threshold). */
const OVERHEAD_BOTTOM = 1.6

/**
 * Move a point out of the low solids of a map (walls, props, containers, window panes) along the
 * nearest face, a few passes for corners, then into the play area. Content migrations use it for
 * the player, zombies and bags that a new wall or building now covers. M11b: only the solids of the
 * storey the point stands on (`y` = its floor).
 */
function outOfSolids(p: Vec3, map: MapData): Vec3 {
  const low = (bottom: number, top: number) => bottom < p.y + OVERHEAD_BOTTOM && top > p.y + 0.05
  const boxes = [
    ...[...map.walls, ...map.containers].filter((w) => low(w.position.y - w.size[1] / 2, w.position.y + w.size[1] / 2)).map((w) => ({ x: w.position.x, z: w.position.z, hx: w.size[0] / 2, hz: w.size[2] / 2 })),
    ...mapWindows(map).filter((w) => Math.abs(w.center.y - (w.sill + w.head) / 2 - p.y) < 0.5).map((w) => ({ x: w.center.x, z: w.center.z, hx: (w.alongX ? w.width : w.thickness) / 2, hz: (w.alongX ? w.thickness : w.width) / 2 })),
  ]
  const out = { ...p }
  for (let pass = 0; pass < 4; pass++) {
    let moved = false
    for (const b of boxes) {
      const hx = b.hx + SOLID_CLEARANCE
      const hz = b.hz + SOLID_CLEARANCE
      const dx = out.x - b.x
      const dz = out.z - b.z
      if (Math.abs(dx) >= hx || Math.abs(dz) >= hz) continue
      if (hx - Math.abs(dx) < hz - Math.abs(dz)) out.x = b.x + Math.sign(dx || 1) * (hx + 0.05)
      else out.z = b.z + Math.sign(dz || 1) * (hz + 0.05)
      moved = true
    }
    if (!moved) break
  }
  const area = mapBounds(map)
  out.x = Math.min(area.maxX - 0.5, Math.max(area.minX + 0.5, out.x))
  out.z = Math.min(area.maxZ - 0.5, Math.max(area.minZ + 0.5, out.z))
  return out
}

/**
 * Pure content migration (M8): a v8 save written for an older content revision of this world is
 * checked against that revision's IDs (the first step's `ids`, exactly like against its map), then
 * mapped onto the current content through every step:
 * - doors, map containers, curtains, lamps and zones that stay (or were renamed) keep their state;
 * - new doors start in their initial state, curtains open, lamps off, new containers are seeded
 *   by hash(worldSeed, id) like New Game;
 * - a removed container's items fall to the ground where it stood (one bag per item, `drop:<item>`,
 *   like dropping them); removed doors/curtains/lamps simply lose their state;
 * - zombies of a removed zone join the zone the runtime rule gives them; a siege on a removed door
 *   becomes a search of the remembered position;
 * - the player, zombies and bags a new solid covers are moved beside it.
 * Items and inventory IDs never change. A missing step or newer content: incompatible.
 */
function migrateContent(source: AnySave, mapId: string, current: MapData): SaveValidation {
  const from = source.contentVersion
  const currentVersion = current.contentVersion ?? 0
  const plan = planContentMigration(current.contentMigrations ?? [], from, mapStatefulIds(current), currentVersion)
  if (!plan) return { ok: false, reason: 'incompatible', detail: `contentVersion ${from}, cần ${currentVersion} (không có migration nội dung v${from} → v${currentVersion})` }
  const e = plan.expected
  const same = (saved: string[], want: string[]) => saved.length === want.length && want.every((id) => saved.includes(id))
  if (!same(source.doors.map((d) => d.id), e.doors)) return corrupt(`door IDs do not match content v${from}`)
  if (!same(source.containers.filter((c) => !c.position).map((c) => c.id), e.containers.map((c) => c.id))) return corrupt(`container IDs do not match content v${from}`)
  if (!same(source.lighting.curtains.map((c) => c.id), e.windows)) return corrupt(`curtain IDs do not match content v${from}`)
  if (!same(source.lighting.lamps.map((l) => l.id), e.lamps)) return corrupt(`lamp IDs do not match content v${from}`)
  for (const z of source.zombies) {
    if (z.zoneId !== null && !e.zones.includes(z.zoneId)) return corrupt(`zombie zone not in content v${from}`)
    if (z.structureTargetId !== null && !e.doors.includes(z.structureTargetId)) return corrupt(`zombie door target not in content v${from}`)
  }

  const list = source.schemaVersion >= LIST_INVENTORY_VERSION
  const onFloor = source.schemaVersion >= FLOOR_VERSION
  const save = structuredClone(source) as Omit<AnySave, 'containers'> & { containers: (SavedContainer | LegacySavedContainer)[]; floor?: SavedFloorCell[] }
  const floorItems: { item: ItemInstance; position: Vec3 }[] = []
  const to = (id: string) => plan.target.get(id) ?? null
  const doors = save.doors.flatMap((d) => {
    const id = to(d.id)
    return id ? [{ ...d, id }] : []
  })
  for (const d of current.doors) if (!doors.some((s) => s.id === d.id)) doors.push({ id: d.id, state: d.initialState ?? 'closed', hp: DOOR_MAX_HP })
  save.doors = inMapOrder(doors, current.doors)

  const kept: (SavedContainer | LegacySavedContainer)[] = []
  const drops = new Map<string, SavedContainer | LegacySavedContainer>()
  for (const c of save.containers) {
    if (c.position) {
      drops.set(c.id, { ...c, position: { ...outOfSolids(c.position, current), y: c.position.y } })
      continue
    }
    const id = to(c.id)
    if (id) {
      kept.push({ ...c, id })
      continue
    }
    const at = e.containers.find((x) => x.id === c.id)!.position
    const spot = outOfSolids({ x: at.x, y: 0, z: at.z }, current)
    for (const item of instancesOf(c.items)) {
      if (onFloor) {
        floorItems.push({ item, position: spot })
        continue
      }
      const dropId = `drop:${item.id}`
      const items: Inventory | LegacyInventory = list
        ? { id: dropId, kind: 'drop', nextItemId: 1, items: [item], slotCapacity: 1 }
        : { id: dropId, nextItemId: 1, slots: [item] }
      drops.set(dropId, { id: dropId, opened: false, items, position: spot } as SavedContainer | LegacySavedContainer)
    }
  }
  save.containers = [...kept, ...drops.values()]
  if (onFloor) {
    // Items already on the floor that a new solid covers move beside it (their storey kept).
    const floor = new FloorStore()
    const all = [
      ...(save.floor ?? []).flatMap((cell) => cell.items.items.map((item) => {
        const p = cell.positions.find((x) => x.id === item.id)!.position
        return { item, position: { ...outOfSolids(p, current), y: p.y } }
      })),
      ...floorItems,
    ]
    for (const { item, position } of all) {
      const cell = floor.cellAt(position)
      cell.items.items.push(item)
      floor.sync(cell, position)
    }
    save.floor = floor.serialize()
  }
  seedAddedContainers(save as AnySave, new Set(current.containers.map((c) => c.id).filter((id) => !kept.some((k) => k.id === id))), current)

  const windows = mapWindows(current)
  const lamps = mapRooms(current).flatMap((r) => (r.lamp ? [r.lamp] : []))
  const curtains = save.lighting.curtains.flatMap((c) => {
    const id = to(c.id)
    return id ? [{ ...c, id }] : []
  })
  for (const w of windows) if (!curtains.some((c) => c.id === w.id)) curtains.push({ id: w.id, closed: false })
  const lampStates = save.lighting.lamps.flatMap((l) => {
    const id = to(l.id)
    return id ? [{ ...l, id }] : []
  })
  for (const l of lamps) if (!lampStates.some((s) => s.id === l.id)) lampStates.push({ id: l.id, on: false })
  save.lighting = { ...save.lighting, curtains: inMapOrder(curtains, windows), lamps: inMapOrder(lampStates, lamps) }

  save.player.position = { ...outOfSolids(save.player.position, current), y: save.player.position.y }
  save.zombies = save.zombies.map((z) => {
    const position = { ...outOfSolids(z.position, current), y: z.position.y }
    const zone = z.zoneId === null ? null : to(z.zoneId)
    const zoneId = zone ?? (z.zoneId === null ? null : (zoneFor(position, current.zombieZones)?.id ?? null))
    const door = z.structureTargetId === null ? null : to(z.structureTargetId)
    const lostSiege = z.structureTargetId !== null && door === null
    return { ...z, position, zoneId, structureTargetId: door, ...(lostSiege ? { ai: 'SEARCH' as const } : {}) }
  })
  save.contentVersion = currentVersion
  const checked = validateSaveGame(save, mapId, current)
  return checked.ok ? { ...checked, migrated: true, fromVersion: source.schemaVersion, contentFrom: from } : checked
}
