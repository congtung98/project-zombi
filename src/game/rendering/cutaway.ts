import type { Vec3 } from '../../types'
import { isInsideBuilding, roofHeight, type BuildingInfo } from '../world/buildings'
import { SLAB_THICKNESS } from '../world/floors'

/**
 * M11c-1A: building cutaway, presentation only. While the player is inside a building, the parts of
 * that building that would hide the storey the player is on are drawn lower or not at all:
 * - everything from the observed storey's ceiling up (roof, upper floor slabs, upper walls, doors,
 *   windows, furniture, lamps) is hidden;
 * - the walls of the observed storey that stand between the camera and the rooms (outer walls whose
 *   outside faces the camera, inner walls) are cut down to `WALL_CUT_HEIGHT`; outer walls facing
 *   away from the camera stay whole (the camera sees their inner face).
 * The observed storey follows the floor the player stands on, with hysteresis on the stairs.
 *
 * Nothing here touches the simulation: colliders, vision occluders, navigation, lighting and the
 * save never read it. Pieces keep casting their full shadow (`StaticBatches` shadow proxies).
 * This module is pure (no three.js, no React): `StaticBatches`, the door/window/lamp/zombie/drop
 * views and the F6 debug read the shared `cutaway` state, which `CutawayController` updates.
 */

/** Height (above the observed floor) the camera-side and inner walls are cut down to. */
export const WALL_CUT_HEIGHT = 0.6
/** Storeys the feet must move (from the observed storey) before the observed storey changes. */
export const LEVEL_SWITCH = 0.75
/** How far inside the footprint the player must be before the building is cut away (m). */
export const ENTER_DEPTH = 0.2
/** How far outside the footprint the player may go before the cutaway ends (m). */
export const LEAVE_MARGIN = 0.3
/** A piece whose top is at most this far above its limit stays whole (walls reaching the slab). */
const KEEP_TOLERANCE = 0.25
/** A piece with less than this left under its limit is hidden instead of cut. */
const HIDE_TOLERANCE = 0.05
/** A wall "belongs" to the observed storey when its bottom is within this of the storey floor. */
const STOREY_SLACK = 0.3
/** Distance past a wall face probed to tell the outside from the inside (m). */
const PROBE = 0.05

/** What a static piece is, for the cutaway rules (walls are cut, the rest only hidden). */
export type ArchRole = 'wall' | 'prop' | 'container' | 'roof' | 'slab' | 'floor' | 'stairs' | 'opening'

export interface Box3Like {
  min: Vec3
  max: Vec3
}

export interface CutawayView {
  buildingId: string
  /** Observed storey (0 = ground floor). */
  level: number
  /** Its floor height. */
  floorY: number
  /** Everything of the building from here up is hidden (the next slab's underside). */
  ceilingY: number
  /** Camera-side and inner walls of the observed storey stop here. */
  wallTopY: number
}

/** Horizontal direction towards the camera (signs of the isometric camera offset). */
export interface CameraSide {
  x: number
  z: number
}

export type PieceShow = 'full' | 'cut' | 'hidden'

/**
 * Observed storey from the feet height, with hysteresis: it changes only once the feet are
 * `LEVEL_SWITCH` storeys away from the current one (the middle of a flight never flickers).
 */
export function observedLevel(previous: number | null, feetY: number, b: Pick<BuildingInfo, 'height' | 'storeys'>): number {
  const t = feetY / b.height
  const top = (b.storeys ?? 1) - 1
  if (previous !== null && Math.abs(t - previous) < LEVEL_SWITCH) return previous
  return Math.min(top, Math.max(0, Math.round(t)))
}

export function viewFor(b: Pick<BuildingInfo, 'id' | 'height'>, level: number): CutawayView {
  const floorY = level * b.height
  return { buildingId: b.id, level, floorY, ceilingY: floorY + b.height - SLAB_THICKNESS, wallTopY: floorY + WALL_CUT_HEIGHT }
}

/**
 * Where a wall piece stands relative to its building and the camera: `camera` (outer wall whose
 * outside faces the camera), `far` (outer wall facing away), `inner` (inside on both sides) or
 * `free` (outside on both sides). A long piece is probed across its thin side only; a short one
 * (corner, jamb) on all four sides, and counts as `camera` if any outside side faces the camera.
 */
