// Prefab library P2–P5: a small typed builder for library prefabs and compounds. It writes the same
// JSON the prefab editor writes (wall runs cut by doors and windows, rooms with lamps, furniture from
// the editor's presets, stairs), so every prefab is ordinary content: validated by the game's
// validator, deep-checked with the game's own systems, and edited afterwards in the map editor.
import { MAP_SCHEMA_VERSION, type BuildingProps, type CompoundDocument, type LibraryInfo, type PrefabDocument, type PrefabObject, type PrefabPlacement, type QuarterTurns, type Rect, type RoomObject, type SurfaceMaterial, type XZ } from '../../../src/map/schema.ts'
import { quantize } from '../../../src/map/transform.ts'
import { PREFAB_PRESETS } from '../../../src/map/editor/prefabPresets.ts'
import { surfaceTemplate } from '../../../src/map/editor/surfaces.ts'
import { checkAccess } from './access.ts'

export type Side = 'N' | 'S' | 'E' | 'W'

let RAW = false
/** Debugging (debug.ts): return prefabs even when a check fails. */
export function buildRaw(v: boolean): void {
  RAW = v
}
type Obj = Record<string, unknown>

const q = quantize
export const rect = (minX: number, minZ: number, maxX: number, maxZ: number): Rect => ({ minX: q(minX), minZ: q(minZ), maxX: q(maxX), maxZ: q(maxZ) })

export interface BuildingSpec {
  prefabId: string
  name: string
  /** Footprint on the wall centre lines (the rectangle, or the bounding box of `outline`). */
  footprint: Rect
  outline?: XZ[]
  storeys?: number
  height?: number
  wallThickness?: number
  wallColor?: string
  roofColor?: string
  floorColor?: string
  catalog: LibraryInfo
  placement?: PrefabPlacement
  variants?: string[]
}

export interface Box {
  kind: 'prop' | 'container' | 'wall'
  size: [number, number, number]
  color: string
  name?: string
  loot?: string
  asset?: string
}

/** A preset of the prefab editor as a box (its size, colour, loot and asset). */
export function preset(id: string, over: Partial<Box> = {}): Box {
  const p = PREFAB_PRESETS.find((x) => x.id === id)
  if (!p) throw new Error(`no preset ${id}`)
  const t = p.template as Obj
  return {
    kind: t.kind as Box['kind'],
    size: [...(t.size as [number, number, number])],
    color: t.color as string,
    ...(t.name ? { name: t.name as string } : {}),
    ...(t.lootTableId ? { loot: t.lootTableId as string } : {}),
    ...((t.visual as Obj | undefined)?.assetId ? { asset: (t.visual as Obj).assetId as string } : {}),
    ...over,
  }
}

/** Plain box (no preset): a counter, a machine, a bench, a tombstone. */
export const box = (kind: Box['kind'], size: [number, number, number], color: string, over: Partial<Box> = {}): Box => ({ kind, size, color, ...over })

interface Door {
  level: number
  at: XZ
  width: number
  alongX: boolean
}

export class Building {
  readonly spec: BuildingSpec
  readonly b: BuildingProps
  readonly objects: Obj[] = []
  readonly rooms: RoomObject[] = []
  private readonly doors: Door[] = []
  private readonly used = new Map<string, number>()

  constructor(spec: BuildingSpec) {
    this.spec = spec
    this.b = {
      height: spec.height ?? 3,
      ...((spec.storeys ?? 1) > 1 ? { storeys: spec.storeys } : {}),
      wallThickness: spec.wallThickness ?? 0.2,
      wallColor: spec.wallColor ?? '#c9b99a',
      roofColor: spec.roofColor ?? '#7a3f2f',
      floorColor: spec.floorColor ?? '#8a7560',
    }
  }

  get t(): number {
    return this.b.wallThickness
  }

  private id(base: string): string {
    const n = (this.used.get(base) ?? 0) + 1
    this.used.set(base, n)
    return `${base}-${n}`
  }

  private lv(level: number): Obj {
    return level ? { level } : {}
  }

  /** Wall runs along the footprint (or outline) at every storey. */
  outerWalls(levels = this.spec.storeys ?? 1): this {
    const f = this.spec.footprint
    const pts = this.spec.outline ?? [
      { x: f.minX, z: f.minZ },
      { x: f.maxX, z: f.minZ },
      { x: f.maxX, z: f.maxZ },
      { x: f.minX, z: f.maxZ },
    ]
    for (let level = 0; level < levels; level++) for (let i = 0; i < pts.length; i++) this.wall(level, pts[i], pts[(i + 1) % pts.length], level ? `outer-${level + 1}` : 'outer')
    return this
  }

  /** A straight wall run along X or Z. */
  wall(level: number, from: XZ, to: XZ, base = 'wall', over: Obj = {}): this {
    if (from.x !== to.x && from.z !== to.z) throw new Error(`${this.spec.prefabId}: wall ${JSON.stringify(from)}→${JSON.stringify(to)} not along an axis`)
    this.objects.push({ kind: 'wallRun', ...this.lv(level), localId: this.id(base), from: { x: q(from.x), z: q(from.z) }, to: { x: q(to.x), z: q(to.z) }, height: this.b.height, thickness: this.t, color: this.b.wallColor, ...over })
    return this
  }

