import {
  MAP_SCHEMA_VERSION,
  RECORD_CATEGORIES,
  RECORD_NAMESPACES,
  recordId,
  type ChunkDocument,
  type PrefabDocument,
  type RecordCategory,
  type WorldDocument,
  type XZ,
} from '../schema.ts'
import { chunkIdOf, chunkOrigin, quantize } from '../transform.ts'
import { resolveChunk, type ResolvedRecord } from '../resolve.ts'
import { computeExternalRefs, type WorldDocuments } from '../validate.ts'

/**
 * Editor document (M3): the serialisable content of one world — the same documents the runtime
 * loads, plus any other file of the world folder kept verbatim (`migrations/…`). Immutable: every
 * edit returns a new document that shares unchanged chunks/prefabs, so history entries are cheap
 * and a render cache keyed by chunk object only re-resolves what changed.
 * No camera, selection or timestamp lives here (that is `EditorSession`).
 */
export interface MapDocument extends WorldDocuments {
  world: WorldDocument
  prefabs: ReadonlyMap<string, PrefabDocument>
  chunks: ReadonlyMap<string, ChunkDocument>
  /** Other files of the world folder by relative path, exported unchanged. */
  extras: ReadonlyMap<string, unknown>
}

/** Where a record lives in the document. */
export interface RecordLocation {
  chunkId: string
  category: RecordCategory
  index: number
  record: AnyRecord
}

export type AnyRecord = Record<string, unknown>

export const ID_KEY: Record<RecordCategory, string> = {
  instances: 'instanceId',
  objects: 'objectId',
  roads: 'roadId',
  zones: 'zoneId',
  spawns: 'spawnId',
}

/** Chunk-local anchor of a record (instances/objects/roads/spawns: `position`, zones: `center`). */
export function anchorKey(category: RecordCategory): 'position' | 'center' {
  return category === 'zones' ? 'center' : 'position'
}

export function recordAnchor(category: RecordCategory, record: AnyRecord): XZ {
  return record[anchorKey(category)] as XZ
}

/** World anchor of a record owned by `chunk`. */
export function worldAnchor(doc: MapDocument, loc: RecordLocation): XZ {
  const chunk = doc.chunks.get(loc.chunkId)!
  const o = chunkOrigin(chunk.cx, chunk.cz, doc.world.chunkSize)
  const a = recordAnchor(loc.category, loc.record)
  return { x: quantize(o.x + a.x), z: quantize(o.z + a.z) }
}

export function findRecord(doc: MapDocument, id: string): RecordLocation | null {
  for (const entry of doc.world.chunks) {
    const chunk = doc.chunks.get(entry.chunkId)
    if (!chunk) continue
    for (const category of RECORD_CATEGORIES) {
      const list = chunk[category] as unknown as AnyRecord[]
      const index = list.findIndex((r) => recordId(category, r) === id)
      if (index >= 0) return { chunkId: entry.chunkId, category, index, record: list[index] }
    }
  }
  return null
}

/** Every record ID in the document, in content order. */
export function allRecordIds(doc: MapDocument): string[] {
  const out: string[] = []
  for (const entry of doc.world.chunks) {
    const chunk = doc.chunks.get(entry.chunkId)
    if (!chunk) continue
    for (const category of RECORD_CATEGORIES) for (const r of chunk[category]) out.push(recordId(category, r))
  }
  return out
}

/** Records whose ID or entity ID matches (an issue on `c0_0/house/door` selects `c0_0/house`). */
export function recordForEntity(doc: MapDocument, entityId: string): string | null {
  const ids = allRecordIds(doc)
  if (ids.includes(entityId)) return entityId
  return ids.find((id) => entityId.startsWith(`${id}/`)) ?? null
}

/** Record at a validator path like `chunks/c0_0.json#/instances/2/position`. */
export function recordAtPath(doc: MapDocument, path: string): string | null {
  const [file, pointer = ''] = path.split('#')
  const entry = doc.world.chunks.find((c) => c.path === file)
  const chunk = entry && doc.chunks.get(entry.chunkId)
  if (!chunk) return null
  const [, category, index] = pointer.split('/')
  if (!(RECORD_CATEGORIES as readonly string[]).includes(category)) return null
  const r = (chunk[category as RecordCategory] as unknown as AnyRecord[])[Number(index)]
  return r ? recordId(category as RecordCategory, r) : null
}

/** Recompute every chunk's `externalRefs` (derived data); chunks whose list is unchanged keep their object. */
export function withExternalRefs(doc: MapDocument): MapDocument {
  const refs = computeExternalRefs(doc, resolvedRecords(doc))
  let chunks: Map<string, ChunkDocument> | null = null
  for (const [chunkId, want] of refs) {
    const chunk = doc.chunks.get(chunkId)
    if (!chunk) continue
    const same = chunk.externalRefs.length === want.length && chunk.externalRefs.every((r, i) => r.id === want[i].id && r.ownerChunkId === want[i].ownerChunkId)
    if (same) continue
    chunks ??= new Map(doc.chunks)
    chunks.set(chunkId, { ...chunk, externalRefs: want })
  }
  return chunks ? { ...doc, chunks } : doc
}

