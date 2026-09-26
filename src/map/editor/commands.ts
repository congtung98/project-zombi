import { MAP_SCHEMA_VERSION, RECORD_NAMESPACES, RESERVED_INSTANCE_NAMES, recordId, type ChunkDocument, type PlayArea, type QuarterTurns, type RecordCategory, type Rect, type WorldDocument, type XZ } from '../schema.ts'
import { addQuarterTurns, chunkIdOf, chunkIndex, chunkOrigin, parseRecordId, quantize } from '../transform.ts'
import { allRecordIds, anchorKey, findRecord, ID_KEY, withExternalRefs, worldAnchor, type AnyRecord, type MapDocument } from './document.ts'
import { findPreset, presetPlacement, type PresetCategory } from './presets.ts'

/**
 * Editing commands (M3, world authoring M4): pure functions document → document. Each returns the new document and
 * the selection that goes with it, or an error that leaves the document untouched. The history
 * (`session.ts`) stores the before/after documents, so undo/redo restore identities exactly.
 *
 * Identity rules (docs/map-content-format.md §4):
 * - move/rotate/edit never change an ID; a move across a chunk line re-homes the record into the
 *   other chunk file and keeps its ID (the chunk part of an ID is the identity chunk, not the owner);
 * - place/duplicate create a new ID in the owner chunk; names already used, reserved or retired are skipped;
 * - delete retires the ID (`world.retiredIds`) so it is never handed out again.
 */

export type CommandResult = { ok: true; doc: MapDocument; selection: string[]; note?: string } | { ok: false; error: string }

const fail = (error: string): CommandResult => ({ ok: false, error })

/** Mutable working copy of the chunks a command touches (copy-on-write per chunk and list). */
class Draft {
  private readonly doc: MapDocument
  private chunks: Map<string, ChunkDocument> | null = null
  private readonly copied = new Set<string>()

  constructor(doc: MapDocument) {
    this.doc = doc
  }

  chunk(chunkId: string): ChunkDocument {
    const current = (this.chunks ?? this.doc.chunks).get(chunkId)!
    if (this.copied.has(chunkId)) return current
    const copy: ChunkDocument = {
      ...current,
      instances: [...current.instances],
      objects: [...current.objects],
      roads: [...current.roads],
      zones: [...current.zones],
      spawns: [...current.spawns],
    }
    this.chunks ??= new Map(this.doc.chunks)
    this.chunks.set(chunkId, copy)
    this.copied.add(chunkId)
    return copy
  }

  list(chunkId: string, category: RecordCategory): AnyRecord[] {
    return this.chunk(chunkId)[category] as unknown as AnyRecord[]
  }

  finish(world: WorldDocument = this.doc.world): MapDocument {
    return withExternalRefs({ ...this.doc, world, chunks: this.chunks ?? this.doc.chunks })
  }
}

/** Owner chunk of a world point, if the world has it. */
export function ownerChunk(doc: MapDocument, p: XZ): { chunkId: string; local: XZ } | null {
  const S = doc.world.chunkSize
  const cx = chunkIndex(p.x, S)
  const cz = chunkIndex(p.z, S)
  const chunkId = chunkIdOf(cx, cz)
  if (!doc.chunks.has(chunkId)) return null
  const o = chunkOrigin(cx, cz, S)
  return { chunkId, local: { x: quantize(p.x - o.x), z: quantize(p.z - o.z) } }
}

function namespaceOf(category: RecordCategory): string | null {
  return category === 'instances' ? null : RECORD_NAMESPACES[category]
}

function makeId(chunkId: string, namespace: string | null, name: string): string {
  return namespace ? `${chunkId}/${namespace}/${name}` : `${chunkId}/${name}`
}

/**
 * First free name `<base>-<n>` (n ≥ 1) in that chunk and namespace: not used by a live record,
 * not retired, not reserved. `base` is stripped of a trailing `-<n>` first (house-2 → house-3).
 */
