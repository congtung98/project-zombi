import { RECORD_CATEGORIES, recordId, type ChunkDocument, type PrefabDocument, type PrefabEntry, type RecordCategory, type Rect, type WorldDocument } from '../schema.ts'
import { chunkIdOf, chunkIndex } from '../transform.ts'
import type { ValidationOptions } from '../validate.ts'
import { resolvedRecords, withExternalRefs, type AnyRecord, type MapDocument } from '../editor/document.ts'
import { fitPrefab, placeBuildings, prefabCatalog, setParcelPrefab, type PrefabCatalog } from './buildings.ts'
import { byString, canonicalJson, hashText } from './geometry.ts'
import { checkWorldLayout, LayoutImportError } from './importer.ts'
import { buildLayoutWorld, type LayoutWorldOptions } from './layoutWorld.ts'
import { parcelRect } from './parcels.ts'
import { LayoutPlanError, planLayout } from './plan.ts'
import { rectCentre, rectsOverlap } from './rects.ts'
import type { EnvironmentParams, GeneratedManifest, GeneratedRecord, LayoutIssue, LayoutParcel, LayoutPlan, PlanParams, WorldLayout, WorldMode } from './schema.ts'

/**
 * GeneratorSync (world generator WG4): the layout a world was generated from lives in the world
 * folder as `layout/world-layout.json` (a file the editor keeps with the document and exports, and
 * the game never loads), together with a manifest of every record the generator wrote and its hash
 * (owner decision Q2). From it:
 *
 * - `generatorStatus`: each record is **generated** (hash unchanged), **modified** (edited or deleted
 *   by hand, or its building chosen by hand), **locked** (its parcel or the record locked) or
 *   **manual** (placed by hand, not in the manifest); each parcel gets the state of its building.
 * - `syncGenerated`: regenerate the whole world (new seed, profile or mode), selected parcels or
 *   chunks (SELECTIVE_REGENERATION), replace or clear a parcel's prefab, restore modified records,
 *   lock and unlock. The new generator output is merged into the document: generated records are
 *   replaced or removed, modified records are kept unless `overwrite` (or the action names them),
 *   locked and manual records are never touched. One pure document → document step, so the editor's
 *   history undoes it like any command.
 *
 * Owner decision Q3: regenerate only worlds nobody plays yet. That rule is the editor's (it knows
 * which worlds are published); this module never looks at saves and never migrates any.
 */

export const LAYOUT_FILE = 'layout/world-layout.json'
export const SYNC_VERSION = 1
/** Lots of the building zones never left empty on purpose (explicit parcel regeneration). */
const NO_VACANCY = { residential: 0, commercial: 0, industrial: 0, public: 0 }
/** Re-rolls tried for one parcel before reporting that nothing else fits it. */
const REROLLS = 8

// ---- Hashing ----

/** JSON with object keys sorted (moved to `geometry.ts`, shared with the prefab library). */
export { canonicalJson }

/** Hash of a record as stored in its owner chunk: moving, resizing or editing any field changes it. */
export function recordHash(chunkId: string, record: object): string {
  return `cyrb53:${hashText(`${chunkId}\n${canonicalJson(record)}`)}`
}

// ---- The layout inside a document ----

const layoutCache = new WeakMap<object, { layout: WorldLayout | null; issues: LayoutIssue[] }>()

/** The layout stored with the document (checked once per object), or null when the world has none or it is broken. */
export function documentLayout(doc: MapDocument): { layout: WorldLayout | null; issues: LayoutIssue[] } {
  const raw = doc.extras.get(LAYOUT_FILE)
  if (raw === undefined) return { layout: null, issues: [] }
  if (raw === null || typeof raw !== 'object') return { layout: null, issues: [{ severity: 'error', code: 'schema', message: `${LAYOUT_FILE}: layout phải là một object` }] }
  let r = layoutCache.get(raw)
  if (!r) {
    const issues = checkWorldLayout(raw)
    r = { layout: issues.some((i) => i.severity === 'error') ? null : (raw as WorldLayout), issues }
    layoutCache.set(raw, r)
  }
  return r
}

export function withLayout(doc: MapDocument, layout: WorldLayout): MapDocument {
  const extras = new Map(doc.extras)
  extras.set(LAYOUT_FILE, layout)
  return { ...doc, extras }
}

interface Located {
  chunk: string
  category: RecordCategory
  record: AnyRecord
}

