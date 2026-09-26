import {
  MAP_SCHEMA_VERSION,
  RECORD_CATEGORIES,
  RECORD_NAMESPACES,
  RESERVED_INSTANCE_NAMES,
  recordId,
  SURFACE_LAYER_MAX,
  type ChunkDocument,
  type ChunkEntry,
  type ExternalRef,
  type PrefabDocument,
  type PrefabEntry,
  type Rect,
  type WorldDocument,
  type XZ,
} from './schema.ts'
import { TREE_LIMITS } from '../game/world/trees.ts'
import { contentMigrationPath, contentMigrationShapeProblems, renameProblems, statefulIds, type ContentMigration } from './contentMigration.ts'
import { chunkIdOf, chunksOverlapping, parseChunkId, parseRecordId, playAreaRect, PREFAB_ID, SLUG } from './transform.ts'
import { outlineBounds, outlineProblem, pointInOutline } from './polygon.ts'
import { resolveChunk, type ResolvedRecord } from './resolve.ts'
import { zoneContains, zoneFor } from '../game/world/zones.ts'

/**
 * Validation shared by the runtime loader, tests, the CLI (`npm run map:check`) and later the
 * editor. Errors block loading/export; warnings are design hints. Each issue names the document
 * path (JSON pointer style) and, when known, the entity ID.
 */

export type Severity = 'error' | 'warning'

export interface ValidationIssue {
  severity: Severity
  code: string
  message: string
  /** `<file>#/<pointer>`, e.g. `chunks/c0_0.json#/instances/2/position`. */
  path: string
  entityId?: string
}

export interface ValidationOptions {
  /** Registered loot table IDs; omitted = not checked. */
  lootTables?: ReadonlySet<string>
}

export class MapContentError extends Error {
  readonly issues: ValidationIssue[]
  constructor(issues: ValidationIssue[]) {
    const errors = issues.filter((i) => i.severity === 'error')
    super(`Map content invalid (${errors.length} error${errors.length === 1 ? '' : 's'}): ${errors.slice(0, 3).map((i) => `${i.code} at ${i.path}: ${i.message}`).join('; ')}`)
    this.issues = issues
  }
}

export function hasErrors(issues: readonly ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error')
}

type Obj = Record<string, unknown>

const COLOR = /^#[0-9a-f]{6}$/i
/** Player/zombie body radius used by the blocked-spawn check. */
export const SPAWN_CLEARANCE = 0.4
/** Boxes starting this high are overhead (lintels, headers): nobody collides with them. */
export const OVERHEAD_BOTTOM = 1.6

class Checker {
  readonly issues: ValidationIssue[] = []
  readonly file: string
  constructor(file: string) {
    this.file = file
  }

  issue(severity: Severity, code: string, path: string, message: string, entityId?: string): void {
    this.issues.push({ severity, code, message, path: `${this.file}#${path}`, ...(entityId ? { entityId } : {}) })
  }
  error(code: string, path: string, message: string, entityId?: string): void {
    this.issue('error', code, path, message, entityId)
  }

  obj(v: unknown, path: string): v is Obj {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) return true
    this.error('schema', path, 'expected an object')
    return false
  }
  arr(v: unknown, path: string): v is unknown[] {
    if (Array.isArray(v)) return true
    this.error('schema', path, 'expected an array')
    return false
  }
  str(v: unknown, path: string, pattern?: RegExp): v is string {
    if (typeof v !== 'string' || v.length === 0) {
      this.error('schema', path, 'expected a non-empty string')
      return false
    }
    if (pattern && !pattern.test(v)) {
      this.error('invalid-id', path, `"${v}" does not match ${pattern}`)
      return false
    }
    return true
  }
  num(v: unknown, path: string, opts: { min?: number; max?: number; int?: boolean; positive?: boolean } = {}): v is number {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.error('not-finite', path, 'expected a finite number')
      return false
    }
    if ((opts.int && !Number.isInteger(v)) || (opts.positive && v <= 0) || (opts.min !== undefined && v < opts.min) || (opts.max !== undefined && v > opts.max)) {
      this.error('out-of-range', path, `${v} is out of range`)
      return false
    }
    return true
  }
  bool(v: unknown, path: string): boolean {
    if (typeof v === 'boolean') return true
    this.error('schema', path, 'expected a boolean')
    return false
  }
  oneOf(v: unknown, values: readonly unknown[], path: string): boolean {
    if (values.includes(v)) return true
    this.error('schema', path, `expected one of ${values.map((x) => JSON.stringify(x)).join(', ')}`)
    return false
  }
  color(v: unknown, path: string): void {
    if (typeof v !== 'string' || !COLOR.test(v)) this.error('schema', path, 'expected a #rrggbb colour')
  }
  xz(v: unknown, path: string): boolean {
    return this.obj(v, path) && this.num(v.x, `${path}/x`) && this.num(v.z, `${path}/z`)
  }
  xyz(v: unknown, path: string): boolean {
    return this.obj(v, path) && this.num(v.x, `${path}/x`) && this.num(v.y, `${path}/y`) && this.num(v.z, `${path}/z`)
  }
  rect(v: unknown, path: string): boolean {
    if (!this.obj(v, path)) return false
    const ok = ['minX', 'minZ', 'maxX', 'maxZ'].every((k) => this.num(v[k], `${path}/${k}`))
    if (ok && ((v.minX as number) >= (v.maxX as number) || (v.minZ as number) >= (v.maxZ as number))) {
      this.error('invalid-rect', path, 'min must be below max')
      return false
    }
    return ok
  }
  size(v: unknown, path: string, n: 2 | 3): boolean {
    if (!Array.isArray(v) || v.length !== n) {
      this.error('schema', path, `expected [${n === 3 ? 'x, y, z' : 'x, z'}]`)
      return false
    }
    return v.every((s, i) => this.num(s, `${path}/${i}`, { positive: true }))
  }
  quarter(v: unknown, path: string): boolean {
    return this.oneOf(v, [0, 1, 2, 3], path)
  }
  schemaVersion(v: unknown): boolean {
    if (v === MAP_SCHEMA_VERSION) return true
    this.error('unsupported-schema', '/schemaVersion', `schemaVersion ${JSON.stringify(v)} is not supported (expected ${MAP_SCHEMA_VERSION})`)
    return false
  }
}

