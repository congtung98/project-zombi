import { describe, expect, it } from 'vitest'
import { cleanPolyline, dominantAngle, legPlan, legPoints } from './orthogonalize'
import type { NormalizedNetwork, WorldLayout } from './schema'
import { gridStreets, imp, road } from './testUtils'

const n = (l: WorldLayout): NormalizedNetwork => l.normalized!
const codes = (l: WorldLayout) => n(l).issues.map((i) => i.code)
const axisAligned = (net: NormalizedNetwork) => net.edges.every((e) => e.points.every((p, i) => i === 0 || p.x === e.points[i - 1].x || p.z === e.points[i - 1].z))

describe('WG1 orthogonal snapping: grid and topology', () => {
  it('recovers the grid of a rotated, noisy street layout and keeps its topology', () => {
    const l = imp(gridStreets(5, 60, 17, 0.8))
    const net = n(l)
    expect(net.valid).toBe(true)
    expect(net.frame.rotationDeg).toBeCloseTo(-17, 0)
    expect(axisAligned(net)).toBe(true)
    // Same nodes and edges, same endpoints.
    expect(net.nodes.map((x) => x.id)).toEqual(l.network.nodes.map((x) => x.id))
    expect(net.edges.map((e) => [e.id, e.from, e.to])).toEqual(l.network.edges.map((e) => [e.id, e.from, e.to]))
    for (const e of net.edges) {
      expect(e.points[0]).toEqual(net.nodes.find((x) => x.id === e.from)!.position)
      expect(e.points[e.points.length - 1]).toEqual(net.nodes.find((x) => x.id === e.to)!.position)
      expect(e.points).toHaveLength(2)
    }
    expect(net.metrics.maxNodeShift).toBeLessThan(2)
    expect(net.issues.filter((i) => i.severity !== 'info')).toEqual([])
    // Every node on the grid.
    expect(net.nodes.every((x) => Number.isInteger(x.position.x) && Number.isInteger(x.position.z))).toBe(true)
  })

  it('honours a fixed alignment and grid step', () => {
    const l = imp(gridStreets(3, 50, 0), { normalize: { alignment: 0, grid: 5 } })
    expect(n(l).frame.rotationDeg).toBe(0)
    expect(n(l).nodes.every((x) => x.position.x % 5 === 0 && x.position.z % 5 === 0)).toBe(true)
  })

  it('straightens a wiggly street into one line', () => {
    const l = imp([road('way/1', [[0, 0], [40, 1.5], [80, -1], [120, 0]])], { normalize: { alignment: 0 } })
    expect(n(l).edges[0].points).toHaveLength(2)
    expect(n(l).edges[0].points[0].z).toBe(n(l).edges[0].points[1].z)
  })

  it('computes the dominant direction modulo 90°', () => {
    const at = (deg: number) => [{ x: 0, z: 0 }, { x: Math.cos((deg * Math.PI) / 180) * 100, z: Math.sin((deg * Math.PI) / 180) * 100 }]
    expect(dominantAngle([at(10), at(100), at(-80)])).toBeCloseTo(10, 6)
    expect(dominantAngle([at(40), at(-50)])).toBeCloseTo(40, 6)
    expect(dominantAngle([])).toBe(0)
  })
})

