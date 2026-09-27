import {
  MAP_SCHEMA_VERSION,
  type CompoundDocument,
  type CompoundInstance,
  type CompoundObject,
  type LibraryGroup,
  type LibraryInfo,
  type LibrarySource,
  type PrefabCategory,
  type PrefabDocument,
  type QuarterTurns,
  type RecordCategory,
  type ChunkDocument,
  type Rect,
  type StandaloneObject,
  type WorldDocument,
  type XZ,
} from '../schema.ts'
import { resolveChunk, type ResolvedRecord } from '../resolve.ts'
import { addQuarterTurns, PREFAB_ID, quantize, rotateXZ } from '../transform.ts'
import { canonicalJson, hashText } from '../layout/geometry.ts'
import { validateCompoundDocument, type ValidationIssue, type ValidationOptions } from '../validate.ts'
import { GROUPS_FILE, groupsProblem } from './groups.ts'
import { freshId, ownerChunk, writeRecords, type CommandResult, type RecordPut } from './commands.ts'
import { findRecord, instancesOf, resolvedRecords, statefulEntityIds, worldAnchor, withExternalRefs, type AnyRecord, type MapDocument } from './document.ts'
import {
  currentMemberHash,
  documentGroups,
  freshGroupId,
  fullGroups,
  liveMembers,
  memberHash,
  memberLocal,
  modifiedMembers,
  newGroup,
  slugify,
  turnAbout,
  turnRecord,
  withGroups,
  type CompoundGroup,
  type GroupMember,
} from './groups.ts'
import { isStatefulItem, uniquePrefabPath, usedLocalIds } from './prefabCommands.ts'

/**
 * Shared prefab library (prefab library P1). The repo world `prefab-library` (hidden from the game's
 * menu) is the library: its prefabs are the building prefabs, its `compounds/*.json` the compound
 * prefabs. It is where content is managed, never something the game needs: a world that uses a
 * library entry holds its own copy.
 *
 * - Copy-on-import: "Thêm vào world" copies a prefab into the world with its stable ID (or a new ID
 *   when the world already has another prefab with that one) and `source` = library, ID, version and
 *   content hash. The copy stays exactly as imported whatever the library does later.
 * - Updates are offered, never applied by themselves: a newer library copy is detected by its hash,
 *   previewed (items added, removed, changed, instances affected), refused when it would drop IDs a
 *   save holds state for or reuse an ID the world retired, and it never overwrites a copy edited in
 *   the world unless the author asks.
 * - Compounds are expanded into ordinary records plus an editor group (`groups.ts`); the prefabs they
 *   use are imported like above, a placed compound pins the version it came from.
 */

export const LIBRARY_WORLD = 'prefab-library'
/** Folder of the compound files in the library world (editor only: never bundled with the game). */
export const COMPOUND_DIR = 'compounds/'

const fail = (error: string): CommandResult => ({ ok: false, error })

export interface SharedLibrary {
  worldId: string
  contentVersion: number
  prefabs: ReadonlyMap<string, PrefabDocument>
  compounds: ReadonlyMap<string, CompoundDocument>
  /** Path of each compound file by compound ID. */
  compoundPaths: ReadonlyMap<string, string>
  /** Problems of compound files (a broken file is left out of the library). */
  issues: ValidationIssue[]
}

/** The library from a library world's files (`world.json`, prefabs, `compounds/…`), or null without a manifest. */
export function libraryFromFiles(files: ReadonlyMap<string, unknown>, opts: ValidationOptions = {}): SharedLibrary | null {
  const world = files.get('world.json') as WorldDocument | undefined
  if (!world || !Array.isArray(world.prefabs)) return null
  const prefabs = new Map<string, PrefabDocument>()
  for (const e of world.prefabs) {
    const doc = files.get(e.path) as PrefabDocument | undefined
    if (doc) prefabs.set(e.prefabId, doc)
  }
  return withCompounds(world, prefabs, files, opts)
}

/** The library from an open document (the library world itself being edited: its live content). */
export function libraryFromDocument(doc: MapDocument, opts: ValidationOptions = {}): SharedLibrary {
  return withCompounds(doc.world, doc.prefabs, doc.extras, opts)
}

function withCompounds(world: WorldDocument, prefabs: ReadonlyMap<string, PrefabDocument>, files: ReadonlyMap<string, unknown>, opts: ValidationOptions): SharedLibrary {
  const compounds = new Map<string, CompoundDocument>()
  const compoundPaths = new Map<string, string>()
  const issues: ValidationIssue[] = []
  const ids = new Set(prefabs.keys())
  for (const [path, raw] of [...files].filter(([p]) => p.startsWith(COMPOUND_DIR) && p.endsWith('.json')).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const found = validateCompoundDocument(raw, path, { ...opts, prefabs: ids })
    issues.push(...found)
    if (found.some((i) => i.severity === 'error')) continue
    const c = raw as CompoundDocument
    if (compounds.has(c.compoundId)) {
      issues.push({ severity: 'error', code: 'duplicate-id', message: `compound ${c.compoundId} also in ${compoundPaths.get(c.compoundId)}`, path })
      continue
    }
    compounds.set(c.compoundId, c)
    compoundPaths.set(c.compoundId, path)
  }
  return { worldId: world.worldId, contentVersion: world.contentVersion, prefabs, compounds, compoundPaths, issues }
}

