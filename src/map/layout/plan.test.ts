import { describe, expect, it } from 'vitest'
import { loadWorld } from '../content'
import { documentFiles, type MapDocument } from '../editor/document'
import { exportPack, parsePack } from '../editor/pack'
import { checkWorldDocuments } from '../validate'
import { pointInOutline } from '../polygon'
import { GameRuntime } from '../../game/core/runtime'
import { roadDetails } from '../../game/rendering/staticBatchData'
import { roadSurface } from '../../game/rendering/surfaces/surfaceRules'
import { sourceToWorld } from './coordinates'
import { distanceToPolyline } from './geometry'
import { checkWorldLayout, importGeoJsonLayout, parseWorldLayout, serializeWorldLayout } from './importer'
import { buildLayoutWorld, SURFACE_STYLE } from './layoutWorld'
import { parcelRect } from './parcels'
import { LayoutPlanError, planLayout, replan } from './plan'
import { rectsOverlap } from './rects'
import type { LayoutParcel, LayoutPlan, WorldLayout } from './schema'
import { area, gridStreets, imp, rect, road } from './testUtils'
import FIXTURE from '../../test/fixtures/layouts/wg1-town.geojson?raw'

const town = () => importGeoJsonLayout(FIXTURE, { layoutId: 'wg1-town', name: 'WG1 town' })
const errors = (p: LayoutPlan) => p.issues.filter((i) => i.severity === 'error')

/** Independent checks of the plan invariants (not trusting the planner's own `checkPlan`). */
function assertInvariants(l: WorldLayout, p: LayoutPlan) {
  const rs = p.parcels.map(parcelRect)
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) expect(rectsOverlap(rs[i], rs[j]), `${p.parcels[i].id} × ${p.parcels[j].id}`).toBe(false)
  for (const [i, r] of rs.entries()) {
    for (const s of p.surfaces) expect(rectsOverlap(r, s.rect), `${p.parcels[i].id} on ${s.id}`).toBe(false)
    expect(r.minX >= p.area.minX && r.maxX <= p.area.maxX && r.minZ >= p.area.minZ && r.maxZ <= p.area.maxZ).toBe(true)
  }
  // Unbuildable land: no parcel centre in a water/no-build polygon or within a river/railway strip.
  const frame = l.normalized!.frame
  for (const q of p.parcels) {
    const r = parcelRect(q)
    const c = { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 }
    for (const x of l.restricted) {
      if (x.geometry.type === 'polygon') expect(pointInOutline(x.geometry.polygon.outer.map((v) => sourceToWorld(frame, v)), c.x, c.z), `${q.id} in ${x.id}`).toBe(false)
      else expect(distanceToPolyline(c, x.geometry.points.map((v) => sourceToWorld(frame, v))) > x.geometry.width / 2, `${q.id} on ${x.id}`).toBe(true)
    }
  }
  // Connectivity: every snapped edge lies on carriageway.
  const carriage = p.surfaces.filter((s) => s.kind !== 'sidewalk').map((s) => s.rect)
  const on = (x: number, z: number) => carriage.some((r) => x >= r.minX - 1e-6 && x <= r.maxX + 1e-6 && z >= r.minZ - 1e-6 && z <= r.maxZ + 1e-6)
  for (const e of l.normalized!.edges)
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1]
      const b = e.points[i]
      for (let t = 0; t <= 1; t += 0.05) expect(on(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t), e.id).toBe(true)
    }
  // Lots touch their street; buildable stays inside the parcel.
  for (const q of p.parcels) {
    const r = parcelRect(q)
    if (q.buildable) expect(q.buildable.minX >= r.minX && q.buildable.maxX <= r.maxX && q.buildable.minZ >= r.minZ && q.buildable.maxZ <= r.maxZ).toBe(true)
    if (q.kind !== 'lot') continue
    expect(q.access).not.toBeNull()
    const s = q.access!.side
    const mid = { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 }
    // Parcel edges sit on the 0.5 m grid, up to 0.5 m in from the street surfaces.
    const probe = s === 'N' ? { x: mid.x, z: r.minZ - 0.6 } : s === 'S' ? { x: mid.x, z: r.maxZ + 0.6 } : s === 'W' ? { x: r.minX - 0.6, z: mid.z } : { x: r.maxX + 0.6, z: mid.z }
    expect(p.surfaces.some((x) => probe.x >= x.rect.minX && probe.x <= x.rect.maxX && probe.z >= x.rect.minZ && probe.z <= x.rect.maxZ), `${q.id} off street`).toBe(true)
  }
}