function relativePath(c: Checker, v: unknown, path: string): void {
  if (!c.str(v, path)) return
  if (v.startsWith('/') || v.includes('\\') || v.split('/').some((s) => s === '..' || s === '.' || s === '') || !v.endsWith('.json')) {
    c.error('invalid-path', path, `"${v}" must be a relative .json path inside the world folder`)
  }
}

type Solid = { id: string; position: { x: number; y: number; z: number }; size: readonly number[] }

/** Boxes a body can collide with (walls, props, containers below `OVERHEAD_BOTTOM`). */
export function lowSolids(records: readonly ResolvedRecord[]): Solid[] {
  return records.flatMap((r) => [...(r.parts.walls ?? []), ...(r.parts.containers ?? [])]).filter((b) => b.position.y - b.size[1] / 2 < OVERHEAD_BOTTOM)
}

/** First solid a body of radius `SPAWN_CLEARANCE` standing at `p` would overlap (spawns, playtest start). */
export function blockingSolid(solids: readonly Solid[], p: { x: number; z: number }): Solid | undefined {
  return solids.find((b) => Math.abs(p.x - b.position.x) < b.size[0] / 2 + SPAWN_CLEARANCE && Math.abs(p.z - b.position.z) < b.size[2] / 2 + SPAWN_CLEARANCE)
}