  /** Wall along X at z from x0 to x1, or along Z at x from z0 to z1. */
  wallX(level: number, z: number, x0: number, x1: number, base = 'wall'): this {
    return this.wall(level, { x: x0, z }, { x: x1, z }, base)
  }
  wallZ(level: number, x: number, z0: number, z1: number, base = 'wall'): this {
    return this.wall(level, { x, z: z0 }, { x, z: z1 }, base)
  }

  /** Extent [min, max] along its axis of the wall run a point lies on (the nearest crossing walls bound it). */
  private wallEnds(level: number, at: XZ, alongX: boolean): [number, number] | null {
    const runs = this.objects.filter((o) => o.kind === 'wallRun' && ((o.level as number | undefined) ?? 0) === level)
    const host = runs.find((r) => {
      const f = r.from as XZ
      const t = r.to as XZ
      return alongX ? f.z === t.z && Math.abs(at.z - f.z) < 1e-6 && at.x >= Math.min(f.x, t.x) && at.x <= Math.max(f.x, t.x) : f.x === t.x && Math.abs(at.x - f.x) < 1e-6 && at.z >= Math.min(f.z, t.z) && at.z <= Math.max(f.z, t.z)
    })
    if (!host) return null
    const f = host.from as XZ
    const t = host.to as XZ
    let lo = alongX ? Math.min(f.x, t.x) : Math.min(f.z, t.z)
    let hi = alongX ? Math.max(f.x, t.x) : Math.max(f.z, t.z)
    // Walls crossing the host between the door and its ends.
    const c = alongX ? at.x : at.z
    for (const r of runs) {
      const a = r.from as XZ
      const b = r.to as XZ
      if (alongX && a.x === b.x && Math.min(a.z, b.z) <= at.z + 1e-6 && Math.max(a.z, b.z) >= at.z - 1e-6) {
        if (a.x < c && a.x > lo) lo = a.x
        if (a.x > c && a.x < hi) hi = a.x
      }
      if (!alongX && a.z === b.z && Math.min(a.x, b.x) <= at.x + 1e-6 && Math.max(a.x, b.x) >= at.x - 1e-6) {
        if (a.z < c && a.z > lo) lo = a.z
        if (a.z > c && a.z < hi) hi = a.z
      }
    }
    return [lo, hi]
  }

  private onWallAxis(level: number, at: XZ): boolean {
    const runs = this.objects.filter((o) => o.kind === 'wallRun' && ((o.level as number | undefined) ?? 0) === level)
    for (const r of runs) {
      const f = r.from as XZ
      const t = r.to as XZ
      if (f.z === t.z && Math.abs(at.z - f.z) < 1e-6 && at.x >= Math.min(f.x, t.x) && at.x <= Math.max(f.x, t.x)) return true
      if (f.x === t.x && Math.abs(at.x - f.x) < 1e-6 && at.z >= Math.min(f.z, t.z) && at.z <= Math.max(f.z, t.z)) return false
    }
    throw new Error(`${this.spec.prefabId}: opening at (${at.x}, ${at.z}) level ${level} is on no wall`)
  }

  /** A door in a wall; its leaf swings towards `into`. */
  door(level: number, at0: XZ, into: XZ, opts: { width?: number; name?: string; open?: boolean; base?: string } = {}): this {
    const alongX = this.onWallAxis(level, at0)
    // Centred on the 0.5 m grid along its wall: the door corridor then holds two navigation cells,
    // one of them clear of the open leaf.
    const at = alongX ? { x: Math.round(at0.x * 2) / 2, z: at0.z } : { x: at0.x, z: Math.round(at0.z * 2) / 2 }
    // At least 1 m: the navigation grid needs a free cell beside the open leaf.
    const width = Math.max(1, opts.width ?? 1)
    // Hinge on the side nearer the end of its wall, so the open leaf folds against the wall beside
    // it instead of standing in the way (q = 0/1: hinge at −X/+Z; q = 2/3: at +X/−Z).
    const ends = this.wallEnds(level, at, alongX)
    const towardsMin = ends ? (alongX ? at.x - ends[0] : at.z - ends[0]) < (alongX ? ends[1] - at.x : ends[1] - at.z) : true
    const quarterTurns: QuarterTurns = alongX ? (towardsMin ? 0 : 2) : towardsMin ? 3 : 1
    const localZ = [[0, 1], [1, 0], [0, -1], [-1, 0]][quarterTurns]
    const openTowards = (into.x - at.x) * localZ[0] + (into.z - at.z) * localZ[1] >= 0 ? 1 : -1
    this.objects.push({
      kind: 'door',
      ...this.lv(level),
      localId: this.id(opts.base ?? 'door'),
      name: opts.name ?? 'Cửa',
      position: { x: q(at.x), z: q(at.z) },
      quarterTurns,
      width,
      openTowards,
      ...(opts.open ? { initialState: 'open' } : {}),
    })
    this.doors.push({ level, at, width, alongX })
    return this
  }