/**
 * Editor issues of the library files a document carries (warnings: the game never reads them): the
 * compound files of the library world and the groups file. A broken compound is left out of the
 * library, a broken groups file ignored.
 */
export function documentLibraryIssues(doc: MapDocument, opts: ValidationOptions = {}): ValidationIssue[] {
  const out: ValidationIssue[] = []
  const raw = doc.extras.get(GROUPS_FILE)
  const problem = raw === undefined ? null : groupsProblem(raw)
  if (problem) out.push({ severity: 'warning', code: 'groups-file', message: `${GROUPS_FILE}: ${problem} (các nhóm bị bỏ qua)`, path: GROUPS_FILE })
  if ([...doc.extras.keys()].some((p) => p.startsWith(COMPOUND_DIR))) out.push(...libraryFromDocument(doc, opts).issues.map((i) => ({ ...i, severity: 'warning' as const })))
  return out
}

const CATEGORY_GROUP: Record<PrefabCategory, LibraryGroup> = { house: 'residential', shop: 'commercial', industrial: 'industrial', public: 'public', outbuilding: 'residential' }

/** Library group of a prefab: its catalog's, else from its generator category, else residential. */
export function libraryGroupOf(p: PrefabDocument): LibraryGroup {
  return p.catalog?.group ?? (p.placement ? CATEGORY_GROUP[p.placement.category] : 'residential')
}

// ---- Content hashes ----

/**
 * Hash of a prefab's content: everything but its identity and bookkeeping (`prefabId`, `source`,
 * `contentVersion`, `retiredLocalIds`), so a copy imported under another ID or updated keeps the hash
 * of the library content it holds, and any edit in the world changes it.
 */
export function prefabHash(p: PrefabDocument): string {
  const { prefabId: _id, source: _source, contentVersion: _version, retiredLocalIds: _retired, ...content } = p
  return `cyrb53:${hashText(canonicalJson(content))}`
}

/** Hash of a compound's content (without `compoundId` and `contentVersion`). */
export function compoundHash(c: CompoundDocument): string {
  const { compoundId: _id, contentVersion: _version, ...content } = c
  return `cyrb53:${hashText(canonicalJson(content))}`
}

// ---- Library prefabs in a world ----

/** The world's copy of a library prefab (tracked by `source`), whatever its ID in the world. */
export function trackedCopy(doc: MapDocument, lib: SharedLibrary, libId: string): PrefabDocument | null {
  for (const p of doc.prefabs.values()) if (p.source?.library === lib.worldId && p.source.id === libId) return p
  return null
}

/**
 * - `absent`: not in the world;
 * - `current`: the world's copy holds the library's content;
 * - `outdated`: the library has changed since the import, the copy was not edited;
 * - `modified`: the copy was edited in the world, the library has not changed;
 * - `modified-outdated`: both;
 * - `id-taken`: not imported, and the world has another prefab with that ID (`identical` when its
 *   content is the library's: it can simply be linked).
 */
export type LibraryState = 'absent' | 'current' | 'outdated' | 'modified' | 'modified-outdated' | 'id-taken'

export interface PrefabLibraryStatus {
  libId: string
  state: LibraryState
  /** ID of the world prefab concerned (the copy, or the prefab holding the ID). */
  worldPrefabId?: string
  libVersion: number
  /** Library version the copy was imported from. */
  importedVersion?: number
  identical?: boolean
}

export function prefabStatus(doc: MapDocument, lib: SharedLibrary, libId: string): PrefabLibraryStatus {
  const lp = lib.prefabs.get(libId)!
  const copy = trackedCopy(doc, lib, libId)
  if (copy) {
    const src = copy.source!
    const outdated = src.hash !== prefabHash(lp)
    const modified = prefabHash(copy) !== src.hash
    const state: LibraryState = outdated ? (modified ? 'modified-outdated' : 'outdated') : modified ? 'modified' : 'current'
    return { libId, state, worldPrefabId: copy.prefabId, libVersion: lp.contentVersion, importedVersion: src.version }
  }
  const taken = doc.prefabs.get(libId)
  if (taken) return { libId, state: 'id-taken', worldPrefabId: libId, libVersion: lp.contentVersion, identical: prefabHash(taken) === prefabHash(lp) }
  return { libId, state: 'absent', libVersion: lp.contentVersion }
}

