import { GAME_CONFIG } from '../core/config'
import { generateContainerLoot } from '../systems/loot'
import type { Inventory } from '../systems/inventory'
import { LOOT_TABLES } from './lootTables'
import type { MapData } from './mapData'
import { DOOR_MAX_HP, type DoorState } from './doors'
import type { Vec3 } from '../../types'

export interface ContainerState {
  id: string
  /** Đã mở lần đầu chưa (đèn báo trên nóc). */
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
}

export function createWorldState(map: MapData, seed: number, lootTables = LOOT_TABLES): WorldState {
  const doors = new Map<string, DoorState>()
  for (const door of map.doors) doors.set(door.id, { id: door.id, state: 'closed', hp: DOOR_MAX_HP })
  const containers = new Map<string, ContainerState>()
  for (const c of map.containers) {
    const table = c.loot ? lootTables[c.loot] : undefined
    containers.set(c.id, {
      id: c.id,
      opened: false,
      items: generateContainerLoot(table, seed, c.id, GAME_CONFIG.inventory.containerSlots),
    })
  }
  return { seed, doors, containers }
}
