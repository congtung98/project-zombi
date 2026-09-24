import type { Vec3 } from '../../types'

export type Side = 'N' | 'S' | 'E' | 'W'

export interface WallDef {
  /** ID ổn định để dùng cho save/collider. */
  id: string
  /** Tâm khối. */
  position: Vec3
  /** Kích thước đầy đủ [rộng X, cao Y, sâu Z]. */
  size: [number, number, number]
  color?: string
}

export interface DoorDef {
  id: string
  name: string
  /** Mặt tường đặt cửa: N = -Z, S = +Z, W = -X, E = +X. */
  side: Side
  /** Độ lệch tâm cửa so với tâm mặt tường, dọc theo mặt tường. */
  offset: number
  width: number
}

export interface ContainerDef {
  id: string
  name: string
  /** Tâm khối (y = nửa chiều cao). */
  position: Vec3
  size: [number, number, number]
  color: string
  /** ID bảng loot (xem `lootTables.ts`); không có thì container trống. */
  loot?: string
}

export interface BuildingDef {
  id: string
  name: string
  center: { x: number; z: number }
  size: { w: number; d: number }
  height: number
  wallThickness: number
  wallColor: string
  roofColor: string
  floorColor: string
  doors: DoorDef[]
  containers: ContainerDef[]
}

/** Vị trí cửa đã tính ra tọa độ thế giới, dùng cho render và tương tác. */
export interface DoorPlacement {
  id: string
  name: string
  buildingId: string
  width: number
  height: number
  /** Tâm ô cửa (trên mặt đất). */
  center: Vec3
  /** Điểm bản lề (trên mặt đất). Cánh cửa quay quanh trục Y tại đây. */
  hinge: Vec3
  /** rotation.y của cánh cửa khi đóng (nằm trong mặt tường). */
  closedAngle: number
  /** rotation.y của cánh cửa khi mở (quay vào trong nhà). */
  openAngle: number
}

export const DOOR_HEIGHT = 2.2

interface SideGeometry {
  alongX: boolean
  /** Tọa độ cố định của mặt tường (z cho N/S, x cho W/E). */
  lineCoord: number
  /** Tâm mặt tường theo trục còn lại. */
  axisCenter: number
  halfLen: number
}

function sideGeometry(b: BuildingDef, side: Side): SideGeometry {
  const { w, d } = b.size
  const { x: cx, z: cz } = b.center
  switch (side) {
    case 'N':
      return { alongX: true, lineCoord: cz - d / 2, axisCenter: cx, halfLen: w / 2 }
    case 'S':
      return { alongX: true, lineCoord: cz + d / 2, axisCenter: cx, halfLen: w / 2 }
    case 'W':
      return { alongX: false, lineCoord: cx - w / 2, axisCenter: cz, halfLen: d / 2 }
    case 'E':
      return { alongX: false, lineCoord: cx + w / 2, axisCenter: cz, halfLen: d / 2 }
  }
}

function makeWall(
  id: string,
  alongX: boolean,
  axisPos: number,
  lineCoord: number,
  length: number,
  height: number,
  thickness: number,
  y: number,
  color: string,
): WallDef {
  return alongX
    ? { id, position: { x: axisPos, y, z: lineCoord }, size: [length, height, thickness], color }
    : { id, position: { x: lineCoord, y, z: axisPos }, size: [thickness, height, length], color }
}

/**
 * Sinh các đoạn tường của một công trình, chừa khoảng trống cho cửa và thêm
 * dầm phía trên cửa. Tường W/E được rút ngắn để không chồng lên tường N/S ở góc.
 */
export function generateBuildingWalls(b: BuildingDef): WallDef[] {
  const walls: WallDef[] = []
  const t = b.wallThickness
  const h = b.height
  const sides: Side[] = ['N', 'S', 'W', 'E']

  for (const side of sides) {
    const g = sideGeometry(b, side)
    let start = g.axisCenter - g.halfLen
    let end = g.axisCenter + g.halfLen
    if (!g.alongX) {
      start += t / 2
      end -= t / 2
    }

    const door = b.doors.find((dr) => dr.side === side)
    const segments: [number, number][] = []
    if (door) {
      const dc = g.axisCenter + door.offset
      segments.push([start, dc - door.width / 2], [dc + door.width / 2, end])
      walls.push(
        makeWall(`${b.id}-${side}-lintel`, g.alongX, dc, g.lineCoord, door.width, h - DOOR_HEIGHT, t, (h + DOOR_HEIGHT) / 2, b.wallColor),
      )
    } else {
      segments.push([start, end])
    }

    segments.forEach(([a, c], i) => {
      if (c - a > 0.01) {
        walls.push(makeWall(`${b.id}-${side}-${i}`, g.alongX, (a + c) / 2, g.lineCoord, c - a, h, t, h / 2, b.wallColor))
      }
    })
  }
  return walls
}

const DOOR_ANGLES: Record<Side, { closed: number; open: number }> = {
  N: { closed: 0, open: -Math.PI / 2 },
  S: { closed: 0, open: Math.PI / 2 },
  W: { closed: -Math.PI / 2, open: 0 },
  E: { closed: -Math.PI / 2, open: Math.PI },
}

export function generateDoorPlacements(b: BuildingDef): DoorPlacement[] {
  return b.doors.map((door) => {
    const g = sideGeometry(b, door.side)
    const dc = g.axisCenter + door.offset
    const angles = DOOR_ANGLES[door.side]
    const center: Vec3 = g.alongX ? { x: dc, y: 0, z: g.lineCoord } : { x: g.lineCoord, y: 0, z: dc }
    const hinge: Vec3 = g.alongX
      ? { x: dc - door.width / 2, y: 0, z: g.lineCoord }
      : { x: g.lineCoord, y: 0, z: dc - door.width / 2 }
    return {
      id: door.id,
      name: door.name,
      buildingId: b.id,
      width: door.width,
      height: DOOR_HEIGHT,
      center,
      hinge,
      closedAngle: angles.closed,
      openAngle: angles.open,
    }
  })
}

export function isInsideBuilding(b: BuildingDef, x: number, z: number, margin = 0): boolean {
  const hw = b.size.w / 2 + margin
  const hd = b.size.d / 2 + margin
  return Math.abs(x - b.center.x) <= hw && Math.abs(z - b.center.z) <= hd
}
