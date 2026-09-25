import type { Vec3 } from '../../types'
import type { DoorStatus } from './doors'

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

/** Window cut into an exterior wall: low sill, glass pane (blocks movement, not sight), header above. */
export interface WindowDef {
  id: string
  name: string
  side: Side
  /** Along the wall from the side centre, like `DoorDef.offset`. */
  offset: number
  width: number
  /** Pane from `sill` to `head` metres above the ground (defaults 0.9 / 2.1). */
  sill?: number
  head?: number
}

/**
 * Interior wall across a building. `axis` is the direction the wall runs: 'z' = a wall along Z at
 * x = `at`, spanning `from`..`to` in Z (trimmed to the inner faces of the outer walls). An optional
 * door (a normal door: collider, nav, zombies, save) sits at `door.at` along the wall.
 */
export interface PartitionDef {
  id: string
  axis: 'x' | 'z'
  at: number
  from: number
  to: number
  door?: {
    id: string
    name: string
    at: number
    width: number
    /** Side (-1/+1 on the axis across the wall) the leaf swings to when open. */
    openSide: -1 | 1
    initialState?: DoorStatus
  }
}

/** Ceiling lamp of a room, switched on the wall at `switchAt` (needs power unless stated). */
export interface LampDef {
  id: string
  name: string
  /** Light contribution 0..1 to the room (building lighting), not a Three.js light. */
  intensity: number
  color: string
  requiresElectricity: boolean
  /** Wall switch (interaction point), on the inner face near the room's door. */
  switchAt: { x: number; z: number }
  /** Fixture position on the ceiling; defaults to the room centre. */
  at?: { x: number; z: number }
}

export interface RoomBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** Room for building lighting: rectangle (wall centre lines) inside a building. */
export interface RoomDef {
  id: string
  name: string
  bounds: RoomBounds
  lamp?: LampDef
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
  windows?: WindowDef[]
  partitions?: PartitionDef[]
  /** Omitted = one room covering the whole footprint. */
  rooms?: RoomDef[]
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
  /** State in a new game (exterior doors start closed; interior doors may start open). */
  initialState?: DoorStatus
}

export const WINDOW_SILL = 0.9
export const WINDOW_HEAD = 2.1

/** Window in world space. The pane is a thin box on the wall line; `inward` points into the building. */
export interface WindowPlacement {
  id: string
  name: string
  buildingId: string
  /** Pane centre (y = middle of the pane). */
  center: Vec3
  width: number
  sill: number
  head: number
  /** Pane runs along X (N/S walls) or Z (W/E walls). */
  alongX: boolean
  thickness: number
  inward: { x: number; z: number }
}

export interface LampPlacement extends LampDef {
  roomId: string
  /** Fixture on the ceiling (y just under the roof). */
  position: Vec3
}

