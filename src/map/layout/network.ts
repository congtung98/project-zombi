import type { XZ } from '../schema.ts'
import { quantize } from '../transform.ts'
import { byString, dist, hashText, segmentIntersection } from './geometry.ts'
import type { LayoutIssue, LayoutRoad, NetworkCrossing, NetworkEdge, NetworkNode, NodeKind, RoadNetwork } from './schema.ts'

/**
 * Road topology in the source frame (world generator WG1). OpenStreetMap roads meet where they
 * share a vertex; GeoJSON keeps that as identical coordinates, which stay identical after projection.
 *
 * - Nodes: road ends and every vertex shared by two roads (or visited twice by one). Edges: roads
 *   split at nodes. A road cut by the clip ends in a `boundary` node.
 * - Near misses: a dead end within `joinTolerance` of another road (hand-drawn data) is joined to
 *   it, with a warning; never across layers. The road records keep their exact geometry: only the
 *   network edge carries the joined end.
 * - Crossings without a shared vertex never become junctions. Bridges, tunnels and different layers
 *   are `grade-separated`; same-level ones are reported as `unjoined` (probably a missing node).
 */

export interface NetworkOptions {
  /** Join a dead end to a road this close (m); 0 disables. Default 1. */
  joinTolerance?: number
}

const keyOf = (p: XZ) => `${p.x}|${p.z}`