function recordsOf(doc: MapDocument): Map<string, Located> {
  const out = new Map<string, Located>()
  for (const e of doc.world.chunks) {
    const chunk = doc.chunks.get(e.chunkId)
    if (!chunk) continue
    for (const category of RECORD_CATEGORIES) for (const r of chunk[category]) out.set(recordId(category, r), { chunk: e.chunkId, category, record: r as unknown as AnyRecord })
  }
  return out
}

/** Building instance IDs are `<chunk>/<parcel>` (no namespace), unlike the parcel's environment objects. */
const isBuildingId = (id: string) => id.indexOf('/') === id.lastIndexOf('/')

/** Manifest entry of a record the generator wrote (`layoutWorld.ts` ID rules: instances `<chunk>/<parcel>`, environment `…/objects/env-<parcel>-…`, zones and zombie spawns by block). */
function entryFor(id: string, loc: Located): GeneratedRecord {
  const e: GeneratedRecord = { id, chunk: loc.chunk, hash: recordHash(loc.chunk, loc.record) }
  if (loc.category === 'instances') e.parcel = id.slice(id.indexOf('/') + 1)
  else if (loc.category === 'objects') {
    // WG5: a lot's environment details belong to the lot (locks and selective regeneration follow it).
    const m = /\/objects\/env-(lot-[0-9a-f]+)-/.exec(id)
    if (m) e.parcel = m[1]
  } else if (loc.category === 'zones') e.block = id.slice(id.lastIndexOf('/') + 1)
  else if (loc.category === 'spawns') {
    const m = /\/zombie-([^/]+)-\d+$/.exec(id)
    if (m) e.block = `block-${m[1]}`
  }
  return e
}

function manifestOf(fresh: MapDocument, mode: WorldMode, catalog: string, previous?: GeneratedManifest | null): GeneratedManifest {
  const records = [...recordsOf(fresh)].map(([id, loc]) => entryFor(id, loc)).sort((a, b) => byString(a.id, b.id))
  return { version: SYNC_VERSION, mode, catalog, playArea: fresh.world.playArea, records, locked: previous?.locked ?? [], rolls: previous?.rolls ?? 0 }
}

/** A new world from a planned layout (FULL: with its buildings decided), the layout and manifest stored in it. */
export function createLayoutWorld(layout: WorldLayout, opts: LayoutWorldOptions): MapDocument {
  if (!layout.plan) throw new Error('layout chưa có kế hoạch lô (plan)')
  const mode = opts.mode ?? 'layout-only'
  const doc = buildLayoutWorld(layout, layout.plan, opts)
  return withLayout(doc, { ...layout, generated: manifestOf(doc, mode, mode === 'full' ? opts.catalog!.id : 'none') })
}

// ---- Status ----

export type RecordState = 'generated' | 'modified' | 'locked' | 'manual'
/** How a generated record was changed by hand: edited (hash differs), deleted, or its building chosen by hand. */
export type Modification = 'edited' | 'deleted' | 'chosen'

export interface RecordStatus {
  id: string
  state: RecordState
  modified: Modification | null
  locked: boolean
  parcel: string | null
  block: string | null
}

/** open: not a lot (forest, farmland, empty land, interior); empty: a lot without a building. */
export type ParcelState = 'generated' | 'modified' | 'locked' | 'empty' | 'open'

export interface GeneratorStatus {
  /** Every record of the document, plus generated records deleted by hand (state modified/locked). */
  records: Map<string, RecordStatus>
  parcels: Map<string, ParcelState>
  /** Parcel → the ID of its building instance (from the manifest). */
  instances: Map<string, string>
  counts: Record<RecordState, number> & { deleted: number }
}

const statusCache = new WeakMap<object, WeakMap<object, GeneratorStatus>>()

