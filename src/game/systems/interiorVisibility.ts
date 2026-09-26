import type { InteriorVisibilityConfig, PlayerVisionConfig } from '../core/config'
import { isInsideRoom, onRoomStorey, type RoomPlacement } from '../world/buildings'
import type { VisionOccluderSet } from '../world/visionOccluders'
import type { Vec3 } from '../../types'
import type { SavedExploration } from '../../types/save'
import { cosHalfFov, facingForward } from './playerVision'
import { computeSectorDistances } from './visionOverlay'

/**
 * M11c-1B: which parts of the interiors the character sees now, and which it has seen before.
 * Presentation state, like player vision (which it follows: same cone, near radius, distance and
 * occluders): AI, lighting and the simulation never read it. The renderer darkens the cells that are
 * not seen now (`InteriorMask`), the cutaway cuts away buildings seen into from outside (`peeks`),
 * and the save keeps the memory (`serialize`/`restore`).
 *
 * Every room is a grid of `cell`-sized cells over its bounds (cells whose centre is in the room).
 * A pass (every `updateInterval`) casts a fan of rays from the eye through the vision occluders
 * (walls, closed doors and curtains stop it, glass and open doors do not) and marks a cell of the
 * character's storey seen when it is in range, in the cone or near, and not past where the ray
 * stopped. Seen cells are remembered (explored) for good.
 */

export interface RoomGrid {
  room: RoomPlacement
  minX: number
  minZ: number
  cols: number
  rows: number
  /** 1 where the cell centre is inside the room (L/T/U rooms leave cells out). */
  inside: Uint8Array
  /** Seen in the last pass. */
  seen: Uint8Array
  /** Seen at least once. */
  explored: Uint8Array
  exploredCount: number
  insideCount: number
}

export interface InteriorObserver {
  position: Vec3
  facing: number
}

export class InteriorVisibility {
  readonly grids: RoomGrid[]
  readonly byRoom = new Map<string, RoomGrid>()
  /** Bumped whenever a seen or explored cell changes (renderers re-upload then). */
  revision = 0
  /** Buildings the character sees into from outside this pass (≥ `peekMinCells` cells near). */
  peeks: string[] = []
  /** Seen cells per building in the last pass (debug). */
  readonly seenByBuilding = new Map<string, number>()
  private readonly sectors: Float32Array
  private timer = 0
  /** What the last pass saw from (position, facing, world revision): the same again is skipped. */
  private lastKey = ''
  private readonly cfg: InteriorVisibilityConfig
  private readonly vision: PlayerVisionConfig

  constructor(rooms: readonly RoomPlacement[], cfg: InteriorVisibilityConfig, vision: PlayerVisionConfig) {
    this.cfg = cfg
    this.vision = vision
    this.sectors = new Float32Array(cfg.rays)
    this.grids = rooms.map((room) => grid(room, cfg.cell))
    for (const g of this.grids) this.byRoom.set(g.room.id, g)
  }

  /** Forget everything (new game). */
  clear(): void {
    for (const g of this.grids) {
      g.seen.fill(0)
      g.explored.fill(0)
      g.exploredCount = 0
    }
    this.peeks = []
    this.seenByBuilding.clear()
    this.timer = 0
    this.lastKey = ''
    this.revision += 1
  }

  /**
   * Throttled pass (`updateInterval`); `inside` is the building the character stands in, if any.
   * `worldRevision` changes when doors or curtains do (what the rays pass): a pass from the same
   * spot, facing and revision as the last one is skipped (a character standing still costs nothing).
   */
  step(dt: number, observer: InteriorObserver, occluders: VisionOccluderSet, inside: string | null, worldRevision = 0): void {
    this.timer -= dt
    if (this.timer > 0) return
    this.timer = this.cfg.updateInterval
    const p = observer.position
    const key = `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)},${observer.facing.toFixed(2)},${inside},${worldRevision}`
    if (key === this.lastKey) return
    this.lastKey = key
    this.update(observer, occluders, inside)
  }

