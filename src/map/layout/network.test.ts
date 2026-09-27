import { describe, expect, it } from 'vitest'
import { imp, road } from './testUtils'

const net = (features: object[], opts = {}) => imp(features, { normalize: false, ...opts })

describe('WG1 road network topology', () => {
  it('turns a shared vertex into a junction and splits the roads there', () => {
    const l = net([road('way/1', [[-50, 0], [0, 0], [50, 0]]), road('way/2', [[0, -50], [0, 0], [0, 50]])])
    expect(l.network.edges.map((e) => e.id)).toEqual(['road-way-1-e1', 'road-way-1-e2', 'road-way-2-e1', 'road-way-2-e2'])
    const centre = l.network.nodes.find((n) => n.position.x === 0 && n.position.z === 0)!
    expect(centre.kind).toBe('junction')
    expect(l.network.edges.filter((e) => e.from === centre.id || e.to === centre.id)).toHaveLength(4)
    expect(l.network.nodes.filter((n) => n.kind === 'end')).toHaveLength(4)
    for (const e of l.network.edges) {
      const from = l.network.nodes.find((n) => n.id === e.from)!
      expect(e.points[0]).toEqual(from.position)
    }
  })

  it('marks two roads meeting end to end as a joint, a T as a junction', () => {
    const l = net([road('way/1', [[0, 0], [50, 0]]), road('way/2', [[50, 0], [100, 0]]), road('way/3', [[25, 0], [25, 40]]), road('way/4', [[-10, 0], [0, 0]])])
    // way/3 does not share a vertex with way/1 at x = 25: exactly on the segment, it is joined (near miss 0 m).
    const kinds = Object.fromEntries(l.network.nodes.map((n) => [`${n.position.x},${n.position.z}`, n.kind]))
    expect(kinds['50,0']).toBe('joint')
    expect(kinds['25,0']).toBe('junction')
    expect(kinds['0,0']).toBe('joint')
  })

  it('joins a dead end within the tolerance with a warning, keeping the road record exact', () => {
    const l = net([road('way/1', [[-50, 0], [50, 0]]), road('way/2', [[10, 40], [10, 0.6]])])
    expect(l.issues.find((i) => i.code === 'joined-near-miss')).toMatchObject({ severity: 'warning', ids: ['road-way-2', 'road-way-1'] })
    expect(l.roads.find((r) => r.id === 'road-way-2')!.points[1]).toEqual({ x: 10, z: -0.6 })
    expect(l.network.nodes.find((n) => n.position.x === 10 && n.position.z === 0)?.kind).toBe('junction')
    // Beyond the tolerance it stays a dead end.
    const far = net([road('way/1', [[-50, 0], [50, 0]]), road('way/2', [[10, 40], [10, 1.5]])])
    expect(far.issues.some((i) => i.code === 'joined-near-miss')).toBe(false)
    expect(far.network.nodes.filter((n) => n.kind === 'end')).toHaveLength(4)
    // Disabled.
    expect(net([road('way/1', [[-50, 0], [50, 0]]), road('way/2', [[10, 40], [10, 0.6]])], { joinTolerance: 0 }).issues.some((i) => i.code === 'joined-near-miss')).toBe(false)
  })

  it('never joins across layers', () => {
    const l = net([road('way/1', [[-50, 0], [50, 0]]), road('way/2', [[10, 40], [10, 0.5]], { bridge: 'yes', layer: '1' })])
    expect(l.issues.some((i) => i.code === 'joined-near-miss')).toBe(false)
  })

  it('keeps crossings without a shared vertex apart: grade-separated or reported as unjoined', () => {
    const bridge = net([road('way/1', [[-50, 0], [50, 0]]), road('way/2', [[0, -50], [0, 50]], { bridge: 'yes', layer: '1' })])
    expect(bridge.network.crossings).toEqual([{ edges: ['road-way-1-e1', 'road-way-2-e1'], at: { x: 0, z: 0 }, kind: 'grade-separated' }])
    expect(bridge.network.nodes.some((n) => n.kind === 'junction')).toBe(false)
    expect(bridge.issues.find((i) => i.code === 'grade-separated-crossing')?.severity).toBe('info')
    const flat = net([road('way/1', [[-50, 0], [50, 0]]), road('way/2', [[0, -50], [0, 50]])])
    expect(flat.network.crossings[0].kind).toBe('unjoined')
    expect(flat.issues.find((i) => i.code === 'crossing-without-junction')?.severity).toBe('warning')
  })

  it('handles a closed loop (roundabout) as one edge from a node back to itself', () => {
    const l = net([road('way/1', [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]])])
    expect(l.network.edges).toHaveLength(1)
    expect(l.network.edges[0].from).toBe(l.network.edges[0].to)
  })

  it('ends a road cut by the clip in a boundary node', () => {
    const l = net([road('way/1', [[-200, 0], [0, 0]]), road('way/2', [[0, 0], [0, 30]])], { clip: { width: 100, depth: 100 } })
    const west = l.network.nodes.find((n) => n.position.x === -50)!
    expect(west.kind).toBe('boundary')
  })

  it('leaves paths out of the network and warns about duplicated roads', () => {
    const l = net([road('way/1', [[0, 0], [50, 0]]), road('way/2', [[0, 10], [50, 10]], { highway: 'footway' }), road('way/3', [[10, 0], [40, 0]])])
    expect(l.network.edges.every((e) => e.roadId !== 'road-way-2')).toBe(true)
    expect(l.roads.some((r) => r.id === 'road-way-2')).toBe(true)
    expect(l.issues.some((i) => i.code === 'overlapping-roads')).toBe(true)
  })
})