  /** A window in a wall; `inside` is a point on the room side. */
  window(level: number, at: XZ, inside: XZ, width = 1.2, opts: { sill?: number; head?: number } = {}): this {
    const alongX = this.onWallAxis(level, at)
    const quarterTurns: QuarterTurns = alongX ? (inside.z >= at.z ? 0 : 2) : inside.x >= at.x ? 1 : 3
    this.objects.push({ kind: 'window', ...this.lv(level), localId: this.id('win'), name: level ? 'Cửa sổ tầng trên' : 'Cửa sổ', position: { x: q(at.x), z: q(at.z) }, quarterTurns, width, sill: opts.sill ?? 0.9, head: opts.head ?? 2.1, thickness: this.t })
    return this
  }

  /** Windows evenly spaced along one outer side of a rectangle footprint at a storey. */
  windows(level: number, side: Side, count: number, width = 1.2, skip: number[] = []): this {
    const f = this.spec.footprint
    const c = { x: (f.minX + f.maxX) / 2, z: (f.minZ + f.maxZ) / 2 }
    for (let i = 0; i < count; i++) {
      if (skip.includes(i)) continue
      const u = (i + 0.5) / count
      const at = side === 'N' || side === 'S' ? { x: q(f.minX + u * (f.maxX - f.minX)), z: side === 'N' ? f.minZ : f.maxZ } : { x: side === 'W' ? f.minX : f.maxX, z: q(f.minZ + u * (f.maxZ - f.minZ)) }
      this.window(level, at, c, width)
    }
    return this
  }

  /**
   * A room (rectangle on the wall centre lines) with a lamp whose switch sits inside, beside the
   * first door on the room's edge (else in a corner).
   */
  room(level: number, name: string, r: Rect, opts: { lamp?: boolean; floor?: string; floorColor?: string; switchAt?: XZ } = {}): this {
    const room: RoomObject = { ...(level ? { level } : {}), localId: this.id('room'), name, bounds: { ...r } }
    if (opts.floor || opts.floorColor) room.visual = { ...(opts.floor ? { floor: opts.floor } : {}), ...(opts.floorColor ? { floorColor: opts.floorColor } : {}) }
    if (opts.lamp !== false) {
      // The switch is placed in `finish` (once the furniture is known), unless given.
      room.lamp = { localId: this.id('lamp'), name: `Đèn ${name.toLowerCase()}`, intensity: 0.8, color: '#ffd9a0', requiresElectricity: true, switchAt: opts.switchAt ?? { x: NaN, z: NaN } }
    }
    this.rooms.push(room)
    return this
  }

  /** Switch spots of a room: beside each door on its edge (both sides), then its corners. */
  private switchSpots(level: number, r: Rect): XZ[] {
    const inset = this.t / 2 + 0.2
    const out: XZ[] = []
    const inside = (p: XZ) => p.x > r.minX + inset - 1e-6 && p.x < r.maxX - inset + 1e-6 && p.z > r.minZ + inset - 1e-6 && p.z < r.maxZ - inset + 1e-6
    for (const d of this.doors) {
      if (d.level !== level) continue
      const onEdge = d.alongX ? (Math.abs(d.at.z - r.minZ) < 1e-6 || Math.abs(d.at.z - r.maxZ) < 1e-6) && d.at.x > r.minX && d.at.x < r.maxX : (Math.abs(d.at.x - r.minX) < 1e-6 || Math.abs(d.at.x - r.maxX) < 1e-6) && d.at.z > r.minZ && d.at.z < r.maxZ
      if (!onEdge) continue
      const off = d.width / 2 + 0.35
      for (const sgn of [1, -1]) {
        const p = d.alongX ? { x: d.at.x + sgn * off, z: Math.abs(d.at.z - r.minZ) < 1e-6 ? r.minZ + inset : r.maxZ - inset } : { x: Math.abs(d.at.x - r.minX) < 1e-6 ? r.minX + inset : r.maxX - inset, z: d.at.z + sgn * off }
        if (inside(p)) out.push({ x: q(p.x), z: q(p.z) })
      }
    }
    // Then every 0.5 m along each wall of the room.
    for (let x = r.minX + inset + 0.2; x <= r.maxX - inset - 0.2 + 1e-6; x += 0.5) out.push({ x: q(x), z: q(r.minZ + inset) }, { x: q(x), z: q(r.maxZ - inset) })
    for (let z = r.minZ + inset + 0.2; z <= r.maxZ - inset - 0.2 + 1e-6; z += 0.5) out.push({ x: q(r.minX + inset), z: q(z) }, { x: q(r.maxX - inset), z: q(z) })
    return out
  }

  // ---- Access (a fast stand-in for the deep check, with useful messages) ----

