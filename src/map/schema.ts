/**
 * Map content format, schema v1 (docs/map-content-format.md). Documents hold semantic data only:
 * no Three.js objects, runtime handles or player state. World units are metres, Y up, ground on XZ.
 *
 * Every module in `src/map/` except `content.ts` imports values with explicit `.ts` paths and only
 * erasable TypeScript, so the Node CLI (`scripts/map-tools/`) can run it without a bundler.
 */

export const MAP_SCHEMA_VERSION = 1

/** Rotation about +Y in 90° steps; q = 1 maps local (x, z) to (z, -x), like Three.js `rotation.y = π/2`. */
export type QuarterTurns = 0 | 1 | 2 | 3

export interface XZ {
  x: number
  z: number
}

export interface XYZ {
  x: number
  y: number
  z: number
}

/** Axis-aligned rectangle on the ground. */
export interface Rect {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

export interface ChunkEntry {
  chunkId: string
  cx: number
  cz: number
  /** Relative to the world folder, e.g. `chunks/c0_0.json`. */
  path: string
}

export interface PrefabEntry {
  prefabId: string
  contentVersion: number
  path: string
}

/** `world.json`: manifest and index of the chunks and prefabs that exist. */
export interface WorldDocument {
  schemaVersion: number
  worldId: string
  name: string
  contentVersion: number
  /** Chunk edge in metres; chunk (cx, cz) covers [cx·S, (cx+1)·S) × [cz·S, (cz+1)·S). */
  chunkSize: number
  coordinateSystem: 'y-up-xz-meters'
  /**
   * Playable rectangle: `size` (X) × `depth` (Z, default `size`) around `center` (default the
   * origin). Nav grid, ground, fence, drop check and spawn checks all use it (M7: off-centre).
   */
  playArea: PlayArea
  /** Fence around the play area (collider + nav), or none. */
  boundary: { height: number; thickness: number } | null
  /** Inclusive chunk index range; every listed chunk lies inside it. */
  chunkBounds: { minCx: number; maxCx: number; minCz: number; maxCz: number }
  chunks: ChunkEntry[]
  prefabs: PrefabEntry[]
  /** Stable ID of the `player` spawn used by New Game. */
  playerSpawn: string
  gameplay?: { maxActiveZombies?: number }
  /**
   * Shown in the game's world menu (default true). `false` hides lab/test worlds from players;
   * they still load with `?world=<worldId>`. Not content: saves do not depend on it.
   */
  listed?: boolean
  /**
   * Record IDs deleted from published content (sorted). They are never handed out again, so a
   * save holding state for a deleted object cannot attach it to a new, unrelated one (editor M3).
   */
  retiredIds?: string[]
  /**
   * Provenance of a generated world (M6): generator name/version, seed and parameters. Traceability
   * only: the files are the content; `map:generate` uses it to detect hand edits before overwriting.
   */
  generator?: GeneratorInfo
}

export interface PlayArea {
  /** Extent along X (m). */
  size: number
  /** Extent along Z (m); omitted = `size` (a square). */
  depth?: number
  /** Centre; omitted = the origin. */
  center?: XZ
}

export interface GeneratorInfo {
  name: string
  version: number
  seed: number
  /** Generator parameters (plain JSON), e.g. `{ "blocksX": 2, "blocksZ": 2 }`. */
  params: Record<string, number | string>
  /** Prefab library the output was built from, e.g. `neighborhood-50@1`. */
  catalog: string
}

export interface BuildingProps {
  height: number
  wallThickness: number
  wallColor: string
  roofColor: string
  floorColor: string
}

/** Solid box (collider, nav blocker, sight blocker when tall). `position` is the box centre. */
export interface BoxFields {
  position: XYZ
  /** Full size [X, Y, Z] before rotation. */
  size: [number, number, number]
  color: string
}

export interface WallObject extends BoxFields {
  kind: 'wall'
  localId: string
}

/** Furniture or loose obstacle: same runtime behaviour as a wall, separate editor layer. */
export interface PropObject extends BoxFields {
  kind: 'prop'
  localId: string
}

export interface ContainerObject extends BoxFields {
  kind: 'container'
  localId: string
  name: string
  /** Key of `LOOT_TABLES`; omitted = always empty. */
  lootTableId?: string
}

/**
 * Door in a wall gap. In its own frame (q = 0) the wall runs along X, the hinge is at local
 * x = −width/2 and the closed leaf points +X; `openTowards` is the local Z side the leaf swings to.
 * Height is the engine constant `DOOR_HEIGHT`.
 */
export interface DoorObject {
  kind: 'door'
  localId: string
  name: string
  /** Centre of the opening on the ground. */
  position: XZ
  quarterTurns: QuarterTurns
  width: number
  openTowards: 1 | -1
  initialState?: 'open' | 'closed'
}

/** Glass pane in a wall gap (blocks movement and zombie sight). q = 0: pane along X, inside = +Z. */
export interface WindowObject {
  kind: 'window'
  localId: string
  name: string
  position: XZ
  quarterTurns: QuarterTurns
  width: number
  sill: number
  head: number
  thickness: number
}

/**
 * Straight wall along X or Z (prefab editor M5). The resolver cuts a gap wherever a door or window
 * of the same prefab sits on it (same axis, centre on the wall line) and adds the lintel above a
 * door and the sill/header of a window, so the GUI only draws walls and drops openings on them.
 * `from`/`to` are points on the wall centre line; the box extends `thickness / 2` past both ends
 * so corners close. Its pieces are plain walls with derived IDs `<entity>#<n>` (no saved state).
 */
export interface WallRunObject {
  kind: 'wallRun'
  localId: string
  from: XZ
  to: XZ
  height: number
  thickness: number
  color: string
}

/**
 * Tree (M9): trunk (collider, nav and sight blocker, like a post) under a canopy that is only drawn
 * and fades when it hides the player. No rotation; `style` picks the canopy shape.
 */
export interface TreeObject {
  kind: 'tree'
  localId: string
  position: XZ
  /** Total height (m), 2..20. */
  height: number
  /** Canopy radius (m), 0.5..8. */
  canopy: number
  /** Trunk radius (m), 0.1..1, below the canopy radius. */
  trunk: number
  /** Canopy colour. */
  color: string
  style: 'round' | 'pine'
}

export type PrefabObject = WallObject | PropObject | ContainerObject | DoorObject | WindowObject | WallRunObject | TreeObject

export interface LampObject {
  localId: string
  name: string
  /** Light contribution 0..1 to its room. */
  intensity: number
  color: string
  requiresElectricity: boolean
  /** Wall switch (interaction point). */
  switchAt: XZ
  /** Ceiling fixture; defaults to the room centre. */
  at?: XZ
}

/** Room for building lighting: rectangle on the wall centre lines, ceiling = building height. */
export interface RoomObject {
  localId: string
  name: string
  bounds: Rect
  lamp?: LampObject
}

export interface PrefabDocument {
  schemaVersion: number
  prefabId: string
  contentVersion: number
  name: string
  /** Local point placed at the instance position; rotation turns about it. */
  pivot: XYZ
  /** Outline used for roof/indoor tests and bounds. */
  footprint: Rect
  /** Present for enterable buildings (floor, roof, lighting); absent for plain prop groups. */
  building?: BuildingProps
  objects: PrefabObject[]
  rooms: RoomObject[]
  /**
   * Local IDs deleted or renamed in the prefab editor (M5, sorted). Never handed out again, so a
   * save holding state for `<instance>/<old id>` can't attach it to an unrelated new object.
   */
  retiredLocalIds?: string[]
}

/** Prefab placement. `instanceId` = `<identityChunkId>/<name>`; positions are chunk-local. */
export interface InstanceRecord {
  instanceId: string
  prefabId: string
  position: XYZ
  quarterTurns: QuarterTurns
}

type Standalone<T> = Omit<T, 'localId'> & { objectId: string }
/** Object placed directly in a chunk. `objectId` = `<identityChunkId>/objects/<name>`. */
export type StandaloneObject = Standalone<WallObject> | Standalone<PropObject> | Standalone<ContainerObject> | Standalone<TreeObject>

/** Road surface (visual only, no collider). */
export interface RoadRecord {
  roadId: string
  position: XZ
  /** [X, Z] */
  size: [number, number]
  color: string
  /**
   * Draw order 0…`SURFACE_LAYER_MAX` (M7, default 0): a higher layer is drawn on top where
   * surfaces overlap (each layer sits 1 mm higher, all below building floors).
   */
  layer?: number
}

export const SURFACE_LAYER_MAX = 4

interface ZoneBase {
  zoneId: string
  /** Only `zombiePopulation` has a runtime consumer (horde wander/migration). */
  kind: 'zombiePopulation'
  name: string
  /** Anchor (ownership) and the centre used by the nearest-centre rule. */
  center: XZ
}

export interface CircleZoneRecord extends ZoneBase {
  shape: 'circle'
  radius: number
}

/** Axis-aligned rectangle around `center` (map editor M4). */
export interface RectZoneRecord extends ZoneBase {
  shape: 'rect'
  /** Full size [X, Z]. */
  size: [number, number]
}

/**
 * Zombie wander/migration area (horde director). A point inside rectangle zones belongs to the
 * smallest one, otherwise to the nearest centre (`game/world/zones.ts`).
 */
export type ZoneRecord = CircleZoneRecord | RectZoneRecord

export interface SpawnRecord {
  spawnId: string
  kind: 'player' | 'zombie'
  position: XZ
}

/** A record owned by another chunk whose bounds reach into this one (loaded with this chunk). */
export interface ExternalRef {
  id: string
  ownerChunkId: string
}

export interface ChunkDocument {
  schemaVersion: number
  contentVersion: number
  chunkId: string
  cx: number
  cz: number
  instances: InstanceRecord[]
  objects: StandaloneObject[]
  roads: RoadRecord[]
  zones: ZoneRecord[]
  spawns: SpawnRecord[]
  externalRefs: ExternalRef[]
}

/** Record categories of a chunk, in resolve order. */
export const RECORD_CATEGORIES = ['instances', 'objects', 'roads', 'zones', 'spawns'] as const
export type RecordCategory = (typeof RECORD_CATEGORIES)[number]

/** Namespaces for chunk-level records; an instance may not use these names. */
export const RECORD_NAMESPACES: Record<Exclude<RecordCategory, 'instances'>, string> = {
  objects: 'objects',
  roads: 'roads',
  zones: 'zones',
  spawns: 'spawns',
}

export const RESERVED_INSTANCE_NAMES: ReadonlySet<string> = new Set(Object.values(RECORD_NAMESPACES))

export function recordId(category: RecordCategory, record: unknown): string {
  const r = record as Record<string, unknown>
  const key = { instances: 'instanceId', objects: 'objectId', roads: 'roadId', zones: 'zoneId', spawns: 'spawnId' }[category]
  return String(r[key])
}
