import { recordId, type LibrarySource, type QuarterTurns, type RecordCategory, type XZ } from '../schema.ts'
import { addQuarterTurns, quantize, rotateXZ, SLUG } from '../transform.ts'
import { canonicalJson, hashText } from '../layout/geometry.ts'
import { anchorKey, findRecord, ID_KEY, worldAnchor, type AnyRecord, type MapDocument } from './document.ts'

/**
 * Editor groups (prefab library P1). A compound prefab placed in a world becomes ordinary instances
 * and objects, which the game loads like any other record; the editor keeps them together as a
 * group in `editor/compounds.json` (a file of the world folder the game never loads or bundles):
 * clicking one member selects the group, moving, turning, duplicating and deleting act on the whole
 * group, Alt+click picks one member to edit, and "Rã nhóm" drops the group and leaves the records.
 *
 * A group remembers its pivot and turn in the world and, per member, the hash of the member in the
 * group's own frame at placement: moving or turning the whole group keeps every member unmodified;
 * editing one member by hand marks it modified, so an update from the library never overwrites it.
 */

export const GROUPS_FILE = 'editor/compounds.json'
export const GROUPS_FORMAT = 'zombie-outbreak/compound-groups'

export interface GroupMember {
  /** Member name in the compound (`main`, `yard` …). */
  member: string
  /** Record ID in the world. */
  id: string
  /** `memberHash` of the member in the group frame at placement (absent: plain group, never "modified"). */
  hash?: string
}

export interface CompoundGroup {
  /** Slug, unique in the world. */
  groupId: string
  name: string
  /** Compound it was placed from (or saved as). */
  compoundId?: string
  /** Library, compound version and hash it was placed from. */
  source?: LibrarySource
  /** World point of the compound's pivot. */
  pivot: XZ
  quarterTurns: QuarterTurns
  members: GroupMember[]
}

export interface GroupsFile {
  format: typeof GROUPS_FORMAT
  version: 1
  groups: CompoundGroup[]
}

const cache = new WeakMap<object, CompoundGroup[]>()

/** Why a groups file is unusable, or null. */
export function groupsProblem(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return 'không phải object'
  const f = raw as Partial<GroupsFile>
  if (f.format !== GROUPS_FORMAT || f.version !== 1) return `format phải là ${GROUPS_FORMAT} v1`
  if (!Array.isArray(f.groups)) return 'groups phải là mảng'
  const ids = new Set<string>()
  for (const g of f.groups as unknown[]) {
    const x = g as Partial<CompoundGroup>
    if (!x || typeof x.groupId !== 'string' || !SLUG.test(x.groupId)) return 'groupId phải là slug'
    if (ids.has(x.groupId)) return `groupId ${x.groupId} trùng`
    ids.add(x.groupId)
    if (typeof x.name !== 'string') return `${x.groupId}: thiếu tên`
    if (!x.pivot || typeof x.pivot.x !== 'number' || typeof x.pivot.z !== 'number') return `${x.groupId}: pivot không hợp lệ`
    if (![0, 1, 2, 3].includes(x.quarterTurns as number)) return `${x.groupId}: quarterTurns không hợp lệ`
    if (!Array.isArray(x.members) || x.members.some((m) => !m || typeof m.member !== 'string' || typeof m.id !== 'string')) return `${x.groupId}: members không hợp lệ`
  }
  return null
}

/** Groups stored with the document ([] when there are none or the file is unusable: `groupsProblem`). */
export function documentGroups(doc: MapDocument): CompoundGroup[] {
  const raw = doc.extras.get(GROUPS_FILE)
  if (!raw || typeof raw !== 'object') return []
  let g = cache.get(raw)
  if (!g) {
    g = groupsProblem(raw) ? [] : (raw as GroupsFile).groups
    cache.set(raw, g)
  }
  return g
}

/** The document with these groups (none: the file is removed). */
export function withGroups(doc: MapDocument, groups: readonly CompoundGroup[]): MapDocument {
  const extras = new Map(doc.extras)
  if (groups.length) extras.set(GROUPS_FILE, { format: GROUPS_FORMAT, version: 1, groups: [...groups] } satisfies GroupsFile)
  else extras.delete(GROUPS_FILE)
  return { ...doc, extras }
}