export function generatorStatus(doc: MapDocument, layout: WorldLayout): GeneratorStatus {
  let perChunks = statusCache.get(doc.chunks)
  if (!perChunks) {
    perChunks = new WeakMap()
    statusCache.set(doc.chunks, perChunks)
  }
  const hit = perChunks.get(layout)
  if (hit) return hit
  const man = layout.generated ?? null
  const entries = new Map((man?.records ?? []).map((r) => [r.id, r]))
  const parcels = new Map((layout.plan?.parcels ?? []).map((q) => [q.id, q]))
  const lockedIds = new Set(man?.locked ?? [])
  const records = new Map<string, RecordStatus>()
  const counts = { generated: 0, modified: 0, locked: 0, manual: 0, deleted: 0 }
  const instances = new Map<string, string>()
  const judge = (id: string, e: GeneratedRecord, loc: Located | undefined): RecordStatus => {
    const q = e.parcel ? parcels.get(e.parcel) : undefined
    const locked = lockedIds.has(id) || !!q?.locked
    const modified: Modification | null = !loc ? 'deleted' : recordHash(loc.chunk, loc.record) !== e.hash ? 'edited' : q?.build?.source === 'manual' ? 'chosen' : null
    return { id, state: locked ? 'locked' : modified ? 'modified' : 'generated', modified, locked, parcel: e.parcel ?? null, block: e.block ?? null }
  }
  for (const [id, loc] of recordsOf(doc)) {
    const e = entries.get(id)
    const s: RecordStatus = e ? judge(id, e, loc) : { id, state: 'manual', modified: null, locked: false, parcel: null, block: null }
    records.set(id, s)
    counts[s.state]++
  }
  const touched = new Set<string>()
  for (const [id, e] of entries) {
    if (e.parcel && isBuildingId(id)) instances.set(e.parcel, id)
    if (records.has(id)) continue
    const s = judge(id, e, undefined)
    records.set(id, s)
    counts.deleted++
  }
  // A parcel is modified when anything of it (its building, a tree, its fence) was changed by hand.
  for (const s of records.values()) if (s.parcel && s.modified) touched.add(s.parcel)
  const parcelStates = new Map<string, ParcelState>()
  for (const q of parcels.values()) {
    const inst = instances.get(q.id)
    const s = inst ? records.get(inst) : undefined
    parcelStates.set(q.id, q.locked ? 'locked' : q.build?.source === 'manual' || touched.has(q.id) ? 'modified' : q.kind !== 'lot' ? 'open' : s ? 'generated' : 'empty')
  }
  const out = { records, parcels: parcelStates, instances, counts }
  perChunks.set(layout, out)
  return out
}

export function stateLabel(s: RecordStatus): string {
  if (s.state === 'manual') return 'Thủ công (không do generator)'
  const how = s.modified === 'deleted' ? 'đã xóa' : s.modified === 'chosen' ? 'prefab chọn tay' : null
  if (s.state === 'locked') return s.modified ? `Khóa (sửa tay${how ? `: ${how}` : ''})` : 'Khóa'
  return s.modified ? `Đã sửa tay${how ? ` (${how})` : ''}` : 'Sinh tự động'
}

/** The parcel under a world point, if any. */
export function parcelAt(layout: WorldLayout, p: { x: number; z: number }): LayoutParcel | null {
  for (const q of layout.plan?.parcels ?? []) {
    const r = parcelRect(q)
    if (p.x >= r.minX && p.x < r.maxX && p.z >= r.minZ && p.z < r.maxZ) return q
  }
  return null
}

/** Chunk owning a parcel's centre (what selective regeneration by chunk goes by). */
export function parcelChunk(q: LayoutParcel, chunkSize = 32): string {
  const c = rectCentre(parcelRect(q))
  return chunkIdOf(chunkIndex(c.x, chunkSize), chunkIndex(c.z, chunkSize))
}

/** Library prefabs a hand choice could put on a parcel: those that fit it unscaled, with whether the zone is one they list. */
export function prefabChoices(layout: WorldLayout, parcelId: string, catalog: PrefabCatalog): { prefabId: string; name: string; zoneOk: boolean }[] {
  const q = layout.plan?.parcels.find((x) => x.id === parcelId)
  if (!q || q.kind !== 'lot') return []
  return catalog.prefabs
    .filter((p) => fitPrefab(q, p, { ...p.placement, frontage: undefined }) !== null)
    .map((p) => ({ prefabId: p.entry.prefabId, name: p.doc.name, zoneOk: p.placement.allowedZones.includes(q.zone) }))
    .sort((a, b) => Number(b.zoneOk) - Number(a.zoneOk) || byString(a.prefabId, b.prefabId))
}

/** Every stored issue of the layout: import, normalisation, plan. */
export function layoutIssues(layout: WorldLayout): LayoutIssue[] {
  return [...layout.issues, ...(layout.normalized?.issues ?? []), ...(layout.plan?.issues ?? [])]
}

// ---- Regeneration ----