/** `world.json` on its own (chunk/prefab files are checked by `validateContent`). */
export function validateWorldDocument(doc: unknown, file = 'world.json'): ValidationIssue[] {
  const c = new Checker(file)
  if (!c.obj(doc, '')) return c.issues
  if (!c.schemaVersion(doc.schemaVersion)) return c.issues
  c.str(doc.worldId, '/worldId', SLUG)
  c.str(doc.name, '/name')
  c.num(doc.contentVersion, '/contentVersion', { int: true, min: 1 })
  c.num(doc.chunkSize, '/chunkSize', { positive: true })
  c.oneOf(doc.coordinateSystem, ['y-up-xz-meters'], '/coordinateSystem')
  if (c.obj(doc.playArea, '/playArea')) {
    const a = doc.playArea
    c.num(a.size, '/playArea/size', { positive: true })
    if (a.depth !== undefined) c.num(a.depth, '/playArea/depth', { positive: true })
    if (a.center !== undefined) c.xz(a.center, '/playArea/center')
  }
  if (doc.boundary !== null && c.obj(doc.boundary, '/boundary')) {
    c.num(doc.boundary.height, '/boundary/height', { positive: true })
    c.num(doc.boundary.thickness, '/boundary/thickness', { positive: true })
  }
  type ChunkBounds = WorldDocument['chunkBounds']
  let bounds: ChunkBounds | null = null
  if (c.obj(doc.chunkBounds, '/chunkBounds')) {
    const b = doc.chunkBounds
    if (['minCx', 'maxCx', 'minCz', 'maxCz'].every((k) => c.num(b[k], `/chunkBounds/${k}`, { int: true }))) {
      const checked = b as unknown as ChunkBounds
      bounds = checked
      if (checked.minCx > checked.maxCx || checked.minCz > checked.maxCz) c.error('invalid-rect', '/chunkBounds', 'min must not exceed max')
    }
  }
  if (c.arr(doc.chunks, '/chunks')) {
    const seen = new Set<string>()
    doc.chunks.forEach((e, i) => {
      const p = `/chunks/${i}`
      if (!c.obj(e, p) || !c.str(e.chunkId, `${p}/chunkId`) || !c.num(e.cx, `${p}/cx`, { int: true }) || !c.num(e.cz, `${p}/cz`, { int: true })) return
      if (e.chunkId !== chunkIdOf(e.cx as number, e.cz as number)) c.error('invalid-id', `${p}/chunkId`, `chunk (${e.cx}, ${e.cz}) must be named ${chunkIdOf(e.cx as number, e.cz as number)}`)
      if (seen.has(e.chunkId as string)) c.error('duplicate-id', `${p}/chunkId`, `chunk ${e.chunkId} listed twice`)
      seen.add(e.chunkId as string)
      if (bounds && ((e.cx as number) < bounds.minCx || (e.cx as number) > bounds.maxCx || (e.cz as number) < bounds.minCz || (e.cz as number) > bounds.maxCz)) {
        c.error('chunk-outside-bounds', p, `chunk ${e.chunkId} lies outside chunkBounds`)
      }
      relativePath(c, e.path, `${p}/path`)
    })
  }
  if (c.arr(doc.prefabs, '/prefabs')) {
    const seen = new Set<string>()
    doc.prefabs.forEach((e, i) => {
      const p = `/prefabs/${i}`
      if (!c.obj(e, p) || !c.str(e.prefabId, `${p}/prefabId`, PREFAB_ID)) return
      if (seen.has(e.prefabId as string)) c.error('duplicate-id', `${p}/prefabId`, `prefab ${e.prefabId} listed twice`)
      seen.add(e.prefabId as string)
      c.num(e.contentVersion, `${p}/contentVersion`, { int: true, min: 1 })
      relativePath(c, e.path, `${p}/path`)
    })
  }
  if (c.str(doc.playerSpawn, '/playerSpawn') && !parseRecordId(doc.playerSpawn, RECORD_NAMESPACES.spawns)) {
    c.error('invalid-id', '/playerSpawn', `"${doc.playerSpawn}" is not a spawn ID`)
  }
  if (doc.listed !== undefined) c.bool(doc.listed, '/listed')
  if (doc.gameplay !== undefined && c.obj(doc.gameplay, '/gameplay') && doc.gameplay.maxActiveZombies !== undefined) {
    c.num(doc.gameplay.maxActiveZombies, '/gameplay/maxActiveZombies', { int: true, min: 0 })
  }
  if (doc.generator !== undefined && c.obj(doc.generator, '/generator')) {
    const g = doc.generator
    c.str(g.name, '/generator/name')
    c.num(g.version, '/generator/version', { int: true, min: 1 })
    c.num(g.seed, '/generator/seed', { int: true })
    c.obj(g.params, '/generator/params')
    c.str(g.catalog, '/generator/catalog')
  }
  if (doc.retiredIds !== undefined && c.arr(doc.retiredIds, '/retiredIds')) {
    const seen = new Set<string>()
    doc.retiredIds.forEach((id, i) => {
      if (!c.str(id, `/retiredIds/${i}`)) return
      if (seen.has(id)) c.error('duplicate-id', `/retiredIds/${i}`, `retired ID "${id}" listed twice`)
      seen.add(id)
    })
  }
  return c.issues
}

/** Tree fields (M9): ranges from `TREE_LIMITS`, trunk thinner than the canopy. */
function checkTree(c: Checker, o: Obj, p: string): void {
  c.xz(o.position, `${p}/position`)
  const [h0, h1] = TREE_LIMITS.height
  const [c0, c1] = TREE_LIMITS.canopy
  const [t0, t1] = TREE_LIMITS.trunk
  c.num(o.height, `${p}/height`, { min: h0, max: h1 })
  const canopy = c.num(o.canopy, `${p}/canopy`, { min: c0, max: c1 })
  const trunk = c.num(o.trunk, `${p}/trunk`, { min: t0, max: t1 })
  if (canopy && trunk && (o.trunk as number) >= (o.canopy as number)) c.error('out-of-range', `${p}/trunk`, 'trunk must be thinner than the canopy')
  c.color(o.color, `${p}/color`)
  c.oneOf(o.style, ['round', 'pine'], `${p}/style`)
}

function checkBox(c: Checker, o: Obj, p: string): void {
  c.xyz(o.position, `${p}/position`)
  c.size(o.size, `${p}/size`, 3)
  c.color(o.color, `${p}/color`)
}

function checkContainerFields(c: Checker, o: Obj, p: string, opts: ValidationOptions, entityId: string): void {
  c.str(o.name, `${p}/name`)
  if (o.lootTableId !== undefined && c.str(o.lootTableId, `${p}/lootTableId`) && opts.lootTables && !opts.lootTables.has(o.lootTableId)) {
    c.error('unknown-loot-table', `${p}/lootTableId`, `loot table "${o.lootTableId}" is not registered`, entityId)
  }
}

