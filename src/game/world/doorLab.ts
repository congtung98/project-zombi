import { generateBuildingWalls, generateDoorPlacements, type BuildingDef } from './buildings'
import type { MapData } from './mapData'

const room: BuildingDef = {
  id: 'lab-room', name: 'Phòng thử cửa', center: { x: 0, z: 0 }, size: { w: 6, d: 6 },
  height: 3, wallThickness: 0.3, wallColor: '#78818c', roofColor: '#444', floorColor: '#757060',
  doors: [{ id: 'lab-door', name: 'Cửa thử', side: 'S', offset: 0, width: 1.4 }], containers: [],
}

export const DOOR_LAB_MAP: MapData = {
  id: 'door-lab', size: 20, playerSpawn: { x: 0, y: 0.9, z: 0 }, zombieSpawns: [{ x: 0, y: 0.9, z: 6 }],
  buildings: [room], walls: generateBuildingWalls(room), doors: generateDoorPlacements(room), containers: [], roads: [],
}

export const DOOR_LAB_ENABLED = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('lab') === 'doors'
