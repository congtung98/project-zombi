/**
 * Uniform grid on the ground plane (XZ) for "what is near here" queries (R1). Items are stored with
 * an axis-aligned footprint (a point has zero extent) and bucketed into every cell it overlaps.
 *
 * Queries are exact on the stored footprint (not just "same cell"), and results come back in
 * insertion order (`seq`), so replacing a loop over a list with a query returns the same items in
 * the same order and keeps simulation results bit-identical. The cost is O(cells touched + hits).
 *
 * World-scale note: this is an in-memory index for the loaded area. Chunk ownership (R3) can keep
 * one hash per chunk or keep this one and insert/remove on chunk load/unload.
 */

interface Entry<T> {
  id: string
  item: T
  seq: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  /** Cell range currently occupied. */
  c0x: number
  c1x: number
  c0z: number
  c1z: number
  /** Last query that returned it (dedupes items spanning several cells). */
  stamp: number
}

/** Cell coordinates fit in 16 bits each side of 0 (±32767 cells, ±131 km at 4 m cells). */
const OFFSET = 32768
const cellKey = (cx: number, cz: number): number => (cx + OFFSET) * 65536 + (cz + OFFSET)

export interface SpatialBounds {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

export class SpatialHash<T> {
  readonly cellSize: number
  private readonly inv: number
  private readonly cells = new Map<number, Entry<T>[]>()
  private readonly entries = new Map<string, Entry<T>>()
  private nextSeq = 0
  private queryStamp = 0
  private readonly scratch: Entry<T>[] = []

  constructor(cellSize: number) {
    this.cellSize = cellSize
    this.inv = 1 / cellSize
  }

  get size(): number {
    return this.entries.size
  }

  has(id: string): boolean {
    return this.entries.has(id)
  }

  get(id: string): T | undefined {
    return this.entries.get(id)?.item
  }

  /** Add (or replace, keeping nothing of the old entry) an item with a footprint centred on x, z. */
  insert(id: string, item: T, x: number, z: number, halfX = 0, halfZ = 0): void {
    this.remove(id)
    const e: Entry<T> = {
      id, item, seq: this.nextSeq++,
      minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ,
      c0x: 0, c1x: -1, c0z: 0, c1z: -1, stamp: -1,
    }
    this.entries.set(id, e)
    this.place(e)
  }

  /** Move an item (keeps its insertion order); re-buckets only when its cell range changed. */
  update(id: string, x: number, z: number, halfX = 0, halfZ = 0): void {
    const e = this.entries.get(id)
    if (!e) return
    e.minX = x - halfX
    e.maxX = x + halfX
    e.minZ = z - halfZ
    e.maxZ = z + halfZ
    const c0x = Math.floor(e.minX * this.inv)
    const c1x = Math.floor(e.maxX * this.inv)
    const c0z = Math.floor(e.minZ * this.inv)
    const c1z = Math.floor(e.maxZ * this.inv)
    if (c0x === e.c0x && c1x === e.c1x && c0z === e.c0z && c1z === e.c1z) return
    this.unplace(e)
    this.place(e)
  }

  remove(id: string): void {
    const e = this.entries.get(id)
    if (!e) return
    this.unplace(e)
    this.entries.delete(id)
  }

  clear(): void {
    this.cells.clear()
    this.entries.clear()
  }

  /** Items whose footprint overlaps the box (edges inclusive), in insertion order. */
  queryAABB(minX: number, minZ: number, maxX: number, maxZ: number, out: T[] = []): T[] {
    const hits = this.collect(minX, minZ, maxX, maxZ)
    for (const e of hits) {
      if (e.maxX < minX || e.minX > maxX || e.maxZ < minZ || e.minZ > maxZ) continue
      out.push(e.item)
    }
    return out
  }

  /** Items whose footprint lies within `radius` of (x, z) (closest point of the box), in insertion order. */
  queryRadius(x: number, z: number, radius: number, out: T[] = []): T[] {
    const hits = this.collect(x - radius, z - radius, x + radius, z + radius)
    const r2 = radius * radius
    for (const e of hits) {
      const dx = x < e.minX ? e.minX - x : x > e.maxX ? x - e.maxX : 0
      const dz = z < e.minZ ? e.minZ - z : z > e.maxZ ? z - e.maxZ : 0
      if (dx * dx + dz * dz > r2) continue
      out.push(e.item)
    }
    return out
  }

  /** Candidates of every cell the box touches (deduped, sorted by insertion order). */
  private collect(minX: number, minZ: number, maxX: number, maxZ: number): Entry<T>[] {
    const stamp = ++this.queryStamp
    const found = this.scratch
    found.length = 0
    const c0x = Math.floor(minX * this.inv)
    const c1x = Math.floor(maxX * this.inv)
    const c0z = Math.floor(minZ * this.inv)
    const c1z = Math.floor(maxZ * this.inv)
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const list = this.cells.get(cellKey(cx, cz))
        if (!list) continue
        for (const e of list) {
          if (e.stamp === stamp) continue
          e.stamp = stamp
          found.push(e)
        }
      }
    }
    if (found.length > 1) found.sort(bySeq)
    return found
  }

  private place(e: Entry<T>): void {
    e.c0x = Math.floor(e.minX * this.inv)
    e.c1x = Math.floor(e.maxX * this.inv)
    e.c0z = Math.floor(e.minZ * this.inv)
    e.c1z = Math.floor(e.maxZ * this.inv)
    for (let cx = e.c0x; cx <= e.c1x; cx++) {
      for (let cz = e.c0z; cz <= e.c1z; cz++) {
        const key = cellKey(cx, cz)
        let list = this.cells.get(key)
        if (!list) {
          list = []
          this.cells.set(key, list)
        }
        list.push(e)
      }
    }
  }

  private unplace(e: Entry<T>): void {
    for (let cx = e.c0x; cx <= e.c1x; cx++) {
      for (let cz = e.c0z; cz <= e.c1z; cz++) {
        const key = cellKey(cx, cz)
        const list = this.cells.get(key)
        if (!list) continue
        const i = list.indexOf(e)
        if (i >= 0) {
          list[i] = list[list.length - 1]
          list.pop()
        }
        if (list.length === 0) this.cells.delete(key)
      }
    }
  }
}

function bySeq(a: { seq: number }, b: { seq: number }): number {
  return a.seq - b.seq
}
