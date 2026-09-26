import { Vector3 } from 'three'
import { isInsideBuilding, type BuildingInfo, type DoorPlacement, type RoomPlacement, type WindowPlacement } from '../world/buildings'
import { subtractRects, type StairPlacement } from '../world/floors'
import { outlineRects } from '../../map/polygon'
import type { Rect } from '../../map/schema'
import type { Box3Like } from './cutaway'
import { packSurface, surfaceIndex, unpackSurface, FACE, type SurfaceId } from './surfaces/catalog'
import type { StaticItem } from './staticBatchData'

/**
 * G2 (graphics plan): architectural details drawn around what the content already has — door
 * frames, window frames, bars and sills, baseboards inside, a plinth along the outer walls, per-room
 * floors, a stoop in front of outer doors. Drawn only: no collider, no sight blocker, no nav, no save.
 *
 * Every detail belongs to its building and carries an `anchor` (the wall or opening it is part of):
 * the cutaway classifies it and the fader tests it with that box, so a frame is cut, hidden and
 * faded with its wall or opening, never left floating. Sizes are chosen for the gameplay zoom
 * (28 px/m: a 9 cm casing is 2–3 px), details under ~5 cm are not modelled.
 */

export const TRIM = {
  /** Door casing face width and how far it stands proud of the wall. */
  casing: 0.09,
  casingProud: 0.03,
  /** Lining of the opening's jambs and head. */
  lining: 0.03,
  color: '#ddd5c4',
} as const

export const WINDOW_TRIM = {
  frame: 0.07,
  frameDepth: 0.1,
  bar: 0.04,
  barDepth: 0.06,
  /** Outer sill: thickness, projection past the wall face, reach past the opening on each side. */
  sill: 0.05,
  sillProud: 0.08,
  sillReach: 0.08,
  sillColor: '#cfc8b8',
} as const

export const BASEBOARD = { height: 0.1, proud: 0.02, color: '#5d4a3a' } as const
export const PLINTH = { height: 0.35, proud: 0.03, color: '#7f786e' } as const
export const STOOP = { depth: 0.8, reach: 0.2, height: 0.05, color: '#9a948a' } as const
/** Per-room floors sit this far above the building floor (no z-fighting, no visible step). */
export const ROOM_FLOOR_LIFT = 0.003

/** A wall piece shorter than this gets no baseboard or plinth (low rails). */
const MIN_WALL_HEIGHT = 0.3
/** A wall piece counts as standing on a storey floor when its bottom is this close to it. */
const FLOOR_SLACK = 0.05
const PROBE = 0.05

/** The doorway (closed leaf plane, a wall's thickness deep) as a box, for the cutaway rules. */
export function doorwayBox(door: DoorPlacement): Box3Like {
  const alongX = door.hinge.x !== door.center.x
  const hw = door.width / 2
  const t = 0.15
  return {
    min: { x: door.center.x - (alongX ? hw : t), y: door.hinge.y, z: door.center.z - (alongX ? t : hw) },
    max: { x: door.center.x + (alongX ? hw : t), y: door.hinge.y + door.height, z: door.center.z + (alongX ? t : hw) },
  }
}

/** The window pane opening (a wall's thickness deep), the box `WindowView` cuts the glass with. */
export function paneBox(win: WindowPlacement): Box3Like {
  const hw = win.width / 2
  const t = win.thickness / 2
  const h = win.head - win.sill
  return {
    min: { x: win.center.x - (win.alongX ? hw : t), y: win.center.y - h / 2, z: win.center.z - (win.alongX ? t : hw) },
    max: { x: win.center.x + (win.alongX ? hw : t), y: win.center.y + h / 2, z: win.center.z + (win.alongX ? t : hw) },
  }
}

const vec = (b: Box3Like) => ({ min: new Vector3(b.min.x, b.min.y, b.min.z), max: new Vector3(b.max.x, b.max.y, b.max.z) })

/**
 * Boxes in an opening's own frame: `along` the wall from its centre, `y` absolute, `across` the
 * wall from its centre line (positive = the `+` side of the across axis).
 */
function framed(alongX: boolean, cx: number, cz: number) {
  return (along: number, alongSize: number, y0: number, y1: number, across: number, acrossSize: number) => {
    const center = alongX ? new Vector3(cx + along, (y0 + y1) / 2, cz + across) : new Vector3(cx + across, (y0 + y1) / 2, cz + along)
    const size: [number, number, number] = alongX ? [alongSize, y1 - y0, acrossSize] : [acrossSize, y1 - y0, alongSize]
    return { center, size }
  }
}