  /** Solid rectangles per storey: wall runs, boxes, flights (their storey and the one above: rails, hole). */
  private solids(level: number): { id: string; r: Rect; wall?: Obj }[] {
    const out: { id: string; r: Rect; wall?: Obj }[] = []
    const t = this.t
    for (const o of this.objects) {
      const l = (o.level as number | undefined) ?? 0
      if (o.kind === 'wallRun' && l === level) {
        const f = o.from as XZ
        const e = o.to as XZ
        out.push({ id: o.localId as string, r: rect(Math.min(f.x, e.x) - t / 2, Math.min(f.z, e.z) - t / 2, Math.max(f.x, e.x) + t / 2, Math.max(f.z, e.z) + t / 2), wall: o })
      } else if ((o.kind === 'prop' || o.kind === 'container' || o.kind === 'wall') && l === level) {
        const p = o.position as XZ
        const sz = o.size as number[]
        out.push({ id: o.localId as string, r: rect(p.x - sz[0] / 2, p.z - sz[2] / 2, p.x + sz[0] / 2, p.z + sz[2] / 2) })
      } else if (o.kind === 'stairs' && (l === level || l + 1 === level)) {
        const p = o.position as XZ
        const odd = ((o.quarterTurns as number) & 1) === 1
        const hx = ((odd ? o.width : o.length) as number) / 2 + t
        const hz = ((odd ? o.length : o.width) as number) / 2 + t
        out.push({ id: o.localId as string, r: rect(p.x - hx, p.z - hz, p.x + hx, p.z + hz) })
      }
    }
    return out
  }

  /** Door openings of a storey as gaps (a zone crossing a wall through a door is not blocked by it). */
  private gaps(level: number): Rect[] {
    const t = this.t
    return this.doors.filter((d) => d.level === level).map((d) => (d.alongX ? rect(d.at.x - d.width / 2, d.at.z - t, d.at.x + d.width / 2, d.at.z + t) : rect(d.at.x - t, d.at.z - d.width / 2, d.at.x + t, d.at.z + d.width / 2)))
  }

  private blocked(level: number, zone: Rect, except: string[] = []): string | null {
    const hit = (a: Rect, b: Rect) => a.minX < b.maxX - 1e-6 && b.minX < a.maxX - 1e-6 && a.minZ < b.maxZ - 1e-6 && b.minZ < a.maxZ - 1e-6
    const f = this.spec.footprint
    if (zone.minX < f.minX || zone.maxX > f.maxX || zone.minZ < f.minZ || zone.maxZ > f.maxZ) return 'outside'
    for (const s of this.solids(level)) {
      if (except.includes(s.id) || !hit(zone, s.r)) continue
      // Through a door gap in that wall: allowed.
      if (s.wall && this.gaps(level).some((g) => hit(zone, g) && zone.minX >= g.minX - 1e-6 && zone.maxX <= g.maxX + 1e-6)) continue
      if (s.wall && this.gaps(level).some((g) => hit(zone, g) && zone.minZ >= g.minZ - 1e-6 && zone.maxZ <= g.maxZ + 1e-6)) continue
      return s.id
    }
    return null
  }