export function freshId(doc: MapDocument, chunkId: string, category: RecordCategory, base: string, taken: ReadonlySet<string> = new Set()): string {
  const namespace = namespaceOf(category)
  const stem = base.replace(/-\d+$/, '') || 'item'
  const used = new Set([...allRecordIds(doc), ...(doc.world.retiredIds ?? []), ...taken])
  for (let n = 1; ; n++) {
    const name = `${stem}-${n}`
    if (!namespace && RESERVED_INSTANCE_NAMES.has(name)) continue
    const id = makeId(chunkId, namespace, name)
    if (!used.has(id)) return id
  }
}

function withAnchor(category: RecordCategory, record: AnyRecord, local: XZ): AnyRecord {
  const key = anchorKey(category)
  const old = record[key] as AnyRecord
  return { ...record, [key]: { ...old, x: local.x, z: local.z } }
}

/** Place a prefab instance with its pivot at world point `at`. */
export function placeInstance(doc: MapDocument, prefabId: string, at: XZ, quarterTurns: QuarterTurns, y = 0): CommandResult {
  if (!doc.prefabs.has(prefabId)) return fail(`Prefab ${prefabId} không có trong world`)
  const owner = ownerChunk(doc, at)
  if (!owner) return fail(`Điểm (${at.x}, ${at.z}) nằm ngoài các chunk của world`)
  const id = freshId(doc, owner.chunkId, 'instances', prefabId.split('/').pop()!)
  const draft = new Draft(doc)
  draft.chunk(owner.chunkId).instances.push({ instanceId: id, prefabId, position: { x: owner.local.x, y, z: owner.local.z }, quarterTurns })
  return { ok: true, doc: draft.finish(), selection: [id] }
}

/**
 * Move records by a world delta. Crossing a chunk line re-homes the record (same ID); a target
 * outside every chunk of the world blocks the whole move.
 */
export function moveRecords(doc: MapDocument, selected: readonly string[], delta: XZ): CommandResult {
  const ids = [...new Set(selected)]
  if (ids.length === 0) return fail('Chưa chọn gì')
  const plans = []
  for (const id of ids) {
    const loc = findRecord(doc, id)
    if (!loc) return fail(`Không tìm thấy ${id}`)
    const a = worldAnchor(doc, loc)
    const target = { x: quantize(a.x + delta.x), z: quantize(a.z + delta.z) }
    const owner = ownerChunk(doc, target)
    if (!owner) return fail(`${id} sẽ ra ngoài các chunk của world (${target.x}, ${target.z})`)
    plans.push({ loc, owner })
  }
  const draft = new Draft(doc)
  const rehomed: string[] = []
  // In-place updates while indices are still valid, then removals (highest index first), then appends.
  const stays = plans.filter((p) => p.owner.chunkId === p.loc.chunkId)
  const leaves = plans.filter((p) => p.owner.chunkId !== p.loc.chunkId)
  for (const p of stays) draft.list(p.loc.chunkId, p.loc.category)[p.loc.index] = withAnchor(p.loc.category, p.loc.record, p.owner.local)
  for (const p of [...leaves].sort((a, b) => b.loc.index - a.loc.index)) draft.list(p.loc.chunkId, p.loc.category).splice(p.loc.index, 1)
  for (const p of leaves) {
    draft.list(p.owner.chunkId, p.loc.category).push(withAnchor(p.loc.category, p.loc.record, p.owner.local))
    rehomed.push(`${recordId(p.loc.category, p.loc.record)}: ${p.loc.chunkId} → ${p.owner.chunkId}`)
  }
  return { ok: true, doc: draft.finish(), selection: [...ids], ...(rehomed.length ? { note: `Đổi chunk sở hữu (ID giữ nguyên): ${rehomed.join(', ')}` } : {}) }
}

/** Put one record's anchor at a world point (inspector). */
export function setRecordAnchor(doc: MapDocument, id: string, at: XZ): CommandResult {
  const loc = findRecord(doc, id)
  if (!loc) return fail(`Không tìm thấy ${id}`)
  const a = worldAnchor(doc, loc)
  return moveRecords(doc, [id], { x: at.x - a.x, z: at.z - a.z })
}

/**
 * Turn records by `turns` quarter turns. Instances turn about their pivot; boxes, surfaces and
 * rectangle zones are axis-aligned, so an odd turn swaps their X/Z size about the anchor (their
 * centre). Spawns and circle zones have no orientation; records a turn leaves unchanged are skipped.
 */