export function buildRoadNetwork(allRoads: readonly LayoutRoad[], cutEnds: ReadonlyMap<string, { start: boolean; end: boolean }>, opts: NetworkOptions = {}): { network: RoadNetwork; issues: LayoutIssue[] } {
  const tolerance = opts.joinTolerance ?? 1
  const issues: LayoutIssue[] = []
  const roads = allRoads.filter((r) => r.network).sort((a, b) => byString(a.id, b.id))
  const lines = roads.map((r) => r.points.map((p) => ({ ...p })))

  // 1. Near-miss joins (dead ends only).
  if (tolerance > 0) {
    const vertexKeys = () => {
      const m = new Map<string, number>()
      for (const l of lines) for (const p of l) m.set(keyOf(p), (m.get(keyOf(p)) ?? 0) + 1)
      return m
    }
    let shared = vertexKeys()
    roads.forEach((road, ri) => {
      for (const end of ['start', 'end'] as const) {
        const cut = cutEnds.get(road.id)
        if (cut && cut[end]) continue
        const line = lines[ri]
        const idx = end === 'start' ? 0 : line.length - 1
        const p = line[idx]
        // A loop has no dead end; a vertex shared with another road is already a junction.
        if (keyOf(line[0]) === keyOf(line[line.length - 1])) continue
        if ((shared.get(keyOf(p)) ?? 0) > 1) continue
        let best: { ri: number; seg: number; point: XZ; d: number; vertex: number | null } | null = null
        lines.forEach((other, oi) => {
          if (roads[oi].layer !== road.layer) return
          for (let s = 1; s < other.length; s++) {
            // Skip the road's own segment at this end.
            if (oi === ri && ((idx === 0 && s === 1) || (idx === line.length - 1 && s === other.length - 1))) continue
            const a = other[s - 1]
            const b = other[s]
            const proj = closest(p, a, b)
            const d = dist(p, proj.point)
            if (d > tolerance) continue
            const vertex = proj.t <= 0 ? s - 1 : proj.t >= 1 ? s : dist(proj.point, a) <= 0.05 ? s - 1 : dist(proj.point, b) <= 0.05 ? s : null
            if (!best || d < best.d - 1e-9) best = { ri: oi, seg: s, point: proj.point, d, vertex }
          }
        })
        if (!best) continue
        const b: { ri: number; seg: number; point: XZ; d: number; vertex: number | null } = best
        let target: XZ
        if (b.vertex !== null) target = lines[b.ri][b.vertex]
        else {
          target = { x: quantize(b.point.x), z: quantize(b.point.z) }
          lines[b.ri].splice(b.seg, 0, target)
        }
        line[end === 'start' ? 0 : line.length - 1] = { ...target }
        issues.push({ severity: 'warning', code: 'joined-near-miss', message: `đầu ${end === 'start' ? 'đầu' : 'cuối'} của ${road.id} cách ${roads[b.ri].id} ${b.d.toFixed(2)} m: đã nối thành giao lộ`, ids: [road.id, roads[b.ri].id], at: target })
        shared = vertexKeys()
      }
    })
  }

  // 2. Node vertices.
  const occurrences = new Map<string, number>()
  lines.forEach((line) => {
    const closed = line.length > 2 && keyOf(line[0]) === keyOf(line[line.length - 1])
    line.forEach((p, i) => {
      if (closed && i === line.length - 1) return
      occurrences.set(keyOf(p), (occurrences.get(keyOf(p)) ?? 0) + 1)
    })
  })
  const nodeKeys = new Set<string>()
  lines.forEach((line) => {
    nodeKeys.add(keyOf(line[0]))
    nodeKeys.add(keyOf(line[line.length - 1]))
    for (const p of line) if ((occurrences.get(keyOf(p)) ?? 0) > 1) nodeKeys.add(keyOf(p))
  })
  const nodeIdOfKey = new Map<string, string>()
  const usedIds = new Set<string>()
  for (const key of [...nodeKeys].sort(byString)) {
    let id = `n-${hashText(key).slice(0, 10)}`
    for (let k = 2; usedIds.has(id); k++) id = `n-${hashText(key).slice(0, 10)}-${k}`
    usedIds.add(id)
    nodeIdOfKey.set(key, id)
  }

  // 3. Edges: each road split at its node vertices.
  const edges: NetworkEdge[] = []
  const edgeRoad = new Map<string, LayoutRoad>()
  const boundaryKeys = new Set<string>()
  roads.forEach((road, ri) => {
    const line = lines[ri]
    const cut = cutEnds.get(road.id)
    if (cut?.start) boundaryKeys.add(keyOf(line[0]))
    if (cut?.end) boundaryKeys.add(keyOf(line[line.length - 1]))
    let start = 0
    let k = 1
    for (let i = 1; i < line.length; i++) {
      if (!nodeKeys.has(keyOf(line[i])) && i < line.length - 1) continue
      const points = line.slice(start, i + 1)
      if (points.length >= 2) {
        const e: NetworkEdge = { id: `${road.id}-e${k++}`, roadId: road.id, from: nodeIdOfKey.get(keyOf(points[0]))!, to: nodeIdOfKey.get(keyOf(points[points.length - 1]))!, points }
        edges.push(e)
        edgeRoad.set(e.id, road)
      }
      start = i
    }
  })

  // 4. Node kinds from degree.
  const degree = new Map<string, number>()
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
  }
  const nodes: NetworkNode[] = [...nodeIdOfKey]
    .filter(([, id]) => degree.has(id))
    .map(([key, id]) => {
      const [x, z] = key.split('|').map(Number)
      const d = degree.get(id)!
      const kind: NodeKind = boundaryKeys.has(key) && d === 1 ? 'boundary' : d >= 3 ? 'junction' : d === 2 ? 'joint' : 'end'
      return { id, position: { x, z }, kind }
    })
    .sort((a, b) => byString(a.id, b.id))

  // 5. Crossings without a shared vertex, and duplicated road geometry.
  const crossings = findCrossings(edges, edgeRoad, issues)
  edges.sort((a, b) => byString(a.id, b.id))
  return { network: { nodes, edges, crossings }, issues }
}

function closest(p: XZ, a: XZ, b: XZ): { point: XZ; t: number } {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2))
  return { point: { x: a.x + t * dx, z: a.z + t * dz }, t }
}

interface Seg {
  edge: number
  index: number
  a: XZ
  b: XZ
}

const BUCKET = 16

/** Segments grouped in square buckets, so pair tests stay near-linear on a town-sized network. */
export function bucketPairs<T extends { a: XZ; b: XZ }>(segs: readonly T[], visit: (s: T, t: T) => void, pad = 0): void {
  const buckets = new Map<string, number[]>()
  segs.forEach((s, i) => {
    const x0 = Math.floor((Math.min(s.a.x, s.b.x) - pad) / BUCKET)
    const x1 = Math.floor((Math.max(s.a.x, s.b.x) + pad) / BUCKET)
    const z0 = Math.floor((Math.min(s.a.z, s.b.z) - pad) / BUCKET)
    const z1 = Math.floor((Math.max(s.a.z, s.b.z) + pad) / BUCKET)
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const k = `${x}|${z}`
        const list = buckets.get(k)
        if (list) list.push(i)
        else buckets.set(k, [i])
      }
  })
  const seen = new Set<number>()
  const n = segs.length
  for (const list of buckets.values()) {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = Math.min(list[i], list[j])
        const b = Math.max(list[i], list[j])
        const pair = a * n + b
        if (seen.has(pair)) continue
        seen.add(pair)
        visit(segs[a], segs[b])
      }
  }
}

