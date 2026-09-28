import { GAME_CONFIG } from '../core/config'
import { seedContainer } from '../systems/loot'
import { createInventory, type Inventory } from '../systems/inventory'
import type { BagStore } from '../systems/bags'
import { LOOT_TABLES } from './lootTables'
import { mapRooms, mapWindows, type MapData } from './mapData'
import { DOOR_MAX_HP, type DoorState } from './doors'
import type { Vec3 } from '../../types'

export interface ContainerState {
  id: string
  /** Đã mở lần đầu chưa (đèn báo trên nóc). Chỉ bật khi người chơi mở bằng E; được lưu từ save v1. */
  opened: boolean
  /** Nội dung hữu hạn, sinh một lần theo seed khi tạo ván; lấy đồ là chuyển số lượng ra khỏi đây. */
  items: Inventory
  /** Only dropped bags have a position; map containers use their static definition. */
  position?: Vec3
}

/** Trạng thái thế giới thay đổi được và cần lưu (Sprint 5). Mọi ID lấy từ map data. */
export interface WorldState {
  /** Seed ván; loot mỗi container = hash(seed, id) nên không phụ thuộc thứ tự mở. */
  seed: number
  doors: Map<string, DoorState>
  containers: Map<string, ContainerState>
  /** INV-LOOT: contents of every bag instance (in the bag, a container or on the ground). */
  bags: BagStore
  /** INV-LOOT: bonus loot rules already applied to this world (New Game or a save migration). */
  lootPatches: string[]
  /** Building lighting (v7): curtain closed per window, lamp switched on per lamp, grid power. */
  curtains: Map<string, boolean>
  lamps: Map<string, boolean>
  electricity: boolean
}

export interface WorldStateOptions {
  lootTables?: typeof LOOT_TABLES
  /**
   * false when a save is about to replace every container (load): containers start empty and the
   * generator is never called, so loading can never roll loot a second time.
   */
  generateLoot?: boolean
}

export function createWorldState(map: MapData, seed: number, options: WorldStateOptions = {}): WorldState {
  const { lootTables = LOOT_TABLES, generateLoot = true } = options
  const doors = new Map<string, DoorState>()
  for (const door of map.doors) doors.set(door.id, { id: door.id, state: door.initialState ?? 'closed', hp: DOOR_MAX_HP })
  const bags: BagStore = new Map()
  const containers = new Map<string, ContainerState>()
  const slots = GAME_CONFIG.inventory.containerSlots
  for (const c of map.containers) {
    containers.set(c.id, {
      id: c.id,
      opened: false,
      items: generateLoot ? seedContainer(c.loot, seed, c.id, slots, bags, lootTables) : createInventory(slots, `loot:${seed}:${c.id}`, 'container'),
    })
  }
  // Curtains start open, lamps off, the grid has power (PZ: power fails later; no shutoff yet).
  const curtains = new Map(mapWindows(map).map((w) => [w.id, false]))
  const lamps = new Map(mapRooms(map).flatMap((r) => (r.lamp ? [[r.lamp.id, false] as const] : [])))
  const lootPatches = GAME_CONFIG.bonusLoot.map((r) => r.id)
  return { seed, doors, containers, bags, lootPatches, curtains, lamps, electricity: true }
}
