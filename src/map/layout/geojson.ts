import type { Rect, XZ } from '../schema.ts'
import { quantize } from '../transform.ts'
import { signedArea } from '../polygon.ts'
import { isGeoPoint, LocalTangentProjection, webMercatorToGeo } from './coordinates.ts'
import { byString, clipPolyline, clipRing, hashText, polylineLength } from './geometry.ts'
import {
  LAND_USE_ZONES,
  RESTRICTED_KINDS,
  ROAD_CLASSES,
  SOURCE_CRS,
  type GeoPoint,
  type Grade,
  type LandUseZone,
  type LayoutBuildingHint,
  type LayoutIssue,
  type LayoutParcelHint,
  type LayoutProjection,
  type LayoutRestricted,
  type LayoutRoad,
  type LayoutZoneArea,
  type Polygon,
  type RestrictedKind,
  type RoadClass,
  type Sidewalk,
  type SourceCrs,
  type SourceTag,
} from './schema.ts'

/**
 * ReferenceImporter for GeoJSON (world generator WG1): reads a FeatureCollection (overpass-turbo,
 * QGIS, geojson.io…), classifies features by their OSM tags or explicit `worldgen:*` properties,
 * projects them to local metres and clips them to an optional rectangle. Nothing is fetched.
 *
 * Tag mapping (first match wins): `worldgen:*` → highway/railway/waterway lines → water and other
 * unbuildable areas → building → landuse → amenity → leisure → natural. Unknown features are
 * counted per reason, never silently: see `docs/world-generator-wg1.md` §3.
 */

export class LayoutImportError extends Error {
  readonly issues: LayoutIssue[]
  constructor(message: string, issues: LayoutIssue[] = []) {
    super(message)
    this.issues = issues
  }
}

export interface GeoJsonReadOptions {
  /** `auto` (default): the file's `worldgen:crs` or legacy `crs` member, else WGS84 when every coordinate is in range. */
  crs?: 'auto' | SourceCrs
  /** Projection origin: lon/lat for geographic sources, source x/y for local metres. Default: centre of the data. */
  origin?: GeoPoint | { x: number; y: number }
  /** Keep only this rectangle (m) around the origin. */
  clip?: { width: number; depth: number }
}

export interface ReadFeatures {
  crs: SourceCrs
  projection: LayoutProjection
  clip: Rect | null
  /** Looks like OpenStreetMap data (IDs `way/…`, overpass copyright): the credit line is required. */
  osm: boolean
  features: number
  roads: LayoutRoad[]
  zones: LayoutZoneArea[]
  restricted: LayoutRestricted[]
  buildings: LayoutBuildingHint[]
  parcels: LayoutParcelHint[]
  /** Road ends cut by the clip rectangle (boundary nodes of the network). */
  cutEnds: Map<string, { start: boolean; end: boolean }>
  issues: LayoutIssue[]
}

type Tags = Record<string, string>
type Position = [number, number]
interface RawPart {
  sourceId: string | null
  tags: Tags
  type: 'line' | 'polygon' | 'point'
  lines: Position[][]
  part: number
}

const GEOMETRY_TYPES = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'])

// ---- Tag tables ----

interface RoadDefaults {
  class: RoadClass
  lanes: number
  sidewalk: Sidewalk
  oneway?: boolean
}