/** First free prefab ID `<id>-<n>` (n ≥ 2) in the world. */
export function freePrefabId(doc: MapDocument, base: string): string {
  const stem = base.replace(/-\d+$/, '')
  for (let n = 2; ; n++) if (!doc.prefabs.has(`${stem}-${n}`)) return `${stem}-${n}`
}

function sourceOf(lib: SharedLibrary, libId: string, p: PrefabDocument): LibrarySource {
  return { library: lib.worldId, id: libId, version: p.contentVersion, hash: prefabHash(p) }
}

/**
 * Copy a library prefab into the world (copy-on-import), as `as` (default its library ID). Refused
 * when the world already holds a copy, or another prefab with that ID (ID conflict: import it under
 * a free ID, `freePrefabId`, or link an identical one with `linkPrefab`).
 */
export function importPrefab(doc: MapDocument, lib: SharedLibrary, libId: string, as: string = libId): CommandResult {
  const lp = lib.prefabs.get(libId)
  if (!lp) return fail(`Thư viện không có prefab ${libId}`)
  if (doc.world.worldId === lib.worldId) return fail('Đây là chính world thư viện')
  const copy = trackedCopy(doc, lib, libId)
  if (copy) return fail(`${libId} đã có trong world (${copy.prefabId}, v${copy.source!.version})`)
  if (!PREFAB_ID.test(as)) return fail(`prefabId "${as}" không hợp lệ`)
  if (doc.prefabs.has(as)) return fail(`World đã có prefab ${as} khác nguồn: nhập với ID mới (${freePrefabId(doc, as)}) hoặc liên kết nếu giống hệt`)
  const prefab: PrefabDocument = { ...structuredClone(lp), prefabId: as, source: sourceOf(lib, libId, lp) }
  const world = { ...doc.world, prefabs: [...doc.world.prefabs, { prefabId: as, contentVersion: prefab.contentVersion, path: uniquePrefabPath(doc, as) }] }
  const prefabs = new Map(doc.prefabs).set(as, prefab)
  return { ok: true, doc: withExternalRefs({ ...doc, world, prefabs }), selection: [], note: as === libId ? `Nhập ${libId} v${lp.contentVersion} từ thư viện` : `Nhập ${libId} v${lp.contentVersion} từ thư viện với ID mới ${as} (world đã có ${libId} khác)` }
}

/**
 * A world prefab with the library ID and exactly the library's content (a world made before the
 * library tracked imports): record its source so updates are offered. Nothing else changes.
 */
export function linkPrefab(doc: MapDocument, lib: SharedLibrary, libId: string): CommandResult {
  const lp = lib.prefabs.get(libId)
  const p = doc.prefabs.get(libId)
  if (!lp || !p) return fail(`Không có ${libId} ở cả world và thư viện`)
  if (p.source) return fail(`${libId} đã có nguồn ${p.source.library}`)
  if (prefabHash(p) !== prefabHash(lp)) return fail(`${libId} trong world khác bản thư viện: nhập bản thư viện với ID mới`)
  const prefabs = new Map(doc.prefabs).set(libId, { ...p, source: sourceOf(lib, libId, lp) })
  return { ok: true, doc: { ...doc, prefabs }, selection: [], note: `Liên kết ${libId} với thư viện` }
}

// ---- Updating a copy from the library ----

export interface UpdateOptions {
  /** Replace a copy edited in the world (its edits are lost). */
  overwriteLocal?: boolean
  /** Accept dropping IDs saves hold state for (the world then needs a new contentVersion). */
  acceptStateChanges?: boolean
}

export interface PrefabUpdatePlan {
  worldPrefabId: string
  libId: string
  fromVersion: number
  toVersion: number
  /** The copy was edited in the world since its import. */
  modifiedInWorld: boolean
  /** Instances in the world that change with it. */
  instances: string[]
  added: string[]
  removed: string[]
  changed: string[]
  /** Removed local IDs a save holds state for (door, container, window, lamp): `<instance>/<id>` state is lost. */
  removedStateful: string[]
  /** Library local IDs the world copy retired (a save could attach old state to them): never allowed. */
  reusedRetired: string[]
  footprintChanged: boolean
  /** Why the update can't be applied as asked (empty: `doc` holds the result). */
  blockers: string[]
  doc: MapDocument | null
}

/** Items of a prefab by local ID (objects, rooms, lamps), as canonical JSON for comparison. */
function itemTexts(p: PrefabDocument): Map<string, string> {
  const out = new Map<string, string>()
  for (const o of p.objects) out.set(o.localId, canonicalJson(o))
  for (const r of p.rooms) {
    const { lamp, ...room } = r
    out.set(r.localId, canonicalJson(room))
    if (lamp) out.set(lamp.localId, canonicalJson(lamp))
  }
  return out
}

/**
 * Preview of updating the world's copy `worldPrefabId` to the library's current content: what
 * changes, what it costs saves, and whether it may be applied. The result keeps the world's prefab
 * ID and file; its retired IDs are the union of both, plus every ID the update removes.
 */
