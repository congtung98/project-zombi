import type { Vec3 } from '../../types'
import {
  generateBuildingWalls,
  generateDoorPlacements,
  generateRooms,
  generateWindowPlacements,
  type BuildingDef,
  type ContainerDef,
  type WallDef,
} from './buildings'
import {
  NEIGHBORHOOD_BUILDINGS,
  NEIGHBORHOOD_MAP,
  NEIGHBORHOOD_OBSTACLES,
  NEIGHBORHOOD_OUTDOOR_CONTAINERS,
  NEIGHBORHOOD_ROADS,
  boundaryWallsFor,
  type MapData,
  type RoadDef,
  type ZoneDef,
} from './mapData'

/**
 * Dev-only synthetic large map (R0 stress mode, `?stress=N`): the 50 m neighbourhood tiled N × N
 * with one outer boundary (inner boundaries dropped, so zombies can cross tiles). Every ID gets a
 * `t<i>-<j>:` prefix; loot tables are reused. Tile (0, 0) keeps the player spawn's surroundings.
 * Extra outdoor spawn points bring each tile to 10 zombies at New Game.
 */

const TILE = NEIGHBORHOOD_MAP.size
/** Two more outdoor spawn points per tile (walkable, outside buildings/fences/car). */
const EXTRA_SPAWNS: Vec3[] = [
  { x: -8, y: 0, z: -5 },
  { x: 8, y: 0, z: 5 },
]

export const STRESS_MAP_PREFIX = 'stress-'

function offsetVec(p: Vec3, dx: number, dz: number): Vec3 {
  return { x: p.x + dx, y: p.y, z: p.z + dz }
}

function offsetBuilding(b: BuildingDef, prefix: string, dx: number, dz: number): BuildingDef {
  return {
    ...b,
    id: prefix + b.id,
    center: { x: b.center.x + dx, z: b.center.z + dz },
    doors: b.doors.map((d) => ({ ...d, id: prefix + d.id })),
    windows: b.windows?.map((w) => ({ ...w, id: prefix + w.id })),
    containers: b.containers.map((c) => offsetContainer(c, prefix, dx, dz)),
    partitions: b.partitions?.map((p) => {
      const shift = p.axis === 'x' ? { at: dz, along: dx } : { at: dx, along: dz }
      return {
        ...p,
        id: prefix + p.id,
        at: p.at + shift.at,
        from: p.from + shift.along,
        to: p.to + shift.along,
        door: p.door ? { ...p.door, id: prefix + p.door.id, at: p.door.at + shift.along } : undefined,
      }
    }),
    rooms: b.rooms?.map((r) => ({
      ...r,
      id: prefix + r.id,
      bounds: { minX: r.bounds.minX + dx, maxX: r.bounds.maxX + dx, minZ: r.bounds.minZ + dz, maxZ: r.bounds.maxZ + dz },
      lamp: r.lamp
        ? {
            ...r.lamp,
            id: prefix + r.lamp.id,
            switchAt: { x: r.lamp.switchAt.x + dx, z: r.lamp.switchAt.z + dz },
            at: r.lamp.at ? { x: r.lamp.at.x + dx, z: r.lamp.at.z + dz } : undefined,
          }
        : undefined,
    })),
  }
}

function offsetContainer(c: ContainerDef, prefix: string, dx: number, dz: number): ContainerDef {
  return { ...c, id: prefix + c.id, position: offsetVec(c.position, dx, dz) }
}

function offsetWall(w: WallDef, prefix: string, dx: number, dz: number): WallDef {
  return { ...w, id: prefix + w.id, position: offsetVec(w.position, dx, dz) }
}

/** N × N tiles of the neighbourhood (N clamped to 1..8), centred on the origin. */
export function buildStressMap(tiles: number): MapData {
  const n = Math.max(1, Math.min(8, Math.floor(tiles)))
  const size = TILE * n
  const buildings: BuildingDef[] = []
  const obstacles: WallDef[] = []
  const outdoor: ContainerDef[] = []
  const roads: RoadDef[] = []
  const spawns: Vec3[] = []
  const zones: ZoneDef[] = []
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const prefix = `t${i}-${j}:`
      const dx = (i - (n - 1) / 2) * TILE
      const dz = (j - (n - 1) / 2) * TILE
      buildings.push(...NEIGHBORHOOD_BUILDINGS.map((b) => offsetBuilding(b, prefix, dx, dz)))
      obstacles.push(...NEIGHBORHOOD_OBSTACLES.map((w) => offsetWall(w, prefix, dx, dz)))
      outdoor.push(...NEIGHBORHOOD_OUTDOOR_CONTAINERS.map((c) => offsetContainer(c, prefix, dx, dz)))
      roads.push(...NEIGHBORHOOD_ROADS.map((r) => ({ ...r, id: prefix + r.id, position: { x: r.position.x + dx, z: r.position.z + dz } })))
      spawns.push(...[...NEIGHBORHOOD_MAP.zombieSpawns, ...EXTRA_SPAWNS].map((p) => offsetVec(p, dx, dz)))
      zones.push(...(NEIGHBORHOOD_MAP.zombieZones ?? []).map((z) => ({ ...z, id: prefix + z.id, center: offsetVec(z.center, dx, dz) })))
    }
  }
  const origin = { x: -(n - 1) / 2 * TILE, z: -(n - 1) / 2 * TILE }
  return {
    id: `${STRESS_MAP_PREFIX}${n}x${n}`,
    size,
    playerSpawn: offsetVec(NEIGHBORHOOD_MAP.playerSpawn, origin.x, origin.z),
    zombieSpawns: spawns,
    zombieZones: zones,
    buildings,
    walls: [...boundaryWallsFor(size), ...buildings.flatMap(generateBuildingWalls), ...obstacles],
    doors: buildings.flatMap(generateDoorPlacements),
    containers: [...buildings.flatMap((b) => b.containers), ...outdoor],
    roads,
    windows: buildings.flatMap(generateWindowPlacements),
    rooms: buildings.flatMap(generateRooms),
    maxActiveZombies: spawns.length,
  }
}

/** `?stress=N` in a dev build (0 = off). */
export const STRESS_TILES: number = (() => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return 0
  const v = Number(new URLSearchParams(window.location.search).get('stress'))
  return Number.isFinite(v) && v >= 1 ? Math.min(8, Math.floor(v)) : 0
})()