const HIGHWAYS: Record<string, RoadDefaults> = {
  motorway: { class: 'arterial', lanes: 4, sidewalk: 'none', oneway: true },
  trunk: { class: 'arterial', lanes: 4, sidewalk: 'none' },
  primary: { class: 'arterial', lanes: 2, sidewalk: 'both' },
  secondary: { class: 'collector', lanes: 2, sidewalk: 'both' },
  tertiary: { class: 'collector', lanes: 2, sidewalk: 'both' },
  motorway_link: { class: 'arterial', lanes: 1, sidewalk: 'none', oneway: true },
  trunk_link: { class: 'arterial', lanes: 1, sidewalk: 'none' },
  primary_link: { class: 'arterial', lanes: 1, sidewalk: 'both' },
  secondary_link: { class: 'collector', lanes: 1, sidewalk: 'both' },
  tertiary_link: { class: 'collector', lanes: 1, sidewalk: 'both' },
  residential: { class: 'local', lanes: 2, sidewalk: 'both' },
  unclassified: { class: 'local', lanes: 2, sidewalk: 'none' },
  road: { class: 'local', lanes: 2, sidewalk: 'none' },
  living_street: { class: 'local', lanes: 1, sidewalk: 'none' },
  service: { class: 'service', lanes: 1, sidewalk: 'none' },
  track: { class: 'track', lanes: 1, sidewalk: 'none' },
  pedestrian: { class: 'path', lanes: 1, sidewalk: 'none' },
  footway: { class: 'path', lanes: 1, sidewalk: 'none' },
  path: { class: 'path', lanes: 1, sidewalk: 'none' },
  cycleway: { class: 'path', lanes: 1, sidewalk: 'none' },
  steps: { class: 'path', lanes: 1, sidewalk: 'none' },
  bridleway: { class: 'path', lanes: 1, sidewalk: 'none' },
}

const CLASS_DEFAULTS: Record<RoadClass, RoadDefaults> = {
  arterial: HIGHWAYS.primary,
  collector: HIGHWAYS.secondary,
  local: HIGHWAYS.residential,
  service: HIGHWAYS.service,
  track: HIGHWAYS.track,
  path: HIGHWAYS.path,
}

/** Lane width (m) per class; a 1-lane service road or track is never narrower than 3 m. */
const LANE_WIDTH: Record<RoadClass, number> = { arterial: 3.25, collector: 3.25, local: 3, service: 3.5, track: 3, path: 2 }

const UNPAVED = new Set(['unpaved', 'dirt', 'gravel', 'ground', 'grass', 'sand', 'earth', 'mud', 'compacted', 'fine_gravel', 'pebblestone'])

const WATERWAY_WIDTH: Record<string, number> = { river: 12, canal: 10, stream: 3, drain: 2, ditch: 1.5 }
const RAILWAY_WIDTH: Record<string, number> = { rail: 6, light_rail: 5, narrow_gauge: 4, tram: 3, monorail: 4, preserved: 5, disused: 5, subway: 5, funicular: 4 }

const WATER_AREAS: [string, string | null][] = [
  ['natural', 'water'],
  ['natural', 'bay'],
  ['water', null],
  ['waterway', 'riverbank'],
  ['waterway', 'dock'],
  ['landuse', 'reservoir'],
  ['landuse', 'basin'],
]
const NO_BUILD_AREAS: [string, string][] = [
  ['landuse', 'cemetery'],
  ['amenity', 'grave_yard'],
  ['landuse', 'military'],
  ['landuse', 'landfill'],
  ['landuse', 'quarry'],
  ['aeroway', 'aerodrome'],
  ['aeroway', 'runway'],
  ['aeroway', 'apron'],
  ['natural', 'wetland'],
  ['natural', 'beach'],
  ['natural', 'bare_rock'],
  ['natural', 'scree'],
]