export function planPrefabUpdate(doc: MapDocument, lib: SharedLibrary, worldPrefabId: string, opts: UpdateOptions = {}): PrefabUpdatePlan | string {
  const copy = doc.prefabs.get(worldPrefabId)
  if (!copy?.source || copy.source.library !== lib.worldId) return `${worldPrefabId} không nhập từ thư viện ${lib.worldId}`
  const lp = lib.prefabs.get(copy.source.id)
  if (!lp) return `Thư viện không còn prefab ${copy.source.id}`
  if (copy.source.hash === prefabHash(lp)) return `${worldPrefabId} đã là bản mới nhất của thư viện (v${lp.contentVersion})`
  const before = itemTexts(copy)
  const after = itemTexts(lp)
  const added = [...after.keys()].filter((k) => !before.has(k))
  const removed = [...before.keys()].filter((k) => !after.has(k))
  const changed = [...after.keys()].filter((k) => before.has(k) && before.get(k) !== after.get(k))
  const instances = instancesOf(doc, worldPrefabId)
  const removedStateful = instances.length ? removed.filter((k) => isStatefulItem(copy, k)) : []
  const retired = new Set(copy.retiredLocalIds ?? [])
  const reusedRetired = [...after.keys()].filter((k) => retired.has(k))
  const modifiedInWorld = prefabHash(copy) !== copy.source.hash
  const blockers: string[] = []
  if (modifiedInWorld && !opts.overwriteLocal) blockers.push(`${worldPrefabId} đã được sửa trong world: cập nhật sẽ bỏ các sửa đó (chọn "Ghi đè bản sửa trong world" nếu chắc chắn)`)
  if (removedStateful.length && !opts.acceptStateChanges) blockers.push(`Bỏ ${removedStateful.join(', ')} của ${instances.length} instance: save cũ giữ trạng thái của chúng sẽ không khớp (chọn "Chấp nhận đổi ID có trạng thái", rồi tăng contentVersion của world)`)
  if (reusedRetired.length) blockers.push(`Thư viện dùng lại local ID mà world đã khóa (${reusedRetired.join(', ')}): save cũ có thể gắn nhầm trạng thái. Nhập bản thư viện thành prefab mới thay vì cập nhật`)
  const footprintChanged = canonicalJson([copy.footprint, copy.outline, copy.pivot]) !== canonicalJson([lp.footprint, lp.outline, lp.pivot])
  const plan: PrefabUpdatePlan = { worldPrefabId, libId: copy.source.id, fromVersion: copy.source.version, toVersion: lp.contentVersion, modifiedInWorld, instances, added, removed, changed, removedStateful, reusedRetired, footprintChanged, blockers, doc: null }
  if (blockers.length) return plan
  const next: PrefabDocument = { ...structuredClone(lp), prefabId: worldPrefabId, source: sourceOf(lib, copy.source.id, lp) }
  const used = usedLocalIds(next)
  const retiredIds = [...new Set([...(copy.retiredLocalIds ?? []), ...(lp.retiredLocalIds ?? []), ...removed])].filter((k) => !used.has(k)).sort()
  if (retiredIds.length) next.retiredLocalIds = retiredIds
  else delete next.retiredLocalIds
  const world = { ...doc.world, prefabs: doc.world.prefabs.map((e) => (e.prefabId === worldPrefabId ? { ...e, contentVersion: next.contentVersion } : e)) }
  plan.doc = withExternalRefs({ ...doc, world, prefabs: new Map(doc.prefabs).set(worldPrefabId, next) })
  return plan
}

// ---- Compounds ----

/**
 * World prefab IDs for the library prefabs a compound uses, importing the missing ones (a free ID
 * when the library ID is taken by another prefab). A copy already in the world is used as it is,
 * even an older one: the world keeps its pinned version (`notes` says so).
 */
function preparePrefabs(doc: MapDocument, lib: SharedLibrary, libIds: readonly string[]): { doc: MapDocument; map: Map<string, string>; notes: string[] } | string {
  let d = doc
  const map = new Map<string, string>()
  const notes: string[] = []
  const inLibrary = doc.world.worldId === lib.worldId
  for (const libId of new Set(libIds)) {
    if (inLibrary) {
      if (!doc.prefabs.has(libId)) return `World thư viện không có prefab ${libId}`
      map.set(libId, libId)
      continue
    }
    const copy = trackedCopy(d, lib, libId)
    if (copy) {
      map.set(libId, copy.prefabId)
      const st = prefabStatus(d, lib, libId).state
      if (st === 'outdated' || st === 'modified-outdated') notes.push(`${copy.prefabId} trong world là bản v${copy.source!.version}, thư viện có bản mới hơn (giữ bản của world)`)
      continue
    }
    const as = d.prefabs.has(libId) ? freePrefabId(d, libId) : libId
    const r = importPrefab(d, lib, libId, as)
    if (!r.ok) return r.error
    d = r.doc
    map.set(libId, as)
    notes.push(r.note!)
  }
  return { doc: d, map, notes }
}