export type SyncRequest =
  /** Whole world: replan (new seed, profile, …) keeping locked, hand-chosen and hand-edited parcels, then buildings. */
  | { kind: 'world'; params?: Partial<PlanParams>; mode?: WorldMode; overwrite?: boolean; environment?: EnvironmentParams }
  /** Explicit: new buildings for these parcels (hand edits on them replaced; locked parcels refused). */
  | { kind: 'parcels'; parcels: string[] }
  /** Bulk: new buildings for the parcels of these chunks (hand edits kept unless overwrite; locked never). */
  | { kind: 'chunks'; chunks: string[]; overwrite?: boolean }
  /** Replace (or clear, with null) a parcel's building by hand. */
  | { kind: 'prefab'; parcel: string; prefabId: string | null }
  /** Put modified records back as generated (deleted ones come back). */
  | { kind: 'revert'; ids: string[] }
  /** Lock or unlock parcels or generated records (a building's lock is its parcel's). */
  | { kind: 'lock'; ids: string[]; locked: boolean }
  /**
   * WG6: a new source layout for the world (the reference changed: a traced road added, an updated
   * GeoJSON), best imported with the old frame pinned (`reimportLayout`). Replanned with the same
   * parameters keeping locked, hand-chosen and hand-edited parcels that still fit, then merged:
   * unchanged areas come out identical, hand edits stay unless overwrite.
   */
  | { kind: 'layout'; layout: WorldLayout; overwrite?: boolean }

export interface SyncContext {
  /** Prefab library (FULL); the world's own copy of a prefab wins over the library's. */
  catalog: PrefabCatalog | null
  validation?: ValidationOptions
}

export interface SyncReport {
  replaced: number
  added: number
  removed: number
  /** Records the regeneration would have changed but kept: modified by hand, locked. */
  keptModified: string[]
  keptLocked: string[]
  /** Generated records not written because a hand-placed record holds the ID (or it was retired). */
  conflicts: string[]
  /** Parcels whose building changed. */
  parcels: string[]
  issues: LayoutIssue[]
}

export type SyncResult = { ok: true; doc: MapDocument; report: SyncReport; summary: string } | { ok: false; error: string }

const fail = (error: string): SyncResult => ({ ok: false, error })

/** The library with the world's own copies of its prefabs in place of the library's (hand edits to a prefab win). */
function worldCatalog(doc: MapDocument, library: PrefabCatalog): PrefabCatalog {
  const own: { entry: PrefabEntry; doc: PrefabDocument }[] = []
  for (const entry of doc.world.prefabs) {
    const p = doc.prefabs.get(entry.prefabId)
    if (p) own.push({ entry, doc: p })
  }
  const ids = new Set(own.map((p) => p.entry.prefabId))
  return prefabCatalog(library.id, [...library.prefabs.filter((p) => !ids.has(p.entry.prefabId)).map((p) => ({ entry: p.entry, doc: p.doc })), ...own])
}

interface Policy {
  /** Record IDs the merge may change (null: every one). */
  scope: ReadonlySet<string> | null
  /** Modified records the action names explicitly: overwritten. */
  force: ReadonlySet<string>
  overwrite: boolean
}