const ZONE_TAGS: Record<string, Record<string, LandUseZone>> = {
  landuse: {
    residential: 'residential',
    commercial: 'commercial',
    retail: 'commercial',
    industrial: 'industrial',
    garages: 'industrial',
    depot: 'industrial',
    port: 'industrial',
    railway: 'industrial',
    education: 'public',
    religious: 'public',
    institutional: 'public',
    civic: 'public',
    forest: 'forest',
    farmland: 'farmland',
    farmyard: 'farmland',
    meadow: 'farmland',
    orchard: 'farmland',
    vineyard: 'farmland',
    allotments: 'farmland',
    plant_nursery: 'farmland',
    greenhouse_horticulture: 'farmland',
    grass: 'empty',
    greenfield: 'empty',
    brownfield: 'empty',
    construction: 'empty',
    village_green: 'empty',
    recreation_ground: 'empty',
    flowerbed: 'empty',
  },
  amenity: {
    marketplace: 'commercial',
    school: 'public',
    college: 'public',
    university: 'public',
    kindergarten: 'public',
    hospital: 'public',
    clinic: 'public',
    place_of_worship: 'public',
    townhall: 'public',
    police: 'public',
    fire_station: 'public',
    library: 'public',
    community_centre: 'public',
    courthouse: 'public',
    prison: 'public',
    parking: 'empty',
  },
  leisure: { park: 'empty', garden: 'empty', pitch: 'empty', playground: 'empty', common: 'empty', dog_park: 'empty', recreation_ground: 'empty' },
  natural: { wood: 'forest', scrub: 'forest', heath: 'forest', grassland: 'empty' },
  man_made: { works: 'industrial' },
}
const ZONE_KEYS = ['landuse', 'amenity', 'leisure', 'natural', 'man_made'] as const

type Classified =
  | { cat: 'road'; tag: SourceTag; defaults: RoadDefaults }
  | { cat: 'restricted'; tag: SourceTag; kind: RestrictedKind; width?: number }
  | { cat: 'zone'; tag: SourceTag; zone: LandUseZone }
  | { cat: 'building'; tag: SourceTag }
  | { cat: 'parcel'; tag: SourceTag; zone?: LandUseZone }
  | { cat: 'ignore'; reason: string }

const isOn = (v: string | undefined) => v !== undefined && v !== 'no' && v !== 'false' && v !== '0'

function classify(t: Tags, type: RawPart['type']): Classified {
  const line = type === 'line'
  const area = type === 'polygon'
  if (type === 'point') return { cat: 'ignore', reason: 'point' }
  if (isOn(t['worldgen:ignore'])) return { cat: 'ignore', reason: 'worldgen:ignore' }
  const wgRoad = t['worldgen:road']
  if (wgRoad !== undefined) {
    if (!(ROAD_CLASSES as readonly string[]).includes(wgRoad)) return { cat: 'ignore', reason: `worldgen:road=${wgRoad} không hợp lệ` }
    return line ? { cat: 'road', tag: { key: 'worldgen:road', value: wgRoad }, defaults: CLASS_DEFAULTS[wgRoad as RoadClass] } : { cat: 'ignore', reason: 'worldgen:road không phải đường' }
  }
  const wgRestricted = t['worldgen:restricted']
  if (wgRestricted !== undefined) {
    if (!(RESTRICTED_KINDS as readonly string[]).includes(wgRestricted)) return { cat: 'ignore', reason: `worldgen:restricted=${wgRestricted} không hợp lệ` }
    return { cat: 'restricted', tag: { key: 'worldgen:restricted', value: wgRestricted }, kind: wgRestricted as RestrictedKind }
  }
  const wgParcel = t['worldgen:parcel']
  if (wgParcel !== undefined) {
    if (!area) return { cat: 'ignore', reason: 'worldgen:parcel không phải vùng' }
    const zone = (LAND_USE_ZONES as readonly string[]).includes(wgParcel) ? (wgParcel as LandUseZone) : undefined
    return { cat: 'parcel', tag: { key: 'worldgen:parcel', value: wgParcel }, zone }
  }
  const wgZone = t['worldgen:zone']
  if (wgZone !== undefined) {
    if (!(LAND_USE_ZONES as readonly string[]).includes(wgZone)) return { cat: 'ignore', reason: `worldgen:zone=${wgZone} không hợp lệ` }
    return area ? { cat: 'zone', tag: { key: 'worldgen:zone', value: wgZone }, zone: wgZone as LandUseZone } : { cat: 'ignore', reason: 'worldgen:zone không phải vùng' }
  }

  const highway = t.highway
  if (highway !== undefined) {
    if (!line) return { cat: 'ignore', reason: 'highway dạng vùng' }
    const d = HIGHWAYS[highway]
    return d ? { cat: 'road', tag: { key: 'highway', value: highway }, defaults: d } : { cat: 'ignore', reason: `highway=${highway}` }
  }
  const railway = t.railway
  if (railway !== undefined && line) {
    if (isOn(t.tunnel)) return { cat: 'ignore', reason: 'đường sắt ngầm' }
    const w = RAILWAY_WIDTH[railway]
    return w ? { cat: 'restricted', tag: { key: 'railway', value: railway }, kind: 'railway', width: w } : { cat: 'ignore', reason: `railway=${railway}` }
  }
  const waterway = t.waterway
  if (waterway !== undefined && line) {
    if (isOn(t.tunnel)) return { cat: 'ignore', reason: 'kênh ngầm' }
    const w = WATERWAY_WIDTH[waterway]
    return w ? { cat: 'restricted', tag: { key: 'waterway', value: waterway }, kind: 'water', width: w } : { cat: 'ignore', reason: `waterway=${waterway}` }
  }
  if (!area) return { cat: 'ignore', reason: 'đường không có tag hỗ trợ' }

  for (const [key, value] of WATER_AREAS) {
    if (t[key] !== undefined && (value === null || t[key] === value)) return { cat: 'restricted', tag: { key, value: t[key] }, kind: 'water' }
  }
  for (const [key, value] of NO_BUILD_AREAS) {
    if (t[key] === value) return { cat: 'restricted', tag: { key, value }, kind: 'no-build' }
  }
  if (isOn(t.building)) return { cat: 'building', tag: { key: 'building', value: t.building } }
  for (const key of ZONE_KEYS) {
    const value = t[key]
    const zone = value !== undefined ? ZONE_TAGS[key][value] : undefined
    if (zone) return { cat: 'zone', tag: { key, value }, zone }
  }
  return { cat: 'ignore', reason: 'vùng không có tag hỗ trợ' }
}