/** A compound member as a world record (ID `id`, anchor in world coordinates), placed at `at` turned `turns`. */
function memberRecord(m: CompoundInstance | CompoundObject, category: 'instances' | 'objects', id: string, anchor: XZ, turns: number, prefabMap: ReadonlyMap<string, string>): AnyRecord {
  if (category === 'instances') {
    const inst = m as CompoundInstance
    return { instanceId: id, prefabId: prefabMap.get(inst.prefabId)!, position: { x: anchor.x, y: inst.position.y, z: anchor.z }, quarterTurns: addQuarterTurns(inst.quarterTurns, turns), ...(inst.visual ? { visual: { ...inst.visual } } : {}) }
  }
  const { member: _m, kind, ...rest } = structuredClone(m as CompoundObject) as AnyRecord
  const rec: AnyRecord = { kind, objectId: id, ...rest, position: { ...(rest.position as AnyRecord), x: anchor.x, z: anchor.z } }
  return turnRecord('objects', rec, turns) ?? rec
}

/** Members of a compound in content order: buildings first, then objects. */
function compoundMembers(c: CompoundDocument): { m: CompoundInstance | CompoundObject; category: 'instances' | 'objects' }[] {
  return [...c.instances.map((m) => ({ m, category: 'instances' as const })), ...c.objects.map((m) => ({ m, category: 'objects' as const }))]
}

function memberAnchor(m: CompoundInstance | CompoundObject, at: XZ, turns: number): XZ {
  return turnAbout({ x: quantize(at.x + m.position.x), z: quantize(at.z + m.position.z) }, at, turns)
}

/**
 * Place a library compound with its pivot at `at`, turned `turns`: its prefabs imported if needed,
 * each member a new record `<chunk>/<name>-<member>-<n>`, and a group holding them with the compound
 * version it came from. Refused whole when a member would fall outside the world's chunks.
 */
export function placeCompound(doc: MapDocument, lib: SharedLibrary, compoundId: string, at: XZ, turns: QuarterTurns): CommandResult {
  const c = lib.compounds.get(compoundId)
  if (!c) return fail(`Thư viện không có compound ${compoundId}`)
  const prep = preparePrefabs(doc, lib, c.instances.map((i) => i.prefabId))
  if (typeof prep === 'string') return fail(prep)
  let d = prep.doc
  const groups = documentGroups(d)
  const stem = slugify(compoundId.split('/').pop()!) || 'compound'
  const groupId = freshGroupId(groups, stem)
  const puts: RecordPut[] = []
  const members: GroupMember[] = []
  const taken = new Set<string>()
  for (const { m, category } of compoundMembers(c)) {
    const anchor = memberAnchor(m, at, turns)
    const owner = ownerChunk(d, anchor)
    if (!owner) return fail(`${c.name}: phần "${m.member}" sẽ nằm ngoài các chunk của world (${anchor.x}, ${anchor.z}) — thêm chunk ở tab Chunk`)
    const id = freshId(d, owner.chunkId, category, `${stem}-${m.member}`, taken)
    taken.add(id)
    const record = memberRecord(m, category, id, anchor, turns, prep.map)
    puts.push({ category, record })
    members.push({ member: m.member, id, hash: memberHash(memberLocal(category, record, anchor, at, turns)) })
  }
  const r = writeRecords(d, puts)
  if (!r.ok) return r
  d = r.doc
  const group: CompoundGroup = { groupId, name: c.name, compoundId, source: { library: lib.worldId, id: compoundId, version: c.contentVersion, hash: compoundHash(c) }, pivot: { ...at }, quarterTurns: turns, members }
  d = withGroups(d, [...documentGroups(d), group])
  return { ok: true, doc: d, selection: members.map((m) => m.id), note: [`Đặt compound ${c.name} (${compoundId} v${c.contentVersion}), nhóm ${groupId}`, ...prep.notes].join('. ') }
}

/**
 * A compound resolved with the library's prefabs, members at their positions around the pivot, unturned
 * (thumbnails, the library panel). Members IDs are `<member>`-based placeholders: never content.
 */
export function compoundRecords(c: CompoundDocument, lib: SharedLibrary): ResolvedRecord[] {
  const chunk: ChunkDocument = {
    schemaVersion: MAP_SCHEMA_VERSION,
    contentVersion: 1,
    chunkId: 'c0_0',
    cx: 0,
    cz: 0,
    instances: c.instances.filter((i) => lib.prefabs.has(i.prefabId)).map((i) => ({ instanceId: `c0_0/${i.member}`, prefabId: i.prefabId, position: { ...i.position }, quarterTurns: i.quarterTurns })),
    objects: c.objects.map((o) => {
      const { member, ...rest } = o
      return { ...rest, objectId: `c0_0/objects/${member}` } as StandaloneObject
    }),
    roads: [],
    zones: [],
    spawns: [],
    externalRefs: [],
  }
  const world = { chunks: [], chunkSize: 32 } as unknown as WorldDocument
  return resolveChunk(world, chunk, (id) => lib.prefabs.get(id)!)
}