  /**
   * Before writing the prefab: every door free on both sides (and where its leaf swings), every
   * container with one free side, windows moved along their wall off furniture (dropped if nowhere
   * fits), and each lamp switch on the first free spot. Throws with the offending IDs otherwise.
   */
  private finish(): void {
    const t = this.t
    const problems: string[] = []
    for (const o of this.objects.filter((x) => x.kind === 'door')) {
      const l = (o.level as number | undefined) ?? 0
      const p = o.position as XZ
      const w = o.width as number
      const alongX = o.quarterTurns === 0 || o.quarterTurns === 2
      // The side the leaf swings to needs room for it; the other side a step in front of the door.
      const lz = [[0, 1], [1, 0], [0, -1], [-1, 0]][o.quarterTurns as number]
      const swing = (alongX ? lz[1] : lz[0]) * (o.openTowards as number)
      for (const sgn of [1, -1]) {
        const depth = sgn === swing ? Math.max(0.9, w) : 0.9
        const zone = alongX ? rect(p.x - w / 2, sgn > 0 ? p.z + t / 2 : p.z - t / 2 - depth, p.x + w / 2, sgn > 0 ? p.z + t / 2 + depth : p.z - t / 2) : rect(sgn > 0 ? p.x + t / 2 : p.x - t / 2 - depth, p.z - w / 2, sgn > 0 ? p.x + t / 2 + depth : p.x - t / 2, p.z + w / 2)
        const why = this.blocked(l, zone)
        if (why && why !== 'outside') problems.push(`door ${String(o.localId)} (level ${l}) blocked by ${why}`)
      }
    }
    for (const o of this.objects.filter((x) => x.kind === 'container')) {
      const l = (o.level as number | undefined) ?? 0
      const p = o.position as XZ
      const sz = o.size as number[]
      const b = rect(p.x - sz[0] / 2, p.z - sz[2] / 2, p.x + sz[0] / 2, p.z + sz[2] / 2)
      const d = 0.7
      const sides = [rect(b.minX, b.minZ - d, b.maxX, b.minZ), rect(b.minX, b.maxZ, b.maxX, b.maxZ + d), rect(b.minX - d, b.minZ, b.minX, b.maxZ), rect(b.maxX, b.minZ, b.maxX + d, b.maxZ)]
      if (!sides.some((z) => !this.blocked(l, z, [o.localId as string]))) problems.push(`container ${String(o.localId)} (level ${l}) has no free side`)
    }
    for (const o of this.objects.filter((x) => x.kind === 'window')) {
      const l = (o.level as number | undefined) ?? 0
      const p0 = o.position as XZ
      const w = o.width as number
      const qt = o.quarterTurns as number
      const alongX = (qt & 1) === 0
      const inward = [[0, 1], [1, 0], [0, -1], [-1, 0]][qt]
      const zoneAt = (p: XZ) => {
        const a = { x: p.x + inward[0] * (t / 2), z: p.z + inward[1] * (t / 2) }
        const bb = { x: a.x + inward[0] * 0.8, z: a.z + inward[1] * 0.8 }
        return alongX ? rect(p.x - w / 2 - 0.1, Math.min(a.z, bb.z), p.x + w / 2 + 0.1, Math.max(a.z, bb.z)) : rect(Math.min(a.x, bb.x), p.z - w / 2 - 0.1, Math.max(a.x, bb.x), p.z + w / 2 + 0.1)
      }
      const openings = this.objects.filter((x) => x !== o && (x.kind === 'door' || x.kind === 'window') && ((x.level as number | undefined) ?? 0) === l)
      const clearOfOpenings = (p: XZ) => openings.every((x) => {
        const xp = x.position as XZ
        const xw = x.width as number
        return alongX ? Math.abs(xp.z - p.z) > 0.01 || Math.abs(xp.x - p.x) >= (xw + w) / 2 + 0.3 : Math.abs(xp.x - p.x) > 0.01 || Math.abs(xp.z - p.z) >= (xw + w) / 2 + 0.3
      })
      let moved: XZ | null = null
      for (const off of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 2.5, -2.5, 3, -3]) {
        const p = alongX ? { x: q(p0.x + off), z: p0.z } : { x: p0.x, z: q(p0.z + off) }
        if (!this.onWallRun(l, p, w, alongX) || !clearOfOpenings(p)) continue
        if (!this.blocked(l, zoneAt(p))) {
          moved = p
          break
        }
      }
      if (moved) o.position = moved
      else o.dropped = true
    }
    for (let k = this.objects.length - 1; k >= 0; k--) if (this.objects[k].dropped) this.objects.splice(k, 1)
    // Lamp switches start beside a door; `settle` moves an unreachable one to the next spot.
    for (const room of this.rooms) {
      if (!room.lamp || Number.isFinite(room.lamp.switchAt.x)) continue
      room.lamp.switchAt = this.switchSpots(room.level ?? 0, room.bounds)[0]
    }
    if (problems.length) throw new Error(`${this.spec.prefabId}:\n  ${problems.join('\n  ')}`)
  }

  /** A window of width `w` centred at `p` lies on one wall run of that storey (not past its ends). */
  private onWallRun(level: number, p: XZ, w: number, alongX: boolean): boolean {
    return this.objects.some((o) => {
      if (o.kind !== 'wallRun' || ((o.level as number | undefined) ?? 0) !== level) return false
      const f = o.from as XZ
      const e = o.to as XZ
      if (alongX) return f.z === e.z && Math.abs(f.z - p.z) < 1e-6 && p.x - w / 2 >= Math.min(f.x, e.x) + 0.3 && p.x + w / 2 <= Math.max(f.x, e.x) - 0.3
      return f.x === e.x && Math.abs(f.x - p.x) < 1e-6 && p.z - w / 2 >= Math.min(f.z, e.z) + 0.3 && p.z + w / 2 <= Math.max(f.z, e.z) - 0.3
    })
  }

  /** A box object at a point (size [X, Y, Z] as given: turn it yourself for a Z-long box). */
  put(level: number, b: Box, at: XZ, opts: { turn?: boolean; y?: number; base?: string; facing?: QuarterTurns } = {}): this {
    const size: [number, number, number] = opts.turn ? [b.size[2], b.size[1], b.size[0]] : [...b.size]
    const base = opts.base ?? (b.name ? slug(b.asset ?? b.kind) : slug(b.asset ?? b.kind))
    this.objects.push({
      kind: b.kind,
      ...this.lv(level),
      localId: this.id(base),
      ...(b.kind === 'container' ? { name: b.name ?? 'Tủ' } : {}),
      position: { x: q(at.x), y: q((opts.y ?? 0) + size[1] / 2), z: q(at.z) },
      size,
      color: b.color,
      ...(b.loot ? { lootTableId: b.loot } : {}),
      ...(b.asset && b.kind !== 'wall' ? { visual: { assetId: b.asset, ...(opts.facing !== undefined ? { facing: opts.facing } : {}) } } : {}),
    })
    return this
  }

  /**
   * A box against one wall of a room (its back on the wall's inner face), `at` metres along that
   * wall from the room's min corner to the box centre; X/Z turned for east and west walls.
   */
  against(level: number, r: Rect, side: Side, at: number, b: Box, gap = 0.03): this {
    const turn = side === 'E' || side === 'W'
    // The box's depth is its Z size (turned for east and west walls, it becomes the X size).
    const depth = b.size[2]
    const off = this.t / 2 + depth / 2 + gap
    const p =
      side === 'N' ? { x: r.minX + at, z: r.minZ + off } : side === 'S' ? { x: r.minX + at, z: r.maxZ - off } : side === 'W' ? { x: r.minX + off, z: r.minZ + at } : { x: r.maxX - off, z: r.minZ + at }
    return this.put(level, b, p, { turn })
  }

  /** A straight flight from storey `level`, its foot at `foot`, climbing towards `dir`. */
  stairs(level: number, foot: XZ, dir: Side, length = 4, width = 1.2): this {
    const v = { E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1] }[dir]
    const quarterTurns = { E: 0, N: 1, W: 2, S: 3 }[dir]
    this.objects.push({ kind: 'stairs', ...this.lv(level), localId: this.id('stairs'), position: { x: q(foot.x + (v[0] * length) / 2), z: q(foot.z + (v[1] * length) / 2) }, quarterTurns, width, length })
    return this
  }

  decor(level: number, assetId: string, at: XZ, y = 0, yaw?: number): this {
    this.objects.push({ kind: 'decor', ...this.lv(level), localId: this.id(slug(assetId)), assetId, position: { x: q(at.x), y: q(y), z: q(at.z) }, ...(yaw ? { yaw } : {}) })
    return this
  }

  surface(material: SurfaceMaterial, at: XZ, size: [number, number], opts: { shape?: 'rect' | 'ellipse'; layer?: number; color?: string } = {}): this {
    const t = surfaceTemplate(material, opts.shape ?? 'rect', size, opts.layer ?? 0)
    const { kind, ...rest } = t
    this.objects.push({ kind, localId: this.id(material === 'water' ? 'pool' : 'ground'), ...rest, ...(opts.color ? { color: opts.color } : {}), position: { x: q(at.x), z: q(at.z) } })
    return this
  }

  doc(): PrefabDocument {
    try {
      this.finish()
      this.settle()
    } catch (e) {
      if (!RAW) throw e
    }
    return this.raw()
  }

  /**
   * The deep check's rules (`access.ts`): a window nobody can reach moves along its wall (dropped
   * if nowhere works), a lamp switch nobody can reach takes the next spot; anything else unreachable
   * or an unusable flight fails the build with its IDs.
   */
  private settle(): void {
    for (let round = 0; round < 600; round++) {
      const problems = checkAccess(this.raw())
      const win = problems.find((x) => x.kind === 'window')
      const lamp = problems.find((x) => x.kind === 'lamp')
      if (!win && !lamp) {
        if (problems.length) throw new Error(`${this.spec.prefabId}:\n  ${problems.map((x) => x.message).join('\n  ')}`)
        return
      }
      if (win) this.moveWindow(win.id.split('/').pop()!)
      if (lamp) this.moveSwitch(lamp.id.split('/').pop()!)
    }
    throw new Error(`${this.spec.prefabId}: windows and switches do not settle`)
  }

  private moveWindow(localId: string): void {
    const i = this.objects.findIndex((o) => o.localId === localId)
    const o = this.objects[i]
    const tried = ((o.tried as number[] | undefined) ?? [0])
    const l = (o.level as number | undefined) ?? 0
    const base = (o.base as XZ | undefined) ?? (o.position as XZ)
    o.base = base
    const w = o.width as number
    const alongX = ((o.quarterTurns as number) & 1) === 0
    for (const off of [0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 2.5, -2.5, 3, -3, 3.5, -3.5, 4, -4]) {
      if (tried.includes(off)) continue
      tried.push(off)
      const p = alongX ? { x: q(base.x + off), z: base.z } : { x: base.x, z: q(base.z + off) }
      if (!this.onWallRun(l, p, w, alongX)) continue
      const clash = this.objects.some((x) => x !== o && (x.kind === 'door' || x.kind === 'window') && ((x.level as number | undefined) ?? 0) === l && (alongX ? Math.abs((x.position as XZ).z - p.z) < 0.01 && Math.abs((x.position as XZ).x - p.x) < ((x.width as number) + w) / 2 + 0.3 : Math.abs((x.position as XZ).x - p.x) < 0.01 && Math.abs((x.position as XZ).z - p.z) < ((x.width as number) + w) / 2 + 0.3))
      if (clash) continue
      o.position = p
      o.tried = tried
      return
    }
    this.objects.splice(i, 1)
  }

  private moveSwitch(lampId: string): void {
    const room = this.rooms.find((r) => r.lamp?.localId === lampId)!
    const spots = this.switchSpots(room.level ?? 0, room.bounds)
    const lamp = room.lamp as unknown as { switchAt: XZ; tried?: number }
    const next = (lamp.tried ?? spots.findIndex((p) => p.x === lamp.switchAt.x && p.z === lamp.switchAt.z)) + 1
    if (next >= spots.length) throw new Error(`${this.spec.prefabId}: no reachable spot for the switch of ${room.name}`)
    lamp.tried = next
    lamp.switchAt = spots[next]
  }

  private raw(): PrefabDocument {
    const s = this.spec
    const clean = (o: Obj) => {
      const { tried: _t, base: _b, ...rest } = o
      return rest
    }
    const rooms = this.rooms.map((r) => (r.lamp ? { ...r, lamp: (({ tried: _t, ...l }) => l)(r.lamp as unknown as { tried?: number } & NonNullable<RoomObject['lamp']>) } : r))
    return {
      schemaVersion: MAP_SCHEMA_VERSION,
      prefabId: s.prefabId,
      contentVersion: 1,
      name: s.name,
      pivot: { x: 0, y: 0, z: 0 },
      footprint: { ...s.footprint },
      ...(s.outline ? { outline: s.outline.map((p) => ({ x: q(p.x), z: q(p.z) })) } : {}),
      building: { ...this.b },
      objects: this.objects.map(clean) as unknown as PrefabObject[],
      rooms,
      ...(s.variants?.length ? { visual: { variants: s.variants } } : {}),
      ...(s.placement ? { placement: s.placement } : {}),
      catalog: s.catalog,
    }
  }
}