// ---- Parsing ----

function tagsOf(props: unknown): Tags {
  const out: Tags = {}
  if (!props || typeof props !== 'object') return out
  const add = (o: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(o)) {
      if (v === null || v === undefined || typeof v === 'object') continue
      out[k] = String(v)
    }
  }
  const p = props as Record<string, unknown>
  // osmtogeojson (older) nests tags under `tags`.
  if (p.tags && typeof p.tags === 'object') add(p.tags as Record<string, unknown>)
  add(p)
  return out
}

function sourceIdOf(feature: Record<string, unknown>, tags: Tags): string | null {
  const raw = feature.id ?? tags['@id'] ?? tags.id
  if (raw === undefined || raw === null || raw === '') return null
  return String(raw)
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isPosition(p: unknown): p is Position {
  return Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && Number.isFinite(p[0]) && Number.isFinite(p[1])
}

function collectParts(geometry: unknown, sourceId: string | null, tags: Tags, out: RawPart[], issues: LayoutIssue[], counter: { part: number }): void {
  if (!geometry || typeof geometry !== 'object') {
    issues.push({ severity: 'warning', code: 'invalid-geometry', message: `feature ${sourceId ?? '(không ID)'}: thiếu geometry`, ids: sourceId ? [sourceId] : undefined })
    return
  }
  const g = geometry as { type?: string; coordinates?: unknown; geometries?: unknown }
  const bad = () => issues.push({ severity: 'warning', code: 'invalid-geometry', message: `feature ${sourceId ?? '(không ID)'}: tọa độ ${g.type} không hợp lệ, bỏ qua`, ids: sourceId ? [sourceId] : undefined })
  const lineOk = (l: unknown): l is Position[] => Array.isArray(l) && l.every(isPosition)
  switch (g.type) {
    case 'Point':
    case 'MultiPoint':
      out.push({ sourceId, tags, type: 'point', lines: [], part: counter.part++ })
      return
    case 'LineString':
      if (!lineOk(g.coordinates)) return void bad()
      out.push({ sourceId, tags, type: 'line', lines: [g.coordinates], part: counter.part++ })
      return
    case 'MultiLineString':
      if (!Array.isArray(g.coordinates) || !g.coordinates.every(lineOk)) return void bad()
      for (const l of g.coordinates as Position[][]) out.push({ sourceId, tags, type: 'line', lines: [l], part: counter.part++ })
      return
    case 'Polygon':
      if (!Array.isArray(g.coordinates) || !g.coordinates.every(lineOk)) return void bad()
      out.push({ sourceId, tags, type: 'polygon', lines: g.coordinates as Position[][], part: counter.part++ })
      return
    case 'MultiPolygon':
      if (!Array.isArray(g.coordinates) || !g.coordinates.every((p) => Array.isArray(p) && p.every(lineOk))) return void bad()
      for (const p of g.coordinates as Position[][][]) out.push({ sourceId, tags, type: 'polygon', lines: p, part: counter.part++ })
      return
    case 'GeometryCollection':
      if (!Array.isArray(g.geometries)) return void bad()
      for (const sub of g.geometries) collectParts(sub, sourceId, tags, out, issues, counter)
      return
    default:
      bad()
  }
}

function rootFeatures(input: unknown): { features: Record<string, unknown>[]; root: Record<string, unknown> } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new LayoutImportError('GeoJSON phải là một object')
  const root = input as Record<string, unknown>
  if (root.type === 'FeatureCollection') {
    if (!Array.isArray(root.features)) throw new LayoutImportError('FeatureCollection thiếu mảng features')
    return { features: root.features.filter((f): f is Record<string, unknown> => !!f && typeof f === 'object'), root }
  }
  if (root.type === 'Feature') return { features: [root], root }
  if (typeof root.type === 'string' && GEOMETRY_TYPES.has(root.type)) return { features: [{ type: 'Feature', properties: {}, geometry: root }], root }
  throw new LayoutImportError(`không phải GeoJSON (type = ${JSON.stringify(root.type)})`)
}

