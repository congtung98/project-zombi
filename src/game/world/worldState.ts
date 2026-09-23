import type { MapData } from './mapData'

export interface DoorState {
  id: string
  open: boolean
}

export interface ContainerState {
  id: string
  /** Đã mở lần đầu chưa. Loot được sinh một lần theo seed ở Sprint 4. */
  opened: boolean
}

/** Trạng thái thế giới thay đổi được và cần lưu (Sprint 5). Mọi ID lấy từ map data. */
export interface WorldState {
  doors: Map<string, DoorState>
  containers: Map<string, ContainerState>
}

export function createWorldState(map: MapData): WorldState {
  const doors = new Map<string, DoorState>()
  for (const door of map.doors) doors.set(door.id, { id: door.id, open: false })
  const containers = new Map<string, ContainerState>()
  for (const c of map.containers) containers.set(c.id, { id: c.id, opened: false })
  return { doors, containers }
}