export interface RoomPlacement {
  id: string
  name: string
  buildingId: string
  bounds: RoomBounds
  /** Ceiling height (walls); above it (roof) is outdoors. */
  height: number
  lamp: LampPlacement | null
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

interface Opening {
  kind: 'door' | 'window'
  id: string
  center: number
  width: number
  sill: number
  head: number
}

/**
 * Sinh các đoạn tường của một công trình, chừa khoảng trống cho cửa (dầm phía trên) và cửa sổ
 * (bệ phía dưới, dầm phía trên; kính do `WindowView` dựng), cộng vách ngăn bên trong. Tường W/E
 * được rút ngắn để không chồng lên tường N/S ở góc. Nhà không có cửa sổ/vách giữ nguyên ID cũ.
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

    const openings: Opening[] = []
    for (const door of b.doors.filter((dr) => dr.side === side)) {
      openings.push({ kind: 'door', id: door.id, center: g.axisCenter + door.offset, width: door.width, sill: 0, head: DOOR_HEIGHT })
    }
    for (const win of (b.windows ?? []).filter((w) => w.side === side)) {
      openings.push({ kind: 'window', id: win.id, center: g.axisCenter + win.offset, width: win.width, sill: win.sill ?? WINDOW_SILL, head: win.head ?? WINDOW_HEAD })
    }
    openings.sort((x, y) => x.center - y.center)

    const segments: [number, number][] = []
    let cursor = start
    for (const o of openings) {
      segments.push([cursor, o.center - o.width / 2])
      cursor = o.center + o.width / 2
      if (o.kind === 'door') {
        walls.push(makeWall(`${b.id}-${side}-lintel`, g.alongX, o.center, g.lineCoord, o.width, h - o.head, t, (h + o.head) / 2, b.wallColor))
      } else {
        walls.push(makeWall(`${o.id}-sill`, g.alongX, o.center, g.lineCoord, o.width, o.sill, t, o.sill / 2, b.wallColor))
        walls.push(makeWall(`${o.id}-header`, g.alongX, o.center, g.lineCoord, o.width, h - o.head, t, (h + o.head) / 2, b.wallColor))
      }
    }
    segments.push([cursor, end])

    segments.forEach(([a, c], i) => {
      if (c - a > 0.01) {
        walls.push(makeWall(`${b.id}-${side}-${i}`, g.alongX, (a + c) / 2, g.lineCoord, c - a, h, t, h / 2, b.wallColor))
      }
    })
  }

  for (const p of b.partitions ?? []) walls.push(...partitionWalls(b, p))
  return walls
}

/** Interior wall pieces (trimmed to the inner faces of the outer walls), with a door gap and lintel. */
function partitionWalls(b: BuildingDef, p: PartitionDef): WallDef[] {
  const t = b.wallThickness
  const h = b.height
  const alongX = p.axis === 'x'
  const inner = alongX
    ? { min: b.center.x - b.size.w / 2 + t / 2, max: b.center.x + b.size.w / 2 - t / 2 }
    : { min: b.center.z - b.size.d / 2 + t / 2, max: b.center.z + b.size.d / 2 - t / 2 }
  const start = Math.max(p.from, inner.min)
  const end = Math.min(p.to, inner.max)
  const out: WallDef[] = []
  const pieces: [number, number][] = []
  if (p.door) {
    pieces.push([start, p.door.at - p.door.width / 2], [p.door.at + p.door.width / 2, end])
    out.push(makeWall(`${p.id}-lintel`, alongX, p.door.at, p.at, p.door.width, h - DOOR_HEIGHT, t, (h + DOOR_HEIGHT) / 2, b.wallColor))
  } else {
    pieces.push([start, end])
  }
  pieces.forEach(([a, c], i) => {
    if (c - a > 0.01) out.push(makeWall(`${p.id}-${i}`, alongX, (a + c) / 2, p.at, c - a, h, t, h / 2, b.wallColor))
  })
  return out
}

/** Window panes of a building (the glass: blocks movement and zombie sight, not the player's). */
export function generateWindowPlacements(b: BuildingDef): WindowPlacement[] {
  return (b.windows ?? []).map((w) => {
    const g = sideGeometry(b, w.side)
    const along = g.axisCenter + w.offset
    const sill = w.sill ?? WINDOW_SILL
    const head = w.head ?? WINDOW_HEAD
    const center: Vec3 = g.alongX ? { x: along, y: (sill + head) / 2, z: g.lineCoord } : { x: g.lineCoord, y: (sill + head) / 2, z: along }
    const inward = { N: { x: 0, z: 1 }, S: { x: 0, z: -1 }, W: { x: 1, z: 0 }, E: { x: -1, z: 0 } }[w.side]
    return { id: w.id, name: w.name, buildingId: b.id, center, width: w.width, sill, head, alongX: g.alongX, thickness: b.wallThickness, inward }
  })
}

/** Rooms of a building (one room over the footprint when none are defined) with their lamps. */
export function generateRooms(b: BuildingDef): RoomPlacement[] {
  const defs: RoomDef[] = b.rooms ?? [{
    id: `${b.id}-room`,
    name: b.name,
    bounds: { minX: b.center.x - b.size.w / 2, maxX: b.center.x + b.size.w / 2, minZ: b.center.z - b.size.d / 2, maxZ: b.center.z + b.size.d / 2 },
  }]
  return defs.map((r) => ({
    id: r.id,
    name: r.name,
    buildingId: b.id,
    bounds: { ...r.bounds },
    height: b.height,
    lamp: r.lamp
      ? {
          ...r.lamp,
          roomId: r.id,
          position: {
            x: r.lamp.at?.x ?? (r.bounds.minX + r.bounds.maxX) / 2,
            y: b.height - 0.08,
            z: r.lamp.at?.z ?? (r.bounds.minZ + r.bounds.maxZ) / 2,
          },
        }
      : null,
  }))
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
  }).concat((b.partitions ?? []).flatMap((p) => (p.door ? [partitionDoor(b, p, p.door)] : [])))
}

/** Door placement in an interior wall; the leaf swings to `openSide` of the wall. */
function partitionDoor(b: BuildingDef, p: PartitionDef, door: NonNullable<PartitionDef['door']>): DoorPlacement {
  const alongX = p.axis === 'x'
  const center: Vec3 = alongX ? { x: door.at, y: 0, z: p.at } : { x: p.at, y: 0, z: door.at }
  const hinge: Vec3 = alongX ? { x: door.at - door.width / 2, y: 0, z: p.at } : { x: p.at, y: 0, z: door.at - door.width / 2 }
  // Leaf direction from the hinge = (cos a, -sin a): +X a = 0, +Z a = -pi/2, -X a = pi, -Z a = pi/2.
  const closedAngle = alongX ? 0 : -Math.PI / 2
  const openAngle = alongX ? (door.openSide > 0 ? -Math.PI / 2 : Math.PI / 2) : door.openSide > 0 ? 0 : Math.PI
  return { id: door.id, name: door.name, buildingId: b.id, width: door.width, height: DOOR_HEIGHT, center, hinge, closedAngle, openAngle, initialState: door.initialState }
}

export function isInsideBuilding(b: BuildingDef, x: number, z: number, margin = 0): boolean {
  const hw = b.size.w / 2 + margin
  const hd = b.size.d / 2 + margin
  return Math.abs(x - b.center.x) <= hw && Math.abs(z - b.center.z) <= hd
}

export function isInsideRoom(bounds: RoomBounds, x: number, z: number): boolean {
  return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ
}
