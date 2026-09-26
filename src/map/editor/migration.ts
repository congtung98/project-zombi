import {
  CONTENT_MIGRATION_FORMAT,
  contentMigrationPath,
  diffIds,
  kindOf,
  renameProblems,
  STATEFUL_KINDS,
  statefulIds,
  type ContentDiff,
  type ContentMigration,
  type StatefulIds,
  type StatefulKind,
} from '../contentMigration.ts'
import type { CommandResult } from './commands.ts'
import { resolvedRecords, type MapDocument } from './document.ts'

/**
 * Editor side of content migrations (M8). The baseline is the published revision (the repo
 * content as opened, or the repo copy of a draft's world); a migration file records its IDs and
 * the renames the author chose, and the world moves to the next contentVersion. Everything else
 * (what was removed or added) follows from the IDs, so later edits never make the file stale:
 * only a rename whose target disappears does, and the validator reports it.
 */

const fail = (error: string): CommandResult => ({ ok: false, error })

export function documentStatefulIds(doc: MapDocument): StatefulIds {
  return statefulIds(resolvedRecords(doc).map((r) => r.parts))
}

/** Stateful IDs removed/added since the baseline (before renames). */
export function contentChanges(baseline: MapDocument, doc: MapDocument): ContentDiff {
  return diffIds(documentStatefulIds(baseline), documentStatefulIds(doc))
}

/** The migration step from `fromVersion` stored in the document, if any. */
export function migrationOf(doc: MapDocument, fromVersion: number): ContentMigration | null {
  return (doc.extras.get(contentMigrationPath(fromVersion)) as ContentMigration | undefined) ?? null
}

/** Parent of an entity ID (`c0_0/house/lamp-a` → `c0_0/house`). */
const parentOf = (id: string) => id.slice(0, id.lastIndexOf('/'))

/**
 * Likely renames: within one kind and one parent (the same instance or chunk namespace), exactly
 * one ID removed and one added — typically a prefab item given a new local ID, or a door replaced.
 */
export function suggestRenames(diff: ContentDiff): Record<string, string> {
  const out: Record<string, string> = {}
  for (const kind of STATEFUL_KINDS) {
    const groups = new Map<string, { removed: string[]; added: string[] }>()
    const group = (id: string) => {
      const key = parentOf(id)
      let g = groups.get(key)
      if (!g) groups.set(key, (g = { removed: [], added: [] }))
      return g
    }
    for (const id of diff.removed[kind]) group(id).removed.push(id)
    for (const id of diff.added[kind]) group(id).added.push(id)
    for (const g of groups.values()) if (g.removed.length === 1 && g.added.length === 1) out[g.removed[0]] = g.added[0]
  }
  return out
}

function sortedRenames(renamed: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(renamed).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/**
 * Write (or rewrite) the migration from the baseline's revision N: `migrations/content-vN.json` with
 * the baseline's IDs and `renamed`, and contentVersion N + 1. Renames must fit (removed → added,
 * same kind, each target once).
 */
export function writeContentMigration(doc: MapDocument, baseline: MapDocument, renamed: Record<string, string>, selection: string[] = []): CommandResult {
  if (baseline.world.worldId !== doc.world.worldId) return fail('Bản gốc là world khác')
  const base = baseline.world.contentVersion
  if (doc.world.contentVersion !== base && doc.world.contentVersion !== base + 1) return fail(`contentVersion phải là ${base} hoặc ${base + 1} (bản đã phát hành là v${base})`)
  const ids = documentStatefulIds(baseline)
  const problems = renameProblems({ ids, renamed }, documentStatefulIds(doc))
  if (problems.length) return fail(`Đổi tên không hợp lệ: ${problems[0].message}`)
  const file: ContentMigration = { format: CONTENT_MIGRATION_FORMAT, fromVersion: base, toVersion: base + 1, ids, renamed: sortedRenames(renamed) }
  const extras = new Map(doc.extras).set(contentMigrationPath(base), file)
  return { ok: true, doc: { ...doc, world: { ...doc.world, contentVersion: base + 1 }, extras }, selection, note: `Migration v${base} → v${base + 1}: save của v${base} sẽ được chuyển sang nội dung mới` }
}

/** Set or clear (`to` null) one rename of an existing migration step. */
export function setMigrationRename(doc: MapDocument, fromVersion: number, from: string, to: string | null, selection: string[] = []): CommandResult {
  const file = migrationOf(doc, fromVersion)
  if (!file) return fail(`Chưa có migration từ v${fromVersion}`)
  const renamed = { ...file.renamed }
  if (to === null) delete renamed[from]
  else renamed[from] = to
  const next = fromVersion + 1 === doc.world.contentVersion ? documentStatefulIds(doc) : (migrationOf(doc, fromVersion + 1)?.ids ?? null)
  if (!next) return fail(`Không có nội dung v${fromVersion + 1} để kiểm tra`)
  const problems = renameProblems({ ids: file.ids, renamed }, next)
  if (problems.length) return fail(`Đổi tên không hợp lệ: ${problems[0].message}`)
  const extras = new Map(doc.extras).set(contentMigrationPath(fromVersion), { ...file, renamed: sortedRenames(renamed) })
  return { ok: true, doc: { ...doc, extras }, selection }
}

/** Kind of a stateful ID in either revision (for labels). */
export function statefulKindOf(ids: StatefulIds, other: StatefulIds, id: string): StatefulKind | null {
  return kindOf(ids, id) ?? kindOf(other, id)
}
