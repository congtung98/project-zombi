import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, REGISTERED_LOOT_TABLES } from '../content'
import { moveRecords } from '../editor/commands'
import { findRecord, type MapDocument } from '../editor/document'
import { documentReference, layoutWorldFromGeoJson, libraryCatalog, reimportLayout, tracingGeoJson, withReference } from '../editor/generator'
import { exportPack, parsePack, validateDocument } from '../editor/pack'
import { importGeoJsonLayout } from './importer'
import { parcelRect } from './parcels'
import {
  addArea,
  addRoad,
  calibrationError,
  checkReference,
  emptyTracing,
  featureAt,
  HAND_TRACING,
  markJunction,
  measureScale,
  metresPerPixel,
  metresToPixel,
  moveVertex,
  pixelToMetres,
  REFERENCE_FILE,
  referenceImage,
  referenceTransform,
  removeFeatures,
  ROAD_DEFAULTS,
  snapRoadPoint,
  type ReferenceTracing,
} from './reference'
import { documentLayout, generatorStatus, syncGenerated } from './worldSync'
import FIXTURE from '../../test/fixtures/layouts/wg1-town.geojson?raw'

/** WG6: reference image, calibration, hand tracing, extraction to the same WorldLayout, world updates from a changed reference. */

const catalog = libraryCatalog(bundledWorldFiles('prefab-library'))!
const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const image = referenceImage('khu-pho.png', 'image/png', PNG, 1000, 800)
const local = ROAD_DEFAULTS.local
const u = (u: number, v: number) => ({ u, v })

/** A "#" street grid traced on a 1000 × 800 px picture, calibrated at 0.4 m/px, plus a zone and a pond. */
function grid(): ReferenceTracing {
  let ref = emptyTracing(image)
  ref = measureScale(ref, u(0, 400), u(1000, 400), 400)
  for (const v of [200, 600]) ref = addRoad(ref, [u(100, v), u(900, v)], local).ref
  for (const x of [300, 700]) ref = addRoad(ref, [u(x, 100), u(x, 700)], local).ref
  ref = addArea(ref, [u(80, 80), u(920, 80), u(920, 720), u(80, 720)], { zone: 'residential' }).ref
  ref = addArea(ref, [u(420, 300), u(580, 300), u(580, 500), u(420, 500)], { restricted: 'water' }).ref
  return ref
}

describe('WG6 calibration', () => {
  it('defaults to 0.5 m/px centred on the origin; 1 m/px without a picture', () => {
    const t = referenceTransform(emptyTracing(image))
    expect(metresPerPixel(t)).toBe(0.5)
    expect(pixelToMetres(emptyTracing(image), u(500, 400))).toEqual({ x: 0, z: 0 })
    expect(metresPerPixel(referenceTransform(emptyTracing()))).toBe(1)
  })

  it('measures a scale: two picture points end up the given distance apart, position and direction kept', () => {
    const ref = measureScale(emptyTracing(image), u(100, 400), u(600, 400), 150)
    const a = pixelToMetres(ref, u(100, 400))
    const b = pixelToMetres(ref, u(600, 400))
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(150, 6)
    expect(a).toEqual(pixelToMetres(emptyTracing(image), u(100, 400)))
    expect(b.z).toBeCloseTo(a.z, 6)
    expect(metresPerPixel(referenceTransform(ref))).toBeCloseTo(0.3, 9)
  })

  it('fits control points: similarity with two (rotation and scale), affine with three, and goes back', () => {
    const rotated: ReferenceTracing = { ...emptyTracing(image), calibration: { method: 'similarity', points: [{ image: u(0, 0), world: { x: 0, z: 0 } }, { image: u(100, 0), world: { x: 0, z: -50 } }] } }
    expect(pixelToMetres(rotated, u(100, 0))).toEqual({ x: expect.closeTo(0, 9), z: expect.closeTo(-50, 9) })
    // Rotated 90°: right in the picture is north in the world, down in the picture is east.
    expect(pixelToMetres(rotated, u(0, 100)).x).toBeCloseTo(50, 9)
    const skew: ReferenceTracing = { ...emptyTracing(image), calibration: { method: 'affine', points: [{ image: u(0, 0), world: { x: 0, z: 0 } }, { image: u(100, 0), world: { x: 30, z: 0 } }, { image: u(0, 100), world: { x: 0, z: 60 } }] } }
    expect(pixelToMetres(skew, u(100, 100))).toEqual({ x: expect.closeTo(30, 9), z: expect.closeTo(60, 9) })
    expect(calibrationError(skew)!.max).toBeLessThan(1e-9)
    const back = metresToPixel(skew, pixelToMetres(skew, u(321, 654)))
    expect(back.u).toBeCloseTo(321, 6)
    expect(back.v).toBeCloseTo(654, 6)
  })
})

