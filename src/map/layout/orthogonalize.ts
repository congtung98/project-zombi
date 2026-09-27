import type { Rect, XZ } from '../schema.ts'
import { quantize } from '../transform.ts'
import { rotateDeg } from './coordinates.ts'
import { boundsOf, byString, dist, polylineDeviation, polylineLength, segmentIntersection, simplify } from './geometry.ts'
import { bucketPairs } from './network.ts'
import type { GridFrame, LayoutIssue, LayoutRoad, NormalizedEdge, NormalizedNetwork, OrthogonalParams, RoadNetwork } from './schema.ts'

/**
 * LayoutNormalizer, method `orthogonal` (world generator WG1, owner decision Q1): snap the road
 * network to a 0°/90° grid so it fits the game's axis-aligned world, keeping its topology.
 *
 * 1. Frame: rotate so the dominant street direction lies on the axes (length-weighted mean of the
 *    segment angles modulo 90°), then shift the centre to the origin on a grid multiple.
 * 2. Each edge is simplified (Douglas–Peucker) and each segment classified: near an axis → straight
 *    along it; steeper → a staircase of steps no longer than `stairStep`.
 * 3. Constraint groups: vertices joined by an X-parallel segment share Z, by a Z-parallel one share
 *    X (union–find). Each group takes the weighted mean of its members, snapped to the grid.
 *    Straight runs therefore straighten, and a junction stays one point for every road meeting there.
 * 4. Checks, never silent: merged nodes, collapsed loops, edges touching or overlapping where the
 *    source has no junction are errors (`valid: false`); a crossing the source already had (bridge,
 *    tunnel, missing node) is kept and flagged; roads whose surfaces would overlap, and edges that
 *    moved or stretched beyond the thresholds, are warnings.
 *
 * The source network is only read. Node and edge IDs are the source's.
 */

export const ORTHOGONAL_VERSION = 1

export const DEFAULT_ORTHOGONAL: OrthogonalParams = {
  alignment: 'auto',
  grid: 1,
  simplify: 2,
  axisTolerance: 20,
  stairStep: 24,
  maxDeviation: 5,
  maxLengthChange: 0.25,
}

/** Length-weighted dominant direction of the network, modulo 90°, in (−45°, 45°], rounded to 0.01°. */
export function dominantAngle(lines: readonly (readonly XZ[])[]): number {
  let c = 0
  let s = 0
  for (const line of lines)
    for (let i = 1; i < line.length; i++) {
      const dx = line[i].x - line[i - 1].x
      const dz = line[i].z - line[i - 1].z
      const w = Math.hypot(dx, dz)
      if (w === 0) continue
      const a = Math.atan2(dz, dx) * 4
      c += w * Math.cos(a)
      s += w * Math.sin(a)
    }
  if (c === 0 && s === 0) return 0
  const deg = (Math.atan2(s, c) / 4) * (180 / Math.PI)
  return Math.round(deg * 100) / 100 + 0
}

class UnionFind {
  private readonly parent: number[] = []
  add(): number {
    this.parent.push(this.parent.length)
    return this.parent.length - 1
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]]
      i = this.parent[i]
    }
    return i
  }
  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    // Smaller root wins: the result does not depend on the order of unions.
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }
}

interface Vertex {
  x: number
  z: number
  weight: number
}

type Axis = 'x' | 'z'
/** A leg of the snapped polyline: along X (H) or along Z (V). */
type Leg = 'H' | 'V'
const other = (l: Leg): Leg => (l === 'H' ? 'V' : 'H')

/**
 * How a source segment becomes axis-aligned legs. Near an axis: one leg, unless a port forces the
 * first or last leg onto the other axis (then an L, or a Z when both ends want the same wrong axis).
 * Steeper: a staircase of `2k` legs (one more when the last leg must repeat the first axis).
 */
export function legPlan(a: XZ, b: XZ, tanTol: number, stairStep: number, start: Leg | null, end: Leg | null): { first: Leg; legs: number; diagonal: boolean } {
  const dx = Math.abs(b.x - a.x)
  const dz = Math.abs(b.z - a.z)
  const natural: Leg | null = dz <= dx * tanTol ? 'H' : dx <= dz * tanTol ? 'V' : null
  if (natural) {
    if ((start ?? natural) === natural && (end ?? natural) === natural) return { first: natural, legs: 1, diagonal: false }
    if (start && end) return { first: start, legs: start === end ? 3 : 2, diagonal: false }
    if (start) return { first: start, legs: 2, diagonal: false }
    return { first: other(end!), legs: 2, diagonal: false }
  }
  const k = Math.max(1, Math.ceil(Math.hypot(dx, dz) / stairStep))
  const first: Leg = start ?? (end ? other(end) : 'H')
  return { first, legs: 2 * k + (end === first ? 1 : 0), diagonal: true }
}