function merge(doc: MapDocument, layout: WorldLayout, fresh: MapDocument, freshManifest: GeneratedManifest, policy: Policy): { doc: MapDocument; records: GeneratedRecord[]; report: Omit<SyncReport, 'parcels' | 'issues'> } {
  const man = layout.generated ?? null
  const old = new Map((man?.records ?? []).map((r) => [r.id, r]))
  const next = new Map(freshManifest.records.map((r) => [r.id, r]))
  const cur = recordsOf(doc)
  const nu = recordsOf(fresh)
  const lockedIds = new Set(man?.locked ?? [])
  const parcels = new Map((layout.plan?.parcels ?? []).map((q) => [q.id, q]))
  const isLocked = (id: string, e: GeneratedRecord) => lockedIds.has(id) || (!!e.parcel && !!parcels.get(e.parcel)?.locked)
  const retired = new Set(doc.world.retiredIds ?? [])
  const removals = new Map<string, Set<string>>()
  const additions: Located[] = []
  const records: GeneratedRecord[] = []
  const report = { replaced: 0, added: 0, removed: 0, keptModified: [] as string[], keptLocked: [] as string[], conflicts: [] as string[] }
  // Hashes cover the owner chunk and every field: equal hashes = the same record in the same chunk.
  const hashes = new Map<string, string>()
  const hashOf = (id: string, loc: Located) => {
    let h = hashes.get(id)
    if (h === undefined) hashes.set(id, (h = recordHash(loc.chunk, loc.record)))
    return h
  }
  const same = (id: string, a: Located | undefined, b: Located | undefined) => !!a && !!b && hashOf(id, a) === next.get(id)!.hash
  const remove = (loc: Located, id: string) => {
    let set = removals.get(loc.chunk)
    if (!set) removals.set(loc.chunk, (set = new Set()))
    set.add(id)
  }
  for (const id of [...new Set([...old.keys(), ...nu.keys()])].sort(byString)) {
    const o = old.get(id)
    const c = cur.get(id)
    const n = nu.get(id)
    const inScope = !policy.scope || policy.scope.has(id)
    if (!o) {
      // A record the generator does not own holds the ID: adopt it when identical, else leave it alone.
      if (c) {
        if (n && inScope) {
          if (same(id, c, n)) records.push(next.get(id)!)
          else report.conflicts.push(id)
        }
        continue
      }
      if (!inScope) continue
    } else if (!inScope) {
      records.push(o)
      continue
    }
    const changes = !same(id, c, n)
    if (o && isLocked(id, o)) {
      if (changes) report.keptLocked.push(id)
      records.push(o)
      continue
    }
    const modified = !!o && (!c || hashOf(id, c) !== o.hash)
    if (modified && !policy.overwrite && !policy.force.has(id)) {
      if (changes) report.keptModified.push(id)
      records.push(o!)
      continue
    }
    if (n) {
      if (retired.has(id)) {
        // Deleted by hand: back only when the action overwrites that edit (Q3: an unpublished world, no save holds it).
        if (!o) {
          report.conflicts.push(id)
          continue
        }
        retired.delete(id)
      }
      records.push(next.get(id)!)
      if (!changes) continue
      if (c) {
        remove(c, id)
        report.replaced++
      } else report.added++
      additions.push(n)
    } else if (c) {
      remove(c, id)
      report.removed++
    }
  }

  const chunks = new Map(doc.chunks)
  const worldChunks = [...doc.world.chunks]
  for (const e of fresh.world.chunks) {
    if (chunks.has(e.chunkId)) continue
    const f = fresh.chunks.get(e.chunkId)!
    chunks.set(e.chunkId, { ...f, instances: [], objects: [], roads: [], zones: [], spawns: [], externalRefs: [] })
    worldChunks.push({ ...e })
  }
  const copied = new Set<string>()
  const edit = (chunkId: string): ChunkDocument => {
    const src = chunks.get(chunkId)!
    if (copied.has(chunkId)) return src
    const copy: ChunkDocument = { ...src, instances: [...src.instances], objects: [...src.objects], roads: [...src.roads], zones: [...src.zones], spawns: [...src.spawns] }
    chunks.set(chunkId, copy)
    copied.add(chunkId)
    return copy
  }
  for (const [chunkId, ids] of removals) {
    const c = edit(chunkId) as unknown as Record<RecordCategory, AnyRecord[]>
    for (const category of RECORD_CATEGORIES) c[category] = c[category].filter((r) => !ids.has(recordId(category, r)))
  }
  for (const a of additions) (edit(a.chunk) as unknown as Record<RecordCategory, AnyRecord[]>)[a.category].push(a.record)

  const world: WorldDocument = { ...doc.world }
  if (worldChunks.length !== doc.world.chunks.length) {
    world.chunks = worldChunks.sort((a, b) => a.cz - b.cz || a.cx - b.cx)
    world.chunkBounds = {
      minCx: Math.min(...worldChunks.map((c) => c.cx)),
      maxCx: Math.max(...worldChunks.map((c) => c.cx)),
      minCz: Math.min(...worldChunks.map((c) => c.cz)),
      maxCz: Math.max(...worldChunks.map((c) => c.cz)),
    }
  }
  // Prefabs the new buildings use (the world's own copy stays when it has one).
  const prefabs = new Map(doc.prefabs)
  const entries = [...doc.world.prefabs]
  for (const a of additions) {
    if (a.category !== 'instances') continue
    const pid = a.record.prefabId as string
    if (prefabs.has(pid)) continue
    const fe = fresh.world.prefabs.find((p) => p.prefabId === pid)
    if (!fe) continue
    prefabs.set(pid, fresh.prefabs.get(pid)!)
    entries.push({ ...fe })
  }
  if (entries.length !== doc.world.prefabs.length) world.prefabs = entries
  if (retired.size !== (doc.world.retiredIds?.length ?? 0)) {
    const kept = (doc.world.retiredIds ?? []).filter((id) => retired.has(id))
    if (kept.length) world.retiredIds = kept
    else delete world.retiredIds
  }
  // The play area follows the plan unless it was changed by hand.
  if (!man || canonicalJson(doc.world.playArea) === canonicalJson(man.playArea)) world.playArea = fresh.world.playArea
  if (fresh.world.generator) world.generator = fresh.world.generator
  const out: MapDocument = { ...doc, world, prefabs: prefabs.size !== doc.prefabs.size ? prefabs : doc.prefabs, chunks }
  // The player start moves with the plan unless the world's own spawn record is still there.
  if (!recordsOf(out).has(world.playerSpawn) && nu.has(fresh.world.playerSpawn)) world.playerSpawn = fresh.world.playerSpawn
  // Same world fields: keep the object (the editor's resolve cache is keyed by it: nothing re-resolves needlessly).
  if (canonicalJson(world) === canonicalJson(doc.world)) out.world = doc.world
  return { doc: withExternalRefs(out), records: records.sort((a, b) => byString(a.id, b.id)), report }
}

