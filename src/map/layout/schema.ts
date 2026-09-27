import type { Rect, XZ } from '../schema.ts'

/**
 * WorldLayout (world generator WG1): the geographic layout a world is generated from, kept apart
 * from map content. The game never loads it; the importer writes it and later generator stages
 * (roads, parcels, prefabs) read it. Plain JSON, no Three.js objects, byte-stable for the same input.
 *
 * Two geometry layers, never mixed:
 * - **source** (`roads`, `network`, `zones`, `restricted`, `buildings`, `parcels`): the reference
 *   geometry as imported, projected to local metres (X east, Z south: north is −Z like the game's
 *   `world/boundary-n`). Kept exactly, whatever normalisation does, so a later method (diagonal or
 *   curved roads) can start again from it.
 * - **normalized**: the road network after a normalisation method (WG1: `orthogonal`, snapped to
 *   a 0°/90° grid) in world coordinates, with its frame, metrics and issues. Same node/edge IDs as the
 *   source network, so every snapped road traces back to its source.
 */

export const LAYOUT_FORMAT = 'zombie-outbreak/world-layout'
export const LAYOUT_FORMAT_VERSION = 1

/** Land use for the generator only (Q7): independent from the runtime `zombiePopulation` zones. */
export const LAND_USE_ZONES = ['residential', 'commercial', 'industrial', 'public', 'forest', 'farmland', 'empty'] as const
export type LandUseZone = (typeof LAND_USE_ZONES)[number]

/** Areas nothing may be built on (Q8). Kept in the layout even though phase 1 renders none of them. */
export const RESTRICTED_KINDS = ['water', 'railway', 'no-build'] as const
export type RestrictedKind = (typeof RESTRICTED_KINDS)[number]

export const ROAD_CLASSES = ['arterial', 'collector', 'local', 'service', 'track', 'path'] as const
export type RoadClass = (typeof ROAD_CLASSES)[number]

export const SIDEWALKS = ['both', 'left', 'right', 'none'] as const
export type Sidewalk = (typeof SIDEWALKS)[number]

export const GRADES = ['ground', 'bridge', 'tunnel'] as const
export type Grade = (typeof GRADES)[number]

export const SOURCE_CRS = ['wgs84', 'web-mercator', 'local-metres'] as const
export type SourceCrs = (typeof SOURCE_CRS)[number]

export interface GeoPoint {
  lon: number
  lat: number
}

/** The tag that decided a feature's class, e.g. `highway=residential` (kept so a mapping can change later). */
export interface SourceTag {
  key: string
  value: string
}

/** Outer ring and holes, open rings (no repeated closing point), outer counter-clockwise, holes clockwise. */
export interface Polygon {
  outer: XZ[]
  holes: XZ[][]
}

interface FeatureBase {
  /** Stable, slug: from the source ID (`road-way-123`) or a content hash when the source has none. */
  id: string
  /** Source reference, e.g. `way/123`. */
  sourceId?: string
  name?: string
  tag: SourceTag
}

export interface LayoutRoad extends FeatureBase {
  class: RoadClass
  lanes: number
  /** Carriageway width (m), sidewalks excluded. */
  width: number
  sidewalk: Sidewalk
  oneway: boolean
  grade: Grade
  /** OSM `layer` (0 = ground); roads on different layers cross without a junction. */
  layer: number
  surface: 'paved' | 'unpaved'
  /** Polyline in the source frame (≥ 2 points). */
  points: XZ[]
  /** Part of the road network that is normalised and generated (paths are kept but excluded by default). */
  network: boolean
}

export interface LayoutZoneArea extends FeatureBase {
  zone: LandUseZone
  polygon: Polygon
}

export type RestrictedGeometry = { type: 'polygon'; polygon: Polygon } | { type: 'line'; points: XZ[]; width: number }

export interface LayoutRestricted extends FeatureBase {
  kind: RestrictedKind
  geometry: RestrictedGeometry
}

/** A building of the reference: a hint only (the generator places prefabs, never copies buildings). */
export interface LayoutBuildingHint extends FeatureBase {
  polygon: Polygon
}

/** A parcel given by the source (optional; WG2 derives parcels from the blocks when there are none). */
export interface LayoutParcelHint extends FeatureBase {
  zone?: LandUseZone
  polygon: Polygon
}

export type NodeKind = 'junction' | 'joint' | 'end' | 'boundary'

export interface NetworkNode {
  id: string
  position: XZ
  /** junction: ≥ 3 edges; joint: 2 edges (road attributes change); end: dead end; boundary: cut by the clip. */
  kind: NodeKind
}