/** Is a newer library version of this group's compound available? */
export function compoundGroupOutdated(g: CompoundGroup, lib: SharedLibrary): boolean {
  if (!g.source || g.source.library !== lib.worldId || !g.compoundId) return false
  const c = lib.compounds.get(g.compoundId)
  return !!c && compoundHash(c) !== g.source.hash
}

export interface CompoundUpdatePlan {
  groupId: string
  compoundId: string
  fromVersion: number
  toVersion: number
  /** Members replaced by the new version (same record IDs). */
  replaced: string[]
  /** New members (new records). */
  added: string[]
  /** Members the new version drops (records deleted, IDs retired). */
  removed: string[]
  /** Members edited by hand, kept as they are (unless overwrite). */
  keptModified: string[]
  /** Members deleted by hand, left deleted. */
  missing: string[]
  /** Hand-edited members the new version drops: kept, taken out of the group. */
  detached: string[]
  /** Stateful IDs (doors, containers, windows, lamps) the update removes from the world. */
  removedStateful: string[]
  notes: string[]
  blockers: string[]
  doc: MapDocument | null
}

/**
 * Preview of updating a placed compound to the library's current version. Unmodified members are
 * replaced in place (same IDs, so saves keep their state where the member still exists); members
 * edited by hand are kept unless `overwriteLocal`; new members are added; dropped ones deleted.
 */
export function planCompoundUpdate(doc: MapDocument, lib: SharedLibrary, groupId: string, opts: UpdateOptions = {}): CompoundUpdatePlan | string {
  const g = documentGroups(doc).find((x) => x.groupId === groupId)
  if (!g) return `Không có nhóm ${groupId}`
  if (!g.compoundId || g.source?.library !== lib.worldId) return `Nhóm ${groupId} không đặt từ thư viện ${lib.worldId}`
  const c = lib.compounds.get(g.compoundId)
  if (!c) return `Thư viện không còn compound ${g.compoundId}`
  if (compoundHash(c) === g.source.hash) return `${g.name} đã là bản mới nhất (v${c.contentVersion})`
  const prep = preparePrefabs(doc, lib, c.instances.map((i) => i.prefabId))
  if (typeof prep === 'string') return prep
  let d = prep.doc
  const modified = new Set(modifiedMembers(doc, g))
  const byName = new Map(g.members.map((m) => [m.member, m]))
  const plan: CompoundUpdatePlan = { groupId, compoundId: g.compoundId, fromVersion: g.source.version, toVersion: c.contentVersion, replaced: [], added: [], removed: [], keptModified: [], missing: [], detached: [], removedStateful: [], notes: [...prep.notes], blockers: [], doc: null }
  const puts: RecordPut[] = []
  const remove: string[] = []
  const members: GroupMember[] = []
  const taken = new Set<string>()
  const stem = slugify(g.compoundId.split('/').pop()!) || 'compound'
  const wanted = new Set<string>()
  for (const { m, category } of compoundMembers(c)) {
    wanted.add(m.member)
    const old = byName.get(m.member)
    const loc = old ? findRecord(doc, old.id) : null
    if (old && !loc) {
      plan.missing.push(m.member)
      continue
    }
    if (old && modified.has(old.id) && !opts.overwriteLocal) {
      plan.keptModified.push(m.member)
      members.push(old)
      continue
    }
    const anchor = memberAnchor(m, g.pivot, g.quarterTurns)
    let id: string
    if (old && loc!.category === category) {
      id = old.id
      plan.replaced.push(m.member)
    } else {
      if (old) remove.push(old.id)
      const owner = ownerChunk(d, anchor)
      if (!owner) return `${c.name}: phần "${m.member}" sẽ nằm ngoài các chunk của world`
      id = freshId(d, owner.chunkId, category, `${stem}-${m.member}`, taken)
      taken.add(id)
      plan.added.push(m.member)
    }
    const record = memberRecord(m, category, id, anchor, g.quarterTurns, prep.map)
    puts.push({ category, record })
    members.push({ member: m.member, id, hash: memberHash(memberLocal(category, record, anchor, g.pivot, g.quarterTurns)) })
  }
  for (const old of g.members) {
    if (wanted.has(old.member) || !findRecord(doc, old.id)) continue
    if (modified.has(old.id) && !opts.overwriteLocal) plan.detached.push(old.member)
    else {
      remove.push(old.id)
      plan.removed.push(old.member)
    }
  }
  const r = writeRecords(d, puts, remove)
  if (!r.ok) return r.error
  d = r.doc
  const before = new Set(statefulEntityIds(doc))
  const after = new Set(statefulEntityIds(d))
  plan.removedStateful = [...before].filter((id) => !after.has(id))
  if (plan.removedStateful.length && !opts.acceptStateChanges) {
    plan.blockers.push(`Cập nhật bỏ ${plan.removedStateful.length} ID có trạng thái trong save (${plan.removedStateful.slice(0, 3).join(', ')}${plan.removedStateful.length > 3 ? ' …' : ''}): chọn "Chấp nhận đổi ID có trạng thái", rồi tăng contentVersion của world`)
    return plan
  }
  const group: CompoundGroup = { ...g, name: c.name, source: { library: lib.worldId, id: g.compoundId, version: c.contentVersion, hash: compoundHash(c) }, members }
  plan.doc = withGroups(d, documentGroups(d).map((x) => (x.groupId === groupId ? group : x)))
  return plan
}

