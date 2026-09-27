import type { Rect, XZ } from '../schema.ts'
import { byString, hashText } from './geometry.ts'
import { mergeRects, qRect, rectsOverlap, sortRects, subtractAll } from './rects.ts'
import type { AccessRoad, LayoutRoad, NormalizedNetwork, RoadClass, RoadNetwork, StreetSurface, SurfaceKind } from './schema.ts'

/**
 * RoadNetworkGenerator, geometry part (world generator WG2): the snapped network becomes street
 * surfaces the game already draws — axis-aligned `RoadRecord` rectangles whose colour picks
 * asphalt, dirt or concrete, with the G4 centre line and kerbs worked out by the game.
 *
 * - Carriageway: one rectangle per straight run, merged through junctions (few records, like the
 *   town generator). Ends reaching a junction or bend are extended by half the crossing road's width,
 *   so the junction square is covered; runs overlap only there, same surface and layer (world-space
 *   UVs: the overlap draws identically). Dirt tracks sit one layer below asphalt.
 * - Sidewalks: strips along the sides the source tags give (left/right follow the way's direction),
 *   extended across junction corners, then cut by every carriageway, so a pavement never lies on a
 *   road and corners close. Strips along X are placed first; strips along Z are cut by them too, so
 *   pavements never overlap.
 * - Access lanes (planned into deep blocks) are carriageway without sidewalks.
 * Connectivity is kept by construction: every edge's centre line lies in its carriageway, and pieces
 * meet at every node (checked by `plan.ts`).
 */

export interface StreetOptions {
  /** Sidewalk width for streets that have one, or null for the preset per class. */
  sidewalk: number | null
  /** Preset sidewalk widths per road class. */
  sidewalkByClass: Record<RoadClass, number>
}

export interface Segment {
  edge: string
  a: XZ
  b: XZ
  axis: 'H' | 'V'
  width: number
  kind: 'asphalt' | 'dirt'
  roadClass: RoadClass
  /** Sidewalk width to the left / right of the direction a → b (0: none). */
  left: number
  right: number
}

/** Axis-aligned segments of the snapped network (and access lanes), with the street attributes of their road. */
export function networkSegments(net: NormalizedNetwork, network: RoadNetwork, roads: readonly LayoutRoad[], access: readonly AccessRoad[], opts: StreetOptions): Segment[] {
  const roadOf = new Map(roads.map((r) => [r.id, r]))
  const edgeRoad = new Map(network.edges.map((e) => [e.id, roadOf.get(e.roadId)!]))
  const out: Segment[] = []
  for (const e of net.edges) {
    const r = edgeRoad.get(e.id)!
    const sw = r.sidewalk === 'none' ? 0 : (opts.sidewalk ?? opts.sidewalkByClass[r.class])
    const left = r.sidewalk === 'both' || r.sidewalk === 'left' ? sw : 0
    const right = r.sidewalk === 'both' || r.sidewalk === 'right' ? sw : 0
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1]
      const b = e.points[i]
      if (a.x === b.x && a.z === b.z) continue
      out.push({ edge: e.id, a, b, axis: a.z === b.z ? 'H' : 'V', width: r.width, kind: r.surface === 'unpaved' ? 'dirt' : 'asphalt', roadClass: r.class, left, right })
    }
  }
  for (const l of access) {
    const [a, b] = l.points
    out.push({ edge: l.id, a, b, axis: a.z === b.z ? 'H' : 'V', width: l.width, kind: 'asphalt', roadClass: 'service', left: 0, right: 0 })
  }
  return out
}

const keyOf = (p: XZ) => `${p.x}|${p.z}`