export interface NetworkEdge {
  /** `<roadId>-e<k>`, k counting pieces along the road. */
  id: string
  roadId: string
  from: string
  to: string
  /** Polyline from `from` to `to`, endpoints included. */
  points: XZ[]
}

/** Two edges whose geometry crosses where the source has no shared node. */
export interface NetworkCrossing {
  edges: [string, string]
  at: XZ
  /** grade-separated: bridge/tunnel/layer, legitimate; unjoined: same level, probably a missing node. */
  kind: 'grade-separated' | 'unjoined'
}

export interface RoadNetwork {
  nodes: NetworkNode[]
  edges: NetworkEdge[]
  crossings: NetworkCrossing[]
}

export type IssueSeverity = 'error' | 'warning' | 'info'

export interface LayoutIssue {
  severity: IssueSeverity
  code: string
  message: string
  ids?: string[]
  at?: XZ
}

/** world = rotate(source, rotationDeg) + offset. Rotation uses `rotateXZ`'s sense: 90° maps (x, z) to (z, −x). */
export interface GridFrame {
  rotationDeg: number
  offset: XZ
}

export interface OrthogonalParams {
  /** `auto`: rotate so the dominant street direction lies on the axes; or a fixed rotation in degrees. */
  alignment: 'auto' | number
  /** Grid step (m) every node and bend snaps to. */
  grid: number
  /** Douglas–Peucker tolerance (m) before snapping: removes wiggles and turns curves into a few segments. */
  simplify: number
  /** A segment within this many degrees of an axis becomes straight; steeper ones become a staircase. */
  axisTolerance: number
  /** Longest staircase step (m) for a diagonal segment. */
  stairStep: number
  /** Warn when a snapped edge departs from its source by more than this (m). */
  maxDeviation: number
  /** Warn when a snapped edge's length changes by more than this fraction. */
  maxLengthChange: number
}

export interface NormalizedEdge {
  id: string
  from: string
  to: string
  /** Axis-aligned polyline in world coordinates (every segment parallel to X or Z). */
  points: XZ[]
  /** Source length and snapped length (m), largest distance between the two polylines (m). */
  sourceLength: number
  length: number
  deviation: number
  /** Diagonal source segments turned into a staircase. */
  staircase: boolean
}

export interface NormalizedMetrics {
  nodes: number
  edges: number
  maxNodeShift: number
  meanNodeShift: number
  maxDeviation: number
  maxLengthChange: number
  staircaseEdges: number
}

export interface NormalizedNetwork {
  method: 'orthogonal'
  /** Bump when the output for the same source and params changes. */
  version: number
  params: OrthogonalParams
  frame: GridFrame
  /** Same IDs as `network.nodes`, positions in world coordinates. */
  nodes: { id: string; position: XZ }[]
  edges: NormalizedEdge[]
  /** World-frame bounds of the snapped network. */
  bounds: Rect
  metrics: NormalizedMetrics
  /** False when an issue is an error (merged nodes, false junction, overlap): later stages must refuse it. */
  valid: boolean
  issues: LayoutIssue[]
}

export type LayoutProjection =
  | { method: 'local-tangent-plane'; ellipsoid: 'WGS84'; origin: GeoPoint }
  /** Source already in metres (x east, y north): X = x − origin.x, Z = −(y − origin.y). */
  | { method: 'local-metres'; origin: { x: number; y: number } }

export interface WorldLayout {
  format: typeof LAYOUT_FORMAT
  formatVersion: number
  layoutId: string
  name: string
  source: {
    kind: 'geojson'
    file?: string
    /** Hash of the source text (line endings normalised), to notice a changed reference. */
    hash: string
    crs: SourceCrs
    /** Required credit line (e.g. OpenStreetMap, ODbL), or null when the source did not need one. */
    attribution: string | null
    features: number
  }
  importer: { name: string; version: number }
  projection: LayoutProjection
  /** Clip rectangle applied in the source frame, or null (everything imported). */
  clip: Rect | null
  /** Source-frame bounds of everything imported. */
  extent: Rect
  /** Land use assumed where no zone covers the ground (Q4: sources without land use). */
  defaults: { zone: LandUseZone }
  roads: LayoutRoad[]
  network: RoadNetwork
  zones: LayoutZoneArea[]
  restricted: LayoutRestricted[]
  buildings: LayoutBuildingHint[]
  parcels: LayoutParcelHint[]
  /** Import issues (the normalisation has its own list). */
  issues: LayoutIssue[]
  normalized: NormalizedNetwork | null
}