function declaredCrs(root: Record<string, unknown>): SourceCrs | null {
  const own = root['worldgen:crs']
  if (typeof own === 'string') {
    if (!(SOURCE_CRS as readonly string[]).includes(own)) throw new LayoutImportError(`worldgen:crs = ${own} không hỗ trợ (${SOURCE_CRS.join(', ')})`)
    return own as SourceCrs
  }
  const legacy = (root.crs as { properties?: { name?: unknown } } | undefined)?.properties?.name
  if (typeof legacy === 'string') {
    if (/3857|900913|3785/.test(legacy)) return 'web-mercator'
    if (/4326|CRS84/i.test(legacy)) return 'wgs84'
    throw new LayoutImportError(`hệ tọa độ ${legacy} không hỗ trợ: xuất lại GeoJSON ở WGS84 (EPSG:4326)`)
  }
  return null
}

function ringOf(points: XZ[]): XZ[] {
  const out: XZ[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (!last || last.x !== p.x || last.z !== p.z) out.push(p)
  }
  if (out.length > 1 && out[0].x === out[out.length - 1].x && out[0].z === out[out.length - 1].z) out.pop()
  return out
}

function oriented(ring: XZ[], ccw: boolean): XZ[] {
  return (signedArea(ring) > 0) === ccw ? ring : [...ring].reverse()
}

