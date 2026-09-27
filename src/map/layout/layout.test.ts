import { describe, expect, it } from 'vitest'
import { layoutChunkIndex, midpointAlong } from './chunks'
import { checkWorldLayout, importGeoJsonLayout, LayoutImportError, MVP_EXTENT, parseWorldLayout, renormalize, serializeWorldLayout } from './importer'
import { layoutPreviewSvg } from './preview'
import type { WorldLayout } from './schema'
import { area, fc, gridStreets, imp, rect, road } from './testUtils'
import FIXTURE from '../../test/fixtures/layouts/wg1-town.geojson?raw'

const town = () => importGeoJsonLayout(FIXTURE, { layoutId: 'wg1-town', name: 'WG1 town', file: 'wg1-town.geojson' })

describe('WG1 fixture town (synthetic GeoJSON, WGS84, rotated 12°)', () => {
  const l = town()
  const n = l.normalized!

  it('imports every supported feature and reports the rest', () => {
    expect(l.source).toMatchObject({ kind: 'geojson', file: 'wg1-town.geojson', crs: 'wgs84', attribution: null, features: 25 })
    expect(l.projection.method).toBe('local-tangent-plane')
    expect(l.roads).toHaveLength(12)
    expect(l.roads.filter((r) => r.network)).toHaveLength(11)
    expect(l.zones.map((z) => z.zone).sort()).toEqual(['commercial', 'empty', 'forest', 'public', 'residential'])
    expect(l.restricted.map((r) => r.kind).sort()).toEqual(['no-build', 'railway', 'water', 'water'])
    expect(l.buildings).toHaveLength(2)
    expect(l.network.nodes).toHaveLength(17)
    expect(l.network.edges).toHaveLength(19)
    const importCodes = l.issues.map((i) => i.code)
    expect(importCodes).toEqual(expect.arrayContaining(['ignored-feature', 'joined-near-miss', 'grade-separated-crossing', 'extent-over-limit', 'no-parcels']))
    expect(importCodes).not.toContain('no-landuse')
  })

  it('snaps to a valid grid: rotation undone, topology kept, diagonals flagged', () => {
    expect(n.valid).toBe(true)
    expect(n.frame.rotationDeg).toBe(-12)
    expect(n.metrics.maxNodeShift).toBeLessThan(2)
    expect(n.metrics.staircaseEdges).toBe(2)
    expect(n.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(n.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['crossing-kept', 'diagonal-staircase', 'roads-too-close']))
    // Straight grid streets stay single segments.
    const main = n.edges.filter((e) => e.id.startsWith('road-fixture-main-street'))
    expect(main.every((e) => e.points.length === 2 && e.points[0].z === e.points[1].z)).toBe(true)
  })

  it('round-trips through the file format byte for byte and validates clean', () => {
    const text = serializeWorldLayout(l)
    expect(checkWorldLayout(JSON.parse(text))).toEqual([])
    const back = parseWorldLayout(text)
    expect(back).toEqual(JSON.parse(JSON.stringify(l)))
    expect(serializeWorldLayout(back)).toBe(text)
    expect(serializeWorldLayout(town())).toBe(text)
  })

  it('re-normalises with other parameters without touching the source layer', () => {
    const coarse = renormalize(l, { grid: 5 })
    expect(coarse.roads).toBe(l.roads)
    expect(coarse.network).toBe(l.network)
    expect(coarse.normalized!.params.grid).toBe(5)
    expect(coarse.normalized!.nodes.every((x) => x.position.x % 5 === 0 && x.position.z % 5 === 0)).toBe(true)
    expect(l.normalized!.params.grid).toBe(1)
  })

  it('draws a preview with the snapped network, the source roads and issue markers', () => {
    const svg = layoutPreviewSvg(l)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.match(/stroke-dasharray="2 1.5"/g)!.length).toBe(11)
    expect(svg).toContain('0 lỗi')
    expect(svg).toContain('#ff9d00')
    const broken = { ...l, normalized: { ...n, valid: false, issues: [...n.issues, { severity: 'error' as const, code: 'x', message: 'x', at: { x: 0, z: 0 } }] } }
    expect(layoutPreviewSvg(broken)).toContain('KHÔNG HỢP LỆ')
  })
})

describe('WG1 layout file validation', () => {
  const good = () => JSON.parse(serializeWorldLayout(town())) as WorldLayout

  it('rejects an unknown format version and broken structure', () => {
    expect(checkWorldLayout({ ...good(), formatVersion: 2 }).map((i) => i.code)).toEqual(['unsupported-version'])
    expect(checkWorldLayout(null).length).toBe(1)
    expect(() => parseWorldLayout('{')).toThrow(LayoutImportError)
  })

  it('catches broken references, duplicate IDs and non-axis-aligned snapped edges', () => {
    const a = good()
    a.network.edges[0].roadId = 'road-missing'
    expect(checkWorldLayout(a).some((i) => i.code === 'reference')).toBe(true)
    const b = good()
    b.zones[1].id = b.zones[0].id
    expect(checkWorldLayout(b).some((i) => i.code === 'duplicate-id')).toBe(true)
    const c = good()
    c.normalized!.edges[0].points[1] = { x: c.normalized!.edges[0].points[1].x + 0.5, z: c.normalized!.edges[0].points[1].z + 0.5 }
    expect(checkWorldLayout(c).some((i) => i.code === 'geometry')).toBe(true)
    const d = good()
    d.network.edges[0].points[0] = { x: 999, z: 999 }
    expect(checkWorldLayout(d).some((i) => i.message.includes('đầu mút'))).toBe(true)
    expect(() => parseWorldLayout(JSON.stringify(d))).toThrow(/đầu mút/)
  })
})