export function rotateRecords(doc: MapDocument, selected: readonly string[], turns: number): CommandResult {
  const ids = [...new Set(selected)]
  const draft = new Draft(doc)
  let count = 0
  const odd = (turns & 1) === 1
  for (const id of ids) {
    const loc = findRecord(doc, id)
    if (!loc) continue
    const r = loc.record
    let next: AnyRecord | null = null
    if (loc.category === 'instances') {
      const q = addQuarterTurns(r.quarterTurns as number, turns)
      if (q !== r.quarterTurns) next = { ...r, quarterTurns: q }
    } else if (odd && Array.isArray(r.size)) {
      const s = r.size as number[]
      const swapped = s.length === 3 ? [s[2], s[1], s[0]] : [s[1], s[0]]
      if (swapped.some((v, i) => v !== s[i])) next = { ...r, size: swapped }
    }
    if (!next) continue
    draft.list(loc.chunkId, loc.category)[loc.index] = next
    count++
  }
  if (count === 0) return fail('Không có gì để xoay (spawn, zone tròn và khối vuông không đổi khi xoay)')
  return { ok: true, doc: draft.finish(), selection: [...ids] }
}

/** Record of a preset with its keys in content-file order (objects: `kind` before the ID). */
function presetRecord(category: PresetCategory, id: string, fields: AnyRecord, local: XZ): AnyRecord {
  const merged = withAnchor(category, fields, local)
  if (category === 'objects') {
    const { kind, ...rest } = merged
    return { kind, [ID_KEY.objects]: id, ...rest }
  }
  return { [ID_KEY[category]]: id, ...merged }
}

/**
 * Place a record from the world-authoring palette (M4): pressed at `from`, released at `to`
 * (null = click, the template's own size). New stable ID `<owner chunk>/<namespace>/<name>-<n>`.
 */
export function placeRecord(doc: MapDocument, presetId: string, from: XZ, to: XZ | null = null): CommandResult {
  const preset = findPreset(presetId)
  if (!preset) return fail(`Không có mẫu ${presetId}`)
  const { at, fields } = presetPlacement(preset, from, to)
  const owner = ownerChunk(doc, at)
  if (!owner) return fail(`Điểm (${at.x}, ${at.z}) nằm ngoài các chunk của world — thêm chunk ở tab Chunk`)
  const id = freshId(doc, owner.chunkId, preset.category, preset.name)
  const draft = new Draft(doc)
  draft.list(owner.chunkId, preset.category).push(presetRecord(preset.category, id, { ...structuredClone(preset.template), ...fields }, owner.local))
  return { ok: true, doc: draft.finish(), selection: [id] }
}

/** Tight inclusive chunk index range of the manifest's chunks. */
function tightChunkBounds(chunks: readonly { cx: number; cz: number }[]): WorldDocument['chunkBounds'] {
  return {
    minCx: Math.min(...chunks.map((c) => c.cx)),
    maxCx: Math.max(...chunks.map((c) => c.cx)),
    minCz: Math.min(...chunks.map((c) => c.cz)),
    maxCz: Math.max(...chunks.map((c) => c.cz)),
  }
}

/**
 * Add an empty chunk file (M4). It is appended to the manifest, so the content order (and the
 * runtime order of everything already placed) stays; `chunkBounds` grows to include it and records
 * that already reach into it get their external references.
 */
