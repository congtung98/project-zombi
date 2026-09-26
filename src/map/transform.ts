import type { QuarterTurns, Rect, XZ } from './schema.ts'

/**
 * Coordinates, chunks and stable IDs of map content (docs/map-content-format.md §2–§3).
 * World position = chunkOrigin + instancePosition + rotate(local − pivot, quarterTurns), then
 * quantised to 1 µm so the same point has one canonical value whatever the chunk/instance split.
 */

const QUANTUM = 1e6

/** Round to 1 µm; −0 becomes 0 (JSON and deep equality treat them differently). */
export function quantize(v: number): number {
  return Math.round(v * QUANTUM) / QUANTUM + 0
}

/** Rotate (x, z) about +Y by q quarter turns: q = 1 → (z, −x). Exact, no trigonometry. */
export function rotateXZ(x: number, z: number, q: number): [number, number] {
  switch (q & 3) {
    case 0:
      return [x + 0, z + 0]
    case 1:
      return [z + 0, -x + 0]
    case 2:
      return [-x + 0, -z + 0]
    default:
      return [-z + 0, x + 0]
  }
}

/** `rotation.y` for a leaf/pane turned q quarter turns, in (−π, π] like the hand-made placements. */
export function quarterAngle(q: number): number {
  return [0, Math.PI / 2, Math.PI, -Math.PI / 2][((q % 4) + 4) % 4]
}

export function addQuarterTurns(a: number, b: number): QuarterTurns {
  return (((a + b) % 4) + 4) % 4 as QuarterTurns
}

/** Axis-aligned size after rotation: odd turns swap X and Z. */
export function rotateSize<T extends [number, number, number] | [number, number]>(size: T, q: number): T {
  if ((q & 1) === 0) return [...size] as T
  return (size.length === 3 ? [size[2], size[1], size[0]] : [size[1], size[0]]) as T
}

export function rotateRect(r: Rect, q: number): Rect {
  const [ax, az] = rotateXZ(r.minX, r.minZ, q)
  const [bx, bz] = rotateXZ(r.maxX, r.maxZ, q)
  return { minX: Math.min(ax, bx), minZ: Math.min(az, bz), maxX: Math.max(ax, bx), maxZ: Math.max(az, bz) }
}

/** Chunk index of a coordinate; points on a boundary belong to the higher chunk (half-open). */
export function chunkIndex(v: number, chunkSize: number): number {
  return Math.floor(v / chunkSize)
}

export function chunkOrigin(cx: number, cz: number, chunkSize: number): XZ {
  return { x: cx * chunkSize + 0, z: cz * chunkSize + 0 }
}

/** Canonical chunk ID: `c<cx>_<cz>`, e.g. `c-1_0`. */
export function chunkIdOf(cx: number, cz: number): string {
  return `c${cx + 0}_${cz + 0}`
}

const CHUNK_ID = /^c(0|-?[1-9]\d*)_(0|-?[1-9]\d*)$/

export function parseChunkId(id: string): { cx: number; cz: number } | null {
  const m = CHUNK_ID.exec(id)
  return m ? { cx: Number(m[1]), cz: Number(m[2]) } : null
}

/**
 * Chunks a rectangle overlaps. Extents are half-open like chunks (an edge lying exactly on a chunk
 * line does not reach into the next chunk); a point or line still has its one owning chunk.
 */
export function chunksOverlapping(r: Rect, chunkSize: number): { cx: number; cz: number }[] {
  const range = (min: number, max: number) => {
    const lo = chunkIndex(min, chunkSize)
    const hi = max > min ? Math.ceil(max / chunkSize) - 1 : lo
    return [lo, Math.max(lo, hi)] as const
  }
  const [x0, x1] = range(r.minX, r.maxX)
  const [z0, z1] = range(r.minZ, r.maxZ)
  const out: { cx: number; cz: number }[] = []
  for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) out.push({ cx, cz })
  return out
}

/** World rectangle of a play area (`world.playArea` or the same fields on `MapData`). */
export function playAreaRect(p: { size: number; depth?: number; center?: XZ }): Rect {
  const hx = p.size / 2
  const hz = (p.depth ?? p.size) / 2
  const cx = p.center?.x ?? 0
  const cz = p.center?.z ?? 0
  return { minX: cx - hx, minZ: cz - hz, maxX: cx + hx, maxZ: cz + hz }
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b }
  return { minX: Math.min(a.minX, b.minX), minZ: Math.min(a.minZ, b.minZ), maxX: Math.max(a.maxX, b.maxX), maxZ: Math.max(a.maxZ, b.maxZ) }
}

/** Lower-case words joined by single hyphens: `door-front`, `t0-1-safehouse`. */
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** Slash-separated slugs: `building/safehouse`. */
export const PREFAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/

/**
 * Split a record ID into its identity chunk and name. Instances: `<chunk>/<name>`; other records:
 * `<chunk>/<namespace>/<name>`. The identity chunk never changes when a record moves (it is part of
 * the ID, not a pointer to the owner), so saves keep matching.
 */
export function parseRecordId(id: string, namespace: string | null): { chunkId: string; name: string } | null {
  const parts = id.split('/')
  const expected = namespace ? 3 : 2
  if (parts.length !== expected || !parseChunkId(parts[0])) return null
  if (namespace && parts[1] !== namespace) return null
  const name = parts[expected - 1]
  return SLUG.test(name) ? { chunkId: parts[0], name } : null
}