interface Detail {
  center: Vector3
  size: [number, number, number]
}

function detail(d: Detail, color: string, surface: SurfaceId, buildingId: string, role: StaticItem['role'], anchor: Box3Like | null, occluder = false): StaticItem {
  return { shape: 'box', center: d.center, size: d.size, color, occluder, surface: packSurface({ a: surface }), buildingId, role, detail: true, ...(anchor ? { anchor: vec(anchor) } : {}) }
}

/**
 * Door frame: linings over the jambs and head of the opening, and a casing (two jambs and a head) on
 * both faces of the wall. `thickness` is the wall's (lintel above the door).
 */
export function doorDetails(door: DoorPlacement, thickness: number): StaticItem[] {
  const alongX = door.hinge.x !== door.center.x
  const at = framed(alongX, door.center.x, door.center.z)
  const { casing: C, casingProud: P, lining: L } = TRIM
  const w = door.width
  const y0 = door.center.y
  const h = door.height
  const t = thickness
  const anchor = doorwayBox(door)
  const parts: Detail[] = [at(-(w / 2 - L / 2), L, y0, y0 + h, 0, t), at(w / 2 - L / 2, L, y0, y0 + h, 0, t), at(0, w, y0 + h - L, y0 + h, 0, t)]
  for (const side of [1, -1]) {
    const across = side * (t / 2 + P / 2)
    parts.push(at(-(w / 2 + C / 2), C, y0, y0 + h + C, across, P), at(w / 2 + C / 2, C, y0, y0 + h + C, across, P), at(0, w + 2 * C, y0 + h, y0 + h + C, across, P))
  }
  // Tall enough to hide the player: fades with the doorway (its anchor), like the leaf.
  return parts.map((p) => detail(p, TRIM.color, 'matte', door.buildingId, 'opening', anchor, true))
}

/** Window: frame and a cross of bars in the pane plane, and an outer sill below the opening. */
export function windowDetails(win: WindowPlacement): StaticItem[] {
  const at = framed(win.alongX, win.center.x, win.center.z)
  const { frame: F, frameDepth: D, bar: B, barDepth: BD, sill: S, sillProud: SP, sillReach: SR } = WINDOW_TRIM
  const w = win.width
  const bottom = win.center.y - (win.head - win.sill) / 2
  const top = win.center.y + (win.head - win.sill) / 2
  const mid = (bottom + top) / 2
  const anchor = paneBox(win)
  // Outside is against `inward` on the across axis.
  const out = -(win.alongX ? Math.sign(win.inward.z) : Math.sign(win.inward.x)) || 1
  const frame: Detail[] = [
    at(0, w, bottom, bottom + F, 0, D),
    at(0, w, top - F, top, 0, D),
    at(-(w / 2 - F / 2), F, bottom, top, 0, D),
    at(w / 2 - F / 2, F, bottom, top, 0, D),
    at(0, B, bottom + F, top - F, 0, BD),
    at(0, w - 2 * F, mid - B / 2, mid + B / 2, 0, BD),
  ]
  const t = win.thickness
  const sill = at(0, w + 2 * SR, bottom - S, bottom, out * (t / 2 + SP / 2 - 0.01), SP + 0.02)
  return [
    ...frame.map((p) => detail(p, TRIM.color, 'matte', win.buildingId, 'opening', anchor)),
    detail(sill, WINDOW_TRIM.sillColor, 'concrete', win.buildingId, 'opening', anchor),
  ]
}

/**
 * Baseboards on the faces of a wall piece inside the building and, on the ground storey, a plinth
 * on its outside face. Only pieces standing on a storey floor (not lintels or window headers).
 */
