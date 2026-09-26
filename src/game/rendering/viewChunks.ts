import { chunkIndex } from '../../map/transform'

/**
 * M10: which chunks the scene mounts (static batches, doors, containers, windows, lamps). Only what
 * the camera can see, grown by a margin, instead of the whole world: a 500 m town mounts ~12 000
 * objects and runs ~2 700 per-frame callbacks otherwise. The simulation keeps the whole world; this
 * is presentation only (plain data, tested without WebGL).
 */

export interface GroundRect {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

export interface ViewRay {
  origin: { x: number; y: number; z: number }
  dir: { x: number; y: number; z: number }
}

/** Group of items longer than a chunk (fence, long walls): always mounted. */
export const WIDE_KEY = 'wide'

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`
}

/** Chunk group of an item: the chunk of its centre, or `WIDE_KEY` when it spans more than a chunk. */
export function itemChunkKey(x: number, z: number, sizeX: number, sizeZ: number, chunkSize: number): string {
  if (sizeX > chunkSize || sizeZ > chunkSize) return WIDE_KEY
  return chunkKey(chunkIndex(x, chunkSize), chunkIndex(z, chunkSize))
}

/**
 * Ground rectangle under the view: where the frustum's corner rays cross the ground and the plane
 * `top` metres up (so objects up to that height standing just outside the ground footprint, which
 * still reach into the picture, count). Null when no ray reaches either plane.
 */
export function viewGroundRect(rays: readonly ViewRay[], top: number): GroundRect | null {
  let rect: GroundRect | null = null
  for (const { origin, dir } of rays) {
    if (Math.abs(dir.y) < 1e-6) continue
    for (const h of [0, top]) {
      const t = (h - origin.y) / dir.y
      const x = origin.x + dir.x * t
      const z = origin.z + dir.z * t
      if (!rect) rect = { minX: x, minZ: z, maxX: x, maxZ: z }
      else {
        rect.minX = Math.min(rect.minX, x)
        rect.minZ = Math.min(rect.minZ, z)
        rect.maxX = Math.max(rect.maxX, x)
        rect.maxZ = Math.max(rect.maxZ, z)
      }
    }
  }
  return rect
}

/** Keys of the chunks overlapping the rectangle grown by `margin`, row by row. */
export function chunksInRect(rect: GroundRect, chunkSize: number, margin: number): string[] {
  const keys: string[] = []
  const c0 = chunkIndex(rect.minX - margin, chunkSize)
  const c1 = chunkIndex(rect.maxX + margin, chunkSize)
  const r0 = chunkIndex(rect.minZ - margin, chunkSize)
  const r1 = chunkIndex(rect.maxZ + margin, chunkSize)
  for (let cz = r0; cz <= r1; cz++) for (let cx = c0; cx <= c1; cx++) keys.push(chunkKey(cx, cz))
  return keys
}

/** Chunks within `radius` chunks of a point (the player's physics neighbourhood). */
export function chunksAround(x: number, z: number, chunkSize: number, radius: number): string[] {
  const cx = chunkIndex(x, chunkSize)
  const cz = chunkIndex(z, chunkSize)
  const keys: string[] = []
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) keys.push(chunkKey(cx + dx, cz + dz))
  return keys
}

export interface ViewChunkOptions {
  chunkSize: number
  /** Metres added around the view rectangle: an item up to a chunk wide belongs to its centre's chunk. */
  margin: number
  /** Extra metres a shown chunk may drift out before it unloads (hysteresis). */
  keep: number
}

/**
 * The next set of shown chunks, sorted: every chunk in the view (+ margin) and `always` (the player's
 * neighbourhood), plus the currently shown ones still within the view grown by `keep`. A camera
 * resting on a chunk line therefore never loads and unloads the same chunk frame after frame.
 */
export function nextViewChunks(current: ReadonlySet<string>, rect: GroundRect | null, always: readonly string[], opts: ViewChunkOptions): string[] {
  const next = new Set(always)
  if (rect) {
    for (const k of chunksInRect(rect, opts.chunkSize, opts.margin)) next.add(k)
    const kept = new Set(chunksInRect(rect, opts.chunkSize, opts.margin + opts.keep))
    for (const k of current) if (kept.has(k)) next.add(k)
  }
  return [...next].sort()
}