describe('WG2 plan of the fixture town', () => {
  const l = town()
  const p = planLayout(l)

  it('plans streets, blocks and parcels without errors or warnings', () => {
    expect(p.issues.filter((i) => i.severity !== 'info')).toEqual([])
    expect(p.metrics.asphalt).toBeGreaterThan(10)
    expect(p.metrics.sidewalks).toBeGreaterThan(20)
    expect(p.metrics.blocks).toBeGreaterThanOrEqual(5)
    expect(p.metrics.lots).toBeGreaterThan(80)
  })

  it('keeps every invariant: disjoint, off streets and unbuildable land, connected, lots on a street', () => {
    assertInvariants(l, p)
  })

  it('labels parcels by land use and does not build on every parcel', () => {
    const zones = new Set(p.parcels.filter((q) => q.kind === 'lot').map((q) => q.zone))
    expect([...zones]).toEqual(expect.arrayContaining(['residential', 'commercial', 'public']))
    expect(p.parcels.some((q) => q.kind === 'open' && q.zone === 'empty')).toBe(true)
    expect(p.parcels.some((q) => q.kind === 'interior' && q.access === null)).toBe(true)
    expect(p.parcels.every((q) => q.locked === false && Number.isInteger(q.seed))).toBe(true)
  })

  it('never changes the layout', () => {
    const before = serializeWorldLayout(l)
    planLayout(l, { seed: 5 })
    expect(serializeWorldLayout(l)).toBe(before)
  })

  it('round-trips through the layout file with the plan', () => {
    const text = serializeWorldLayout({ ...l, plan: p })
    expect(checkWorldLayout(JSON.parse(text))).toEqual([])
    expect(parseWorldLayout(text).plan).toEqual(JSON.parse(JSON.stringify(p)))
    const broken = JSON.parse(text) as WorldLayout
    broken.plan!.parcels[1].id = broken.plan!.parcels[0].id
    broken.plan!.parcels[2].access = { ...broken.plan!.parcels[2].access!, edge: 'nope' }
    expect(checkWorldLayout(broken).map((i) => i.code)).toEqual(expect.arrayContaining(['duplicate-id', 'reference']))
  })
})

describe('WG2 determinism and regeneration', () => {
  const l = town()
  const p1 = planLayout(l)

  it('same layout and params → same plan; another seed only moves lot cuts', () => {
    expect(JSON.stringify(planLayout(l))).toBe(JSON.stringify(p1))
    const p2 = planLayout(l, { seed: 2 })
    expect(p2.surfaces).toEqual(p1.surfaces)
    expect(p2.blocks).toEqual(p1.blocks)
    expect(p2.parcels.map((q) => q.id)).not.toEqual(p1.parcels.map((q) => q.id))
    expect(errors(p2)).toEqual([])
  })

  it('keeps locked parcels exactly when regenerating with another seed', () => {
    const lots = p1.parcels.filter((q) => q.kind === 'lot')
    const locked = [lots[0], lots[Math.floor(lots.length / 2)], lots[lots.length - 1]].map((q) => ({ ...q, locked: true }))
    const lockedIds = new Set(locked.map((q) => q.id))
    const prev = { ...p1, parcels: p1.parcels.map((q) => (lockedIds.has(q.id) ? { ...q, locked: true } : q)) }
    const p2 = replan(l, prev, { seed: 7 })
    for (const q of locked) expect(p2.parcels.find((x) => x.id === q.id)).toEqual(q)
    expect(p2.blocks.map((b) => b.id)).toEqual(p1.blocks.map((b) => b.id))
    expect(errors(p2)).toEqual([])
    assertInvariants(l, p2)
    expect(p2.issues.find((i) => i.code === 'kept-parcels')?.ids).toHaveLength(3)
  })

  it('regenerates one block and leaves every other parcel as it was', () => {
    const target = p1.blocks.find((b) => p1.parcels.filter((q) => q.block === b.id && q.kind === 'lot').length > 5)!
    const p2 = replan(l, p1, { seed: 11 }, [target.id])
    const outside = (p: LayoutPlan) => p.parcels.filter((q) => q.block !== target.id).map((q) => JSON.stringify(q)).sort()
    expect(outside(p2)).toEqual(outside(p1))
    const inside = (p: LayoutPlan) => p.parcels.filter((q) => q.block === target.id).map((q) => q.id).sort()
    expect(inside(p2)).not.toEqual(inside(p1))
    assertInvariants(l, p2)
  })

  it('reports a kept parcel that now lies on a street instead of dropping it silently', () => {
    const street = p1.surfaces.find((s) => s.kind === 'asphalt')!.rect
    const bad: LayoutParcel = { ...p1.parcels[0], id: 'lot-bad', polygon: [{ x: street.minX, z: street.minZ }, { x: street.minX, z: street.minZ + 5 }, { x: street.minX + 5, z: street.minZ + 5 }, { x: street.minX + 5, z: street.minZ }], locked: true }
    const p2 = planLayout(l, {}, { keep: [bad] })
    expect(p2.issues.find((i) => i.code === 'kept-parcel-conflict')?.ids).toEqual(['lot-bad'])
    expect(p2.parcels.some((q) => q.id === 'lot-bad')).toBe(false)
  })
})

