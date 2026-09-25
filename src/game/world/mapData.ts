import type { Vec3 } from '../../types'
import { loadBundledWorld } from '../../map/content'
import {
  generateRooms,
  generateWindowPlacements,
  type BuildingDef,
  type BuildingInfo,
  type ContainerDef,
  type DoorPlacement,
  type RoomPlacement,
  type WallDef,
  type WindowPlacement,
} from './buildings'

export type { WallDef } from './buildings'

export interface RoadDef {
  id: string
  position: { x: number; z: number }
  /** [rộng X, sâu Z] */
  size: [number, number]
  color: string
}

/**
 * Outdoor area a zombie group wanders in (P2-S5). Every zombie belongs to the zone nearest its
 * spawn point; the horde director moves whole groups between zones.
 */
export interface ZoneDef {
  id: string
  name: string
  center: Vec3
  /** Wander destinations are picked within this radius of the centre. */
  radius: number
}

export interface MapData {
  id: string
  /** Content revision of a data-driven world (world.json); saves record it. Hand-made maps: absent. */
  contentVersion?: number
  size: number
  playerSpawn: Vec3
  zombieSpawns: Vec3[]
  /** Wander/migration zones; maps without zones wander around each spawn point, no migration. */
  zombieZones?: ZoneDef[]
  buildings: BuildingInfo[]
  /** Mọi khối tĩnh có collider: tường công trình, hàng rào, vật cản, biên. */
  walls: WallDef[]
  doors: DoorPlacement[]
  containers: ContainerDef[]
  /** Mặt đường chỉ để hiển thị, không có collider. */
  roads: RoadDef[]
  /** Window panes (building lighting + see-through glass). Omitted = derived from `buildings`. */
  windows?: WindowPlacement[]
  /** Rooms with their lamps (building lighting). Omitted = derived from `buildings`. */
  rooms?: RoomPlacement[]
  /** Living zombie cap for this map; omitted = `GAME_CONFIG.spawn.maxActive` (stress maps raise it). */
  maxActiveZombies?: number
}

/** Parametric buildings of a hand-made map (content maps resolve windows/rooms explicitly). */
function parametric(map: MapData): BuildingDef[] {
  return map.buildings.filter((b): b is BuildingDef => Array.isArray((b as Partial<BuildingDef>).doors))
}

/** Windows of a map (test maps often list only walls/doors: derive from the buildings). */
export function mapWindows(map: MapData): WindowPlacement[] {
  return map.windows ?? parametric(map).flatMap(generateWindowPlacements)
}

/** Rooms of a map; a building without room data is one room over its footprint (no lamp). */
export function mapRooms(map: MapData): RoomPlacement[] {
  return map.rooms ?? parametric(map).flatMap(generateRooms)
}

/**
 * Khu phố 50 × 50 (bốn chunk 32 m): nhà an toàn, cửa hàng, nhà dân, công viên. Nội dung nằm trong
 * `content/maps/neighborhood-50/` (prefab + chunk JSON, docs/map-content-format.md); file này chỉ
 * nạp và resolve nó thành `MapData`. Lỗi nội dung ném `MapContentError`, không có map dự phòng.
 */
export const NEIGHBORHOOD_MAP: MapData = loadBundledWorld('neighborhood-50').map