function slug(s: string): string {
  return s.split('/').pop()!.replace(/[^a-z0-9]+/g, '-')
}

/** Every house variant (G3b): lived-in, abandoned, intact. */
export const VARIANTS = ['intact', 'lived-in', 'abandoned']

// ---- Compounds ----

type CompoundMember = CompoundDocument['instances'][number] | CompoundDocument['objects'][number]

/** A compound under construction: members around the pivot (0, 0), unturned. */
export class Compound {
  readonly instances: CompoundDocument['instances'] = []
  readonly objects: CompoundDocument['objects'] = []
  private readonly used = new Map<string, number>()
  readonly compoundId: string
  readonly name: string
  readonly catalog: LibraryInfo
  readonly placement?: PrefabPlacement
  constructor(compoundId: string, name: string, catalog: LibraryInfo, placement?: PrefabPlacement) {
    this.compoundId = compoundId
    this.name = name
    this.catalog = catalog
    this.placement = placement
  }

  private member(base: string): string {
    const n = (this.used.get(base) ?? 0) + 1
    this.used.set(base, n)
    return n === 1 ? base : `${base}-${n}`
  }

  building(prefabId: string, at: XZ, quarterTurns: QuarterTurns = 0, base = prefabId.split('/').pop()!): this {
    this.instances.push({ member: this.member(base), prefabId, position: { x: q(at.x), y: 0, z: q(at.z) }, quarterTurns })
    return this
  }

