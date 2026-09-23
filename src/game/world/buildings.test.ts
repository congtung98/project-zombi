import { describe, expect, it } from 'vitest'
import { DOOR_HEIGHT, generateBuildingWalls, generateDoorPlacements, isInsideBuilding, type BuildingDef } from './buildings'

const building: BuildingDef = {
  id: 'b',
  name: 'Test',
  center: { x: 10, z: -10 },
  size: { w: 8, d: 6 },
  height: 3,
  wallThickness: 0.3,
  wallColor: '#fff',
  roofColor: '#000',
  floorColor: '#888',
  doors: [
    { id: 'd-s', name: 'South', side: 'S', offset: 1, width: 1.4 },
    { id: 'd-w', name: 'West', side: 'W', offset: -1, width: 1.2 },
  ],
  containers: [],
}

function coversX(wall: { position: { x: number; y: number; z: number }; size: [number, number, number] }, x: number, y: number) {
  return (
    Math.abs(x - wall.position.x) < wall.size[0] / 2 &&
    Math.abs(y - wall.position.y) < wall.size[1] / 2
  )
}

describe('generateBuildingWalls', () => {
  const walls = generateBuildingWalls(building)

  it('leaves a floor-level gap at each door but keeps a lintel above it', () => {
    const southWalls = walls.filter((w) => w.position.z === -7)
    // Door S center x = 11, width 1.4 → gap 10.3..11.7 at y = 1 (body height).
    expect(southWalls.some((w) => coversX(w, 11, 1))).toBe(false)
    // Wall exists on both sides of the gap.
    expect(southWalls.some((w) => coversX(w, 9, 1))).toBe(true)
    expect(southWalls.some((w) => coversX(w, 13, 1))).toBe(true)
    // Lintel covers the gap above door height.
    expect(southWalls.some((w) => coversX(w, 11, (DOOR_HEIGHT + 3) / 2))).toBe(true)
  })

  it('produces a solid wall on sides without doors', () => {
    const northWalls = walls.filter((w) => w.position.z === -13)
    expect(northWalls).toHaveLength(1)
    expect(northWalls[0].size[0]).toBe(8)
  })

  it('gives every wall a unique stable id', () => {
    const ids = walls.map((w) => w.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('generateDoorPlacements', () => {
  const doors = generateDoorPlacements(building)

  it('places door centers on the building perimeter', () => {
    const south = doors.find((d) => d.id === 'd-s')!
    expect(south.center).toEqual({ x: 11, y: 0, z: -7 })
    expect(south.hinge).toEqual({ x: 10.3, y: 0, z: -7 })
    const west = doors.find((d) => d.id === 'd-w')!
    expect(west.center).toEqual({ x: 6, y: 0, z: -11 })
    expect(west.hinge).toEqual({ x: 6, y: 0, z: -11.6 })
  })

  it('opens the leaf toward the interior', () => {
    const south = doors.find((d) => d.id === 'd-s')!
    // Leaf direction = (cos a, -sin a) on XZ. Open S door must point to -Z (interior).
    expect(-Math.sin(south.openAngle)).toBeCloseTo(-1)
    const west = doors.find((d) => d.id === 'd-w')!
    // Open W door must point to +X (interior).
    expect(Math.cos(west.openAngle)).toBeCloseTo(1)
    // Closed W door lies along +Z (in the wall plane).
    expect(-Math.sin(west.closedAngle)).toBeCloseTo(1)
  })
})

describe('isInsideBuilding', () => {
  it('detects points inside, outside and within margin', () => {
    expect(isInsideBuilding(building, 10, -10)).toBe(true)
    expect(isInsideBuilding(building, 14.5, -10)).toBe(false)
    expect(isInsideBuilding(building, 14.5, -10, 1)).toBe(true)
  })
})