function parseLength(v: string | undefined): number | null {
  if (v === undefined) return null
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(m|ft|')?/i.exec(v)
  if (!m) return null
  const n = Number(m[1].replace(',', '.'))
  return m[2] && /ft|'/i.test(m[2]) ? n * 0.3048 : n
}

function sidewalkOf(t: Tags, fallback: Sidewalk): Sidewalk {
  const v = t.sidewalk ?? (isOn(t['sidewalk:both']) ? 'both' : undefined)
  if (v === undefined) {
    const l = isOn(t['sidewalk:left'])
    const r = isOn(t['sidewalk:right'])
    return l && r ? 'both' : l ? 'left' : r ? 'right' : fallback
  }
  if (v === 'both' || v === 'yes') return 'both'
  if (v === 'left' || v === 'right') return v
  return 'none'
}

/** Read and classify a GeoJSON document into source-frame layout features. */
export function readGeoJson(input: unknown, opts: GeoJsonReadOptions = {}): ReadFeatures {
  const { features, root } = rootFeatures(input)
  const issues: LayoutIssue[] = []
  const parts: RawPart[] = []
  for (const f of features) {
    const tags = tagsOf(f.properties)
    collectParts(f.geometry, sourceIdOf(f, tags), tags, parts, issues, { part: 0 })
  }

  // CRS and projection.
  let crs: SourceCrs
  const declared = opts.crs && opts.crs !== 'auto' ? opts.crs : declaredCrs(root)
  const coords = parts.flatMap((p) => p.lines.flat())
  if (declared) crs = declared
  else if (coords.every((c) => Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90)) crs = 'wgs84'
  else throw new LayoutImportError('tọa độ ngoài phạm vi lon/lat: khai báo crs (web-mercator hoặc local-metres) bằng tùy chọn hoặc thuộc tính "worldgen:crs"')

  let project: (c: Position) => XZ
  let projection: ReadFeatures['projection']
  if (crs === 'local-metres') {
    const o = opts.origin && 'x' in opts.origin ? opts.origin : centreOf(coords, 1)
    projection = { method: 'local-metres', origin: { x: o.x, y: o.y } }
    project = (c) => ({ x: quantize(c[0] - o.x), z: quantize(-(c[1] - o.y)) })
  } else {
    const toGeo = crs === 'web-mercator' ? (c: Position): GeoPoint => webMercatorToGeo(c[0], c[1]) : (c: Position): GeoPoint => ({ lon: c[0], lat: c[1] })
    const geo = coords.map(toGeo)
    if (geo.some((g) => !isGeoPoint(g))) throw new LayoutImportError('tọa độ ngoài phạm vi lon/lat')
    let origin: GeoPoint
    if (opts.origin && 'lon' in opts.origin) origin = opts.origin
    else {
      const c = centreOf(geo.map((g) => [g.lon, g.lat] as Position), 1e-7)
      origin = { lon: c.x, lat: c.y }
    }
    const ltp = new LocalTangentProjection(origin)
    projection = { method: 'local-tangent-plane', ellipsoid: 'WGS84', origin: ltp.origin }
    project = (c) => {
      const p = ltp.toLocal(toGeo(c))
      return { x: quantize(p.x), z: quantize(p.z) }
    }
  }
  const clip: Rect | null = opts.clip ? { minX: -opts.clip.width / 2, minZ: -opts.clip.depth / 2, maxX: opts.clip.width / 2, maxZ: opts.clip.depth / 2 } : null

  const osm = parts.some((p) => p.sourceId !== null && /^(node|way|relation)\//.test(p.sourceId)) || (typeof root.copyright === 'string' && /openstreetmap/i.test(root.copyright))

  const roads: LayoutRoad[] = []
  const zones: LayoutZoneArea[] = []
  const restricted: LayoutRestricted[] = []
  const buildings: LayoutBuildingHint[] = []
  const parcels: LayoutParcelHint[] = []
  const cutEnds = new Map<string, { start: boolean; end: boolean }>()
  const ignored = new Map<string, string[]>()
  const ignore = (reason: string, id: string | null) => {
    const list = ignored.get(reason) ?? []
    list.push(id ?? '(không ID)')
    ignored.set(reason, list)
  }
  const multiPart = new Map<string, number>()
  for (const p of parts) if (p.sourceId) multiPart.set(p.sourceId, (multiPart.get(p.sourceId) ?? 0) + 1)

  for (const p of parts) {
    let c = classify(p.tags, p.type)
    // A closed line with an area tag is an area (some exporters keep closed ways as LineString).
    if (c.cat === 'ignore' && p.type === 'line' && p.lines[0].length >= 4) {
      const l = p.lines[0]
      if (l[0][0] === l[l.length - 1][0] && l[0][1] === l[l.length - 1][1]) {
        const asArea = classify(p.tags, 'polygon')
        if (asArea.cat !== 'ignore' && asArea.cat !== 'road') {
          c = asArea
          p.type = 'polygon'
        }
      }
    }
    if (c.cat === 'ignore') {
      ignore(c.reason, p.sourceId)
      continue
    }
    const baseId = (prefix: string) => {
      const core = p.sourceId ? slug(p.sourceId) || `h${hashText(p.sourceId).slice(0, 10)}` : `h${hashText(JSON.stringify([p.lines, Object.entries(p.tags).sort(([a], [b]) => byString(a, b))])).slice(0, 10)}`
      const many = p.sourceId !== null && (multiPart.get(p.sourceId) ?? 0) > 1
      return `${prefix}-${core}${many && p.part > 0 ? `-${p.part + 1}` : ''}`
    }
    const common = { sourceId: p.sourceId ?? undefined, name: p.tags.name }

    if (p.type === 'line') {
      const pts = ringOfLine(p.lines[0].map(project))
      if (pts.length < 2 || polylineLength(pts) < 1e-6) {
        ignore('đường suy biến', p.sourceId)
        continue
      }
      const pieces = clip ? clipPolyline(pts, clip) : [{ points: pts, cutStart: false, cutEnd: false }]
      if (!pieces.length) {
        ignore('nằm ngoài vùng cắt', p.sourceId)
        continue
      }
      pieces.forEach((piece, k) => {
        const id = `${baseId(c.cat === 'road' ? 'road' : 'restricted')}${pieces.length > 1 && k > 0 ? `-p${k + 1}` : ''}`
        if (c.cat === 'road') {
          roads.push(roadOf(id, common, p.tags, c.defaults, piece.points))
          if (piece.cutStart || piece.cutEnd) cutEnds.set(id, { start: piece.cutStart, end: piece.cutEnd })
        } else if (c.cat === 'restricted') {
          const width = parseLength(p.tags.width) ?? c.width ?? 4
          restricted.push({ id, ...common, tag: c.tag, kind: c.kind, geometry: { type: 'line', points: piece.points, width } })
        } else ignore('không phải đường', p.sourceId)
      })
      continue
    }

    // Polygon: outer ring + holes, clipped, oriented.
    const rings = p.lines.map((l) => ringOf(l.map(project)))
    let outer = rings[0] ?? []
    let holes = rings.slice(1)
    if (clip) {
      outer = ringOf(clipRing(outer, clip))
      holes = holes.map((h) => ringOf(clipRing(h, clip)))
    }
    if (outer.length < 3 || Math.abs(signedArea(outer)) < 0.01) {
      ignore(clip && rings[0] && rings[0].length >= 3 ? 'nằm ngoài vùng cắt' : 'vùng suy biến', p.sourceId)
      continue
    }
    const polygon: Polygon = {
      outer: oriented(outer, true),
      holes: holes.filter((h) => h.length >= 3 && Math.abs(signedArea(h)) >= 0.01).map((h) => oriented(h, false)),
    }
    if (c.cat === 'zone') zones.push({ id: baseId('landuse'), ...common, tag: c.tag, zone: c.zone, polygon })
    else if (c.cat === 'restricted') restricted.push({ id: baseId('restricted'), ...common, tag: c.tag, kind: c.kind, geometry: { type: 'polygon', polygon } })
    else if (c.cat === 'building') buildings.push({ id: baseId('building'), ...common, tag: c.tag, polygon })
    else if (c.cat === 'parcel') parcels.push({ id: baseId('parcel'), ...common, tag: c.tag, zone: c.zone, polygon })
    else ignore('không phải vùng', p.sourceId)
  }

  for (const [reason, ids] of [...ignored].sort(([a], [b]) => byString(a, b))) {
    ids.sort(byString)
    const sample = ids.slice(0, 5)
    issues.push({ severity: 'info', code: 'ignored-feature', message: `bỏ qua ${ids.length} feature: ${reason}${ids.length > 5 ? ` (vd. ${sample.join(', ')})` : ` (${sample.join(', ')})`}`, ids: sample })
  }

  const dedupe = <T extends { id: string }>(list: T[], what: string): T[] => {
    const sorted = [...list].sort((a, b) => byString(a.id, b.id) || byString(JSON.stringify(a), JSON.stringify(b)))
    const seen = new Map<string, number>()
    for (const item of sorted) {
      const n = (seen.get(item.id) ?? 0) + 1
      seen.set(item.id, n)
      if (n > 1) {
        issues.push({ severity: 'warning', code: 'duplicate-feature', message: `${what} ${item.id} xuất hiện ${n} lần; bản sau đổi thành ${item.id}-dup${n}`, ids: [item.id] })
        const old = item.id
        item.id = `${item.id}-dup${n}`
        const ends = cutEnds.get(old)
        if (ends && what === 'đường') cutEnds.set(item.id, ends)
      }
    }
    return sorted.sort((a, b) => byString(a.id, b.id))
  }

  return {
    crs,
    projection,
    clip,
    osm,
    features: features.length,
    roads: dedupe(roads, 'đường'),
    zones: dedupe(zones, 'vùng'),
    restricted: dedupe(restricted, 'vùng cấm'),
    buildings: dedupe(buildings, 'nhà'),
    parcels: dedupe(parcels, 'lô'),
    cutEnds,
    issues,
  }
}

function ringOfLine(points: XZ[]): XZ[] {
  const out: XZ[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (!last || last.x !== p.x || last.z !== p.z) out.push(p)
  }
  return out
}

function centreOf(coords: Position[], step: number): { x: number; y: number } {
  if (!coords.length) return { x: 0, y: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of coords) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  const r = (v: number) => Math.round(v / step) * step
  return { x: quantize(r((minX + maxX) / 2)), y: quantize(r((minY + maxY) / 2)) }
}

function roadOf(id: string, common: { sourceId?: string; name?: string }, t: Tags, d: RoadDefaults, points: XZ[]): LayoutRoad {
  const lanes = (() => {
    const n = Number.parseInt(t.lanes ?? '', 10)
    return Number.isFinite(n) && n >= 1 && n <= 12 ? n : d.lanes
  })()
  const tagged = parseLength(t.width)
  const width = tagged !== null && tagged >= 2 && tagged <= 60 ? tagged : Math.max(d.class === 'path' ? 2 : 3, lanes * LANE_WIDTH[d.class])
  const bridge = isOn(t.bridge)
  const tunnel = isOn(t.tunnel) && t.tunnel !== 'building_passage'
  const grade: Grade = bridge ? 'bridge' : tunnel ? 'tunnel' : 'ground'
  const layerTag = Number.parseInt(t.layer ?? '', 10)
  const layer = Number.isFinite(layerTag) ? layerTag : bridge ? 1 : tunnel ? -1 : 0
  const oneway = t.oneway !== undefined ? ['yes', 'true', '1', '-1'].includes(t.oneway) : d.oneway === true
  const surface = UNPAVED.has(t.surface ?? '') || (d.class === 'track' && t.surface === undefined) ? 'unpaved' : 'paved'
  return {
    id,
    sourceId: common.sourceId,
    name: common.name,
    tag: { key: t['worldgen:road'] !== undefined ? 'worldgen:road' : 'highway', value: t['worldgen:road'] ?? t.highway },
    class: d.class,
    lanes,
    width: quantize(width),
    sidewalk: sidewalkOf(t, d.sidewalk),
    oneway,
    grade,
    layer,
    surface,
    points,
    network: d.class !== 'path',
  }
}