export function wallSide(b: BuildingInfo, box: Box3Like, camera: CameraSide): 'camera' | 'far' | 'inner' | 'free' {
  const w = box.max.x - box.min.x
  const d = box.max.z - box.min.z
  const cx = (box.min.x + box.max.x) / 2
  const cz = (box.min.z + box.max.z) / 2
  const out = (x: number, z: number) => !isInsideBuilding(b, x, z)
  const probes: { outside: boolean; facesCamera: boolean }[] = []
  if (w <= d * 1.5) {
    probes.push({ outside: out(box.max.x + PROBE, cz), facesCamera: camera.x > 0 }, { outside: out(box.min.x - PROBE, cz), facesCamera: camera.x < 0 })
  }
  if (d <= w * 1.5) {
    probes.push({ outside: out(cx, box.max.z + PROBE), facesCamera: camera.z > 0 }, { outside: out(cx, box.min.z - PROBE), facesCamera: camera.z < 0 })
  }
  const outside = probes.filter((p) => p.outside)
  if (outside.length === 0) return 'inner'
  if (outside.length === probes.length) return 'free'
  return outside.some((p) => p.facesCamera) ? 'camera' : 'far'
}

/**
 * Height a piece of the view's building is drawn up to (Infinity: whole). Walls and openings (door
 * leaves, window panes) of the observed storey on the camera side or inside stop at `wallTopY`;
 * everything stops at `ceilingY`.
 */
export function displayLimit(view: CutawayView, b: BuildingInfo, box: Box3Like, role: ArchRole, camera: CameraSide): number {
  if (b.id !== view.buildingId) return Infinity
  if ((role === 'wall' || role === 'opening') && box.min.y >= view.floorY - STOREY_SLACK && box.min.y < view.ceilingY) {
    const side = wallSide(b, box, camera)
    if (side === 'camera' || side === 'inner') return view.wallTopY
  }
  return view.ceilingY
}

/** Whole, cut down to `limit`, or hidden. */
export function pieceShow(box: Box3Like, limit: number): PieceShow {
  // Hidden first: a slab right under the limit is gone, not kept by the tolerance below.
  if (limit - box.min.y <= HIDE_TOLERANCE) return 'hidden'
  if (box.max.y <= limit + KEEP_TOLERANCE) return 'full'
  return 'cut'
}

/**
 * The scene's current cutaway: which building (if any) and which storey. `update` runs every frame
 * (`CutawayController`); `version` bumps when the view changes, so readers recompute only then.
 */
export class CutawayState {
  view: CutawayView | null = null
  building: BuildingInfo | null = null
  version = 0
  /** Last composition, for the F6 debug: pieces hidden, cut and shadow proxies kept, time spent. */
  stats = { hidden: 0, cut: 0, shadows: 0, ms: 0 }
  private camera: CameraSide = { x: 1, z: 1 }
  private findBuilding: (p: Vec3, margin: number) => BuildingInfo | null = () => null

  /** Wire to a world (the building lookup) and the camera side; resets the view. */
  attach(findBuilding: (p: Vec3, margin: number) => BuildingInfo | null, camera: CameraSide): void {
    this.findBuilding = findBuilding
    this.camera = { x: Math.sign(camera.x), z: Math.sign(camera.z) }
    this.set(null, null)
  }

  get cameraSide(): CameraSide {
    return this.camera
  }

  /** Follow the player (feet position); true when the view changed. */
  update(p: Vec3): boolean {
    let b = this.building
    // Keep the building until the player is clearly out of it (doorways never flicker).
    if (b && !(isInsideBuilding(b, p.x, p.z, LEAVE_MARGIN) && p.y < roofHeight(b))) b = null
    if (!b) {
      const found = this.findBuilding(p, -ENTER_DEPTH)
      b = found && p.y < roofHeight(found) ? found : null
    }
    if (!b) return this.set(null, null)
    const level = observedLevel(b === this.building && this.view ? this.view.level : null, p.y, b)
    if (b === this.building && this.view?.level === level) return false
    return this.set(b, viewFor(b, level))
  }

  /** Height a piece is drawn up to (Infinity: whole, including every piece of other buildings). */
  limit(buildingId: string | undefined, box: Box3Like, role: ArchRole): number {
    if (!this.view || !this.building || buildingId !== this.view.buildingId) return Infinity
    return displayLimit(this.view, this.building, box, role, this.camera)
  }

  /** Whether an entity standing at `p` (feet) is on a hidden storey of the view building. */
  hidesPoint(p: Vec3): boolean {
    const v = this.view
    return !!v && !!this.building && p.y >= v.ceilingY - 0.1 && isInsideBuilding(this.building, p.x, p.z)
  }

  /** Whether a storey floor of a building is the one the player looks at (ground floor elsewhere). */
  storeyShown(buildingId: string | undefined, floorY: number): boolean {
    const v = this.view
    const shown = v && buildingId === v.buildingId ? v.floorY : 0
    return Math.abs(floorY - shown) < 0.5
  }

  private set(b: BuildingInfo | null, view: CutawayView | null): boolean {
    if (this.building === b && this.view === view) return false
    this.building = b
    this.view = view
    this.version += 1
    return true
  }
}

export const cutaway = new CutawayState()