/** Corner points of `legs` alternating legs from a to b (b last, exactly); X and Z travel split evenly between their legs. */
export function legPoints(a: XZ, b: XZ, first: Leg, legs: number): XZ[] {
  const firstCount = Math.ceil(legs / 2)
  const nH = first === 'H' ? firstCount : legs - firstCount
  const nV = legs - nH
  const out: XZ[] = []
  let x = a.x
  let z = a.z
  for (let j = 0; j < legs; j++) {
    if (j === legs - 1) {
      out.push({ x: b.x, z: b.z })
      break
    }
    const leg = j % 2 === 0 ? first : other(first)
    if (leg === 'H' && nH) x += (b.x - a.x) / nH
    if (leg === 'V' && nV) z += (b.z - a.z) / nV
    out.push({ x, z })
  }
  return out
}

/**
 * Ports: at every node, each edge end leaves along its own signed axis direction (+X, −X, +Z, −Z),
 * chosen among the two its first segment leans towards, with the least total turning. Two roads
 * leaving a junction at a shallow angle then cannot snap onto one line: the one further from the
 * axis turns first. A node with more than four ends cannot be orthogonal (error).
 */
function assignPorts(edges: readonly { id: string; from: string; to: string }[], simplified: ReadonlyMap<string, XZ[]>, issues: LayoutIssue[]): Map<string, Leg> {
  const ends = new Map<string, { key: string; dx: number; dz: number }[]>()
  const add = (node: string, key: string, a: XZ, b: XZ) => {
    const list = ends.get(node) ?? []
    list.push({ key, dx: b.x - a.x, dz: b.z - a.z })
    ends.set(node, list)
  }
  for (const e of edges) {
    const pts = simplified.get(e.id)!
    add(e.from, `${e.id}|from`, pts[0], pts[1])
    add(e.to, `${e.id}|to`, pts[pts.length - 1], pts[pts.length - 2])
  }
  const ports = new Map<string, Leg>()
  for (const node of [...ends.keys()].sort(byString)) {
    const list = ends.get(node)!.sort((a, b) => byString(a.key, b.key))
    if (list.length > 4) {
      issues.push({ severity: 'error', code: 'junction-too-many-roads', message: `node ${node} có ${list.length} nhánh: lưới 0°/90° chỉ có 4 hướng`, ids: [node] })
      continue
    }
    const options = list.map((end) => {
      const opts: { leg: Leg; dir: string; cost: number }[] = []
      if (end.dx !== 0) opts.push({ leg: 'H', dir: end.dx > 0 ? '+x' : '-x', cost: Math.atan2(Math.abs(end.dz), Math.abs(end.dx)) })
      if (end.dz !== 0) opts.push({ leg: 'V', dir: end.dz > 0 ? '+z' : '-z', cost: Math.atan2(Math.abs(end.dx), Math.abs(end.dz)) })
      return opts.sort((a, b) => a.cost - b.cost || byString(a.leg, b.leg))
    })
    let best: { cost: number; pick: number[] } | null = null
    const pick: number[] = []
    const used = new Set<string>()
    const search = (i: number, cost: number) => {
      if (best && cost >= best.cost - 1e-12) return
      if (i === list.length) {
        best = { cost, pick: [...pick] }
        return
      }
      options[i].forEach((o, k) => {
        if (used.has(o.dir)) return
        used.add(o.dir)
        pick.push(k)
        search(i + 1, cost + o.cost)
        pick.pop()
        used.delete(o.dir)
      })
    }
    search(0, 0)
    const chosen = best as { cost: number; pick: number[] } | null
    if (!chosen) continue
    list.forEach((end, i) => ports.set(end.key, options[i][chosen.pick[i]].leg))
  }
  return ports
}