/**
 * M11a outline: rectilinear, simple, with `bounds` (the footprint or room rectangle) as its bounding
 * box. Returns the outline when usable (for point tests), else null.
 */
function checkOutline(c: Checker, v: unknown, path: string, bounds: Rect | null, what: string): XZ[] | null {
  if (!c.arr(v, path)) return null
  if (!v.every((p, i) => c.xz(p, `${path}/${i}`))) return null
  const poly = v as XZ[]
  const problem = outlineProblem(poly)
  if (problem) {
    c.error('invalid-outline', path, `${what} outline ${problem}`)
    return null
  }
  const box = outlineBounds(poly)
  if (bounds && (box.minX !== bounds.minX || box.minZ !== bounds.minZ || box.maxX !== bounds.maxX || box.maxZ !== bounds.maxZ)) {
    c.error('outline-bounds', path, `${what} rectangle must be the bounding box of its outline (${box.minX}…${box.maxX} × ${box.minZ}…${box.maxZ})`)
  }
  return poly
}

export function validatePrefabDocument(doc: unknown, entry: PrefabEntry, opts: ValidationOptions = {}, file = entry.path): ValidationIssue[] {
  const c = new Checker(file)
  if (!c.obj(doc, '')) return c.issues
  if (!c.schemaVersion(doc.schemaVersion)) return c.issues
  if (doc.prefabId !== entry.prefabId) c.error('manifest-mismatch', '/prefabId', `file holds ${JSON.stringify(doc.prefabId)}, manifest expects ${entry.prefabId}`)
  if (c.num(doc.contentVersion, '/contentVersion', { int: true, min: 1 }) && doc.contentVersion !== entry.contentVersion) {
    c.error('version-mismatch', '/contentVersion', `prefab is v${doc.contentVersion}, manifest pins v${entry.contentVersion}`)
  }
  c.str(doc.name, '/name')
  c.xyz(doc.pivot, '/pivot')
  const footprintOk = c.rect(doc.footprint, '/footprint')
  const outline = doc.outline === undefined ? null : checkOutline(c, doc.outline, '/outline', footprintOk ? (doc.footprint as Rect) : null, 'footprint')
  const building = doc.building !== undefined && c.obj(doc.building, '/building') ? doc.building : null
  if (building) {
    c.num(building.height, '/building/height', { positive: true })
    c.num(building.wallThickness, '/building/wallThickness', { positive: true })
    for (const k of ['wallColor', 'roofColor', 'floorColor']) c.color(building[k], `/building/${k}`)
  }
  const localIds = new Set<string>()
  const claim = (id: unknown, path: string) => {
    if (!c.str(id, path, SLUG)) return
    if (localIds.has(id)) c.error('duplicate-id', path, `local ID "${id}" used twice in ${entry.prefabId}`)
    localIds.add(id)
  }
  let doors = 0
  if (c.arr(doc.objects, '/objects')) {
    doc.objects.forEach((o, i) => {
      const p = `/objects/${i}`
      if (!c.obj(o, p)) return
      claim(o.localId, `${p}/localId`)
      const entityId = `${entry.prefabId}:${String(o.localId)}`
      switch (o.kind) {
        case 'wall':
        case 'prop':
          checkBox(c, o, p)
          break
        case 'container':
          checkBox(c, o, p)
          checkContainerFields(c, o, p, opts, entityId)
          break
        case 'tree':
          checkTree(c, o, p)
          break
        case 'door':
          doors++
          c.str(o.name, `${p}/name`)
          c.xz(o.position, `${p}/position`)
          c.quarter(o.quarterTurns, `${p}/quarterTurns`)
          c.num(o.width, `${p}/width`, { positive: true })
          c.oneOf(o.openTowards, [1, -1], `${p}/openTowards`)
          if (o.initialState !== undefined) c.oneOf(o.initialState, ['open', 'closed'], `${p}/initialState`)
          break
        case 'wallRun':
          if (c.xz(o.from, `${p}/from`) && c.xz(o.to, `${p}/to`)) {
            const f = o.from as Obj
            const t = o.to as Obj
            const alongX = f.z === t.z && f.x !== t.x
            const alongZ = f.x === t.x && f.z !== t.z
            if (!alongX && !alongZ) c.error('out-of-range', p, `wall run "${String(o.localId)}" must be a non-empty segment along X or Z`)
          }
          c.num(o.height, `${p}/height`, { positive: true })
          c.num(o.thickness, `${p}/thickness`, { positive: true })
          c.color(o.color, `${p}/color`)
          break
        case 'window':
          c.str(o.name, `${p}/name`)
          c.xz(o.position, `${p}/position`)
          c.quarter(o.quarterTurns, `${p}/quarterTurns`)
          c.num(o.width, `${p}/width`, { positive: true })
          c.num(o.thickness, `${p}/thickness`, { positive: true })
          if (c.num(o.sill, `${p}/sill`, { min: 0 }) && c.num(o.head, `${p}/head`, { positive: true }) && (o.sill as number) >= (o.head as number)) {
            c.error('out-of-range', p, 'sill must be below head')
          }
          break
        default:
          c.error('unknown-kind', `${p}/kind`, `unknown object kind ${JSON.stringify(o.kind)}`)
      }
      if (footprintOk && (o.kind === 'door' || o.kind === 'window' || o.kind === 'container' || o.kind === 'prop') && c.obj(o.position, `${p}/position`)) {
        const f = doc.footprint as Obj
        const x = o.position.x as number
        const z = o.position.z as number
        if (x < (f.minX as number) || x > (f.maxX as number) || z < (f.minZ as number) || z > (f.maxZ as number) || (outline && !pointInOutline(outline, x, z))) {
          c.issue('warning', 'outside-footprint', `${p}/position`, `${o.kind} "${String(o.localId)}" lies outside the footprint`)
        }
      }
    })
  }
  if (c.arr(doc.rooms, '/rooms')) {
    if (doc.rooms.length > 0 && !building) c.error('rooms-need-building', '/rooms', 'rooms need building properties (ceiling height)')
    doc.rooms.forEach((r, i) => {
      const p = `/rooms/${i}`
      if (!c.obj(r, p)) return
      claim(r.localId, `${p}/localId`)
      c.str(r.name, `${p}/name`)
      const boundsOk = c.rect(r.bounds, `${p}/bounds`)
      const roomOutline = r.outline === undefined ? null : checkOutline(c, r.outline, `${p}/outline`, boundsOk ? (r.bounds as Rect) : null, `room "${String(r.localId)}"`)
      if (r.lamp === undefined || !c.obj(r.lamp, `${p}/lamp`)) return
      const l = r.lamp
      claim(l.localId, `${p}/lamp/localId`)
      c.str(l.name, `${p}/lamp/name`)
      c.num(l.intensity, `${p}/lamp/intensity`, { min: 0, max: 1 })
      c.color(l.color, `${p}/lamp/color`)
      c.bool(l.requiresElectricity, `${p}/lamp/requiresElectricity`)
      c.xz(l.switchAt, `${p}/lamp/switchAt`)
      if (l.at !== undefined && c.xz(l.at, `${p}/lamp/at`) && boundsOk) {
        const b = r.bounds as Rect
        const at = l.at as XZ
        if (at.x < b.minX || at.x > b.maxX || at.z < b.minZ || at.z > b.maxZ || (roomOutline && !pointInOutline(roomOutline, at.x, at.z))) c.issue('warning', 'lamp-outside-room', `${p}/lamp/at`, `lamp "${String(l.localId)}" hangs outside room "${String(r.localId)}"`)
      }
    })
  }
  if (building && doors === 0) c.issue('warning', 'building-no-entrance', '/objects', `building ${entry.prefabId} has no door`)
  if (doc.retiredLocalIds !== undefined && c.arr(doc.retiredLocalIds, '/retiredLocalIds')) {
    const seen = new Set<string>()
    doc.retiredLocalIds.forEach((id, i) => {
      if (!c.str(id, `/retiredLocalIds/${i}`, SLUG)) return
      if (seen.has(id)) c.error('duplicate-id', `/retiredLocalIds/${i}`, `retired local ID "${id}" listed twice`)
      seen.add(id)
      if (localIds.has(id)) c.error('retired-id-reused', `/retiredLocalIds/${i}`, `local ID "${id}" was deleted from ${entry.prefabId} and cannot be used again`, `${entry.prefabId}:${id}`)
    })
  }
  return c.issues
}