/** Records of the parcels given and of the zombie zones and spawns of their blocks (spawns keep clear of buildings). */
function parcelScope(ids: ReadonlySet<string>, plan: LayoutPlan, manifests: readonly (GeneratedManifest | null | undefined)[]): { scope: Set<string>; instances: Set<string> } {
  const blocks = new Set(plan.parcels.filter((q) => ids.has(q.id)).map((q) => q.block))
  const scope = new Set<string>()
  const instances = new Set<string>()
  for (const m of manifests)
    for (const e of m?.records ?? []) {
      if (e.parcel && ids.has(e.parcel)) {
        scope.add(e.id)
        instances.add(e.id)
      }
      if (e.block && blocks.has(e.block)) scope.add(e.id)
    }
  return { scope, instances }
}

const buildOf = (plan: LayoutPlan) => new Map(plan.parcels.map((q) => [q.id, canonicalJson(q.build ?? null)]))
/** What stands on each parcel, whoever chose it (a re-roll must change this, not only the source). */
const standing = (plan: LayoutPlan) => new Map(plan.parcels.map((q) => [q.id, canonicalJson(q.build ? { ...q.build, source: undefined } : null)]))

/**
 * One generator action on a document that holds its layout. Returns the new document (records
 * merged, layout and manifest updated) and what happened; errors leave the document as it was.
 */