export function addChunk(doc: MapDocument, cx: number, cz: number, selection: string[] = []): CommandResult {
  if (!Number.isInteger(cx) || !Number.isInteger(cz)) return fail('Chỉ số chunk phải là số nguyên')
  const chunkId = chunkIdOf(cx, cz)
  if (doc.chunks.has(chunkId)) return fail(`Chunk ${chunkId} đã có`)
  const path = `chunks/${chunkId}.json`
  if (doc.extras.has(path) || doc.world.chunks.some((c) => c.path === path)) return fail(`Đường dẫn ${path} đã được dùng`)
  const chunk: ChunkDocument = { schemaVersion: MAP_SCHEMA_VERSION, contentVersion: 1, chunkId, cx, cz, instances: [], objects: [], roads: [], zones: [], spawns: [], externalRefs: [] }
  const entries = [...doc.world.chunks, { chunkId, cx, cz, path }]
  const b = doc.world.chunkBounds
  const chunkBounds = { minCx: Math.min(b.minCx, cx), maxCx: Math.max(b.maxCx, cx), minCz: Math.min(b.minCz, cz), maxCz: Math.max(b.maxCz, cz) }
  const chunks = new Map(doc.chunks).set(chunkId, chunk)
  return { ok: true, doc: withExternalRefs({ ...doc, world: { ...doc.world, chunks: entries, chunkBounds }, chunks }), selection, note: `Thêm chunk ${chunkId}` }
}

/** Remove a chunk that owns no record (move or delete them first); never the last one. */
export function removeChunk(doc: MapDocument, chunkId: string, selection: string[] = []): CommandResult {
  const chunk = doc.chunks.get(chunkId)
  if (!chunk) return fail(`Không có chunk ${chunkId}`)
  if (doc.world.chunks.length === 1) return fail('World phải còn ít nhất một chunk')
  const owned = chunk.instances.length + chunk.objects.length + chunk.roads.length + chunk.zones.length + chunk.spawns.length
  if (owned > 0) return fail(`Chunk ${chunkId} còn sở hữu ${owned} record — di chuyển hoặc xóa chúng trước`)
  const entries = doc.world.chunks.filter((c) => c.chunkId !== chunkId)
  const chunks = new Map(doc.chunks)
  chunks.delete(chunkId)
  const world = { ...doc.world, chunks: entries, chunkBounds: tightChunkBounds(entries) }
  return { ok: true, doc: withExternalRefs({ ...doc, world, chunks }), selection, note: `Xóa chunk ${chunkId}` }
}

/** Play area in canonical form: `depth` only when it differs from `size`, `center` only off the origin. */
export function normalizePlayArea(p: PlayArea): PlayArea {
  const out: PlayArea = { size: quantize(p.size) }
  if (p.depth !== undefined && quantize(p.depth) !== out.size) out.depth = quantize(p.depth)
  if (p.center && (quantize(p.center.x) !== 0 || quantize(p.center.z) !== 0)) out.center = { x: quantize(p.center.x), z: quantize(p.center.z) }
  return out
}

/** Play area as a rectangle (M7: off-centre and non-square allowed), in canonical form. */
export function playAreaFromRect(r: Rect): PlayArea {
  return normalizePlayArea({ size: r.maxX - r.minX, depth: r.maxZ - r.minZ, center: { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 } })
}

/**
 * Play area covering the rectangle of the world's chunks, less a 2 m margin on each side like the
 * neighbourhood and blank worlds (M7: it follows the chunks instead of a square around the origin).
 */
export function fittedPlayArea(world: WorldDocument): PlayArea {
  const S = world.chunkSize
  const b = tightChunkBounds(world.chunks)
  const margin = Math.min(2, S / 4)
  return playAreaFromRect({ minX: b.minCx * S + margin, minZ: b.minCz * S + margin, maxX: (b.maxCx + 1) * S - margin, maxZ: (b.maxCz + 1) * S - margin })
}

export function samePlayArea(a: PlayArea, b: PlayArea): boolean {
  return JSON.stringify(normalizePlayArea(a)) === JSON.stringify(normalizePlayArea(b))
}

/** Delete records; their IDs are retired. The manifest's player spawn cannot be deleted. */
export function deleteRecords(doc: MapDocument, selected: readonly string[]): CommandResult {
  const ids = [...new Set(selected)]
  if (ids.length === 0) return fail('Chưa chọn gì')
  if (ids.includes(doc.world.playerSpawn)) return fail(`${doc.world.playerSpawn} là điểm xuất phát của người chơi (world.playerSpawn), không xóa được`)
  const locs = []
  for (const id of ids) {
    const loc = findRecord(doc, id)
    if (!loc) return fail(`Không tìm thấy ${id}`)
    locs.push(loc)
  }
  const draft = new Draft(doc)
  for (const loc of [...locs].sort((a, b) => b.index - a.index)) draft.list(loc.chunkId, loc.category).splice(loc.index, 1)
  const retiredIds = [...new Set([...(doc.world.retiredIds ?? []), ...ids])].sort()
  return { ok: true, doc: draft.finish({ ...doc.world, retiredIds }), selection: [] }
}

