import { describe, expect, it } from 'vitest'
import { signedArea } from '../polygon'
import { LayoutImportError, readGeoJson } from './geojson'
import { OSM_ATTRIBUTION } from './importer'
import { area, fc, imp, rect, road } from './testUtils'

const read = (features: object[], opts = {}) => readGeoJson(fc(features), { origin: { x: 0, y: 0 }, ...opts })

describe('WG1 GeoJSON import: roads', () => {
  it('reads OSM highway tags into class, lanes, width, sidewalks, grade', () => {
    const r = read([
      road('way/1', [[0, 0], [100, 0]], { highway: 'residential', name: 'Elm' }),
      road('way/2', [[0, 10], [100, 10]], { highway: 'primary', lanes: '4' }),
      road('way/3', [[0, 20], [100, 20]], { highway: 'service', width: '7.5 m' }),
      road('way/4', [[0, 30], [100, 30]], { highway: 'track' }),
      road('way/5', [[0, 40], [100, 40]], { highway: 'footway' }),
      road('way/6', [[0, 50], [100, 50]], { highway: 'tertiary', bridge: 'yes', oneway: 'yes', sidewalk: 'right', width: "20'" }),
      road('way/7', [[0, 60], [100, 60]], { highway: 'residential', tunnel: 'yes' }),
    ]).roads
    const by = new Map(r.map((x) => [x.id, x]))
    expect(by.get('road-way-1')).toMatchObject({ class: 'local', lanes: 2, width: 6, sidewalk: 'both', oneway: false, grade: 'ground', layer: 0, surface: 'paved', network: true, name: 'Elm', tag: { key: 'highway', value: 'residential' } })
    expect(by.get('road-way-2')).toMatchObject({ class: 'arterial', lanes: 4, width: 13 })
    expect(by.get('road-way-3')).toMatchObject({ class: 'service', lanes: 1, width: 7.5, sidewalk: 'none' })
    expect(by.get('road-way-4')).toMatchObject({ class: 'track', surface: 'unpaved' })
    expect(by.get('road-way-5')).toMatchObject({ class: 'path', network: false })
    expect(by.get('road-way-6')).toMatchObject({ grade: 'bridge', layer: 1, oneway: true, sidewalk: 'right' })
    expect(by.get('road-way-6')!.width).toBeCloseTo(6.096, 6)
    expect(by.get('road-way-7')).toMatchObject({ grade: 'tunnel', layer: -1 })
  })

  it('projects local metres with north on −Z and keeps the source geometry exactly', () => {
    const r = read([road('way/1', [[10, 20], [40, 20], [40, -5]])]).roads[0]
    expect(r.points).toEqual([{ x: 10, z: -20 }, { x: 40, z: -20 }, { x: 40, z: 5 }])
  })

  it('accepts explicit worldgen:road and rejects unknown values with a reported reason', () => {
    const r = read([road('a', [[0, 0], [10, 0]], { highway: undefined, 'worldgen:road': 'collector' }), road('b', [[0, 5], [10, 5]], { highway: undefined, 'worldgen:road': 'motorway' })])
    expect(r.roads.map((x) => [x.id, x.class])).toEqual([['road-a', 'collector']])
    expect(r.issues.some((i) => i.code === 'ignored-feature' && i.message.includes('worldgen:road=motorway'))).toBe(true)
  })
})