export function orthogonalize(network: RoadNetwork, roads: readonly LayoutRoad[], params: Partial<OrthogonalParams> = {}): NormalizedNetwork {
  const p: OrthogonalParams = { ...DEFAULT_ORTHOGONAL, ...params }
  const issues: LayoutIssue[] = []
  const roadOf = new Map(roads.map((r) => [r.id, r]))
  const edges = [...network.edges].sort((a, b) => byString(a.id, b.id))
  const nodes = [...network.nodes].sort((a, b) => byString(a.id, b.id))

  // 1. Frame.
  const rotationDeg = p.alignment === 'auto' ? dominantAngle(edges.map((e) => e.points)) : p.alignment
  const rotated = new Map(edges.map((e) => [e.id, e.points.map((q) => rotateDeg(q, rotationDeg))]))
  const box = boundsOf([...rotated.values()].flat()) ?? { minX: 0, minZ: 0, maxX: 0, maxZ: 0 }
  // WG6: a pinned offset keeps the world frame of an updated layout (unchanged streets stay where they were).
  const offset = p.offset ?? { x: quantize(-Math.round((box.minX + box.maxX) / 2 / p.grid) * p.grid), z: quantize(-Math.round((box.minZ + box.maxZ) / 2 / p.grid) * p.grid) }
  const frame: GridFrame = { rotationDeg, offset }
  const toFrame = (q: XZ): XZ => ({ x: q.x + offset.x, z: q.z + offset.z })
  const sourceWorld = new Map([...rotated].map(([id, pts]) => [id, pts.map(toFrame)]))
  const nodeSource = new Map(nodes.map((n) => [n.id, toFrame(rotateDeg(n.position, rotationDeg))]))

  // 2. Vertices, segments and constraint groups.
  const vertices: Vertex[] = []
  const ux = new UnionFind()
  const uz = new UnionFind()
  const addVertex = (q: XZ, weight: number) => {
    vertices.push({ x: q.x, z: q.z, weight })
    ux.add()
    uz.add()
    return vertices.length - 1
  }
  const degree = new Map<string, number>()
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
  }
  const nodeVertex = new Map<string, number>()
  for (const n of nodes) nodeVertex.set(n.id, addVertex(nodeSource.get(n.id)!, 1 + (degree.get(n.id) ?? 0)))

  const tanTol = Math.tan((p.axisTolerance * Math.PI) / 180)
  const simplified = new Map(edges.map((e) => [e.id, simplify(sourceWorld.get(e.id)!, p.simplify)]))
  const ports = assignPorts(edges, simplified, issues)
  const edgeVertices = new Map<string, number[]>()
  const staircase = new Set<string>()
  for (const e of edges) {
    const pts = simplified.get(e.id)!
    const chain: number[] = [nodeVertex.get(e.from)!]
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      const last = i === pts.length - 1
      const plan = legPlan(a, b, tanTol, p.stairStep, i === 1 ? (ports.get(`${e.id}|from`) ?? null) : null, last ? (ports.get(`${e.id}|to`) ?? null) : null)
      if (plan.diagonal) staircase.add(e.id)
      const corners = legPoints(a, b, plan.first, plan.legs)
      corners.forEach((q, j) => {
        const v = last && j === corners.length - 1 ? nodeVertex.get(e.to)! : addVertex(q, 1)
        // A leg along X keeps Z (and the other way round).
        const leg = j % 2 === 0 ? plan.first : other(plan.first)
        if (leg === 'H') uz.union(chain[chain.length - 1], v)
        else ux.union(chain[chain.length - 1], v)
        chain.push(v)
      })
    }
    edgeVertices.set(e.id, chain)
  }

  // 3. Group values: weighted mean, snapped to the grid.
  const solve = (uf: UnionFind, axis: Axis) => {
    const sum = new Map<number, [number, number]>()
    vertices.forEach((v, i) => {
      const r = uf.find(i)
      const s = sum.get(r) ?? [0, 0]
      s[0] += v[axis] * v.weight
      s[1] += v.weight
      sum.set(r, s)
    })
    const value = new Map<number, number>()
    for (const [r, [total, w]] of sum) value.set(r, quantize(Math.round(total / w / p.grid) * p.grid))
    return (i: number) => value.get(uf.find(i))!
  }
  const X = solve(ux, 'x')
  const Z = solve(uz, 'z')
  const at = (i: number): XZ => ({ x: X(i), z: Z(i) })

  // 4. Edge polylines: drop repeated points, merge straight runs, remove fold-backs of interior bends.
  const out: NormalizedEdge[] = []
  for (const e of edges) {
    const raw = edgeVertices.get(e.id)!.map(at)
    const pts = cleanPolyline(raw)
    const src = sourceWorld.get(e.id)!
    const sourceLength = polylineLength(src)
    const length = polylineLength(pts)
    out.push({
      id: e.id,
      from: e.from,
      to: e.to,
      points: pts,
      sourceLength: quantize(sourceLength),
      length: quantize(length),
      deviation: quantize(polylineDeviation(src, pts)),
      staircase: staircase.has(e.id),
    })
  }
  const outNodes = nodes.map((n) => ({ id: n.id, position: at(nodeVertex.get(n.id)!) }))

  // 5. Checks.
  const nodePos = new Map(outNodes.map((n) => [n.id, n.position]))
  const byPosition = new Map<string, string[]>()
  for (const n of outNodes) {
    const k = `${n.position.x}|${n.position.z}`
    byPosition.set(k, [...(byPosition.get(k) ?? []), n.id])
  }
  for (const ids of byPosition.values())
    if (ids.length > 1) issues.push({ severity: 'error', code: 'nodes-merged', message: `${ids.length} node bị nắn trùng một điểm (${ids.join(', ')}): kết nối sẽ đổi. Giảm grid hoặc axisTolerance`, ids, at: nodePos.get(ids[0]) })
  for (const e of out) {
    if (e.from === e.to && e.length === 0) issues.push({ severity: 'error', code: 'edge-collapsed', message: `vòng ${e.id} co lại thành một điểm`, ids: [e.id], at: nodePos.get(e.from) })
  }
  checkSegments(out, network, roadOf, issues)

  const shifts = nodes.map((n) => dist(nodeSource.get(n.id)!, nodePos.get(n.id)!))
  let maxLengthChange = 0
  for (const e of out) {
    const change = e.sourceLength > p.grid ? Math.abs(e.length / e.sourceLength - 1) : 0
    maxLengthChange = Math.max(maxLengthChange, change)
    if (e.staircase) issues.push({ severity: 'warning', code: 'diagonal-staircase', message: `${e.id} có đoạn chéo quá ${p.axisTolerance}°: nắn thành bậc thang (đường chéo thật cần phương pháp khác)`, ids: [e.id], at: e.points[Math.floor(e.points.length / 2)] })
    if (e.deviation > p.maxDeviation) issues.push({ severity: 'warning', code: 'edge-deviation', message: `${e.id} lệch tối đa ${e.deviation.toFixed(1)} m so với bản gốc (ngưỡng ${p.maxDeviation} m)`, ids: [e.id], at: e.points[0] })
    if (change > p.maxLengthChange) issues.push({ severity: 'warning', code: 'edge-length', message: `${e.id} đổi chiều dài ${(change * 100).toFixed(0)} % (${e.sourceLength.toFixed(1)} → ${e.length.toFixed(1)} m, ngưỡng ${(p.maxLengthChange * 100).toFixed(0)} %)`, ids: [e.id], at: e.points[0] })
  }

  const bounds: Rect = boundsOf(out.flatMap((e) => e.points)) ?? { minX: 0, minZ: 0, maxX: 0, maxZ: 0 }
  return {
    method: 'orthogonal',
    version: ORTHOGONAL_VERSION,
    params: p,
    frame,
    nodes: outNodes,
    edges: out,
    bounds,
    metrics: {
      nodes: outNodes.length,
      edges: out.length,
      maxNodeShift: quantize(Math.max(0, ...shifts)),
      meanNodeShift: quantize(shifts.length ? shifts.reduce((a, b) => a + b, 0) / shifts.length : 0),
      maxDeviation: quantize(Math.max(0, ...out.map((e) => e.deviation))),
      maxLengthChange: quantize(maxLengthChange),
      staircaseEdges: staircase.size,
    },
    valid: !issues.some((i) => i.severity === 'error'),
    issues,
  }
}

