import type { Vec3 } from '../../types'
import { GAME_CONFIG } from '../core/config'
import {
  generateBuildingWalls,
  generateDoorPlacements,
  type BuildingDef,
  type ContainerDef,
  type DoorPlacement,
  type WallDef,
} from './buildings'

export type { WallDef } from './buildings'

export interface RoadDef {
  id: string
  position: { x: number; z: number }
  /** [rộng X, sâu Z] */
  size: [number, number]
  color: string
}

export interface MapData {
  id: string
  size: number
  playerSpawn: Vec3
  zombieSpawns: Vec3[]
  buildings: BuildingDef[]
  /** Mọi khối tĩnh có collider: tường công trình, hàng rào, vật cản, biên. */
  walls: WallDef[]
  doors: DoorPlacement[]
  containers: ContainerDef[]
  /** Mặt đường chỉ để hiển thị, không có collider. */
  roads: RoadDef[]
}

const SIZE = GAME_CONFIG.world.size
const HALF = SIZE / 2
const BOUNDARY_HEIGHT = 2
const BOUNDARY_THICKNESS = 1

/** Hàng rào bao quanh bản đồ để người chơi không đi ra ngoài sân. */
const boundaryWalls: WallDef[] = [
  { id: 'bound-n', position: { x: 0, y: BOUNDARY_HEIGHT / 2, z: -HALF - BOUNDARY_THICKNESS / 2 }, size: [SIZE + 2, BOUNDARY_HEIGHT, BOUNDARY_THICKNESS] },
  { id: 'bound-s', position: { x: 0, y: BOUNDARY_HEIGHT / 2, z: HALF + BOUNDARY_THICKNESS / 2 }, size: [SIZE + 2, BOUNDARY_HEIGHT, BOUNDARY_THICKNESS] },
  { id: 'bound-w', position: { x: -HALF - BOUNDARY_THICKNESS / 2, y: BOUNDARY_HEIGHT / 2, z: 0 }, size: [BOUNDARY_THICKNESS, BOUNDARY_HEIGHT, SIZE + 2] },
  { id: 'bound-e', position: { x: HALF + BOUNDARY_THICKNESS / 2, y: BOUNDARY_HEIGHT / 2, z: 0 }, size: [BOUNDARY_THICKNESS, BOUNDARY_HEIGHT, SIZE + 2] },
]

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
  containers: [
    { id: 'ct-house-wardrobe', name: 'Tủ quần áo', position: { x: 16.5, y: 1, z: 14.9 }, size: [1.6, 2, 0.6], color: '#6d4c35', loot: 'house-wardrobe' },
    { id: 'ct-house-kitchen', name: 'Tủ bếp', position: { x: 9.6, y: 0.5, z: 14.9 }, size: [1.4, 1, 0.6], color: '#9c7a5a', loot: 'house-kitchen' },
    { id: 'ct-house-nightstand', name: 'Tủ đầu giường', position: { x: 17.05, y: 0.35, z: 12 }, size: [0.5, 0.7, 0.5], color: '#7b5a44', loot: 'house-nightstand' },
  ],
}

const BUILDINGS: BuildingDef[] = [SAFE_HOUSE, STORE, HOUSE]

/** Outdoor containers: riskier spots (the park has a zombie spawn) for rarer melee. */
const outdoorContainers: ContainerDef[] = [
  { id: 'ct-park-toolbox', name: 'Thùng dụng cụ công viên', position: { x: -21.5, y: 0.35, z: 12.5 }, size: [0.9, 0.7, 0.5], color: '#b0472f', loot: 'park-toolbox' },
  // P2-S4: scrap pile behind (east of) the house, between two zombie spawns.
  { id: 'ct-house-scrap', name: 'Đống phế liệu sau nhà', position: { x: 20.5, y: 0.4, z: 12 }, size: [1.4, 0.8, 1], color: '#6b6f73', loot: 'scrap-pile' },
]

/** Containers added in P2-S2 (save v3). Older saves receive them once, seeded, during migration. */
export const CONTAINERS_ADDED_V3: ReadonlySet<string> = new Set(['ct-safehouse-closet', 'ct-store-tools', 'ct-house-nightstand', 'ct-park-toolbox'])

/** Material containers added in P2-S4 (save v5); seeded once when an older save migrates. */
export const CONTAINERS_ADDED_V5: ReadonlySet<string> = new Set(['ct-safehouse-toolbox', 'ct-store-hardware', 'ct-house-scrap'])

/** Vật cản rời: hàng rào công viên, xe hỏng, quầy, giường, thùng. */
const obstacles: WallDef[] = [
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

const roads: RoadDef[] = [
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
  buildings: BUILDINGS,
  walls: [...boundaryWalls, ...BUILDINGS.flatMap(generateBuildingWalls), ...obstacles],
  doors: BUILDINGS.flatMap(generateDoorPlacements),
  containers: [...BUILDINGS.flatMap((b) => b.containers), ...outdoorContainers],
  roads,
}