describe('WG6 hand tracing', () => {
  it('makes a junction wherever a new road crosses one (the importer never joins roads that only cross)', () => {
    const ref = grid()
    const roads = ref.features.filter((f) => f.kind === 'road')
    expect(roads).toHaveLength(4)
    // Each road has its two ends and two crossings.
    expect(roads.map((r) => r.points.length)).toEqual([4, 4, 4, 4])
    const layout = importGeoJsonLayout(tracingGeoJson(ref).text, { layoutId: 'trace', name: 'trace', origin: { x: 0, y: 0 } })
    expect(layout.network.nodes.filter((n) => n.kind === 'junction')).toHaveLength(4)
    expect(layout.issues.filter((i) => i.code === 'crossing-without-junction')).toEqual([])
    expect(layout.zones.map((z) => z.zone)).toEqual(['residential'])
    expect(layout.restricted.map((r) => r.kind)).toEqual(['water'])
    expect(layout.normalized!.valid).toBe(true)
  })

  it('snaps onto road vertices and onto roads (a T junction), and marks near misses as junctions', () => {
    let ref = addRoad(emptyTracing(), [u(0, 0), u(100, 0)], local).ref
    const onRoad = snapRoadPoint(ref, u(40, 1.5), 3)
    expect(onRoad.snapped).toBe(true)
    expect(onRoad.point).toEqual(u(40, 0))
    expect(onRoad.ref.features[0].points).toHaveLength(3)
    ref = addRoad(onRoad.ref, [onRoad.point, u(40, 60)], local).ref
    expect(snapRoadPoint(ref, u(99, 1), 3).point).toEqual(u(100, 0))
    // A road ending 2 m short of another: the junction mark joins them.
    ref = addRoad(ref, [u(70, 58), u(70, 2)], local).ref
    const marked = markJunction(ref, u(70, 1), 3)
    expect(marked.roads).toBe(2)
    const layout = importGeoJsonLayout(tracingGeoJson(marked.ref).text, { layoutId: 't', name: 't', origin: { x: 0, y: 0 }, joinTolerance: 0 })
    expect(layout.network.nodes.filter((n) => n.kind === 'junction')).toHaveLength(2)
  })

  it('edits: moving a junction vertex moves every road through it; delete; find by click', () => {
    const ref = grid()
    const road = ref.features[0]
    const j = road.points[1]
    const moved = moveVertex(ref, road.id, 1, u(j.u + 10, j.v + 5))
    const through = moved.features.filter((f) => f.kind === 'road' && f.points.some((p) => p.u === j.u + 10 && p.v === j.v + 5))
    expect(through).toHaveLength(2)
    expect(featureAt(ref, u(500, 201), 4)).toEqual({ id: road.id, vertex: null })
    expect(featureAt(ref, u(500, 400), 4)!.id).toBe(ref.features.find((f) => f.kind === 'restricted')!.id)
    expect(removeFeatures(ref, [road.id]).features).toHaveLength(ref.features.length - 1)
    expect(removeFeatures(ref, [road.id]).nextId).toBe(ref.nextId)
  })

  it('warns about an uncalibrated picture and refuses a tracing without roads', () => {
    expect(HAND_TRACING.extract(emptyTracing(image)).issues.map((i) => i.code)).toEqual(['trace-no-roads', 'trace-uncalibrated'])
    expect(HAND_TRACING.extract(grid()).issues).toEqual([])
  })

  it('checks a stored reference', () => {
    expect(checkReference(grid())).toEqual([])
    expect(checkReference({ ...grid(), features: [{ id: 'x', kind: 'road', points: [], road: { class: 'moon' } }] })[0].severity).toBe('error')
    expect(checkReference({ ...grid(), calibration: { method: 'affine', points: [{ image: u(0, 0), world: { x: 0, z: 0 } }, { image: u(0, 0), world: { x: 1, z: 0 } }] } })[0].code).toBe('calibration')
    expect(() => referenceImage('a.txt', 'text/plain', 'data:text/plain,hi', 1, 1)).toThrow()
  })
})

function tracedWorld(ref: ReferenceTracing): MapDocument {
  const { text } = tracingGeoJson(ref)
  const r = layoutWorldFromGeoJson({ worldId: 'wg6-trace', name: 'WG6', text, file: 'bản vẽ khu-pho.png', mode: 'full', seed: 1, profile: 'default', origin: { x: 0, y: 0 }, extras: [[REFERENCE_FILE, ref]] }, catalog, OPTS)
  if (!r.ok) throw new Error(r.error)
  return r.doc
}