/** Remove zero-length segments and interior vertices between two segments on the same line (runs and fold-backs). */
export function cleanPolyline(raw: readonly XZ[]): XZ[] {
  const pts: XZ[] = []
  for (const q of raw) {
    const last = pts[pts.length - 1]
    if (last && last.x === q.x && last.z === q.z) continue
    pts.push(q)
    while (pts.length >= 3) {
      const [a, b, c] = pts.slice(-3)
      const sameLine = (a.x === b.x && b.x === c.x) || (a.z === b.z && b.z === c.z)
      if (!sameLine) break
      pts.splice(pts.length - 2, 1)
      if (pts.length >= 2) {
        const [u, v] = pts.slice(-2)
        if (u.x === v.x && u.z === v.z) pts.pop()
      }
    }
  }
  if (pts.length === 1) pts.push({ ...pts[0] })
  return pts
}

interface Seg {
  edge: number
  index: number
  a: XZ
  b: XZ
}

function checkSegments(edges: readonly NormalizedEdge[], network: RoadNetwork, roadOf: ReadonlyMap<string, LayoutRoad>, issues: LayoutIssue[]): void {
  const sourceEdge = new Map(network.edges.map((e) => [e.id, e]))
  const width = (e: NormalizedEdge) => roadOf.get(sourceEdge.get(e.id)!.roadId)?.width ?? 0
  const crossed = new Set(network.crossings.map((c) => [...c.edges].sort(byString).join(' ')))
  const segs: Seg[] = []
  edges.forEach((e, ei) => {
    for (let i = 1; i < e.points.length; i++) if (e.points[i - 1].x !== e.points[i].x || e.points[i - 1].z !== e.points[i].z) segs.push({ edge: ei, index: i, a: e.points[i - 1], b: e.points[i] })
  })
  const maxWidth = Math.max(0, ...edges.map(width))
  const reported = new Set<string>()
  const once = (key: string, issue: LayoutIssue) => {
    if (reported.has(key)) return
    reported.add(key)
    issues.push(issue)
  }
  // Pairs are visited in bucket order; collect, then sort so the issue list is deterministic.
  const found: { key: string; issue: LayoutIssue }[] = []
  bucketPairs(
    segs,
    (s, t) => {
      const [s1, s2] = s.edge < t.edge || (s.edge === t.edge && s.index < t.index) ? [s, t] : [t, s]
      const e1 = edges[s1.edge]
      const e2 = edges[s2.edge]
      if (s1.edge === s2.edge && Math.abs(s1.index - s2.index) <= 1) return
      const pair = [e1.id, e2.id].sort(byString)
      const horizontal = (g: Seg) => g.a.z === g.b.z
      if (horizontal(s1) === horizontal(s2)) {
        const h = horizontal(s1)
        const lo = (g: Seg) => Math.min(h ? g.a.x : g.a.z, h ? g.b.x : g.b.z)
        const hi = (g: Seg) => Math.max(h ? g.a.x : g.a.z, h ? g.b.x : g.b.z)
        const overlap = Math.min(hi(s1), hi(s2)) - Math.max(lo(s1), lo(s2))
        const gap = Math.abs(h ? s1.a.z - s2.a.z : s1.a.x - s2.a.x)
        if (gap === 0 && overlap > 0) {
          found.push({ key: `overlap ${pair.join(' ')}`, issue: { severity: 'error', code: 'edges-overlap', message: e1.id === e2.id ? `${e1.id} tự chồng lên chính nó sau khi nắn` : `${e1.id} và ${e2.id} chồng lên nhau sau khi nắn: hai đường thành một`, ids: pair, at: h ? { x: Math.max(lo(s1), lo(s2)), z: s1.a.z } : { x: s1.a.x, z: Math.max(lo(s1), lo(s2)) } } })
          return
        }
        if (gap > 0 && overlap > 0.5 && e1.id !== e2.id && gap < (width(e1) + width(e2)) / 2) {
          found.push({ key: `close ${pair.join(' ')}`, issue: { severity: 'warning', code: 'roads-too-close', message: `${e1.id} và ${e2.id} song song cách ${gap.toFixed(1)} m, mặt đường (${width(e1)} + ${width(e2)} m) sẽ chồng nhau`, ids: pair, at: s1.a } })
        }
        if (gap !== 0 || overlap < 0) return
      }
      const q = segmentIntersection(s1.a, s1.b, s2.a, s2.b) ?? overlapPoint(s1, s2)
      if (!q) return
      const endNode = (e: NormalizedEdge, g: Seg): string | null => {
        if (g.index === 1 && dist(q, g.a) < 1e-9) return e.from
        if (g.index === e.points.length - 1 && dist(q, g.b) < 1e-9) return e.to
        return null
      }
      const n1 = endNode(e1, s1)
      const n2 = endNode(e2, s2)
      if (n1 !== null && n1 === n2) return
      if (crossed.has(pair.join(' ')) && n1 === null && n2 === null) {
        found.push({ key: `kept ${pair.join(' ')}`, issue: { severity: 'info', code: 'crossing-kept', message: `${e1.id} và ${e2.id} vẫn cắt nhau không giao lộ như bản gốc (cầu/hầm/thiếu node)`, ids: pair, at: { x: quantize(q.x), z: quantize(q.z) } } })
        return
      }
      found.push({ key: `false ${pair.join(' ')} ${quantize(q.x)}|${quantize(q.z)}`, issue: { severity: 'error', code: 'false-junction', message: `${e1.id} và ${e2.id} chạm nhau sau khi nắn ở chỗ bản gốc không có giao lộ`, ids: pair, at: { x: quantize(q.x), z: quantize(q.z) } } })
    },
    maxWidth / 2,
  )
  found.sort((a, b) => byString(a.key, b.key))
  for (const f of found) once(f.key, f.issue)
}

/** Collinear segments touching end to end (overlap exactly 0): the shared point. */
function overlapPoint(s: Seg, t: Seg): XZ | null {
  for (const p of [s.a, s.b]) for (const q of [t.a, t.b]) if (p.x === q.x && p.z === q.z) return p
  return null
}