  box(b: Box, at: XZ, opts: { turn?: boolean; base?: string; facing?: QuarterTurns } = {}): this {
    const size: [number, number, number] = opts.turn ? [b.size[2], b.size[1], b.size[0]] : [...b.size]
    this.objects.push({
      kind: b.kind,
      member: this.member(opts.base ?? slug(b.asset ?? b.kind)),
      ...(b.kind === 'container' ? { name: b.name ?? 'Thùng' } : {}),
      position: { x: q(at.x), y: q(size[1] / 2), z: q(at.z) },
      size,
      color: b.color,
      ...(b.loot ? { lootTableId: b.loot } : {}),
      ...(b.asset && b.kind !== 'wall' ? { visual: { assetId: b.asset, ...(opts.facing !== undefined ? { facing: opts.facing } : {}) } } : {}),
    } as CompoundMember as CompoundDocument['objects'][number])
    return this
  }

  /** A straight wall or fence from `a` to `b` (along X or Z), `thick` thick, `h` high. */
  line(a: XZ, b: XZ, thick: number, h: number, color: string, kind: 'wall' | 'prop' = 'wall', base = kind === 'wall' ? 'wall' : 'fence', asset?: string): this {
    const alongX = a.z === b.z
    const len = Math.abs(alongX ? b.x - a.x : b.z - a.z)
    const size: [number, number, number] = alongX ? [q(len), h, thick] : [thick, h, q(len)]
    return this.box({ kind, size, color, ...(asset ? { asset } : {}) }, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, { base })
  }

