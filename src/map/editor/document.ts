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

/** Prefab and item at a validator path like `prefabs/house.json#/objects/3/width` (M5). */
export function prefabItemAtPath(doc: MapDocument, path: string): { prefabId: string; localId: string | null } | null {
  const [file, pointer = ''] = path.split('#')
  const entry = doc.world.prefabs.find((p) => p.path === file)
  const prefab = entry && doc.prefabs.get(entry.prefabId)
  if (!entry) return null
  if (!prefab) return { prefabId: entry.prefabId, localId: null }
  const [, list, index, sub] = pointer.split('/')
  if (list === 'objects') return { prefabId: entry.prefabId, localId: prefab.objects[Number(index)]?.localId ?? null }
  if (list === 'rooms') {
    const room = prefab.rooms[Number(index)]
    return { prefabId: entry.prefabId, localId: (sub === 'lamp' ? room?.lamp?.localId : room?.localId) ?? null }
  }
  return { prefabId: entry.prefabId, localId: null }
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
 * under the world and prefab-map identity, so a chunk edit only re-resolves the chunks it replaced
 * and a prefab edit (M5: new prefab map) re-resolves every instance.
 */
const resolveCache = new WeakMap<object, WeakMap<object, WeakMap<ChunkDocument, ResolvedRecord[]>>>()
export function resolvedRecords(doc: MapDocument): ResolvedRecord[] {
  return resolvedChunks(doc).flatMap((c) => c.records)
}

/**
 * Resolved records per owner chunk, in manifest order (M7: the viewport batches per chunk). A
 * chunk's list is the same array while the chunk object, prefabs and world are unchanged.
 */
export function resolvedChunks(doc: MapDocument): { chunkId: string; records: readonly ResolvedRecord[] }[] {
  let byPrefabs = resolveCache.get(doc.world)
  if (!byPrefabs) {
    byPrefabs = new WeakMap()
    resolveCache.set(doc.world, byPrefabs)
  }
  let perWorld = byPrefabs.get(doc.prefabs)
  if (!perWorld) {
    perWorld = new WeakMap()
    byPrefabs.set(doc.prefabs, perWorld)
  }
  const prefab = (id: string) => {
    const p = doc.prefabs.get(id)
    if (!p) throw new Error(`Unknown prefab ${id}`)
    return p
  }
  const out: { chunkId: string; records: readonly ResolvedRecord[] }[] = []
  for (const entry of doc.world.chunks) {
    const chunk = doc.chunks.get(entry.chunkId)
    if (!chunk) continue
    let list = perWorld.get(chunk)
    if (!list) {
      list = resolveChunk(doc.world, chunk, prefab)
      perWorld.set(chunk, list)
    }
    out.push({ chunkId: entry.chunkId, records: list })
  }
  return out
}

/**
 * Save as a new world: the same content under another worldId and name, as a world that was never
 * published. contentVersion restarts at 1 (no save holds its IDs yet); the source world's save
 * migrations (`migrations/…`, they convert that world's old saves), generator provenance and a
 * hidden `listed: false` are dropped (the copy shows in the game's world menu). Chunks, prefabs, record IDs and retired IDs are kept as they are (IDs never contain the
 * world ID), so the copy plays exactly like the source and the source is left untouched.
 */
export function forkDocument(doc: MapDocument, worldId: string, name: string): MapDocument {
  const world: WorldDocument = { ...doc.world, worldId, name, contentVersion: 1 }
  delete world.generator
  delete world.listed
  const extras = new Map([...doc.extras].filter(([path]) => !path.startsWith('migrations/')))
  return { world, prefabs: doc.prefabs, chunks: doc.chunks, extras }
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

/** Instance record IDs of a prefab across the world, in content order (M5: who a prefab edit affects). */
export function instancesOf(doc: MapDocument, prefabId: string): string[] {
  const out: string[] = []
  for (const e of doc.world.chunks) for (const inst of doc.chunks.get(e.chunkId)?.instances ?? []) if (inst.prefabId === prefabId) out.push(inst.instanceId)
  return out
}

/**
 * Stable IDs a save holds state for (doors, map containers, windows/curtains, lamps, zombie
 * zones): a save loads only when this set matches the map and the contentVersion is the same.
 * An edit that keeps the set is compatible with existing saves (M5).
 */
export function statefulEntityIds(doc: MapDocument): string[] {
  const ids: string[] = []
  for (const r of resolvedRecords(doc)) {
    const p = r.parts
    for (const d of p.doors ?? []) ids.push(d.id)
    for (const c of p.containers ?? []) ids.push(c.id)
    for (const w of p.windows ?? []) ids.push(w.id)
    for (const room of p.rooms ?? []) if (room.lamp) ids.push(room.lamp.id)
    for (const z of p.zones ?? []) ids.push(z.id)
  }
  return ids.sort()
}

export interface ChunkStatus {
  chunkId: string
  cx: number
  cz: number
  /** Records the chunk owns. */
  records: number
  /** Records owned elsewhere that reach into it. */
  refs: number
  /** Differs from the reference document (last open / draft save / export), or new. */
  modified: boolean
  errors: number
  warnings: number
}

/**
 * Per-chunk status for the chunk panel and the viewport outlines (M4). Every chunk of the document
 * is loaded in the editor; issues are attributed to a chunk by their file path.
 */
export function chunkStatuses(doc: MapDocument, reference: MapDocument | null, issues: readonly { severity: string; path: string }[]): ChunkStatus[] {
  return doc.world.chunks.map((e) => {
    const chunk = doc.chunks.get(e.chunkId)!
    const before = reference?.chunks.get(e.chunkId)
    const prefix = `${e.path}#`
    const mine = issues.filter((i) => i.path === e.path || i.path.startsWith(prefix))
    return {
      chunkId: e.chunkId,
      cx: e.cx,
      cz: e.cz,
      records: RECORD_CATEGORIES.reduce((n, c) => n + chunk[c].length, 0),
      refs: chunk.externalRefs.length,
      modified: !before || (before !== chunk && JSON.stringify(before) !== JSON.stringify(chunk)),
      errors: mine.filter((i) => i.severity === 'error').length,
      warnings: mine.filter((i) => i.severity !== 'error').length,
    }
  })
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
 * spawn and one zombie spawn so New Game works right away. More chunks: `addChunk` (M4).
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