export function syncGenerated(doc: MapDocument, request: SyncRequest, ctx: SyncContext): SyncResult {
  const { layout, issues: layoutProblems } = documentLayout(doc)
  if (!layout) return fail(layoutProblems.length ? `layout hỏng: ${layoutProblems[0].message}` : 'world này không sinh từ layout')
  // The layout the world is generated from after this action (a new one for `layout`).
  const target = request.kind === 'layout' ? { ...request.layout, plan: undefined, generated: undefined } : layout
  if (!target.normalized?.valid) return fail('mạng đường đã nắn có lỗi: chưa sinh lại được')
  const man = layout.generated ?? null
  const mode: WorldMode = request.kind === 'world' && request.mode ? request.mode : (man?.mode ?? (layout.plan?.catalog ? 'full' : 'layout-only'))
  if (mode === 'full' && !ctx.catalog) return fail('không có thư viện prefab (content/maps/prefab-library)')
  const catalog = mode === 'full' ? worldCatalog(doc, ctx.catalog!) : null
  const plan0 = layout.plan ?? null
  const issues: LayoutIssue[] = []
  const status = generatorStatus(doc, layout)
  const rolls = man?.rolls ?? 0

  if (request.kind === 'lock') {
    if (!plan0) return fail('layout chưa có kế hoạch lô')
    const parcels = new Set<string>()
    const records = new Set<string>()
    for (const id of request.ids) {
      if (plan0.parcels.some((q) => q.id === id)) parcels.add(id)
      else {
        const s = status.records.get(id)
        if (!s) return fail(`không có ${id}`)
        if (s.state === 'manual') return fail(`${id} được đặt tay, không do generator: regeneration không bao giờ đụng tới nó`)
        if (s.parcel) parcels.add(s.parcel)
        else records.add(id)
      }
    }
    const lockedIds = new Set(man?.locked ?? [])
    for (const id of records) {
      if (request.locked) lockedIds.add(id)
      else lockedIds.delete(id)
    }
    const plan1 = { ...plan0, parcels: plan0.parcels.map((q) => (parcels.has(q.id) && q.locked !== request.locked ? { ...q, locked: request.locked } : q)) }
    const layout1: WorldLayout = { ...layout, plan: plan1, generated: man ? { ...man, locked: [...lockedIds].sort(byString) } : man }
    const n = parcels.size + records.size
    return { ok: true, doc: withLayout(doc, layout1), report: { replaced: 0, added: 0, removed: 0, keptModified: [], keptLocked: [], conflicts: [], parcels: [...parcels], issues }, summary: `${request.locked ? 'Khóa' : 'Mở khóa'} ${n} mục${parcels.size ? ` (${parcels.size} lô)` : ''}` }
  }

  let plan1: LayoutPlan
  let policy: (fresh: GeneratedManifest) => Policy
  let nextRolls = rolls
  try {
    switch (request.kind) {
      case 'world': {
        const overwrite = !!request.overwrite
        const edited = new Set<string>()
        if (!overwrite) for (const s of status.records.values()) if (s.parcel && (s.modified === 'edited' || s.modified === 'deleted')) edited.add(s.parcel)
        const keep = (plan0?.parcels ?? []).filter((q) => q.locked || (!overwrite && (q.build?.source === 'manual' || edited.has(q.id))))
        const params = { ...(plan0?.params ?? {}), ...request.params }
        // P1: the architecture style only chooses buildings; it never changes the parcels.
        const lots = (p: Partial<PlanParams>) => canonicalJson({ ...p, architectureStyle: undefined, styleByZone: undefined })
        if (plan0 && lots(params) === lots(plan0.params)) {
          // Same plan parameters: the same parcels (a replan would cut the blocks around the kept ones
          // differently); only the buildings of the parcels not kept are decided again.
          const kept = new Set(keep.map((q) => q.id))
          plan1 = {
            ...plan0,
            parcels: plan0.parcels.map((q) => {
              if (kept.has(q.id) || q.build === undefined) return q
              const { build: _, ...rest } = q
              return rest
            }),
          }
          plan1 = { ...plan1, params: params as PlanParams }
        } else {
          plan1 = planLayout(layout, params, { keep })
          if (plan0?.catalog) plan1 = { ...plan1, catalog: plan0.catalog }
          if (plan0?.environment) plan1 = { ...plan1, environment: plan0.environment }
        }
        // WG5: environment settings (never change the parcels).
        if (request.environment) plan1 = { ...plan1, environment: request.environment }
        if (catalog) {
          const r = placeBuildings(plan1, catalog)
          plan1 = r.plan
          issues.push(...r.issues)
        }
        policy = () => ({ scope: null, force: new Set(), overwrite })
        break
      }
      case 'parcels':
      case 'chunks':
      case 'prefab': {
        if (!plan0) return fail('layout chưa có kế hoạch lô')
        if (!catalog) return fail('world chỉ có đường (layout-only): sinh lại world ở chế độ full trước')
        let ids: string[]
        let explicit = true
        if (request.kind === 'chunks') {
          const chunks = new Set(request.chunks)
          explicit = !!request.overwrite
          ids = plan0.parcels
            .filter((q) => q.kind === 'lot' && !q.locked && chunks.has(parcelChunk(q)))
            .filter((q) => explicit || (q.build?.source !== 'manual' && !status.records.get(status.instances.get(q.id) ?? '')?.modified))
            .map((q) => q.id)
          if (!ids.length) return fail(`không có lô nào sinh lại được trong ${request.chunks.join(', ')} (lô khóa và lô sửa tay được giữ)`)
        } else {
          ids = request.kind === 'prefab' ? [request.parcel] : request.parcels
          for (const id of ids) {
            const q = plan0.parcels.find((x) => x.id === id)
            if (!q) return fail(`không có lô ${id}`)
            if (q.locked) return fail(`lô ${id} đã khóa: mở khóa trước`)
          }
        }
        if (request.kind === 'prefab') {
          const r = setParcelPrefab(plan0, catalog, request.parcel, request.prefabId)
          const error = r.issues.find((i) => i.severity === 'error')
          if (error) return fail(error.message)
          plan1 = r.plan
          issues.push(...r.issues)
        } else {
          const before = standing(plan0)
          let k = 0
          let r: ReturnType<typeof placeBuildings>
          // One parcel: re-roll until its building changes (deterministic: the salts come from the manifest).
          do {
            k++
            // Asked for by name ("Sinh lại lô"): always a building when one fits (clearing a lot is the prefab choice "none").
            r = placeBuildings(plan0, catalog, { parcels: ids, salt: rolls + k, vacancy: request.kind === 'parcels' ? NO_VACANCY : undefined })
          } while (request.kind === 'parcels' && ids.length === 1 && k < REROLLS && standing(r.plan).get(ids[0]) === before.get(ids[0]))
          plan1 = r.plan
          nextRolls = rolls + k
          issues.push(...r.issues.filter((i) => i.code !== 'parcel-locked'))
        }
        const wanted = new Set(ids)
        policy = (fresh) => {
          const { scope, instances } = parcelScope(wanted, plan1, [man, fresh])
          return { scope, force: explicit ? instances : new Set(), overwrite: false }
        }
        break
      }
      case 'layout': {
        const overwrite = !!request.overwrite
        const edited = new Set<string>()
        if (!overwrite) for (const s of status.records.values()) if (s.parcel && (s.modified === 'edited' || s.modified === 'deleted')) edited.add(s.parcel)
        const keep = (plan0?.parcels ?? []).filter((q) => q.locked || (!overwrite && (q.build?.source === 'manual' || edited.has(q.id))))
        // Kept parcels the new streets run over are dropped by the planner (`kept-parcel-conflict`).
        plan1 = planLayout(target, plan0?.params ?? {}, { keep })
        if (plan0?.catalog) plan1 = { ...plan1, catalog: plan0.catalog }
        if (plan0?.environment) plan1 = { ...plan1, environment: plan0.environment }
        issues.push(...plan1.issues.filter((i) => i.severity !== 'info'))
        if (catalog) {
          const r = placeBuildings(plan1, catalog)
          plan1 = r.plan
          issues.push(...r.issues)
        }
        policy = () => ({ scope: null, force: new Set(), overwrite })
        break
      }
      case 'revert': {
        if (!plan0) return fail('layout chưa có kế hoạch lô')
        for (const id of request.ids) {
          const s = status.records.get(id)
          if (!s || s.state === 'manual') return fail(`${id} không do generator sinh ra`)
          if (s.locked) return fail(`${id} đã khóa: mở khóa trước`)
        }
        plan1 = plan0
        const ids = new Set(request.ids)
        policy = () => ({ scope: ids, force: ids, overwrite: false })
        break
      }
    }
  } catch (e) {
    if (e instanceof LayoutPlanError || e instanceof LayoutImportError) return fail(e.message)
    throw e
  }

  let fresh: MapDocument
  try {
    fresh = buildLayoutWorld(target, plan1, { worldId: doc.world.worldId, name: doc.world.name, mode, catalog: catalog ?? undefined, validation: ctx.validation, validate: false })
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
  const freshManifest = manifestOf(fresh, mode, catalog?.id ?? 'none', man)
  const merged = merge(doc, layout, fresh, freshManifest, policy(freshManifest))
  const before = plan0 ? buildOf(plan0) : new Map<string, string>()
  const changedParcels = plan1.parcels.filter((q) => before.get(q.id) !== canonicalJson(q.build ?? null)).map((q) => q.id)
  issues.push(...overlapWarnings(merged.doc, plan1, changedParcels, status))
  const generated: GeneratedManifest = { ...freshManifest, records: merged.records, locked: man?.locked ?? [], rolls: nextRolls }
  const report: SyncReport = { ...merged.report, parcels: changedParcels, issues }
  const next: WorldLayout = { ...target, plan: plan1, generated }
  return { ok: true, doc: withLayout(merged.doc, next), report, summary: summarize(report) }
}

/** New buildings that overlap something placed by hand (kept as it is: the author decides). */
function overlapWarnings(doc: MapDocument, plan: LayoutPlan, parcels: readonly string[], status: GeneratorStatus): LayoutIssue[] {
  if (!parcels.length) return []
  const manual = resolvedRecords(doc).filter((r) => (r.category === 'instances' || r.category === 'objects') && status.records.get(r.id)?.state === 'manual')
  if (!manual.length) return []
  const out: LayoutIssue[] = []
  const wanted = new Set(parcels)
  for (const q of plan.parcels) {
    if (!wanted.has(q.id) || !q.build || q.build.prefabId === null) continue
    const f: Rect = q.build.footprint
    const hit = manual.find((r) => rectsOverlap(r.bounds, f))
    if (hit) out.push({ severity: 'warning', code: 'manual-overlap', message: `công trình mới trên ${q.id} chồng lên ${hit.id} (đặt tay, giữ nguyên)`, ids: [q.id, hit.id], at: rectCentre(f) })
  }
  return out
}

function summarize(r: SyncReport): string {
  const parts = [`thay ${r.replaced}`, `thêm ${r.added}`, `bỏ ${r.removed}`]
  if (r.keptModified.length) parts.push(`giữ ${r.keptModified.length} sửa tay`)
  if (r.keptLocked.length) parts.push(`giữ ${r.keptLocked.length} khóa`)
  if (r.conflicts.length) parts.push(`${r.conflicts.length} trùng ID với record đặt tay`)
  return `${parts.join(', ')}${r.parcels.length ? ` (${r.parcels.length} lô đổi công trình)` : ''}`
}
