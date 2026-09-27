import { describe, expect, it } from 'vitest'
import type { Rect, XZ } from '../schema'
import { planLayout } from './plan'
import { intersectRect, rectArea, rectsOverlap } from './rects'
import type { LayoutPlan } from './schema'
import { imp, road } from './testUtils'

/** Street surfaces (WG2): carriageway runs, sidewalks, junctions. Local metres: world Z = −y. */

const plan = (features: object[], params = {}): LayoutPlan => planLayout(imp(features, { normalize: { alignment: 0 } }), { accessRoads: false, ...params })
/** The world offset of the snapped network (its centre moves to the origin): source point → world point. */
const shift = (features: object[]) => imp(features, { normalize: { alignment: 0 } }).normalized!.frame.offset
const rects = (p: LayoutPlan, kind: string) => p.surfaces.filter((s) => s.kind === kind).map((s) => s.rect)
const inside = (q: XZ, list: readonly Rect[]) => list.some((r) => q.x > r.minX && q.x < r.maxX && q.z > r.minZ && q.z < r.maxZ)
const pairsOverlap = (list: readonly Rect[]) => list.some((a, i) => list.some((b, j) => j > i && rectsOverlap(a, b)))

describe('WG2 street surfaces', () => {
  it('a crossing: two carriageway runs overlapping only in the junction square', () => {
    const p = plan([road('way/1', [[-60, 0], [0, 0], [60, 0]]), road('way/2', [[0, -60], [0, 0], [0, 60]])])
    const asphalt = rects(p, 'asphalt')
    expect(asphalt).toHaveLength(2)
    expect(rectArea(intersectRect(asphalt[0], asphalt[1])!)).toBeCloseTo(36, 6)
    expect(asphalt.map((r) => [r.maxX - r.minX, r.maxZ - r.minZ]).sort()).toEqual([[120, 6], [6, 120]].sort())
  })

  it('sidewalks never lie on a carriageway or on each other, and close the corners', () => {
    const p = plan([road('way/1', [[-60, 0], [0, 0], [60, 0]]), road('way/2', [[0, -60], [0, 0], [0, 60]])])
    const asphalt = rects(p, 'asphalt')
    const walks = rects(p, 'sidewalk')
    expect(walks.some((w) => asphalt.some((a) => rectsOverlap(a, w)))).toBe(false)
    expect(pairsOverlap(walks)).toBe(false)
    // 1.8 m pavements on both sides: all four corner squares covered.
    for (const [x, z] of [[3.9, 3.9], [-3.9, 3.9], [3.9, -3.9], [-3.9, -3.9]]) expect(inside({ x, z }, walks)).toBe(true)
    // Continuous along the street, interrupted only by the crossing carriageway.
    for (let x = -55; x <= 55; x++) if (Math.abs(x) > 3) expect(inside({ x: x + 0.5, z: -3.9 }, walks)).toBe(true)
  })

  it('merges collinear roads through a straight joint into one run', () => {
    const p = plan([road('way/1', [[-60, 0], [0, 0]]), road('way/2', [[0, 0], [60, 0]])])
    expect(rects(p, 'asphalt')).toEqual([{ minX: -60, minZ: -3, maxX: 60, maxZ: 3 }])
  })

  it('puts sidewalks on the tagged side of the way direction (right of travel)', () => {
    // Eastbound: the right is south (+Z in the world).
    const east = plan([road('way/1', [[-60, 0], [60, 0]], { sidewalk: 'right' })])
    expect(rects(east, 'sidewalk').every((r) => r.minZ >= 3)).toBe(true)
    const west = plan([road('way/1', [[60, 0], [-60, 0]], { sidewalk: 'right' })])
    expect(rects(west, 'sidewalk').every((r) => r.maxZ <= -3)).toBe(true)
    expect(rects(plan([road('way/1', [[-60, 0], [60, 0]], { highway: 'service' })]), 'sidewalk')).toEqual([])
  })

  it('keeps the open side of a T continuous and covers both corners of a bend', () => {
    const tf = [road('way/1', [[-60, 0], [0, 0], [60, 0]]), road('way/2', [[0, 0], [0, -60]])]
    const o = shift(tf)
    const walks = rects(plan(tf), 'sidewalk')
    // The stem goes south (+Z): the north pavement runs straight across the junction.
    for (let x = -10; x <= 10; x++) expect(inside({ x: x + 0.25 + o.x, z: -3.9 + o.z }, walks)).toBe(true)
    const bf = [road('way/1', [[-60, 0], [0, 0], [0, 60]])]
    const b = shift(bf)
    const bw = rects(plan(bf), 'sidewalk')
    // East then north (−Z): outer corner south-east, inner corner north-west.
    expect(inside({ x: 3.9 + b.x, z: 3.9 + b.z }, bw)).toBe(true)
    expect(inside({ x: -3.9 + b.x, z: -3.9 + b.z }, bw)).toBe(true)
    expect(pairsOverlap(bw)).toBe(false)
  })

  it('draws unpaved tracks as dirt, and widens with lanes and width tags', () => {
    const p = plan([road('way/1', [[-60, 0], [60, 0]], { highway: 'track' }), road('way/2', [[-60, 40], [60, 40]], { highway: 'primary', lanes: '4' })])
    const dirt = rects(p, 'dirt')
    expect(dirt).toHaveLength(1)
    expect([dirt[0].maxX - dirt[0].minX, dirt[0].maxZ - dirt[0].minZ]).toEqual([120, 3])
    expect(rects(p, 'asphalt')[0].maxZ - rects(p, 'asphalt')[0].minZ).toBe(13)
  })

  it('gives every surface a stable geometry ID and the edges it serves', () => {
    const p = plan([road('way/1', [[-60, 0], [0, 0], [60, 0]]), road('way/2', [[0, -60], [0, 0], [0, 60]])])
    expect(p.surfaces.every((s) => /^(asphalt|dirt|sidewalk)-[0-9a-f]{8}$/.test(s.id))).toBe(true)
    const run = p.surfaces.find((s) => s.kind === 'asphalt' && s.rect.maxX - s.rect.minX === 120)!
    expect(run.edges).toEqual(['road-way-1-e1', 'road-way-1-e2'])
    expect(plan([road('way/1', [[-60, 0], [0, 0], [60, 0]]), road('way/2', [[0, -60], [0, 0], [0, 60]])]).surfaces).toEqual(p.surfaces)
  })
})
