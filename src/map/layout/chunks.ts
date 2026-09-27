import type { XZ } from '../schema.ts'
import { chunkIdOf, chunkIndex, chunksOverlapping } from '../transform.ts'
import { byString, dist } from './geometry.ts'
import type { NormalizedNetwork } from './schema.ts'

/**
 * Chunk ownership of the normalised network (world generator WG1, Q5: layouts grow by chunks).
 * Same rules as map content (docs/map-content-format.md §3): chunks are half-open, a record has
 * exactly one owner — a node the chunk holding it, an edge the chunk holding the point halfway along
 * it — and every other chunk it passes through lists it as a reference, never as a copy.
 * Renderer-independent: later stages build per-chunk content from this index.
 */

export interface LayoutChunk {
  chunkId: string
  cx: number
  cz: number
  nodes: string[]
  edges: string[]
  /** Edges owned elsewhere that pass through this chunk. */
  refs: string[]
}

/** Point halfway along a polyline (by length). */
export function midpointAlong(points: readonly XZ[]): XZ {
  let total = 0
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i])
  let left = total / 2
  for (let i = 1; i < points.length; i++) {
    const d = dist(points[i - 1], points[i])
    if (d >= left && d > 0) {
      const t = left / d
      return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, z: points[i - 1].z + (points[i].z - points[i - 1].z) * t }
    }
    left -= d
  }
  return points[0]
}

export function layoutChunkIndex(net: NormalizedNetwork, chunkSize = 32): LayoutChunk[] {
  const chunks = new Map<string, LayoutChunk>()
  const get = (cx: number, cz: number) => {
    const id = chunkIdOf(cx, cz)
    let c = chunks.get(id)
    if (!c) chunks.set(id, (c = { chunkId: id, cx, cz, nodes: [], edges: [], refs: [] }))
    return c
  }
  for (const n of net.nodes) get(chunkIndex(n.position.x, chunkSize), chunkIndex(n.position.z, chunkSize)).nodes.push(n.id)
  for (const e of net.edges) {
    const m = midpointAlong(e.points)
    const owner = get(chunkIndex(m.x, chunkSize), chunkIndex(m.z, chunkSize))
    owner.edges.push(e.id)
    const touched = new Set<string>()
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1]
      const b = e.points[i]
      const rect = { minX: Math.min(a.x, b.x), minZ: Math.min(a.z, b.z), maxX: Math.max(a.x, b.x), maxZ: Math.max(a.z, b.z) }
      for (const { cx, cz } of chunksOverlapping(rect, chunkSize)) touched.add(chunkIdOf(cx, cz) + `|${cx}|${cz}`)
    }
    for (const t of touched) {
      const [id, cx, cz] = t.split('|')
      if (id === owner.chunkId) continue
      get(Number(cx), Number(cz)).refs.push(e.id)
    }
  }
  const list = [...chunks.values()].sort((a, b) => a.cz - b.cz || a.cx - b.cx)
  for (const c of list) {
    c.nodes.sort(byString)
    c.edges.sort(byString)
    c.refs.sort(byString)
  }
  return list
}