describe('WG2 lot profiles, access lanes, zones', () => {
  // A 200 × 160 m superblock split by one avenue: too deep for street lots alone.
  const big = [road('way/n', [[-100, 80], [0, 80], [100, 80]]), road('way/s', [[-100, -80], [0, -80], [100, -80]]), road('way/w', [[-100, -80], [-100, 80]]), road('way/e', [[100, -80], [100, 80]]), road('way/c', [[0, -80], [0, 80]], { highway: 'tertiary' }), area('way/lu', [rect(-130, -110, 130, 110)], { landuse: 'residential' })]
  const l = imp(big, { normalize: { alignment: 0 } })

  it('adds access lanes into deep blocks so lots reach a street, and joins them to streets', () => {
    const with_ = planLayout(l)
    const without = planLayout(l, { accessRoads: false })
    expect(with_.accessRoads.length).toBeGreaterThan(0)
    expect(without.accessRoads).toEqual([])
    expect(with_.metrics.interior).toBeLessThan(without.metrics.interior)
    const edges = new Set([...l.normalized!.edges.map((e) => e.id), ...with_.accessRoads.map((a) => a.id)])
    for (const a of with_.accessRoads) {
      expect(a.joins.every((j) => edges.has(j))).toBe(true)
      expect(a.points[0].x === a.points[1].x || a.points[0].z === a.points[1].z).toBe(true)
    }
    expect(errors(with_)).toEqual([])
    assertInvariants(l, with_)
    expect(with_.parcels.some((q) => q.access && q.access.edge.startsWith('access-'))).toBe(true)
  })

  it('cuts narrow deep tube-house lots with the vn-urban profile and wide pavements', () => {
    const p = planLayout(l, { profile: 'vn-urban' })
    const lots = p.parcels.filter((q) => q.kind === 'lot' && q.zone === 'residential')
    const fronts = lots.map((q) => q.access!.frontage).sort((a, b) => a - b)
    expect(fronts[Math.floor(fronts.length / 2)]).toBeGreaterThanOrEqual(4)
    expect(fronts[Math.floor(fronts.length / 2)]).toBeLessThanOrEqual(6)
    expect(fronts.every((f) => f >= 3 && f <= 8)).toBe(true)
    expect(lots.length).toBeGreaterThan(planLayout(l).parcels.filter((q) => q.kind === 'lot').length * 2)
    const walk = p.surfaces.find((s) => s.kind === 'sidewalk')!.rect
    expect(Math.min(walk.maxX - walk.minX, walk.maxZ - walk.minZ)).toBe(3)
    assertInvariants(l, p)
  })

  it('takes per-zone overrides and the default zone of a layout without land use', () => {
    const open = planLayout(l, { zones: { residential: { subdivide: false, frontage: [10, 40, 200], depth: [10, 40, 200] } }, accessRoads: false })
    expect(open.parcels.every((q) => q.kind !== 'lot')).toBe(true)
    const bare = imp(gridStreets(3, 60), { defaultZone: 'empty' })
    expect(planLayout(bare).parcels.every((q) => q.zone === 'empty' && q.kind !== 'lot')).toBe(true)
    const homes = imp(gridStreets(3, 60))
    expect(planLayout(homes).parcels.some((q) => q.kind === 'lot' && q.zone === 'residential')).toBe(true)
  })

  it('refuses a layout without a valid snapped network, an unknown profile or a bad seed', () => {
    expect(() => planLayout(imp(gridStreets(3, 60), { normalize: false }))).toThrow(LayoutPlanError)
    const invalid = imp([road('way/1', [[-50, 0], [50, 0]]), road('way/2', [[0, 30], [0, 1.4]])], { normalize: { alignment: 0, grid: 4 } })
    expect(() => planLayout(invalid)).toThrow(/không hợp lệ/)
    expect(() => planLayout(l, { profile: 'mars' })).toThrow(LayoutPlanError)
    expect(() => planLayout(l, { seed: 1.5 })).toThrow(LayoutPlanError)
  })

  it('plans a dense 500 × 500 m town quickly', () => {
    const dense = imp(gridStreets(21, 25, 31, 0.6))
    const t0 = performance.now()
    const p = planLayout(dense)
    expect(performance.now() - t0).toBeLessThan(3000)
    expect(errors(p)).toEqual([])
    expect(p.metrics.blocks).toBeGreaterThanOrEqual(400)
  })
})

