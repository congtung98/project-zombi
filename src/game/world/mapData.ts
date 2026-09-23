import type { Vec3 } from '../../types'
import { GAME_CONFIG } from '../core/config'

export interface WallDef {
  /** ID ổn định để dùng cho save/collider sau này. */
  id: string
  /** Tâm khối. */
  position: Vec3
  /** Kích thước đầy đủ [rộng X, cao Y, sâu Z]. */
  size: [number, number, number]
  color?: string
}

export interface MapData {
  id: string
  size: number
  playerSpawn: Vec3
  zombieSpawns: Vec3[]
  walls: WallDef[]
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

/** Tường thử nghiệm Sprint 1: kiểm tra trượt dọc tường, góc và lối hẹp. */
const testWalls: WallDef[] = [
  { id: 'wall-a', position: { x: 6, y: 1.5, z: -4 }, size: [8, 3, 0.6], color: '#8a7f72' },
  { id: 'wall-b', position: { x: 10.3, y: 1.5, z: 0 }, size: [0.6, 3, 8.6], color: '#8a7f72' },
  { id: 'wall-c', position: { x: -8, y: 1.5, z: 6 }, size: [0.6, 3, 10], color: '#8a7f72' },
  { id: 'wall-d', position: { x: -4, y: 1.5, z: 11.3 }, size: [8.6, 3, 0.6], color: '#8a7f72' },
  { id: 'pillar-1', position: { x: 0, y: 1, z: -12 }, size: [1.2, 2, 1.2], color: '#6f6a63' },
  { id: 'pillar-2', position: { x: 3, y: 1, z: -12 }, size: [1.2, 2, 1.2], color: '#6f6a63' },
  { id: 'crate-1', position: { x: -12, y: 0.5, z: -8 }, size: [1, 1, 1], color: '#a67c52' },
  { id: 'crate-2', position: { x: -13, y: 0.5, z: -7 }, size: [1, 1, 1], color: '#a67c52' },
]

export const TEST_MAP: MapData = {
  id: 'test-yard-50',
  size: SIZE,
  playerSpawn: { x: 0, y: 0, z: 0 },
  zombieSpawns: [{ x: 14, y: 0, z: 10 }],
  walls: [...boundaryWalls, ...testWalls],
}