// ---- Authoring compounds (in the library world) ----

export interface SaveCompoundOptions {
  compoundId: string
  name: string
  catalog?: LibraryInfo
}

/** File of a compound in its world: `compounds/<id with / as ->.json`. */
export function compoundPath(compoundId: string): string {
  return `${COMPOUND_DIR}${compoundId.replace(/\//g, '-')}.json`
}

/**
 * Save the selected records (instances and objects) as a compound of this world (`compounds/…`):
 * in the library world, a compound of the shared library. Positions become relative to the group's
 * pivot and unturned (a selection that is not a group: the centre of its anchors, no turn). Saving
 * again under the same ID bumps its version. The records become (or stay) a group linked to it.
 */
export function saveCompound(doc: MapDocument, ids: readonly string[], opts: SaveCompoundOptions): CommandResult {
  if (!PREFAB_ID.test(opts.compoundId)) return fail(`compoundId "${opts.compoundId}": chữ thường, số, gạch nối, phân cách bằng /`)
  if (!opts.name.trim()) return fail('Tên compound trống')
  const want = [...new Set(ids)]
  if (!want.length) return fail('Chọn các record của compound')
  const locs = want.map((id) => findRecord(doc, id))
  if (locs.some((l) => !l)) return fail('Không tìm thấy record')
  if (locs.some((l) => l!.category !== 'instances' && l!.category !== 'objects')) return fail('Compound chỉ chứa công trình (prefab) và object (tường, rào, cây, trang trí, mặt nền); bỏ đường, zone, spawn khỏi vùng chọn')
  const path = compoundPath(opts.compoundId)
  const existing = doc.extras.get(path) as CompoundDocument | undefined
  if (existing && existing.compoundId !== opts.compoundId) return fail(`${path} đang chứa compound ${existing.compoundId}`)
  // The frame of the group being saved: the group already linked to this compound (members added or
  // left out around it: its pivot stays, so nothing placed from it moves), else the one whole group
  // in the selection. Parts of any other group are refused (it would be torn apart).
  const touched = documentGroups(doc).filter((g) => g.members.some((m) => want.includes(m.id)))
  const whole = new Set(fullGroups(doc, want).map((g) => g.groupId))
  const group = touched.find((g) => g.compoundId === opts.compoundId) ?? (touched.length === 1 && whole.has(touched[0].groupId) ? touched[0] : null)
  const anchors = locs.map((l) => worldAnchor(doc, l!))
  const pivot = group?.pivot ?? { x: snapHalf((Math.min(...anchors.map((a) => a.x)) + Math.max(...anchors.map((a) => a.x))) / 2), z: snapHalf((Math.min(...anchors.map((a) => a.z)) + Math.max(...anchors.map((a) => a.z))) / 2) }
  if (touched.some((g) => g.groupId !== group?.groupId)) return fail(`Vùng chọn có phần của nhóm khác (${touched.filter((g) => g.groupId !== group?.groupId).map((g) => g.name).join(', ')}): chọn cả nhóm, hoặc rã nhóm đó trước`)
  const q = group?.quarterTurns ?? 0
  const names = new Map(group?.members.map((m) => [m.id, m.member]) ?? [])
  const used = new Set<string>()
  const instances: CompoundInstance[] = []
  const objects: CompoundObject[] = []
  const bounds = new Map(resolvedRecords(doc).map((r) => [r.id, r.bounds]))
  let footprint: Rect | null = null
  const members: GroupMember[] = []
  want.forEach((id, i) => {
    const loc = locs[i]!
    let member = names.get(id) ?? id.split('/').pop()!.replace(/-\d+$/, '')
    if (used.has(member)) for (let n = 2; ; n++) if (!used.has(`${member}-${n}`)) { member = `${member}-${n}`; break }
    used.add(member)
    const local = memberLocal(loc.category, loc.record, anchors[i], pivot, q)
    members.push({ member, id, hash: memberHash(local) })
    if (loc.category === 'instances') {
      const world = doc.prefabs.get(String(local.prefabId))
      // The library ID of an imported prefab (a compound saved outside the library names library prefabs).
      const prefabId = world?.source?.id ?? String(local.prefabId)
      const pos = local.position as { x: number; y: number; z: number }
      instances.push({ member, prefabId, position: { x: pos.x, y: pos.y, z: pos.z }, quarterTurns: local.quarterTurns as QuarterTurns, ...(local.visual ? { visual: local.visual as { variantId?: string } } : {}) })
    } else {
      const { kind, ...rest } = local
      objects.push({ kind, member, ...rest } as unknown as CompoundObject)
    }
    const b = bounds.get(id)
    if (b) footprint = unionLocal(footprint, b, pivot, q)
  })
  const c: CompoundDocument = {
    schemaVersion: MAP_SCHEMA_VERSION,
    compoundId: opts.compoundId,
    contentVersion: existing ? existing.contentVersion + (compoundHash({ ...existing, instances, objects, footprint: footprint!, name: opts.name.trim(), ...(opts.catalog ? { catalog: opts.catalog } : {}) }) !== compoundHash(existing) ? 1 : 0) : 1,
    name: opts.name.trim(),
    footprint: footprint!,
    ...((opts.catalog ?? existing?.catalog) ? { catalog: opts.catalog ?? existing!.catalog } : {}),
    ...(existing?.placement ? { placement: existing.placement } : {}),
    instances,
    objects,
  }
  const extras = new Map(doc.extras).set(path, c)
  let d: MapDocument = { ...doc, extras }
  const source: LibrarySource = { library: doc.world.worldId, id: c.compoundId, version: c.contentVersion, hash: compoundHash(c) }
  const others = documentGroups(d).filter((g) => g.groupId !== group?.groupId)
  const linked: CompoundGroup = { groupId: group?.groupId ?? freshGroupId(others, slugify(c.compoundId.split('/').pop()!)), name: c.name, compoundId: c.compoundId, source, pivot, quarterTurns: q as QuarterTurns, members }
  d = withGroups(d, [...others, linked])
  return { ok: true, doc: d, selection: want, note: `Lưu compound ${c.compoundId} v${c.contentVersion} (${instances.length} công trình, ${objects.length} object) vào ${path}` }
}