  /**
   * A fence or wall around a rectangle with gaps: `gaps` = [side, centre along that side from its min
   * corner, width]. Each side is split into straight pieces around its gaps.
   */
  enclose(r: Rect, thick: number, h: number, color: string, kind: 'wall' | 'prop', gaps: [Side, number, number][], asset?: string): this {
    const sides: [Side, XZ, XZ][] = [
      ['N', { x: r.minX, z: r.minZ }, { x: r.maxX, z: r.minZ }],
      ['S', { x: r.minX, z: r.maxZ }, { x: r.maxX, z: r.maxZ }],
      ['W', { x: r.minX, z: r.minZ + thick / 2 }, { x: r.minX, z: r.maxZ - thick / 2 }],
      ['E', { x: r.maxX, z: r.minZ + thick / 2 }, { x: r.maxX, z: r.maxZ - thick / 2 }],
    ]
    for (const [side, a, b] of sides) {
      const alongX = side === 'N' || side === 'S'
      const lo = alongX ? a.x : a.z
      const hi = alongX ? b.x : b.z
      const cuts = gaps.filter((g) => g[0] === side).map((g) => [(alongX ? r.minX : r.minZ) + g[1] - g[2] / 2, (alongX ? r.minX : r.minZ) + g[1] + g[2] / 2]).sort((x, y) => x[0] - y[0])
      let cur = lo
      const piece = (s: number, e: number) => {
        if (e - s < 0.2) return
        this.line(alongX ? { x: s, z: a.z } : { x: a.x, z: s }, alongX ? { x: e, z: a.z } : { x: a.x, z: e }, thick, h, color, kind, kind === 'wall' ? 'wall' : 'fence', asset)
      }
      for (const [s, e] of cuts) {
        piece(cur, s)
        cur = e
      }
      piece(cur, hi)
    }
    return this
  }

  surface(material: SurfaceMaterial, at: XZ, size: [number, number], opts: { shape?: 'rect' | 'ellipse'; layer?: number; color?: string; base?: string; navigation?: 'walkable' | 'blocked' } = {}): this {
    const { kind, ...rest } = surfaceTemplate(material, opts.shape ?? 'rect', size, opts.layer ?? 0)
    this.objects.push({ kind, member: this.member(opts.base ?? (material === 'water' ? 'water' : material)), ...rest, ...(opts.color ? { color: opts.color } : {}), ...(opts.navigation ? { navigation: opts.navigation } : {}), position: { x: q(at.x), z: q(at.z) } } as CompoundDocument['objects'][number])
    return this
  }

  tree(at: XZ, style: 'round' | 'pine' = 'round', height = style === 'pine' ? 8 : 6, canopy = style === 'pine' ? 1.8 : 2.5): this {
    this.objects.push({ kind: 'tree', member: this.member(style === 'pine' ? 'pine' : 'tree'), position: { x: q(at.x), z: q(at.z) }, height, canopy, trunk: style === 'pine' ? 0.2 : 0.25, color: style === 'pine' ? '#2f5a3a' : '#3f6b35', style })
    return this
  }

  decor(assetId: string, at: XZ, yaw?: number): this {
    this.objects.push({ kind: 'decor', member: this.member(slug(assetId)), assetId, position: { x: q(at.x), y: 0, z: q(at.z) }, ...(yaw ? { yaw } : {}) })
    return this
  }
}

/** Build every prefab, collecting every builder problem before failing (one run lists them all). */
export function buildAll<T>(builders: (() => T)[]): T[] {
  const out: T[] = []
  const errors: string[] = []
  for (const b of builders) {
    try {
      out.push(b())
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  if (errors.length) throw new Error(errors.join('\n'))
  return out
}

/**
 * A compound document from a `Compound`: its footprint is the union of its buildings' footprints
 * (turned) and its objects' areas around the pivot.
 */
export function compoundDoc(c: Compound, prefabs: ReadonlyMap<string, PrefabDocument>): CompoundDocument {
  let fp: Rect | null = null
  const add = (r: Rect) => {
    fp = fp ? { minX: Math.min(fp.minX, r.minX), minZ: Math.min(fp.minZ, r.minZ), maxX: Math.max(fp.maxX, r.maxX), maxZ: Math.max(fp.maxZ, r.maxZ) } : r
  }
  for (const i of c.instances) {
    const p = prefabs.get(i.prefabId)
    if (!p) throw new Error(`${c.compoundId}: no prefab ${i.prefabId}`)
    const f = p.footprint
    const corners = [
      [f.minX - p.pivot.x, f.minZ - p.pivot.z],
      [f.maxX - p.pivot.x, f.maxZ - p.pivot.z],
    ].map(([x, z]) => {
      const t = i.quarterTurns & 3
      return t === 0 ? [x, z] : t === 1 ? [z, -x] : t === 2 ? [-x, -z] : [-z, x]
    })
    add(rect(i.position.x + Math.min(corners[0][0], corners[1][0]), i.position.z + Math.min(corners[0][1], corners[1][1]), i.position.x + Math.max(corners[0][0], corners[1][0]), i.position.z + Math.max(corners[0][1], corners[1][1])))
  }
  for (const o of c.objects) {
    const p = o.position as XZ
    const s = (o as { size?: number[] }).size
    if (o.kind === 'tree') add(rect(p.x - o.canopy, p.z - o.canopy, p.x + o.canopy, p.z + o.canopy))
    else if (s) add(rect(p.x - s[0] / 2, p.z - s[s.length - 1] / 2, p.x + s[0] / 2, p.z + s[s.length - 1] / 2))
    else add(rect(p.x - 0.5, p.z - 0.5, p.x + 0.5, p.z + 0.5))
  }
  return { schemaVersion: MAP_SCHEMA_VERSION, compoundId: c.compoundId, contentVersion: 1, name: c.name, footprint: fp!, catalog: c.catalog, ...(c.placement ? { placement: c.placement } : {}), instances: c.instances, objects: c.objects }
}