describe('WG2 layout-only world (existing map content)', () => {
  const l = town()
  const p = planLayout(l)
  const doc: MapDocument = buildLayoutWorld(l, p, { worldId: 'wg2-town', name: 'WG2 town' })
  const files = new Map(documentFiles(doc))
  const roads = [...doc.chunks.values()].flatMap((c) => c.roads)

  it('is valid content: one road record per surface, no flickering overlaps', () => {
    const checked = checkWorldDocuments((path) => files.get(path))
    expect(checked.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(checked.issues.filter((i) => i.code === 'surface-overlap')).toEqual([])
    expect(roads).toHaveLength(p.surfaces.length)
    expect(doc.world.generator).toMatchObject({ name: 'world-layout', seed: 1, params: { layout: 'wg1-town', mode: 'layout-only', profile: 'default' } })
    expect(doc.world.prefabs).toEqual([])
  })

  it('maps surfaces to the colours the game reads as asphalt, dirt and concrete', () => {
    expect(roadSurface(SURFACE_STYLE.asphalt.color)).toBe('asphalt')
    expect(roadSurface(SURFACE_STYLE.dirt.color)).toBe('dirt')
    expect(roadSurface(SURFACE_STYLE.sidewalk.color)).toBe('concrete')
    expect(new Set(roads.map((r) => r.color))).toEqual(new Set([SURFACE_STYLE.asphalt.color, SURFACE_STYLE.sidewalk.color]))
  })

  it('round-trips through an editor content pack', () => {
    const opened = parsePack(exportPack(doc))
    expect(opened.ok).toBe(true)
  })

  it('loads and runs in the game: street paint and kerbs worked out, player on the street', () => {
    const map = loadWorld((path) => files.get(path)).map
    expect(map.roads).toHaveLength(p.surfaces.length)
    const details = roadDetails(map.roads)
    expect(details.some((d) => d.id?.includes('#paint-'))).toBe(true)
    expect(details.some((d) => d.id?.includes('#kerb-'))).toBe(true)
    const rt = new GameRuntime(map)
    const start = rt.player.position
    expect(map.roads.some((r) => Math.abs(start.x - r.position.x) <= r.size[0] / 2 && Math.abs(start.z - r.position.z) <= r.size[1] / 2 && roadSurface(r.color) === 'asphalt')).toBe(true)
    for (let i = 0; i < 300; i++) rt.tick(1 / 60)
    expect(Number.isFinite(rt.player.position.x)).toBe(true)
  })
})