function findCrossings(edges: readonly NetworkEdge[], edgeRoad: ReadonlyMap<string, LayoutRoad>, issues: LayoutIssue[]): NetworkCrossing[] {
  const segs: Seg[] = []
  edges.forEach((e, ei) => {
    for (let i = 1; i < e.points.length; i++) segs.push({ edge: ei, index: i, a: e.points[i - 1], b: e.points[i] })
  })
  const found = new Map<string, NetworkCrossing>()
  const overlaps = new Set<string>()
  bucketPairs(segs, (s, t) => {
    if (s.edge === t.edge && Math.abs(s.index - t.index) <= 1) return
    const e1 = edges[s.edge]
    const e2 = edges[t.edge]
    const p = segmentIntersection(s.a, s.b, t.a, t.b)
    if (!p) {
      if (collinearOverlap(s, t) > 0.01) {
        const ids = [e1.id, e2.id].sort(byString)
        overlaps.add(ids.join(' '))
      }
      return
    }
    // Meeting at a shared node is a junction, not a crossing.
    const atEnd = (e: NetworkEdge, seg: Seg) => (seg.index === 1 && dist(p, e.points[0]) < 1e-6) || (seg.index === e.points.length - 1 && dist(p, e.points[e.points.length - 1]) < 1e-6)
    if (atEnd(e1, s) && atEnd(e2, t)) return
    const r1 = edgeRoad.get(e1.id)!
    const r2 = edgeRoad.get(e2.id)!
    const separated = r1.layer !== r2.layer || r1.grade !== 'ground' || r2.grade !== 'ground'
    const ids = [e1.id, e2.id].sort(byString) as [string, string]
    const key = `${ids.join(' ')}@${Math.round(p.x * 100)}|${Math.round(p.z * 100)}`
    if (!found.has(key)) found.set(key, { edges: ids, at: { x: quantize(p.x), z: quantize(p.z) }, kind: separated ? 'grade-separated' : 'unjoined' })
  })
  const list = [...found.values()].sort((a, b) => byString(a.edges.join(' '), b.edges.join(' ')) || a.at.x - b.at.x || a.at.z - b.at.z)
  for (const c of list) {
    if (c.kind === 'unjoined') issues.push({ severity: 'warning', code: 'crossing-without-junction', message: `${c.edges[0]} và ${c.edges[1]} cắt nhau cùng cao độ nhưng không có điểm chung: giữ là không giao nhau (thiếu node trong dữ liệu?)`, ids: [...c.edges], at: c.at })
    else issues.push({ severity: 'info', code: 'grade-separated-crossing', message: `${c.edges[0]} và ${c.edges[1]} giao khác cao độ (cầu/hầm/layer): không tạo giao lộ`, ids: [...c.edges], at: c.at })
  }
  for (const pair of [...overlaps].sort(byString)) {
    const ids = pair.split(' ')
    issues.push({ severity: 'warning', code: 'overlapping-roads', message: `${ids[0]} và ${ids[1]} chồng lên nhau một đoạn (đường bị trùng trong dữ liệu?)`, ids })
  }
  return list
}

function collinearOverlap(s: { a: XZ; b: XZ }, t: { a: XZ; b: XZ }): number {
  const dx = s.b.x - s.a.x
  const dz = s.b.z - s.a.z
  const len = Math.hypot(dx, dz)
  if (len === 0) return 0
  const cross = (p: XZ) => Math.abs((p.x - s.a.x) * dz - (p.z - s.a.z) * dx) / len
  if (cross(t.a) > 1e-6 || cross(t.b) > 1e-6) return 0
  const along = (p: XZ) => ((p.x - s.a.x) * dx + (p.z - s.a.z) * dz) / len
  const lo = Math.max(0, Math.min(along(t.a), along(t.b)))
  const hi = Math.min(len, Math.max(along(t.a), along(t.b)))
  return hi - lo
}