describe('WG1 GeoJSON import: areas, restricted land, hints', () => {
  const r = read([
    area('way/10', [rect(0, 0, 50, 50)], { landuse: 'retail' }),
    area('way/11', [rect(60, 0, 100, 50)], { amenity: 'school' }),
    area('way/12', [rect(60, 0, 70, 10)], { building: 'yes', amenity: 'school' }),
    area('way/13', [rect(0, 60, 50, 100), rect(10, 70, 20, 80)], { leisure: 'park' }),
    area('way/14', [rect(200, 0, 250, 50)], { natural: 'water' }),
    area('way/15', [rect(300, 0, 350, 50)], { landuse: 'cemetery' }),
    area('way/16', [rect(400, 0, 450, 50)], { landuse: 'forest' }),
    area('way/17', [rect(500, 0, 550, 50)], { 'worldgen:zone': 'industrial', landuse: 'residential' }),
    area('way/18', [rect(600, 0, 620, 30)], { 'worldgen:parcel': 'residential' }),
    road('way/20', [[-100, -100], [100, -100]], { highway: undefined, waterway: 'river' }),
    road('way/21', [[-100, -120], [100, -120]], { highway: undefined, railway: 'rail' }),
    road('way/22', [[-100, -140], [100, -140]], { highway: undefined, railway: 'subway', tunnel: 'yes' }),
    { type: 'Feature', id: 'node/1', properties: { amenity: 'cafe' }, geometry: { type: 'Point', coordinates: [5, 5] } },
    road('way/23', [[0, 200], [50, 200]], { highway: 'proposed' }),
  ])

  it('maps land use to generator zones (independent from zombie zones)', () => {
    expect(r.zones.map((z) => [z.id, z.zone, `${z.tag.key}=${z.tag.value}`])).toEqual([
      ['landuse-way-10', 'commercial', 'landuse=retail'],
      ['landuse-way-11', 'public', 'amenity=school'],
      ['landuse-way-13', 'empty', 'leisure=park'],
      ['landuse-way-16', 'forest', 'landuse=forest'],
      ['landuse-way-17', 'industrial', 'worldgen:zone=industrial'],
    ])
  })

  it('keeps water, railways and no-build land (never dropped, Q8)', () => {
    expect(r.restricted.map((x) => [x.id, x.kind, x.geometry.type, x.geometry.type === 'line' ? x.geometry.width : null])).toEqual([
      ['restricted-way-14', 'water', 'polygon', null],
      ['restricted-way-15', 'no-build', 'polygon', null],
      ['restricted-way-20', 'water', 'line', 12],
      ['restricted-way-21', 'railway', 'line', 6],
    ])
  })

  it('keeps buildings as hints and source parcels', () => {
    expect(r.buildings.map((b) => b.id)).toEqual(['building-way-12'])
    expect(r.parcels).toMatchObject([{ id: 'parcel-way-18', zone: 'residential' }])
  })

  it('normalises rings: no closing point, outer counter-clockwise, holes clockwise', () => {
    const park = r.zones.find((z) => z.id === 'landuse-way-13')!
    expect(park.polygon.outer).toHaveLength(4)
    expect(signedArea(park.polygon.outer)).toBeGreaterThan(0)
    expect(park.polygon.holes).toHaveLength(1)
    expect(signedArea(park.polygon.holes[0])).toBeLessThan(0)
  })

  it('reports every ignored feature by reason, with samples', () => {
    const ignored = r.issues.filter((i) => i.code === 'ignored-feature').map((i) => i.message)
    expect(ignored.some((m) => m.includes('point') && m.includes('node/1'))).toBe(true)
    expect(ignored.some((m) => m.includes('highway=proposed'))).toBe(true)
    expect(ignored.some((m) => m.includes('đường sắt ngầm'))).toBe(true)
  })
})

describe('WG1 GeoJSON import: IDs', () => {
  it('derives IDs from source IDs, parts and a content hash, independent of feature order', () => {
    const features = [
      road('way/123', [[0, 0], [10, 0]]),
      road(null, [[0, 10], [10, 10]]),
      { type: 'Feature', id: 'relation/9', properties: { highway: 'residential' }, geometry: { type: 'MultiLineString', coordinates: [[[0, 20], [10, 20]], [[0, 30], [10, 30]]] } },
    ]
    const a = read(features).roads.map((x) => x.id)
    const b = read([...features].reverse()).roads.map((x) => x.id)
    expect(a).toEqual(b)
    expect(a).toContain('road-way-123')
    expect(a).toContain('road-relation-9')
    expect(a).toContain('road-relation-9-2')
    expect(a.find((id) => /^road-h[0-9a-f]{10}$/.test(id))).toBeTruthy()
  })

  it('renames duplicates deterministically with a warning', () => {
    const r = read([road('way/1', [[0, 0], [10, 0]]), road('way/1', [[0, 5], [10, 5]])])
    expect(r.roads.map((x) => x.id)).toEqual(['road-way-1', 'road-way-1-dup2'])
    expect(r.issues.some((i) => i.code === 'duplicate-feature')).toBe(true)
  })
})