describe('WG1 orthogonal snapping: diagonals, curves, ports', () => {
  it('turns a 45° road into a staircase, flagged and measured', () => {
    const l = imp([road('way/1', [[0, 0], [100, 0]]), road('way/2', [[100, 0], [180, -80]])], { normalize: { alignment: 0, stairStep: 30 } })
    const net = n(l)
    const diag = net.edges.find((e) => e.id === 'road-way-2-e1')!
    expect(net.valid).toBe(true)
    expect(diag.staircase).toBe(true)
    expect(diag.points.length).toBeGreaterThan(4)
    expect(diag.length / diag.sourceLength).toBeCloseTo(Math.SQRT2, 1)
    expect(codes(l)).toEqual(expect.arrayContaining(['diagonal-staircase', 'edge-deviation', 'edge-length']))
    expect(net.metrics.staircaseEdges).toBe(1)
  })

  it('keeps a road leaving a junction at a shallow angle off its neighbour (ports)', () => {
    // Both leave (0, 0) heading south, 12° apart: without ports they would snap onto one line.
    const l = imp([road('way/1', [[0, 0], [0, -100]]), road('way/2', [[0, 0], [-21, -100]]), road('way/3', [[0, 0], [100, 0]])], { normalize: { alignment: 0 } })
    const net = n(l)
    expect(net.valid).toBe(true)
    expect(codes(l)).not.toContain('edges-overlap')
    const fork = net.edges.find((e) => e.id === 'road-way-2-e1')!
    // Its first leg turns west (−X) while way/1 keeps south.
    expect(fork.points[1].z).toBe(fork.points[0].z)
    expect(fork.points[1].x).toBeLessThan(fork.points[0].x)
  })

  it('reports a junction with more than four roads as an error', () => {
    const arms = [0, 72, 144, 216, 288].map((deg, i) => road(`way/${i}`, [[0, 0], [Math.round(Math.cos((deg * Math.PI) / 180) * 80), Math.round(Math.sin((deg * Math.PI) / 180) * 80)]]))
    const l = imp(arms, { normalize: { alignment: 0 } })
    expect(n(l).valid).toBe(false)
    expect(codes(l)).toContain('junction-too-many-roads')
  })

  it('never merges nodes silently: two junctions closer than the grid is an error', () => {
    const l = imp([road('way/1', [[-50, 0], [50, 0]]), road('way/2', [[-50, 0.4], [-20, 0.4], [-20, 0], [-20, -50]]), road('way/3', [[0, 30], [0, 0]]), road('way/4', [[0, 0.4], [0, 0], [0, -50]])], { normalize: { alignment: 0, grid: 2 }, joinTolerance: 0 })
    expect(n(l).valid).toBe(false)
    expect(codes(l)).toEqual(expect.arrayContaining(['nodes-merged']))
  })

  it('never creates a junction silently: a dead end snapped onto another road is an error', () => {
    const l = imp([road('way/1', [[-50, 0], [50, 0]]), road('way/2', [[0, 30], [0, 1.4]])], { normalize: { alignment: 0, grid: 4 } })
    expect(l.issues.some((i) => i.code === 'joined-near-miss')).toBe(false)
    expect(n(l).valid).toBe(false)
    expect(n(l).issues.find((i) => i.code === 'false-junction')).toMatchObject({ severity: 'error', ids: ['road-way-1-e1', 'road-way-2-e1'] })
  })

  it('keeps a bridge crossing as a crossing, not a junction', () => {
    const l = imp([road('way/1', [[-50, 0], [50, 0]]), road('way/2', [[0, -50], [0, 50]], { bridge: 'yes', layer: '1' })], { normalize: { alignment: 0 } })
    expect(n(l).valid).toBe(true)
    expect(codes(l)).toContain('crossing-kept')
  })

  it('warns when parallel roads end up closer than their widths', () => {
    const l = imp([road('way/1', [[0, 0], [100, 0]]), road('way/2', [[0, 4], [100, 4]])], { normalize: { alignment: 0 } })
    expect(n(l).valid).toBe(true)
    expect(n(l).issues.find((i) => i.code === 'roads-too-close')?.severity).toBe('warning')
  })
})

describe('WG1 orthogonal snapping: source kept, determinism', () => {
  it('never changes the source layer', () => {
    const plain = imp(gridStreets(4, 40, 23, 1), { normalize: false })
    const before = JSON.stringify({ roads: plain.roads, network: plain.network })
    const snapped = imp(gridStreets(4, 40, 23, 1))
    expect(JSON.stringify({ roads: snapped.roads, network: snapped.network })).toBe(before)
  })

  it('gives the same output for the same input, whatever the feature order', () => {
    const features = [...gridStreets(4, 45, 8, 1.2), road('way/diag', [[-67.5, -67.5], [-120, -120]])]
    // The source hash is of the text, which changes with the order; everything else must not.
    const body = (l: WorldLayout) => JSON.stringify({ ...l, source: { ...l.source, hash: '' } })
    const a = body(imp(features))
    expect(body(imp(features))).toBe(a)
    expect(body(imp([...features].reverse()))).toBe(a)
  })
})

describe('WG1 orthogonal snapping: helpers', () => {
  it('plans legs: straight, forced L, Z and staircase', () => {
    const tan = Math.tan((20 * Math.PI) / 180)
    const a = { x: 0, z: 0 }
    expect(legPlan(a, { x: 100, z: 5 }, tan, 24, null, null)).toEqual({ first: 'H', legs: 1, diagonal: false })
    expect(legPlan(a, { x: 100, z: 5 }, tan, 24, 'V', null)).toEqual({ first: 'V', legs: 2, diagonal: false })
    expect(legPlan(a, { x: 100, z: 5 }, tan, 24, null, 'V')).toEqual({ first: 'H', legs: 2, diagonal: false })
    expect(legPlan(a, { x: 100, z: 5 }, tan, 24, 'V', 'V')).toEqual({ first: 'V', legs: 3, diagonal: false })
    expect(legPlan(a, { x: 50, z: 50 }, tan, 24, null, null)).toEqual({ first: 'H', legs: 6, diagonal: true })
    expect(legPlan(a, { x: 50, z: 50 }, tan, 24, 'V', 'V')).toEqual({ first: 'V', legs: 7, diagonal: true })
    expect(legPoints(a, { x: 10, z: 20 }, 'H', 2)).toEqual([{ x: 10, z: 0 }, { x: 10, z: 20 }])
    expect(legPoints(a, { x: 10, z: 20 }, 'V', 3)).toEqual([{ x: 0, z: 10 }, { x: 10, z: 10 }, { x: 10, z: 20 }])
  })

  it('cleans snapped polylines: repeats, straight runs and fold-backs', () => {
    expect(cleanPolyline([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 5, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 5 }])).toEqual([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 5 }])
    expect(cleanPolyline([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 5 }])).toEqual([{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 5 }])
    expect(cleanPolyline([{ x: 3, z: 3 }, { x: 3, z: 3 }])).toEqual([{ x: 3, z: 3 }, { x: 3, z: 3 }])
  })
})