/** Carriageway and sidewalk rectangles of the segments, clipped to `area`. */
export function streetSurfaces(segments: readonly Segment[], area: Rect): StreetSurface[] {
  // Perpendicular reach at every segment end: half width and sidewalk of crossing segments ending there.
  const ends = new Map<string, Segment[]>()
  for (const s of segments) for (const p of [s.a, s.b]) ends.set(keyOf(p), [...(ends.get(keyOf(p)) ?? []), s])
  const reach = (s: Segment, p: XZ) => {
    let road = 0
    let walk = 0
    for (const o of ends.get(keyOf(p)) ?? []) {
      if (o.axis === s.axis) continue
      road = Math.max(road, o.width / 2)
      walk = Math.max(walk, o.left, o.right)
    }
    return { road, walk }
  }

  const carriage: { rect: Rect; kind: 'asphalt' | 'dirt'; edge: string }[] = []
  const strips: { rect: Rect; axis: 'H' | 'V'; edge: string }[] = []
  for (const s of segments) {
    const lo = s.axis === 'H' ? (s.a.x < s.b.x ? s.a : s.b) : s.a.z < s.b.z ? s.a : s.b
    const hi = lo === s.a ? s.b : s.a
    const rl = reach(s, lo)
    const rh = reach(s, hi)
    const w = s.width / 2
    // Direction a → b and its right normal (facing +X, the right is +Z).
    const dx = Math.sign(s.b.x - s.a.x)
    const dz = Math.sign(s.b.z - s.a.z)
    const right = { x: -dz, z: dx }
    if (s.axis === 'H') {
      const z = s.a.z
      carriage.push({ rect: { minX: lo.x - rl.road, maxX: hi.x + rh.road, minZ: z - w, maxZ: z + w }, kind: s.kind, edge: s.edge })
      const x0 = lo.x - rl.road - rl.walk
      const x1 = hi.x + rh.road + rh.walk
      for (const [width, sign] of [[s.right, right.z], [s.left, -right.z]] as const) {
        if (width <= 0) continue
        strips.push({ rect: sign > 0 ? { minX: x0, maxX: x1, minZ: z + w, maxZ: z + w + width } : { minX: x0, maxX: x1, minZ: z - w - width, maxZ: z - w }, axis: 'H', edge: s.edge })
      }
    } else {
      const x = s.a.x
      carriage.push({ rect: { minX: x - w, maxX: x + w, minZ: lo.z - rl.road, maxZ: hi.z + rh.road }, kind: s.kind, edge: s.edge })
      const z0 = lo.z - rl.road - rl.walk
      const z1 = hi.z + rh.road + rh.walk
      for (const [width, sign] of [[s.right, right.x], [s.left, -right.x]] as const) {
        if (width <= 0) continue
        strips.push({ rect: sign > 0 ? { minX: x + w, maxX: x + w + width, minZ: z0, maxZ: z1 } : { minX: x - w - width, maxX: x - w, minZ: z0, maxZ: z1 }, axis: 'V', edge: s.edge })
      }
    }
  }

  const clip = (r: Rect): Rect | null => {
    const c = { minX: Math.max(r.minX, area.minX), minZ: Math.max(r.minZ, area.minZ), maxX: Math.min(r.maxX, area.maxX), maxZ: Math.min(r.maxZ, area.maxZ) }
    return c.maxX - c.minX > 1e-6 && c.maxZ - c.minZ > 1e-6 ? qRect(c) : null
  }
  const out: { kind: SurfaceKind; rect: Rect }[] = []
  for (const kind of ['asphalt', 'dirt'] as const) {
    const rects = carriage.filter((c) => c.kind === kind).map((c) => clip(c.rect)).filter((r): r is Rect => r !== null)
    for (const r of mergeRects(rects)) out.push({ kind, rect: r })
  }
  const road = out.map((o) => o.rect)
  const walks: Rect[] = []
  for (const axis of ['H', 'V'] as const) {
    for (const st of strips.filter((x) => x.axis === axis)) {
      const r = clip(st.rect)
      if (!r) continue
      const cut = [...road.filter((q) => rectsOverlap(q, r)), ...walks.filter((q) => rectsOverlap(q, r))]
      for (const piece of subtractAll(r, cut)) if (piece.maxX - piece.minX > 0.05 && piece.maxZ - piece.minZ > 0.05) walks.push(qRect(piece))
    }
  }
  for (const r of mergeRects(walks)) out.push({ kind: 'sidewalk', rect: r })

  // Stable IDs from the geometry; the edges each piece serves.
  const used = new Set<string>()
  const surfaces: StreetSurface[] = out.map((o) => {
    const base = `${o.kind}-${hashText(`${o.rect.minX},${o.rect.minZ},${o.rect.maxX},${o.rect.maxZ}`).slice(0, 8)}`
    let id = base
    for (let k = 2; used.has(id); k++) id = `${base}-${k}`
    used.add(id)
    // A carriageway piece serves the edges whose own rectangle (clipped) it contains; a pavement, the strips it lies across.
    const within = (a: Rect, b: Rect) => a.minX >= b.minX - 1e-6 && a.maxX <= b.maxX + 1e-6 && a.minZ >= b.minZ - 1e-6 && a.maxZ <= b.maxZ + 1e-6
    const serves = o.kind === 'sidewalk'
      ? strips
          .filter((st) => {
            const c = clip(st.rect)
            // Same band across the strip (merged pieces may span several strips along it).
            const band = st.axis === 'H' ? o.rect.minZ >= st.rect.minZ - 1e-6 && o.rect.maxZ <= st.rect.maxZ + 1e-6 : o.rect.minX >= st.rect.minX - 1e-6 && o.rect.maxX <= st.rect.maxX + 1e-6
            return c !== null && rectsOverlap(c, o.rect) && band
          })
          .map((st) => st.edge)
      : carriage.filter((c) => { const r = clip(c.rect); return c.kind === o.kind && r !== null && within(r, o.rect) }).map((c) => c.edge)
    return { id, kind: o.kind, rect: o.rect, edges: [...new Set(serves)].sort(byString) }
  })
  const order: Record<SurfaceKind, number> = { asphalt: 0, dirt: 1, sidewalk: 2 }
  const rectOrder = new Map(sortRects(surfaces.map((s) => s.rect)).map((r, i) => [r, i]))
  return surfaces.sort((a, b) => order[a.kind] - order[b.kind] || rectOrder.get(a.rect)! - rectOrder.get(b.rect)!)
}