describe('WG6 worlds from a tracing', () => {
  const ref = grid()
  const doc = tracedWorld(ref)

  it('becomes a valid FULL world that keeps its reference (picture, calibration, tracing)', () => {
    expect(validateDocument(doc, OPTS).filter((i) => i.severity === 'error')).toEqual([])
    expect([...doc.chunks.values()].reduce((n, c) => n + c.instances.length, 0)).toBeGreaterThan(10)
    expect(documentReference(doc).ref).toEqual(ref)
    const back = parsePack(exportPack(doc), OPTS)
    expect(back.ok && documentReference(back.doc).ref).toEqual(ref)
    // Calibrated at 0.4 m/px: a street traced 800 px long is 320 m long in the world.
    const edges = documentLayout(doc).layout!.normalized!.edges
    const total = (id: string) => edges.filter((e) => e.id.startsWith(`road-trace-${id}`)).reduce((n, e) => n + e.length, 0)
    expect(total('road-1')).toBeCloseTo(320, 0)
  })

  it('updates from a changed tracing: new street added, unchanged blocks identical, hand edits and locks kept', () => {
    const layout = documentLayout(doc).layout!
    const q = layout.plan!.parcels.filter((x) => x.build && x.build.prefabId !== null)
    const moved = q.find((x) => { const r = parcelRect(x); const b = (x.build as { footprint: { maxX: number } }).footprint; return r.maxX - b.maxX >= 0.5 })!
    const status = generatorStatus(doc, layout)
    const movedId = status.instances.get(moved.id)!
    let d = moveRecords(doc, [movedId], { x: 0.5, z: 0 })
    if (!d.ok) throw new Error(d.error)
    let edited = d.doc
    const locked = syncGenerated(edited, { kind: 'lock', ids: [q[q.length - 1].id], locked: true }, { catalog, validation: OPTS })
    if (!locked.ok) throw new Error(locked.error)
    edited = locked.doc
    // A service lane traced across the east of the grid.
    const next = addRoad(ref, [u(700, 400), u(900, 400)], ROAD_DEFAULTS.service).ref
    const updated = reimportLayout(layout, tracingGeoJson(next).text)
    expect(updated.normalized!.frame).toEqual(layout.normalized!.frame)
    const r = syncGenerated(withReference(edited, next), { kind: 'layout', layout: updated }, { catalog, validation: OPTS })
    if (!r.ok) throw new Error(r.error)
    expect(r.report.added).toBeGreaterThan(0)
    expect(findRecord(r.doc, movedId)!.record).toEqual(findRecord(edited, movedId)!.record)
    expect(documentLayout(r.doc).layout!.plan!.parcels.find((x) => x.id === q[q.length - 1].id)?.locked ?? true).toBe(true)
    // West of the new lane nothing moved: the same road records.
    const westRoads = (m: MapDocument) => [...m.chunks.values()].flatMap((c) => c.roads).filter((rd) => rd.roadId.startsWith('c-') ).map((rd) => JSON.stringify(rd)).sort()
    expect(westRoads(r.doc)).toEqual(westRoads(edited))
    expect(validateDocument(r.doc, OPTS).filter((i) => i.severity === 'error')).toEqual([])
    expect(documentReference(r.doc).ref).toEqual(next)
  })

  it('updates a GeoJSON world the same way (WG4 limit lifted): the fixture without one road', () => {
    const r = layoutWorldFromGeoJson({ worldId: 'wg6-geo', name: 'geo', text: FIXTURE, mode: 'full', seed: 1, profile: 'default' }, catalog, OPTS)
    if (!r.ok) throw new Error(r.error)
    const old = documentLayout(r.doc).layout!
    const data = JSON.parse(FIXTURE) as { features: { properties?: { name?: string } }[] }
    const fewer = { ...data, features: data.features.filter((f) => !/curve/i.test(f.properties?.name ?? '')) }
    const updated = reimportLayout(old, JSON.stringify(fewer))
    expect(updated.normalized!.frame).toEqual(old.normalized!.frame)
    const s = syncGenerated(r.doc, { kind: 'layout', layout: updated }, { catalog, validation: OPTS })
    if (!s.ok) throw new Error(s.error)
    expect(s.report.removed).toBeGreaterThan(0)
    expect(validateDocument(s.doc, OPTS).filter((i) => i.severity === 'error')).toEqual([])
  })
})