/** Members of a group whose record still exists (a member deleted by hand drops out). */
export function liveMembers(doc: MapDocument, g: CompoundGroup): GroupMember[] {
  return g.members.filter((m) => findRecord(doc, m.id))
}

/** The group a record belongs to. */
export function groupOf(doc: MapDocument, id: string): CompoundGroup | null {
  return documentGroups(doc).find((g) => g.members.some((m) => m.id === id)) ?? null
}

/** A selection grown to whole groups (clicking one member selects its group). */
export function expandToGroups(doc: MapDocument, ids: readonly string[]): string[] {
  const groups = documentGroups(doc)
  if (!groups.length) return [...ids]
  const out = new Set(ids)
  for (const g of groups) if (g.members.some((m) => out.has(m.id))) for (const m of liveMembers(doc, g)) out.add(m.id)
  return [...out]
}

/** Groups every live member of which is selected (they move, turn and duplicate as a whole). */
export function fullGroups(doc: MapDocument, ids: readonly string[]): CompoundGroup[] {
  const want = new Set(ids)
  return documentGroups(doc).filter((g) => {
    const live = liveMembers(doc, g)
    return live.length > 0 && live.every((m) => want.has(m.id))
  })
}

/** Drop members whose record is gone and groups left empty. */
export function pruneGroups(doc: MapDocument): MapDocument {
  const groups = documentGroups(doc)
  if (!groups.length) return doc
  let changed = false
  const next: CompoundGroup[] = []
  for (const g of groups) {
    const live = liveMembers(doc, g)
    if (live.length !== g.members.length) changed = true
    if (live.length) next.push(live.length === g.members.length ? g : { ...g, members: live })
  }
  return changed ? withGroups(doc, next) : doc
}

/** A slug from any text (Vietnamese diacritics dropped): `Trường học` → `truong-hoc`. */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** First free `<base>-<n>` group ID. */
export function freshGroupId(groups: readonly CompoundGroup[], base: string, taken: ReadonlySet<string> = new Set()): string {
  const stem = slugify(base.replace(/-\d+$/, '')) || 'group'
  const used = new Set([...groups.map((g) => g.groupId), ...taken])
  for (let n = 1; ; n++) if (!used.has(`${stem}-${n}`)) return `${stem}-${n}`
}

// ---- Turning records (world rotation, groups, compounds) ----

/**
 * A record's own fields turned by `turns` quarter turns about its anchor, or null when a turn leaves
 * it unchanged. Instances add to their turn; boxes, surfaces and rectangle zones swap X/Z (they are
 * axis-aligned); decor adds to its yaw; a furniture look with a set facing turns with its box. Trees,
 * spawns and circle zones have no orientation.
 */
export function turnRecord(category: RecordCategory, r: AnyRecord, turns: number): AnyRecord | null {
  if (turns % 4 === 0) return null
  if (category === 'instances') {
    const q = addQuarterTurns(r.quarterTurns as number, turns)
    return q !== r.quarterTurns ? { ...r, quarterTurns: q } : null
  }
  if (r.kind === 'decor') return { ...r, yaw: ((((r.yaw as number | undefined) ?? 0) + turns * 90) % 360 + 360) % 360 }
  if (!Array.isArray(r.size)) return null
  let next: AnyRecord | null = null
  const s = r.size as number[]
  if (turns & 1) {
    const swapped = s.length === 3 ? [s[2], s[1], s[0]] : [s[1], s[0]]
    if (swapped.some((v, i) => v !== s[i])) next = { ...r, size: swapped }
  }
  const visual = r.visual as { facing?: number } | undefined
  if (visual?.facing !== undefined) next = { ...(next ?? r), visual: { ...visual, facing: addQuarterTurns(visual.facing, turns) } }
  return next
}

/** `p` turned `turns` quarter turns about `pivot`. */
export function turnAbout(p: XZ, pivot: XZ, turns: number): XZ {
  const [x, z] = rotateXZ(p.x - pivot.x, p.z - pivot.z, turns)
  return { x: quantize(pivot.x + x), z: quantize(pivot.z + z) }
}

/**
 * A member in its group's own frame: the record without its ID, the anchor relative to the pivot and
 * everything turned back by the group's turn. The same for any position and turn of the whole group.
 */