describe('WG1 GeoJSON import: CRS, clip, errors', () => {
  it('detects WGS84 and records a local tangent plane at the data centre', () => {
    const r = readGeoJson(fc([road('way/1', [[105.8, 21], [105.801, 21]])], null))
    expect(r.crs).toBe('wgs84')
    expect(r.projection).toEqual({ method: 'local-tangent-plane', ellipsoid: 'WGS84', origin: { lon: 105.8005, lat: 21 } })
    const pts = r.roads[0].points
    expect(pts[1].x - pts[0].x).toBeCloseTo(103.9, 0)
  })

  it('reads a legacy EPSG:3857 crs member, refuses unknown ones and out-of-range coordinates', () => {
    const merc = { type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3857' } }, features: [road('way/1', [[11777000, 2391000], [11777100, 2391000]])] }
    expect(readGeoJson(merc).crs).toBe('web-mercator')
    const other = { ...merc, crs: { type: 'name', properties: { name: 'EPSG:32648' } } }
    expect(() => readGeoJson(other)).toThrow(LayoutImportError)
    expect(() => readGeoJson(fc([road('way/1', [[500, 0], [600, 0]])], null))).toThrow(/local-metres/)
  })

  it('clips roads into pieces with boundary ends, and polygons to the rectangle', () => {
    const r = read([road('way/1', [[-100, 0], [100, 0]]), road('way/2', [[-100, 30], [-10, 30], [-10, 60], [100, 60]]), area('way/3', [rect(-100, -100, 100, 100)], { landuse: 'residential' }), road('way/4', [[500, 0], [600, 0]])], { clip: { width: 100, depth: 200 } })
    expect(r.roads.find((x) => x.id === 'road-way-1')!.points).toEqual([{ x: -50, z: 0 }, { x: 50, z: 0 }])
    expect(r.cutEnds.get('road-way-1')).toEqual({ start: true, end: true })
    expect(r.zones[0].polygon.outer.every((p) => Math.abs(p.x) <= 50 && Math.abs(p.z) <= 100)).toBe(true)
    expect(r.roads.some((x) => x.id === 'road-way-4')).toBe(false)
    expect(r.issues.some((i) => i.message.includes('nằm ngoài vùng cắt'))).toBe(true)
    // Leaves the rectangle at x = 50 and comes back: two pieces, cut at the boundary.
    const cut = read([road('way/5', [[-40, 0], [100, 0], [100, 10], [-40, 10]])], { clip: { width: 100, depth: 100 } })
    expect(cut.roads.map((x) => x.id)).toEqual(['road-way-5', 'road-way-5-p2'])
    expect(cut.cutEnds.get('road-way-5')).toEqual({ start: false, end: true })
    expect(cut.cutEnds.get('road-way-5-p2')).toEqual({ start: true, end: false })
  })

  it('rejects non-GeoJSON and warns about broken geometry', () => {
    expect(() => readGeoJson([])).toThrow(LayoutImportError)
    expect(() => readGeoJson({ type: 'Topology' })).toThrow(LayoutImportError)
    const r = read([{ type: 'Feature', id: 'way/1', properties: { highway: 'residential' }, geometry: { type: 'LineString', coordinates: [[0, 'x']] } }])
    expect(r.issues.some((i) => i.code === 'invalid-geometry')).toBe(true)
  })

  it('adds the OpenStreetMap credit for OSM-looking data (ODbL)', () => {
    expect(imp([road('way/1', [[0, 0], [100, 0]])]).source.attribution).toBe(OSM_ATTRIBUTION)
    expect(imp([road('street-1', [[0, 0], [100, 0]])]).source.attribution).toBeNull()
    expect(imp([road('way/1', [[0, 0], [100, 0]])], { attribution: 'Own survey' }).source.attribution).toBe('Own survey')
  })
})