/** Copy records `offset` metres away with new IDs in their new owner chunk. */
export function duplicateRecords(doc: MapDocument, selected: readonly string[], offset: XZ): CommandResult {
  const ids = [...new Set(selected)]
  if (ids.length === 0) return fail('Chưa chọn gì')
  const draft = new Draft(doc)
  const created: string[] = []
  const taken = new Set<string>()
  for (const id of ids) {
    const loc = findRecord(doc, id)
    if (!loc) return fail(`Không tìm thấy ${id}`)
    const a = worldAnchor(doc, loc)
    const owner = ownerChunk(doc, { x: a.x + offset.x, z: a.z + offset.z })
    if (!owner) return fail(`Bản sao của ${id} sẽ ra ngoài các chunk của world`)
    const name = parseRecordId(id, namespaceOf(loc.category))?.name ?? 'item'
    const newId = freshId(doc, owner.chunkId, loc.category, name, taken)
    taken.add(newId)
    const copy = withAnchor(loc.category, { ...structuredClone(loc.record), [ID_KEY[loc.category]]: newId }, owner.local)
    draft.list(owner.chunkId, loc.category).push(copy)
    created.push(newId)
  }
  return { ok: true, doc: draft.finish(), selection: created }
}

/**
 * Change record properties (inspector). The ID can't change; the anchor may change only in height
 * (`position.y`): horizontal moves go through `moveRecords` so ownership stays right.
 */
export function updateRecord(doc: MapDocument, id: string, patch: AnyRecord): CommandResult {
  const loc = findRecord(doc, id)
  if (!loc) return fail(`Không tìm thấy ${id}`)
  const idKey = ID_KEY[loc.category]
  if (idKey in patch && patch[idKey] !== id) return fail('ID không đổi được (ID ổn định)')
  const key = anchorKey(loc.category)
  if (key in patch) {
    const want = patch[key] as XZ
    const have = loc.record[key] as XZ
    if (want.x !== have.x || want.z !== have.z) return fail('Đổi vị trí ngang bằng lệnh di chuyển')
  }
  const next: AnyRecord = { ...loc.record }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k]
    else next[k] = v
  }
  const draft = new Draft(doc)
  draft.list(loc.chunkId, loc.category)[loc.index] = next
  return { ok: true, doc: draft.finish(), selection: [id] }
}

export type WorldPatch = Partial<Pick<WorldDocument, 'name' | 'contentVersion' | 'playerSpawn' | 'playArea' | 'boundary'>>

export function updateWorld(doc: MapDocument, patch: WorldPatch, selection: string[] = []): CommandResult {
  if (patch.playerSpawn !== undefined) {
    const loc = findRecord(doc, patch.playerSpawn)
    if (!loc || loc.category !== 'spawns' || loc.record.kind !== 'player') return fail(`${patch.playerSpawn} không phải spawn người chơi`)
  }
  if (patch.contentVersion !== undefined && !(Number.isInteger(patch.contentVersion) && patch.contentVersion >= 1)) return fail('contentVersion phải là số nguyên ≥ 1')
  const positive = (v: number) => Number.isFinite(v) && v > 0
  if (patch.playArea !== undefined) {
    const a = patch.playArea
    if (!positive(a.size) || (a.depth !== undefined && !positive(a.depth))) return fail('Kích thước vùng chơi phải > 0')
    if (a.center && !(Number.isFinite(a.center.x) && Number.isFinite(a.center.z))) return fail('Tâm vùng chơi không hợp lệ')
    patch = { ...patch, playArea: normalizePlayArea(a) }
  }
  if (patch.boundary && !(positive(patch.boundary.height) && positive(patch.boundary.thickness))) return fail('Hàng rào biên: cao và dày phải > 0')
  return { ok: true, doc: { ...doc, world: { ...doc.world, ...patch } }, selection }
}