  /** One pass now. */
  update(observer: InteriorObserver, occluders: VisionOccluderSet, inside: string | null): void {
    const { cfg, vision } = this
    const p = observer.position
    // The fan of rays only when some room is in range (outdoors, far from houses: nothing to do).
    const range = vision.visionDistance
    const anyInRange = this.grids.some((g) => onRoomStorey(g.room, p.y) && dist2(p.x, p.z, g.room.bounds) <= range * range)
    if (anyInRange) computeSectorDistances(p, occluders, vision, this.sectors)
    const n = this.sectors.length
    const fwd = facingForward(observer.facing)
    const cosHalf = cosHalfFov(vision.fieldOfView)
    const near = vision.nearDetectionRadius
    let changed = false
    this.seenByBuilding.clear()
    const peekCells = new Map<string, number>()
    for (const g of this.grids) {
      const room = g.room
      const b = room.bounds
      // Rooms of another storey or out of range: nothing seen.
      const reachable = onRoomStorey(room, p.y) && dist2(p.x, p.z, b) <= range * range
      if (!reachable) {
        if (g.seen.includes(1)) {
          g.seen.fill(0)
          changed = true
        }
        continue
      }
      let seenHere = 0
      let peekHere = 0
      for (let r = 0; r < g.rows; r++) {
        for (let c = 0; c < g.cols; c++) {
          const i = r * g.cols + c
          if (!g.inside[i]) continue
          const x = g.minX + (c + 0.5) * cfg.cell
          const z = g.minZ + (r + 0.5) * cfg.cell
          const dx = x - p.x
          const dz = z - p.z
          const d = Math.hypot(dx, dz)
          let seen = d <= range && (d <= near || (d > 0 ? (dx * fwd.x + dz * fwd.z) / d >= cosHalf : true))
          if (seen && d > 0) {
            // The two rays around this direction; the nearer stop wins (no seeing past a wall edge).
            let a = Math.atan2(dx, dz)
            if (a < 0) a += Math.PI * 2
            const f = (a / (Math.PI * 2)) * n - 0.5
            const i0 = ((Math.floor(f) % n) + n) % n
            const clear = Math.min(this.sectors[i0], this.sectors[(i0 + 1) % n])
            seen = d <= clear + cfg.wallTolerance
          }
          const v = seen ? 1 : 0
          if (g.seen[i] !== v) {
            g.seen[i] = v
            changed = true
          }
          if (seen) {
            seenHere += 1
            if (d <= cfg.peekDistance) peekHere += 1
            if (!g.explored[i]) {
              g.explored[i] = 1
              g.exploredCount += 1
              changed = true
            }
          }
        }
      }
      if (seenHere > 0) this.seenByBuilding.set(room.buildingId, (this.seenByBuilding.get(room.buildingId) ?? 0) + seenHere)
      if (peekHere > 0 && room.buildingId !== inside) peekCells.set(room.buildingId, (peekCells.get(room.buildingId) ?? 0) + peekHere)
    }
    const peeks = [...peekCells].filter(([, count]) => count >= cfg.peekMinCells).map(([id]) => id).sort()
    if (peeks.join('|') !== this.peeks.join('|')) {
      this.peeks = peeks
      changed = true
    }
    if (changed) this.revision += 1
  }

  /** Share of a room's cells explored (0..1); 0 for an unknown room. */
  exploredShare(roomId: string): number {
    const g = this.byRoom.get(roomId)
    return g && g.insideCount > 0 ? g.exploredCount / g.insideCount : 0
  }

  /** The memory for the save; undefined while nothing is explored (a save round-trips unchanged). */
  serialize(): SavedExploration | undefined {
    const rooms: SavedExploration['rooms'] = []
    for (const g of this.grids) if (g.exploredCount > 0) rooms.push({ id: g.room.id, bits: toBase64(pack(g.explored)) })
    return rooms.length ? { cell: this.cfg.cell, rooms } : undefined
  }

  /**
   * Restore a saved memory. Rooms that no longer exist, or whose grid changed (another cell size,
   * other bounds after a content update), are skipped: the memory is only a view, never an error.
   */
  restore(saved: SavedExploration | undefined): void {
    this.clear()
    if (!saved || saved.cell !== this.cfg.cell) return
    for (const r of saved.rooms) {
      const g = this.byRoom.get(r.id)
      if (!g) continue
      const bits = fromBase64(r.bits)
      if (!bits || bits.length !== Math.ceil(g.explored.length / 8)) continue
      for (let i = 0; i < g.explored.length; i++) {
        if (g.inside[i] && bits[i >> 3] & (1 << (i & 7))) {
          g.explored[i] = 1
          g.exploredCount += 1
        }
      }
    }
    this.revision += 1
  }
}

/** Whether a saved exploration has the right shape (anything else is dropped, never corrupt). */
export function isSavedExploration(value: unknown): value is SavedExploration {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.cell === 'number' && v.cell > 0 && Array.isArray(v.rooms) && v.rooms.every((r) => !!r && typeof r === 'object' && typeof (r as Record<string, unknown>).id === 'string' && typeof (r as Record<string, unknown>).bits === 'string')
}

function grid(room: RoomPlacement, cell: number): RoomGrid {
  const b = room.bounds
  const cols = Math.max(1, Math.ceil((b.maxX - b.minX) / cell - 1e-6))
  const rows = Math.max(1, Math.ceil((b.maxZ - b.minZ) / cell - 1e-6))
  const inside = new Uint8Array(cols * rows)
  let insideCount = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = b.minX + (c + 0.5) * cell
      const z = b.minZ + (r + 0.5) * cell
      if (isInsideRoom(b, x, z, room.outline)) {
        inside[r * cols + c] = 1
        insideCount += 1
      }
    }
  }
  const size = cols * rows
  return { room, minX: b.minX, minZ: b.minZ, cols, rows, inside, seen: new Uint8Array(size), explored: new Uint8Array(size), exploredCount: 0, insideCount }
}

/** Squared distance from a point to a rectangle (0 inside). */
function dist2(x: number, z: number, b: { minX: number; maxX: number; minZ: number; maxZ: number }): number {
  const dx = Math.max(b.minX - x, 0, x - b.maxX)
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ)
  return dx * dx + dz * dz
}

function pack(cells: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(cells.length / 8))
  for (let i = 0; i < cells.length; i++) if (cells[i]) out[i >> 3] |= 1 << (i & 7)
  return out
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromBase64(text: string): Uint8Array | null {
  try {
    const s = atob(text)
    const out = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
    return out
  } catch {
    return null
  }
}