/** One chunk file on its own: structure, IDs and that every record's anchor lies in this chunk. */
export function validateChunkDocument(doc: unknown, entry: ChunkEntry, world: WorldDocument, opts: ValidationOptions = {}, file = entry.path): ValidationIssue[] {
  const c = new Checker(file)
  if (!c.obj(doc, '')) return c.issues
  if (!c.schemaVersion(doc.schemaVersion)) return c.issues
  c.num(doc.contentVersion, '/contentVersion', { int: true, min: 1 })
  if (doc.chunkId !== entry.chunkId || doc.cx !== entry.cx || doc.cz !== entry.cz) {
    c.error('manifest-mismatch', '/chunkId', `file holds ${JSON.stringify(doc.chunkId)} (${String(doc.cx)}, ${String(doc.cz)}), manifest expects ${entry.chunkId}`)
  }
  const S = world.chunkSize
  /** Half-open ownership: the anchor must satisfy 0 ≤ local < chunkSize on both axes. */
  const owned = (v: unknown, path: string, id: string) => {
    if (!c.obj(v, path)) return
    const x = v.x as number
    const z = v.z as number
    if (!(x >= 0 && x < S && z >= 0 && z < S)) {
      c.error('owner-mismatch', path, `anchor (${x}, ${z}) is outside chunk ${entry.chunkId} (local coordinates must be in [0, ${S}))`, id)
    }
  }
  const prefabIds = new Set(world.prefabs.map((p) => p.prefabId))
  for (const category of RECORD_CATEGORIES) {
    if (!c.arr(doc[category], `/${category}`)) continue
    ;(doc[category] as unknown[]).forEach((r, i) => {
      const p = `/${category}/${i}`
      if (!c.obj(r, p)) return
      const id = recordId(category, r)
      const namespace = category === 'instances' ? null : RECORD_NAMESPACES[category]
      const parsed = parseRecordId(id, namespace)
      if (!parsed) {
        c.error('invalid-id', p, `"${id}" must look like ${namespace ? `<chunkId>/${namespace}/<name>` : '<chunkId>/<name>'}`)
        return
      }
      switch (category) {
        case 'instances':
          if (RESERVED_INSTANCE_NAMES.has(parsed.name)) c.error('invalid-id', p, `instance name "${parsed.name}" is reserved`, id)
          if (!c.str(r.prefabId, `${p}/prefabId`)) break
          if (!prefabIds.has(r.prefabId)) c.error('unknown-prefab', `${p}/prefabId`, `prefab ${r.prefabId} is not in the manifest`, id)
          if (c.xyz(r.position, `${p}/position`)) owned(r.position, `${p}/position`, id)
          c.quarter(r.quarterTurns, `${p}/quarterTurns`)
          break
        case 'objects':
          if (!c.oneOf(r.kind, ['wall', 'prop', 'container', 'tree'], `${p}/kind`)) break
          if (r.kind === 'tree') {
            checkTree(c, r, p)
            if (c.obj(r.position, `${p}/position`)) owned(r.position, `${p}/position`, id)
            break
          }
          checkBox(c, r, p)
          if (r.kind === 'container') checkContainerFields(c, r, p, opts, id)
          if (c.obj(r.position, `${p}/position`)) owned(r.position, `${p}/position`, id)
          break
        case 'roads':
          if (c.xz(r.position, `${p}/position`)) owned(r.position, `${p}/position`, id)
          c.size(r.size, `${p}/size`, 2)
          c.color(r.color, `${p}/color`)
          if (r.layer !== undefined) c.num(r.layer, `${p}/layer`, { int: true, min: 0, max: SURFACE_LAYER_MAX })
          break
        case 'zones':
          c.oneOf(r.kind, ['zombiePopulation'], `${p}/kind`)
          c.str(r.name, `${p}/name`)
          if (c.xz(r.center, `${p}/center`)) owned(r.center, `${p}/center`, id)
          if (!c.oneOf(r.shape, ['circle', 'rect'], `${p}/shape`)) break
          if (r.shape === 'circle') c.num(r.radius, `${p}/radius`, { positive: true })
          else c.size(r.size, `${p}/size`, 2)
          break
        case 'spawns':
          c.oneOf(r.kind, ['player', 'zombie'], `${p}/kind`)
          if (c.xz(r.position, `${p}/position`)) owned(r.position, `${p}/position`, id)
          break
      }
    })
  }
  if (c.arr(doc.externalRefs, '/externalRefs')) {
    doc.externalRefs.forEach((r, i) => {
      const p = `/externalRefs/${i}`
      if (c.obj(r, p) && c.str(r.id, `${p}/id`) && c.str(r.ownerChunkId, `${p}/ownerChunkId`) && !parseChunkId(r.ownerChunkId)) {
        c.error('invalid-id', `${p}/ownerChunkId`, `"${r.ownerChunkId}" is not a chunk ID`)
      }
    })
  }
  return c.issues
}