const snapHalf = (v: number) => quantize(Math.round(v * 2) / 2)

/** `acc` grown by world rectangle `b` seen in the group frame (pivot, turn undone). */
function unionLocal(acc: Rect | null, b: Rect, pivot: XZ, q: number): Rect {
  const back = (4 - (q & 3)) & 3
  const pts = [
    rotateXZ(b.minX - pivot.x, b.minZ - pivot.z, back),
    rotateXZ(b.maxX - pivot.x, b.maxZ - pivot.z, back),
  ]
  const r = { minX: quantize(Math.min(pts[0][0], pts[1][0])), minZ: quantize(Math.min(pts[0][1], pts[1][1])), maxX: quantize(Math.max(pts[0][0], pts[1][0])), maxZ: quantize(Math.max(pts[0][1], pts[1][1])) }
  return acc ? { minX: Math.min(acc.minX, r.minX), minZ: Math.min(acc.minZ, r.minZ), maxX: Math.max(acc.maxX, r.maxX), maxZ: Math.max(acc.maxZ, r.maxZ) } : r
}

// ---- Groups as commands ----

/** Group the selection (Ctrl+G): a plain group, not linked to a compound. */
export function groupRecords(doc: MapDocument, ids: readonly string[], name: string): CommandResult {
  const g = newGroup(doc, [...new Set(ids)], name.trim() || 'Nhóm')
  if (typeof g === 'string') return fail(g)
  return { ok: true, doc: withGroups(doc, [...documentGroups(doc), g]), selection: g.members.map((m) => m.id), note: `Nhóm ${g.members.length} record thành ${g.groupId}` }
}

/** Drop a group; its records stay as they are (ungroup). */
export function ungroup(doc: MapDocument, groupId: string): CommandResult {
  const groups = documentGroups(doc)
  const g = groups.find((x) => x.groupId === groupId)
  if (!g) return fail(`Không có nhóm ${groupId}`)
  return { ok: true, doc: withGroups(doc, groups.filter((x) => x !== g)), selection: liveMembers(doc, g).map((m) => m.id), note: `Rã nhóm ${g.name}: ${g.members.length} record giữ nguyên` }
}

/** Members of a group with their state for the Inspector. */
export function groupMemberStates(doc: MapDocument, g: CompoundGroup): { member: string; id: string; category: RecordCategory | null; state: 'ok' | 'modified' | 'missing' }[] {
  return g.members.map((m) => {
    const loc = findRecord(doc, m.id)
    if (!loc) return { member: m.member, id: m.id, category: null, state: 'missing' as const }
    const modified = !!m.hash && currentMemberHash(doc, g, m.id) !== m.hash
    return { member: m.member, id: m.id, category: loc.category, state: modified ? ('modified' as const) : ('ok' as const) }
  })
}