export function wallBaseDetails(wall: StaticItem, building: BuildingInfo): StaticItem[] {
  const [sx, sy, sz] = wall.size
  const bottom = wall.center.y - sy / 2
  const storey = Math.round(bottom / building.height)
  if (sy < MIN_WALL_HEIGHT || Math.abs(bottom - storey * building.height) > FLOOR_SLACK) return []
  const { a, faces } = unpackSurface(wall.surface)
  const thinX = sx <= sz
  const half = (thinX ? sx : sz) / 2
  const length = thinX ? sz : sx
  // Plaster all over = a partition (both broad faces inside).
  const inside = (face: number) => a === 'plaster' || (faces & face) !== 0
  const anchor = { min: wall.center.clone().sub(new Vector3(sx / 2, sy / 2, sz / 2)), max: wall.center.clone().add(new Vector3(sx / 2, sy / 2, sz / 2)) }
  const out: StaticItem[] = []
  const place = (sign: number, proud: number, height: number, extra: [number, number]): Detail => {
    const across = sign * (half + proud / 2)
    const len = length + extra[0] + extra[1]
    const shift = (extra[1] - extra[0]) / 2
    return thinX
      ? { center: new Vector3(wall.center.x + across, bottom + height / 2, wall.center.z + shift), size: [proud, height, len] }
      : { center: new Vector3(wall.center.x + shift, bottom + height / 2, wall.center.z + across), size: [len, height, proud] }
  }
  // An outer corner (past the piece's end the wall line is outside) gets the plinth wrapped round it.
  const past = (end: -1 | 1) => {
    const d = length / 2 + PROBE
    return !(thinX ? isInsideBuilding(building, wall.center.x, wall.center.z + end * d) : isInsideBuilding(building, wall.center.x + end * d, wall.center.z))
  }
  for (const sign of [1, -1] as const) {
    const face = thinX ? (sign > 0 ? FACE.px : FACE.nx) : sign > 0 ? FACE.pz : FACE.nz
    if (inside(face)) {
      out.push({ ...detail(place(sign, BASEBOARD.proud, BASEBOARD.height, [0, 0]), BASEBOARD.color, 'wood', building.id, 'wall', null), anchor })
    } else if (storey === 0) {
      const extra: [number, number] = [past(-1) ? PLINTH.proud : 0, past(1) ? PLINTH.proud : 0]
      out.push({ ...detail(place(sign, PLINTH.proud, PLINTH.height, extra), PLINTH.color, 'concrete', building.id, 'wall', null), anchor })
    }
  }
  return out
}

/** Default colours of floor surfaces a room names without a colour. */
const FLOOR_TINT: Partial<Record<SurfaceId, string>> = { tile: '#c2bcae', concrete: '#8d8a84', fabric: '#8a7a6a' }

/**
 * A room with its own floor (`visual.floor`): its rectangles just above the building floor or the
 * upper slab, less the stair holes of that slab. Rooms without one keep the building's wooden floor.
 */
export function roomFloorDetails(room: RoomPlacement, building: BuildingInfo, stairs: readonly StairPlacement[], floorY: number): StaticItem[] {
  const surface = room.visual?.floor as SurfaceId | undefined
  if (!surface || surfaceIndex(surface) < 0) return []
  const y = room.floorY ?? 0
  const rects: Rect[] = room.outline ? outlineRects(room.outline) : [{ minX: room.bounds.minX, minZ: room.bounds.minZ, maxX: room.bounds.maxX, maxZ: room.bounds.maxZ }]
  const holes = stairs.filter((s) => s.buildingId === building.id && Math.abs(s.topY - y) < FLOOR_SLACK).map((s) => s.rect)
  const color = room.visual?.floorColor ?? FLOOR_TINT[surface] ?? building.floorColor
  return subtractRects(rects, y > 0 ? holes : []).map((r) => ({
    shape: 'floor' as const,
    center: new Vector3((r.minX + r.maxX) / 2, (y > 0 ? y : floorY) + ROOM_FLOOR_LIFT, (r.minZ + r.maxZ) / 2),
    size: [r.maxX - r.minX, 0, r.maxZ - r.minZ] as [number, number, number],
    color,
    occluder: false,
    surface: packSurface({ a: surface }),
    buildingId: building.id,
    role: 'floor' as const,
    id: room.id,
    detail: true,
  }))
}

/** A low concrete slab in front of a ground-storey door that leads outside. */
export function stoopDetail(door: DoorPlacement, thickness: number, building: BuildingInfo): StaticItem | null {
  if (door.center.y > FLOOR_SLACK) return null
  const alongX = door.hinge.x !== door.center.x
  const probe = thickness / 2 + 0.3
  const outside = (s: number) => !(alongX ? isInsideBuilding(building, door.center.x, door.center.z + s * probe) : isInsideBuilding(building, door.center.x + s * probe, door.center.z))
  const side = outside(1) ? 1 : outside(-1) ? -1 : 0
  if (side === 0) return null
  const at = framed(alongX, door.center.x, door.center.z)
  const d = at(0, door.width + 2 * STOOP.reach, door.center.y, door.center.y + STOOP.height, side * (thickness / 2 + STOOP.depth / 2), STOOP.depth)
  return detail(d, STOOP.color, 'concrete', building.id, 'floor', null)
}