/** Every loaded document of a world, keyed by prefab/chunk ID. */
export interface WorldDocuments {
  world: WorldDocument
  prefabs: ReadonlyMap<string, PrefabDocument>
  chunks: ReadonlyMap<string, ChunkDocument>
  /** M8: valid content migrations `migrations/content-v<N>.json` for N < contentVersion, by N. */
  contentMigrations?: readonly ContentMigration[]
}

/**
 * External references a chunk must list: records owned elsewhere whose bounds reach into it
 * (only chunks that exist in the manifest). Sorted by ID for stable diffs.
 */
export function computeExternalRefs(docs: WorldDocuments, resolved?: ResolvedRecord[]): Map<string, ExternalRef[]> {
  const records = resolved ?? resolveAll(docs)
  const listed = new Set(docs.world.chunks.map((c) => c.chunkId))
  const refs = new Map<string, ExternalRef[]>(docs.world.chunks.map((c) => [c.chunkId, []]))
  for (const r of records) {
    for (const { cx, cz } of chunksOverlapping(r.bounds, docs.world.chunkSize)) {
      const id = chunkIdOf(cx, cz)
      if (id !== r.ownerChunkId && listed.has(id)) refs.get(id)!.push({ id: r.id, ownerChunkId: r.ownerChunkId })
    }
  }
  for (const list of refs.values()) list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return refs
}

