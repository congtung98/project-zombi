import type { Vec3 } from '../../types'
import { GAME_CONFIG } from '../core/config'
import {
  generateBuildingWalls,
  generateDoorPlacements,
  generateRooms,
  generateWindowPlacements,
  type BuildingDef,
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
  size: number
  playerSpawn: Vec3
  zombieSpawns: Vec3[]
  /** Wander/migration zones; maps without zones wander around each spawn point, no migration. */
  zombieZones?: ZoneDef[]
  buildings: BuildingDef[]
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

/** Windows of a map (test maps often list only walls/doors: derive from the buildings). */
export function mapWindows(map: MapData): WindowPlacement[] {
  return map.windows ?? map.buildings.flatMap(generateWindowPlacements)
}

/** Rooms of a map; a building without room data is one room over its footprint (no lamp). */
export function mapRooms(map: MapData): RoomPlacement[] {
  return map.rooms ?? map.buildings.flatMap(generateRooms)
}

const SIZE = GAME_CONFIG.world.size
const BOUNDARY_HEIGHT = 2
const BOUNDARY_THICKNESS = 1

/** Hàng rào bao quanh bản đồ (vuông `size`, tâm gốc tọa độ) để người chơi không đi ra ngoài sân. */
export function boundaryWallsFor(size: number): WallDef[] {
  const half = size / 2
  return [
    { id: 'bound-n', position: { x: 0, y: BOUNDARY_HEIGHT / 2, z: -half - BOUNDARY_THICKNESS / 2 }, size: [size + 2, BOUNDARY_HEIGHT, BOUNDARY_THICKNESS] },
    { id: 'bound-s', position: { x: 0, y: BOUNDARY_HEIGHT / 2, z: half + BOUNDARY_THICKNESS / 2 }, size: [size + 2, BOUNDARY_HEIGHT, BOUNDARY_THICKNESS] },
    { id: 'bound-w', position: { x: -half - BOUNDARY_THICKNESS / 2, y: BOUNDARY_HEIGHT / 2, z: 0 }, size: [BOUNDARY_THICKNESS, BOUNDARY_HEIGHT, size + 2] },
    { id: 'bound-e', position: { x: half + BOUNDARY_THICKNESS / 2, y: BOUNDARY_HEIGHT / 2, z: 0 }, size: [BOUNDARY_THICKNESS, BOUNDARY_HEIGHT, size + 2] },
  ]
}
const boundaryWalls = boundaryWallsFor(SIZE)

/**
 * Khu phố 50 × 50. Hai trục đường cắt nhau chia bản đồ thành 4 khu:
 * NW nhà an toàn (spawn), NE cửa hàng, SE nhà dân, SW công viên có hàng rào.
 * Mọi cửa và container đặt thủ công để kiểm soát trải nghiệm đầu tiên.
 */
const SAFE_HOUSE: BuildingDef = {
  id: 'safehouse',
  name: 'Nhà an toàn',
  center: { x: -14, z: -14 },
  size: { w: 8, d: 8 },
  height: 3,
  wallThickness: 0.3,
  wallColor: '#b9a78a',
  roofColor: '#6b4f3a',
  floorColor: '#7d6b55',
  doors: [{ id: 'door-safehouse', name: 'Cửa nhà an toàn', side: 'S', offset: 1, width: 1.4 }],
  // Building lighting sprint: windows (daylight), a ceiling lamp and its switch beside the door.
  windows: [
    { id: 'win-safehouse-n', name: 'Cửa sổ phía bắc nhà an toàn', side: 'N', offset: 2, width: 1.2 },
    { id: 'win-safehouse-e', name: 'Cửa sổ phía đông nhà an toàn', side: 'E', offset: 2.2, width: 1.2 },
  ],
  rooms: [
    {
      id: 'room-safehouse', name: 'Nhà an toàn', bounds: { minX: -18, maxX: -10, minZ: -18, maxZ: -10 },
      lamp: { id: 'lamp-safehouse', name: 'Đèn nhà an toàn', intensity: 0.8, color: '#ffd9a0', requiresElectricity: true, switchAt: { x: -14.3, z: -10.25 } },
    },
  ],
  containers: [
    { id: 'ct-safehouse-cabinet', name: 'Tủ đồ nhà an toàn', position: { x: -17, y: 0.5, z: -17.4 }, size: [1.2, 1, 0.6], color: '#8b5e3c', loot: 'safehouse-cabinet' },
    // P2-S2: New Game starts unarmed; the starting melee is guaranteed here, a few steps from spawn.
    { id: 'ct-safehouse-closet', name: 'Tủ quần áo nhà an toàn', position: { x: -10.5, y: 0.9, z: -15.5 }, size: [0.6, 1.8, 1.4], color: '#6d4c35', loot: 'safehouse-closet' },
    // P2-S4: starter repair materials against the west wall.
    { id: 'ct-safehouse-toolbox', name: 'Hộp đồ nghề nhà an toàn', position: { x: -17.5, y: 0.3, z: -13 }, size: [0.5, 0.6, 0.9], color: '#4f6d7a', loot: 'safehouse-toolbox' },
  ],
}

const STORE: BuildingDef = {
  id: 'store',
  name: 'Cửa hàng tiện lợi',
  center: { x: 13, z: -13 },
  size: { w: 12, d: 8 },
  height: 3,
  wallThickness: 0.3,
  wallColor: '#8f9aa8',
  roofColor: '#4d5561',
  floorColor: '#9aa0a6',
  doors: [{ id: 'door-store', name: 'Cửa cửa hàng', side: 'S', offset: -3, width: 1.6 }],
  windows: [
    { id: 'win-store-s1', name: 'Tủ kính cửa hàng', side: 'S', offset: 1, width: 1.6 },
    { id: 'win-store-s2', name: 'Tủ kính cửa hàng (góc)', side: 'S', offset: 4, width: 1.6 },
  ],
  rooms: [
    {
      id: 'room-store', name: 'Cửa hàng tiện lợi', bounds: { minX: 7, maxX: 19, minZ: -17, maxZ: -9 },
      lamp: { id: 'lamp-store', name: 'Đèn cửa hàng', intensity: 0.9, color: '#e8f2ff', requiresElectricity: true, switchAt: { x: 8.6, z: -9.25 } },
    },
  ],
  containers: [
    { id: 'ct-store-shelf-1', name: 'Kệ hàng 1', position: { x: 9, y: 0.8, z: -16.4 }, size: [2, 1.6, 0.6], color: '#5b6b7a', loot: 'store-shelf' },
    { id: 'ct-store-shelf-2', name: 'Kệ hàng 2', position: { x: 13, y: 0.8, z: -16.4 }, size: [2, 1.6, 0.6], color: '#5b6b7a', loot: 'store-shelf' },
    { id: 'ct-store-shelf-3', name: 'Kệ hàng 3', position: { x: 17, y: 0.8, z: -16.4 }, size: [2, 1.6, 0.6], color: '#5b6b7a', loot: 'store-shelf' },
    { id: 'ct-store-fridge', name: 'Tủ lạnh', position: { x: 18.3, y: 0.9, z: -11 }, size: [0.8, 1.8, 0.8], color: '#d8dee6', loot: 'store-fridge' },
    { id: 'ct-store-tools', name: 'Kệ dụng cụ', position: { x: 7.5, y: 0.8, z: -12.5 }, size: [0.6, 1.6, 2], color: '#7a5f3a', loot: 'tool-shelf' },
    // P2-S4: materials shelf against the east wall, between shelf 3 and the fridge.
    { id: 'ct-store-hardware', name: 'Kệ vật liệu', position: { x: 18.45, y: 0.8, z: -14.3 }, size: [0.6, 1.6, 1.8], color: '#8a6a3a', loot: 'hardware-shelf' },
  ],
}

const HOUSE: BuildingDef = {
  id: 'house',
  name: 'Nhà dân',
  center: { x: 13, z: 12 },
  size: { w: 9, d: 7 },
  height: 3,
  wallThickness: 0.3,
  wallColor: '#c4a484',
  roofColor: '#7a3f2f',
  floorColor: '#8a7560',
  doors: [{ id: 'door-house', name: 'Cửa nhà dân', side: 'N', offset: -2, width: 1.4 }],
  // Building lighting sprint: a wall splits the living room (windows, front door) from the back
  // bedroom (no window); the bedroom door starts open.
  partitions: [
    {
      id: 'house-partition', axis: 'z', at: 14, from: 8.5, to: 15.5,
      door: { id: 'door-house-bedroom', name: 'Cửa phòng ngủ', at: 13, width: 1.4, openSide: -1, initialState: 'open' },
    },
  ],
  windows: [
    { id: 'win-house-n', name: 'Cửa sổ phòng khách', side: 'N', offset: 0, width: 1.2 },
    { id: 'win-house-w', name: 'Cửa sổ phía tây phòng khách', side: 'W', offset: -0.5, width: 1.2 },
  ],
  rooms: [
    {
      id: 'room-house-living', name: 'Phòng khách', bounds: { minX: 8.5, maxX: 14, minZ: 8.5, maxZ: 15.5 },
      lamp: { id: 'lamp-house-living', name: 'Đèn phòng khách', intensity: 0.8, color: '#ffd9a0', requiresElectricity: true, switchAt: { x: 12.05, z: 8.75 } },
    },
    {
      id: 'room-house-bedroom', name: 'Phòng ngủ', bounds: { minX: 14, maxX: 17.5, minZ: 8.5, maxZ: 15.5 },
      lamp: { id: 'lamp-house-bedroom', name: 'Đèn phòng ngủ', intensity: 0.7, color: '#ffd9a0', requiresElectricity: true, switchAt: { x: 14.25, z: 14.3 } },
    },
  ],
  containers: [
    { id: 'ct-house-wardrobe', name: 'Tủ quần áo', position: { x: 16.5, y: 1, z: 14.9 }, size: [1.6, 2, 0.6], color: '#6d4c35', loot: 'house-wardrobe' },
    { id: 'ct-house-kitchen', name: 'Tủ bếp', position: { x: 9.6, y: 0.5, z: 14.9 }, size: [1.4, 1, 0.6], color: '#9c7a5a', loot: 'house-kitchen' },
    { id: 'ct-house-nightstand', name: 'Tủ đầu giường', position: { x: 17.05, y: 0.35, z: 12 }, size: [0.5, 0.7, 0.5], color: '#7b5a44', loot: 'house-nightstand' },
  ],
}

/** Exported for the dev stress map, which tiles the neighbourhood (`stressMap.ts`). */
export const NEIGHBORHOOD_BUILDINGS: BuildingDef[] = [SAFE_HOUSE, STORE, HOUSE]
const BUILDINGS = NEIGHBORHOOD_BUILDINGS

/** Outdoor containers: riskier spots (the park has a zombie spawn) for rarer melee. */
export const NEIGHBORHOOD_OUTDOOR_CONTAINERS: ContainerDef[] = [
  { id: 'ct-park-toolbox', name: 'Thùng dụng cụ công viên', position: { x: -21.5, y: 0.35, z: 12.5 }, size: [0.9, 0.7, 0.5], color: '#b0472f', loot: 'park-toolbox' },
  // P2-S4: scrap pile behind (east of) the house, between two zombie spawns.
  { id: 'ct-house-scrap', name: 'Đống phế liệu sau nhà', position: { x: 20.5, y: 0.4, z: 12 }, size: [1.4, 0.8, 1], color: '#6b6f73', loot: 'scrap-pile' },
]

/** Containers added in P2-S2 (save v3). Older saves receive them once, seeded, during migration. */
export const CONTAINERS_ADDED_V3: ReadonlySet<string> = new Set(['ct-safehouse-closet', 'ct-store-tools', 'ct-house-nightstand', 'ct-park-toolbox'])

/** Material containers added in P2-S4 (save v5); seeded once when an older save migrates. */
export const CONTAINERS_ADDED_V5: ReadonlySet<string> = new Set(['ct-safehouse-toolbox', 'ct-store-hardware', 'ct-house-scrap'])

/** Building lighting sprint (save v7): the bedroom door; older saves get it in its initial state. */
export const DOORS_ADDED_V7: ReadonlySet<string> = new Set(['door-house-bedroom'])
/** Wall pieces added in v7 (the house partition): migrated players/zombies inside them are moved out. */
export const WALL_PREFIXES_ADDED_V7: readonly string[] = ['house-partition']

/** Vật cản rời: hàng rào công viên, xe hỏng, quầy, giường, thùng. */
export const NEIGHBORHOOD_OBSTACLES: WallDef[] = [
  { id: 'fence-park-n', position: { x: -14.5, y: 0.5, z: 6 }, size: [15, 1, 0.15], color: '#7a6a55' },
  { id: 'fence-park-e', position: { x: -7, y: 0.5, z: 13 }, size: [0.15, 1, 8], color: '#7a6a55' },
  { id: 'fence-park-s', position: { x: -14.5, y: 0.5, z: 20 }, size: [15, 1, 0.15], color: '#7a6a55' },
  { id: 'car-1', position: { x: 4, y: 0.7, z: -1 }, size: [4, 1.4, 2], color: '#7a3b3b' },
  { id: 'store-counter', position: { x: 14, y: 0.5, z: -11 }, size: [4, 1, 0.8], color: '#6a7480' },
  { id: 'house-bed', position: { x: 15.5, y: 0.3, z: 10.5 }, size: [2, 0.6, 1.6], color: '#8c4a5a' },
  { id: 'crate-1', position: { x: -20, y: 0.5, z: 10 }, size: [1, 1, 1], color: '#a67c52' },
  { id: 'crate-2', position: { x: -19, y: 0.5, z: 11 }, size: [1, 1, 1], color: '#a67c52' },
  { id: 'crate-3', position: { x: 21, y: 0.5, z: -20 }, size: [1, 1, 1], color: '#a67c52' },
  { id: 'pillar-1', position: { x: 2, y: 1, z: 20 }, size: [1.2, 2, 1.2], color: '#6f6a63' },
  { id: 'pillar-2', position: { x: 5, y: 1, z: 20 }, size: [1.2, 2, 1.2], color: '#6f6a63' },
]

export const NEIGHBORHOOD_ROADS: RoadDef[] = [
  { id: 'road-ew', position: { x: 0, z: -1 }, size: [SIZE, 4], color: '#3a3a3f' },
  { id: 'road-ns', position: { x: -1, z: 0 }, size: [4, SIZE], color: '#3a3a3f' },
]

export const NEIGHBORHOOD_MAP: MapData = {
  id: 'neighborhood-50',
  size: SIZE,
  playerSpawn: { x: -13, y: 0, z: -13 },
  /** Điểm spawn đặt tay: ngoài nhà an toàn, đủ xa điểm xuất phát, rải quanh cửa hàng, nhà dân và công viên. */
  zombieSpawns: [
    { x: -14, y: 0, z: 13 },
    { x: 4, y: 0, z: 14 },
    { x: 20, y: 0, z: 0 },
    { x: -2, y: 0, z: -20 },
    { x: 16, y: 0, z: -5 },
    { x: 22, y: 0, z: 20 },
    { x: -22, y: 0, z: 0 },
    { x: 8, y: 0, z: 22 },
  ],
  /** Outdoor only (never inside a building), each around one or two spawn points, all connected. */
  zombieZones: [
    { id: 'zone-park', name: 'Công viên', center: { x: -15, y: 0, z: 13 }, radius: 5 },
    { id: 'zone-west', name: 'Đường phía tây', center: { x: -21, y: 0, z: -3 }, radius: 3.5 },
    { id: 'zone-north', name: 'Bãi đất phía bắc', center: { x: -2, y: 0, z: -19 }, radius: 3.5 },
    { id: 'zone-store', name: 'Sân cửa hàng', center: { x: 14, y: 0, z: -5 }, radius: 3.5 },
    { id: 'zone-east', name: 'Đường phía đông', center: { x: 21, y: 0, z: 2 }, radius: 3 },
    { id: 'zone-cross', name: 'Ngã tư', center: { x: -1, y: 0, z: -1 }, radius: 4 },
    { id: 'zone-south', name: 'Phố phía nam', center: { x: 4, y: 0, z: 17 }, radius: 4 },
    { id: 'zone-yard', name: 'Sân sau nhà dân', center: { x: 20, y: 0, z: 20 }, radius: 3.5 },
  ],
  buildings: BUILDINGS,
  walls: [...boundaryWalls, ...BUILDINGS.flatMap(generateBuildingWalls), ...NEIGHBORHOOD_OBSTACLES],
  doors: BUILDINGS.flatMap(generateDoorPlacements),
  containers: [...BUILDINGS.flatMap((b) => b.containers), ...NEIGHBORHOOD_OUTDOOR_CONTAINERS],
  roads: NEIGHBORHOOD_ROADS,
  windows: BUILDINGS.flatMap(generateWindowPlacements),
  rooms: BUILDINGS.flatMap(generateRooms),
}
