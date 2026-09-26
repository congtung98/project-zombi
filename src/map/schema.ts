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
  /** Storey height (m): floor to floor, the walls of one storey; the roof sits on the top storey. */
  height: number
  /**
   * M11b: number of storeys, 1..`MAX_STOREYS` (default 1). Storey k (0 = ground) has its floor at
   * k·height; every upper storey gets a slab over the footprint/outline with holes over its stairs.
   */
  storeys?: number
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

export const MAX_STOREYS = 4

/**
 * M11b: storey of a prefab object or room (0 = ground, default). The resolver raises it by
 * `level · building.height`; positions stay relative to that storey's floor. Chunk objects have none.
 */
export interface Levelled {
  level?: number
}

export interface WallObject extends BoxFields, Levelled {
  kind: 'wall'
  localId: string
}

/** Furniture or loose obstacle: same runtime behaviour as a wall, separate editor layer. */
export interface PropObject extends BoxFields, Levelled {
  kind: 'prop'
  localId: string
  /** G3a (graphics): drawn as a furniture asset inside the box; presentation only. */
  visual?: FurnitureVisual
}

export interface ContainerObject extends BoxFields, Levelled {
  kind: 'container'
  localId: string
  name: string
  /** Key of `LOOT_TABLES`; omitted = always empty. */
  lootTableId?: string
  /** G3a (graphics): drawn as a furniture asset inside the box; presentation only. */
  visual?: FurnitureVisual
}

/**
 * G3a: looks of a prop or container. `assetId` names an asset of the furniture registry
 * (`game/rendering/furniture/catalog.ts`, e.g. `furniture/wardrobe`), built to fill the object's box:
 * the box stays the collider, nav and sight blocker and interaction target, and IDs, loot and saves
 * never depend on it. `facing` turns the asset's front towards `rotateXZ(0, 1, facing)` in the
 * object's frame (0 = +Z, 1 = +X, 2 = −Z, 3 = −X), and turns with a prefab instance; omitted, the back
 * goes against the nearest wall. An unknown asset is a warning and draws the plain box.
 */
export interface FurnitureVisual {
  assetId: string
  facing?: QuarterTurns
  /**
   * G3b: extra turn about the box centre, degrees −45…45 (a chair pulled out askew); the asset shrinks
   * to stay inside the box, which stays the collider.
   */
  yaw?: number
  /** G3b: one of the asset's looks (`FURNITURE_VARIANTS`: an unmade bed, a tool rack); default: the house variant's, else the asset's first. */
  variantId?: string
}

/**
 * G3b: drawn-only decor (`game/rendering/decor/catalog.ts`: a cup, a packed bag, an oil stain). No
 * collider, nav or sight blocker, no interaction, no saved state; an ID like every object (the editor
 * keeps it). `position` is the centre of its base: `y` is the height of what it stands on above its
 * storey's floor (0 = the floor, 0.75 = a table top). `yaw` in degrees, the sense of quarter turns
 * (90 = one quarter turn); `color` tints the main part. `variants` = the house variants it belongs to
 * (absent: every variant, and houses without variants).
 */
export interface DecorObject extends Levelled {
  kind: 'decor'
  localId: string
  assetId: string
  position: XYZ
  yaw?: number
  color?: string
  variants?: string[]
}

/**
 * Door in a wall gap. In its own frame (q = 0) the wall runs along X, the hinge is at local
 * x = −width/2 and the closed leaf points +X; `openTowards` is the local Z side the leaf swings to.
 * Height is the engine constant `DOOR_HEIGHT`.
 */
export interface DoorObject extends Levelled {
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
export interface WindowObject extends Levelled {
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
export interface WallRunObject extends Levelled {
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

/**
 * M11b: straight flight from storey `level` (default 0) to `level + 1` of a multi-storey building.
 * Own frame (q = 0): it climbs along +X, `length` long (the walked run) and `width` wide across Z,
 * `position` is the centre of that rectangle. The resolver encloses it: side walls along the run up
 * to a railing on the upper storey, a wall under the top end on the lower storey and a railing
 * across the bottom end on the upper storey, and cuts its rectangle out of the upper slab. You walk
 * in at the bottom end (lower storey) and out at the top end (upper storey).
 */
export interface StairsObject extends Levelled {
  kind: 'stairs'
  localId: string
  position: XZ
  quarterTurns: QuarterTurns
  width: number
  length: number
}

export type PrefabObject = WallObject | PropObject | ContainerObject | DoorObject | WindowObject | WallRunObject | TreeObject | StairsObject | DecorObject

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
export interface RoomObject extends Levelled {
  localId: string
  name: string
  /** Rectangle, or the bounding box of `outline`. */
  bounds: Rect
  /** M11a: L/T/U-shaped room: rectilinear outline (edges along X or Z), bounding box = `bounds`. */
  outline?: XZ[]
  lamp?: LampObject
  /** G2 (graphics): how the room is drawn; presentation only, never IDs, colliders, loot or saves. */
  visual?: RoomVisual
}

/**
 * G2: a room's looks. `floor` is a surface ID of the shared catalog
 * (`game/rendering/surfaces/catalog.ts`, e.g. `tile` for a kitchen), drawn in `floorColor` (default:
 * the building's floor colour). Absent = the building's wooden floor.
 */
export interface RoomVisual {
  floor?: string
  floorColor?: string
}

export interface PrefabDocument {
  schemaVersion: number
  prefabId: string
  contentVersion: number
  name: string
  /** Local point placed at the instance position; rotation turns about it. */
  pivot: XYZ
  /** Outline used for roof/indoor tests and bounds (the bounding box of `outline` when it is set). */
  footprint: Rect
  /**
   * M11a: non-rectangular building (L, T, U, notches): rectilinear outline on the wall centre lines,
   * edges along X or Z. Floors, roofs and indoor tests follow it; its bounding box is `footprint`.
   */
  outline?: XZ[]
  /** Present for enterable buildings (floor, roof, lighting); absent for plain prop groups. */
  building?: BuildingProps
  objects: PrefabObject[]
  rooms: RoomObject[]
  /**
   * G3b (graphics): house variants this prefab offers (`game/rendering/variants.ts`: `intact`,
   * `lived-in`, `abandoned`); each instance shows one. Presentation only.
   */
  visual?: { variants?: string[] }
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
  /**
   * G3b (graphics): which of the prefab's variants this house shows (`game/rendering/variants.ts`);
   * absent or not offered: one picked by a stable seed of the instance ID and the prefab version.
   */
  visual?: { variantId?: string }
}

type Standalone<T> = Omit<T, 'localId'> & { objectId: string }
/** Object placed directly in a chunk. `objectId` = `<identityChunkId>/objects/<name>`. */
export type StandaloneObject = Standalone<WallObject> | Standalone<PropObject> | Standalone<ContainerObject> | Standalone<TreeObject> | Standalone<DecorObject>

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