export function resolveAll(docs: WorldDocuments): ResolvedRecord[] {
  const prefab = (id: string) => docs.prefabs.get(id)!
  return docs.world.chunks.flatMap((e) => resolveChunk(docs.world, docs.chunks.get(e.chunkId)!, prefab))
}

/**
 * Whole-world checks, after each document passed on its own: unique stable IDs, ownership
 * references, the player spawn, spawns inside the play area and not inside a collider.
 */
export function validateContent(docs: WorldDocuments): ValidationIssue[] {
  const { world } = docs
  const issues: ValidationIssue[] = []
  const add = (severity: Severity, code: string, path: string, message: string, entityId?: string) =>
    issues.push({ severity, code, message, path, ...(entityId ? { entityId } : {}) })
  const records = resolveAll(docs)
  const chunkPath = (id: string) => world.chunks.find((c) => c.chunkId === id)?.path ?? id

  const owners = new Map<string, string>()
  const retired = new Set(world.retiredIds ?? [])
  for (const r of records) {
    if (retired.has(r.id)) add('error', 'retired-id-reused', `${chunkPath(r.ownerChunkId)}#/${r.category}/${r.order[2]}`, `"${r.id}" belongs to a deleted record and cannot be used again`, r.id)
    for (const id of r.entityIds) {
      const first = owners.get(id)
      if (first) add('error', 'duplicate-id', `${chunkPath(r.ownerChunkId)}#/${r.category}/${r.order[2]}`, `stable ID "${id}" also used in ${first}`, id)
      else owners.set(id, chunkPath(r.ownerChunkId))
    }
  }

  const expected = computeExternalRefs(docs, records)
  for (const entry of world.chunks) {
    const declared = docs.chunks.get(entry.chunkId)!.externalRefs
    const want = expected.get(entry.chunkId)!
    const key = (r: ExternalRef) => `${r.id}@${r.ownerChunkId}`
    const wantKeys = new Set(want.map(key))
    const haveKeys = new Set(declared.map(key))
    for (const r of want) {
      if (!haveKeys.has(key(r))) add('error', 'missing-external-ref', `${entry.path}#/externalRefs`, `${r.id} (owned by ${r.ownerChunkId}) reaches into ${entry.chunkId} but is not referenced`, r.id)
    }
    declared.forEach((r, i) => {
      if (!wantKeys.has(key(r))) add('error', 'stale-external-ref', `${entry.path}#/externalRefs/${i}`, `${r.id} (owner ${r.ownerChunkId}) does not reach into ${entry.chunkId} or has another owner`, r.id)
    })
  }

  const play = playAreaRect(world.playArea)
  const solids = lowSolids(records)
  let player = false
  for (const r of records) {
    if (r.category !== 'spawns') continue
    const p = r.parts.playerSpawns?.[0]?.position ?? r.parts.zombieSpawns![0]
    const path = `${chunkPath(r.ownerChunkId)}#/spawns/${r.order[2]}`
    if (r.id === world.playerSpawn) player = !!r.parts.playerSpawns?.length
    if (p.x < play.minX || p.x > play.maxX || p.z < play.minZ || p.z > play.maxZ) add('error', 'spawn-outside-play-area', path, `spawn (${p.x}, ${p.z}) is outside the play area`, r.id)
    const blocker = blockingSolid(solids, p)
    if (blocker) add('error', 'spawn-blocked', path, `spawn (${p.x}, ${p.z}) is inside ${blocker.id}`, r.id)
  }
  if (!player) add('error', 'missing-player-spawn', 'world.json#/playerSpawn', `${world.playerSpawn} is not a player spawn of this world`)

  // Zone membership follows the runtime rule; a spawn standing in a zone it will not belong to is a design slip.
  const zones = records.flatMap((r) => r.parts.zones ?? [])
  for (const r of records) {
    const p = r.parts.zombieSpawns?.[0]
    if (!p) continue
    const inside = zones.filter((z) => zoneContains(z, p.x, p.z))
    const assigned = zoneFor(p, zones)
    if (inside.length && assigned && !inside.includes(assigned)) {
      add('warning', 'zone-assignment', `${chunkPath(r.ownerChunkId)}#/spawns/${r.order[2]}`, `zombie spawn (${p.x}, ${p.z}) lies in ${inside.map((z) => z.id).join(', ')} but belongs to ${assigned.id} (rectangles first, then nearest centre)`, r.id)
    }
  }

  // Surfaces of one layer share one height: differently coloured overlaps flicker (z-fighting) in the game.
  const roads = records.filter((r) => r.parts.roads?.length)
  for (let i = 0; i < roads.length; i++) {
    for (let j = i + 1; j < roads.length; j++) {
      const a = roads[i]
      const b = roads[j]
      const ra = a.parts.roads![0]
      const rb = b.parts.roads![0]
      if (ra.color === rb.color || (ra.layer ?? 0) !== (rb.layer ?? 0)) continue
      const overlaps = a.bounds.minX < b.bounds.maxX && b.bounds.minX < a.bounds.maxX && a.bounds.minZ < b.bounds.maxZ && b.bounds.minZ < a.bounds.maxZ
      if (overlaps) add('warning', 'surface-overlap', `${chunkPath(b.ownerChunkId)}#/roads/${b.order[2]}`, `${b.id} overlaps ${a.id} with another colour on the same layer (they share one height and flicker; set a different layer)`, b.id)
    }
  }

  for (const r of records) {
    if (r.category === 'spawns') continue
    const b = r.bounds
    if (b.minX < play.minX || b.maxX > play.maxX || b.minZ < play.minZ || b.maxZ > play.maxZ) {
      add('warning', 'outside-play-area', `${chunkPath(r.ownerChunkId)}#/${r.category}/${r.order[2]}`, `${r.id} extends beyond the play area`, r.id)
    }
  }
  return issues
}