export function memberLocal(category: RecordCategory, record: AnyRecord, anchor: XZ, pivot: XZ, q: number): AnyRecord {
  const back = (4 - (q & 3)) & 3
  const { [ID_KEY[category]]: _id, ...rest } = record
  const turned = turnRecord(category, rest, back) ?? rest
  const [x, z] = rotateXZ(anchor.x - pivot.x, anchor.z - pivot.z, back)
  const key = anchorKey(category)
  const out: AnyRecord = { ...turned, [key]: { ...(turned[key] as AnyRecord), x: quantize(x), z: quantize(z) } }
  if (out.yaw === 0) delete out.yaw
  return out
}

/** Hash of a member's group-frame form (`memberLocal`). */
export function memberHash(local: AnyRecord): string {
  return `cyrb53:${hashText(canonicalJson(local))}`
}

/** Hash of a live member as it is now in its group. */
export function currentMemberHash(doc: MapDocument, g: CompoundGroup, id: string): string | null {
  const loc = findRecord(doc, id)
  if (!loc) return null
  return memberHash(memberLocal(loc.category, loc.record, worldAnchor(doc, loc), g.pivot, g.quarterTurns))
}

/** Members edited by hand since placement (their group-frame hash changed). */
export function modifiedMembers(doc: MapDocument, g: CompoundGroup): string[] {
  return g.members.filter((m) => m.hash && findRecord(doc, m.id) && currentMemberHash(doc, g, m.id) !== m.hash).map((m) => m.id)
}

/** Group bookkeeping after `moveRecords`: whole groups moved by `delta` carry their pivot. */
export function groupsAfterMove(doc: MapDocument, before: MapDocument, ids: readonly string[], delta: XZ): MapDocument {
  const moved = new Set(fullGroups(before, ids).map((g) => g.groupId))
  if (!moved.size) return doc
  return withGroups(
    doc,
    documentGroups(doc).map((g) => (moved.has(g.groupId) ? { ...g, pivot: { x: quantize(g.pivot.x + delta.x), z: quantize(g.pivot.z + delta.z) } } : g)),
  )
}

/** Group bookkeeping after `duplicateRecords`: whole groups copied get a copy of their group with the new IDs. */
export function groupsAfterDuplicate(doc: MapDocument, before: MapDocument, ids: readonly string[], created: ReadonlyMap<string, string>, offset: XZ): MapDocument {
  const copied = fullGroups(before, ids)
  if (!copied.length) return doc
  const groups = [...documentGroups(doc)]
  for (const g of copied) {
    const members = liveMembers(before, g).map((m) => ({ ...m, id: created.get(m.id)! }))
    groups.push({ ...g, groupId: freshGroupId(groups, g.groupId), pivot: { x: quantize(g.pivot.x + offset.x), z: quantize(g.pivot.z + offset.z) }, members })
  }
  return withGroups(doc, groups)
}

/** Record IDs of a group, in content order of its members. */
export function groupIds(doc: MapDocument, g: CompoundGroup): string[] {
  return liveMembers(doc, g).map((m) => m.id)
}

/** The group itself as a new group of records (Ctrl+G): pivot at the centre of their anchors. */
export function newGroup(doc: MapDocument, ids: readonly string[], name: string): CompoundGroup | string {
  if (ids.length < 2) return 'Chọn ít nhất 2 record để nhóm'
  if (ids.some((id) => groupOf(doc, id))) return 'Một record đã thuộc nhóm khác: rã nhóm đó trước'
  const locs = ids.map((id) => findRecord(doc, id))
  if (locs.some((l) => !l)) return 'Không tìm thấy record'
  const anchors = locs.map((l) => worldAnchor(doc, l!))
  const pivot = { x: quantize((Math.min(...anchors.map((a) => a.x)) + Math.max(...anchors.map((a) => a.x))) / 2), z: quantize((Math.min(...anchors.map((a) => a.z)) + Math.max(...anchors.map((a) => a.z))) / 2) }
  const used = new Set<string>()
  const members = locs.map((l) => {
    const base = recordId(l!.category, l!.record).split('/').pop()!
    let member = base
    for (let n = 2; used.has(member); n++) member = `${base}-${n}`
    used.add(member)
    return { member, id: recordId(l!.category, l!.record) }
  })
  return { groupId: freshGroupId(documentGroups(doc), name), name, pivot, quarterTurns: 0, members }
}