describe('WG1 incomplete sources (Q4)', () => {
  it('imports roads without land use or parcels, with a default zone', () => {
    const l = imp(gridStreets(3, 40), { defaultZone: 'empty' })
    expect(l.defaults.zone).toBe('empty')
    expect(l.issues.find((i) => i.code === 'no-landuse')?.severity).toBe('warning')
    expect(l.issues.find((i) => i.code === 'no-parcels')?.severity).toBe('info')
    expect(l.normalized!.valid).toBe(true)
  })

  it('imports land use without roads, but reports it cannot generate', () => {
    const l = imp([area('way/1', [rect(0, 0, 50, 50)], { landuse: 'residential' })])
    expect(l.issues.find((i) => i.code === 'no-roads')?.severity).toBe('error')
    expect(l.normalized).toBeNull()
    expect(l.zones).toHaveLength(1)
  })

  it('refuses an invalid layout ID and invalid JSON', () => {
    expect(() => importGeoJsonLayout(fc([]), { layoutId: 'Bad ID', name: 'x' })).toThrow(LayoutImportError)
    expect(() => importGeoJsonLayout('{"type":', { layoutId: 'x', name: 'x' })).toThrow(/JSON/)
  })
})

describe('WG1 size limit and clip (Q5)', () => {
  it('warns above the 500 m MVP extent and clips to it', () => {
    const big = gridStreets(8, 90)
    expect(imp(big).issues.some((i) => i.code === 'extent-over-limit')).toBe(true)
    const clipped = imp(big, { clip: { width: MVP_EXTENT, depth: MVP_EXTENT } })
    expect(clipped.issues.some((i) => i.code === 'extent-over-limit')).toBe(false)
    expect(clipped.network.nodes.some((x) => x.kind === 'boundary')).toBe(true)
    expect(clipped.normalized!.valid).toBe(true)
  })

  it('imports and snaps a dense 500 × 500 m town quickly', () => {
    // 21 × 21 streets 25 m apart, rotated and jittered: 441 junctions, 840 edges.
    const t0 = performance.now()
    const l = imp(gridStreets(21, 25, 31, 0.6))
    const ms = performance.now() - t0
    expect(l.network.edges).toHaveLength(840)
    expect(l.normalized!.valid).toBe(true)
    expect(ms).toBeLessThan(3000)
  })
})

describe('WG1 stable IDs across re-imports', () => {
  it('keeps road, node and edge IDs when a road is added and the origin is pinned', () => {
    const base = gridStreets(3, 50)
    const a = imp(base)
    const b = imp([...base, road('way/new', [[50, 50], [50, 120]])])
    const ids = (l: WorldLayout) => new Set([...l.roads.map((r) => r.id), ...l.network.nodes.map((x) => x.id), ...l.network.edges.map((e) => e.id)])
    const before = ids(a)
    const after = ids(b)
    for (const id of before) expect(after.has(id)).toBe(true)
    expect(after.has('road-way-new')).toBe(true)
  })
})

describe('WG1 chunk ownership of the snapped network', () => {
  const net = town().normalized!
  const chunks = layoutChunkIndex(net, 32)

  it('gives every node and edge exactly one owner and never copies', () => {
    const edgeOwners = chunks.flatMap((c) => c.edges)
    expect(edgeOwners.sort()).toEqual(net.edges.map((e) => e.id).sort())
    expect(chunks.flatMap((c) => c.nodes).sort()).toEqual(net.nodes.map((x) => x.id).sort())
    for (const c of chunks) for (const id of c.refs) expect(c.edges).not.toContain(id)
  })

  it('lists an edge as a reference in every other chunk it crosses', () => {
    for (const e of net.edges) {
      const holders = chunks.filter((c) => c.edges.includes(e.id) || c.refs.includes(e.id))
      const xs = e.points.map((p) => p.x)
      const zs = e.points.map((p) => p.z)
      const spanX = Math.floor(Math.max(...xs) / 32) - Math.floor(Math.min(...xs) / 32)
      const spanZ = Math.floor(Math.max(...zs) / 32) - Math.floor(Math.min(...zs) / 32)
      expect(holders.length).toBeGreaterThanOrEqual(Math.max(spanX, spanZ))
      const owner = chunks.find((c) => c.edges.includes(e.id))!
      const m = midpointAlong(e.points)
      expect([owner.cx, owner.cz]).toEqual([Math.floor(m.x / 32), Math.floor(m.z / 32)])
    }
  })

  it('uses half-open chunks: a point on a chunk line belongs to the higher chunk', () => {
    const tiny = { ...net, nodes: [{ id: 'n-a', position: { x: 32, z: -32 } }], edges: [{ ...net.edges[0], id: 'e', points: [{ x: 0, z: 0 }, { x: 64, z: 0 }] }] }
    const c = layoutChunkIndex(tiny, 32)
    expect(c.find((x) => x.nodes.includes('n-a'))!.chunkId).toBe('c1_-1')
    // Midpoint x = 32: owned by c1_0, referenced by c0_0; the line z = 0 lies in row 0 only.
    expect(c.find((x) => x.edges.includes('e'))!.chunkId).toBe('c1_0')
    expect(c.filter((x) => x.refs.includes('e')).map((x) => x.chunkId)).toEqual(['c0_0'])
  })
})