/** Parse + validate every document of a world read through `read(path)`; throws on errors. */
export function loadWorldDocuments(read: (path: string) => unknown, opts: ValidationOptions = {}): { docs: WorldDocuments; issues: ValidationIssue[] } {
  const checked = checkWorldDocuments(read, opts)
  if (!checked.docs || hasErrors(checked.issues)) throw new MapContentError(checked.issues)
  return { docs: checked.docs, issues: checked.issues }
}

/**
 * Non-throwing form of `loadWorldDocuments` (editor Validate panel, drafts): every issue found.
 * `docs` is null when a document failed on its own; otherwise the world-level checks ran too and
 * `docs` is returned even if they found errors.
 */
export function checkWorldDocuments(read: (path: string) => unknown, opts: ValidationOptions = {}): { docs: WorldDocuments | null; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = []
  const readChecked = (path: string): unknown => {
    try {
      return read(path)
    } catch (e) {
      issues.push({ severity: 'error', code: 'missing-file', message: e instanceof Error ? e.message : String(e), path })
      return undefined
    }
  }
  const raw = readChecked('world.json')
  if (raw !== undefined) issues.push(...validateWorldDocument(raw))
  if (hasErrors(issues)) return { docs: null, issues }
  const world = raw as WorldDocument
  const prefabs = new Map<string, PrefabDocument>()
  for (const entry of world.prefabs) {
    const doc = readChecked(entry.path)
    if (doc === undefined) continue
    const found = validatePrefabDocument(doc, entry, opts)
    issues.push(...found)
    if (!hasErrors(found)) prefabs.set(entry.prefabId, doc as PrefabDocument)
  }
  const chunks = new Map<string, ChunkDocument>()
  for (const entry of world.chunks) {
    const doc = readChecked(entry.path)
    if (doc === undefined) continue
    const found = validateChunkDocument(doc, entry, world, opts)
    issues.push(...found)
    if (!hasErrors(found)) chunks.set(entry.chunkId, doc as ChunkDocument)
  }
  if (hasErrors(issues)) return { docs: null, issues }
  const docs: WorldDocuments = { world, prefabs, chunks }
  issues.push(...validateContent(docs))
  if (hasErrors(issues)) return { docs, issues }
  const migrations = checkContentMigrations(read, docs, issues)
  return { docs: migrations.length ? { ...docs, contentMigrations: migrations } : docs, issues }
}

/**
 * Content migrations (M8) for every revision below the current one. A missing step is a warning
 * (saves of that revision will be reported incompatible); a malformed file or a rename that does
 * not fit the next revision is an error.
 */
function checkContentMigrations(read: (path: string) => unknown, docs: WorldDocuments, issues: ValidationIssue[]): ContentMigration[] {
  const found: ContentMigration[] = []
  for (let v = 1; v < docs.world.contentVersion; v++) {
    const path = contentMigrationPath(v)
    let raw: unknown
    try {
      raw = read(path)
    } catch {
      issues.push({ severity: 'warning', code: 'content-migration-missing', path, message: `no migration from content v${v} to v${v + 1}: saves of v${v} will not load` })
      continue
    }
    const problems = contentMigrationShapeProblems(raw, v)
    for (const message of problems) issues.push({ severity: 'error', code: 'content-migration', path, message })
    if (!problems.length) found.push(raw as ContentMigration)
  }
  const current = statefulIds(resolveAll(docs).map((r) => r.parts))
  for (const m of found) {
    const next = m.toVersion === docs.world.contentVersion ? current : found.find((x) => x.fromVersion === m.toVersion)?.ids
    if (!next) continue
    for (const p of renameProblems(m, next)) issues.push({ severity: 'error', code: 'content-migration-rename', path: `${contentMigrationPath(m.fromVersion)}#/renamed`, message: p.message, entityId: p.from })
  }
  return found
}
