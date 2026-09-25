import { RECORD_NAMESPACES, RESERVED_INSTANCE_NAMES, recordId, type ChunkDocument, type QuarterTurns, type RecordCategory, type WorldDocument, type XZ } from '../schema.ts'
import { addQuarterTurns, chunkIdOf, chunkIndex, chunkOrigin, parseRecordId, quantize } from '../transform.ts'
import { allRecordIds, anchorKey, findRecord, ID_KEY, withExternalRefs, worldAnchor, type AnyRecord, type MapDocument } from './document.ts'

/**
 * Editing commands (M3): pure functions document → document. Each returns the new document and
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

/** Turn instances by `turns` quarter turns about their pivot (other records have no rotation). */
export function rotateInstances(doc: MapDocument, selected: readonly string[], turns: number): CommandResult {
  const ids = [...new Set(selected)]
  const draft = new Draft(doc)
  let count = 0
  for (const id of ids) {
    const loc = findRecord(doc, id)
    if (!loc || loc.category !== 'instances') continue
    const r = loc.record
    draft.list(loc.chunkId, 'instances')[loc.index] = { ...r, quarterTurns: addQuarterTurns(r.quarterTurns as number, turns) }
    count++
  }
  if (count === 0) return fail('Chỉ công trình (instance prefab) xoay được')
  return { ok: true, doc: draft.finish(), selection: [...ids] }
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

export type WorldPatch = Partial<Pick<WorldDocument, 'name' | 'contentVersion' | 'playerSpawn'>>

export function updateWorld(doc: MapDocument, patch: WorldPatch, selection: string[] = []): CommandResult {
  if (patch.playerSpawn !== undefined) {
    const loc = findRecord(doc, patch.playerSpawn)
    if (!loc || loc.category !== 'spawns' || loc.record.kind !== 'player') return fail(`${patch.playerSpawn} không phải spawn người chơi`)
  }
  if (patch.contentVersion !== undefined && !(Number.isInteger(patch.contentVersion) && patch.contentVersion >= 1)) return fail('contentVersion phải là số nguyên ≥ 1')
  return { ok: true, doc: { ...doc, world: { ...doc.world, ...patch } }, selection }
}