/**
 * Resolved records of the whole document, for the viewport and picking. Cached per chunk object
 * (and world/prefab identity), so an edit only re-resolves the chunks it replaced.
 */
const resolveCache = new WeakMap<object, WeakMap<ChunkDocument, ResolvedRecord[]>>()
export function resolvedRecords(doc: MapDocument): ResolvedRecord[] {
  let perWorld = resolveCache.get(doc.world)
  if (!perWorld) {
    perWorld = new WeakMap()
    resolveCache.set(doc.world, perWorld)
  }
  const prefab = (id: string) => {
    const p = doc.prefabs.get(id)
    if (!p) throw new Error(`Unknown prefab ${id}`)
    return p
  }
  const out: ResolvedRecord[] = []
  for (const entry of doc.world.chunks) {
    const chunk = doc.chunks.get(entry.chunkId)
    if (!chunk) continue
    let list = perWorld.get(chunk)
    if (!list) {
      list = resolveChunk(doc.world, chunk, prefab)
      perWorld.set(chunk, list)
    }
    out.push(...list)
  }
  return out
}

/** A document from content already split into world/prefabs/chunks (bundled worlds, tests). */
export function documentFrom(docs: WorldDocuments, extras: ReadonlyMap<string, unknown> = new Map()): MapDocument {
  return { world: docs.world, prefabs: docs.prefabs, chunks: docs.chunks, extras }
}

/** Files of the document in export order: world.json, prefabs and chunks in manifest order, then extras sorted by path. */
export function documentFiles(doc: MapDocument): [string, unknown][] {
  const files: [string, unknown][] = [['world.json', doc.world]]
  for (const e of doc.world.prefabs) files.push([e.path, doc.prefabs.get(e.prefabId)])
  for (const e of doc.world.chunks) files.push([e.path, doc.chunks.get(e.chunkId)])
  const extras = [...doc.extras.keys()].sort()
  for (const path of extras) files.push([path, doc.extras.get(path)])
  return files
}

export interface BlankWorldOptions {
  worldId: string
  name: string
  /** Prefab library copied into the new world. */
  prefabs: { entry: WorldDocument['prefabs'][number]; doc: PrefabDocument }[]
  chunkSize?: number
}

/**
 * New world: 2 × 2 chunks around the origin (the play area is centred on it), a fence, the player
 * spawn and one zombie spawn so New Game works right away. Chunk creation arrives with M4.
 */
export function blankDocument(opts: BlankWorldOptions): MapDocument {
  const S = opts.chunkSize ?? 32
  const cells = [
    [-1, -1],
    [0, -1],
    [-1, 0],
    [0, 0],
  ]
  const chunks = new Map<string, ChunkDocument>()
  for (const [cx, cz] of cells) {
    const chunkId = chunkIdOf(cx, cz)
    chunks.set(chunkId, { schemaVersion: MAP_SCHEMA_VERSION, contentVersion: 1, chunkId, cx, cz, instances: [], objects: [], roads: [], zones: [], spawns: [], externalRefs: [] })
  }
  const start = chunks.get('c0_0')!
  start.spawns.push({ spawnId: `c0_0/${RECORD_NAMESPACES.spawns}/player-start`, kind: 'player', position: { x: 2, z: 2 } })
  const far = chunks.get('c-1_-1')!
  far.spawns.push({ spawnId: `c-1_-1/${RECORD_NAMESPACES.spawns}/zombie-1`, kind: 'zombie', position: { x: S - 12, z: S - 12 } })
  const world: WorldDocument = {
    schemaVersion: MAP_SCHEMA_VERSION,
    worldId: opts.worldId,
    name: opts.name,
    contentVersion: 1,
    chunkSize: S,
    coordinateSystem: 'y-up-xz-meters',
    playArea: { size: 2 * S - 4 },
    boundary: { height: 2, thickness: 1 },
    chunkBounds: { minCx: -1, maxCx: 0, minCz: -1, maxCz: 0 },
    chunks: cells.map(([cx, cz]) => ({ chunkId: chunkIdOf(cx, cz), cx, cz, path: `chunks/${chunkIdOf(cx, cz)}.json` })),
    prefabs: opts.prefabs.map((p) => ({ ...p.entry })),
    playerSpawn: 'c0_0/spawns/player-start',
  }
  return { world, prefabs: new Map(opts.prefabs.map((p) => [p.entry.prefabId, p.doc])), chunks, extras: new Map() }
}
