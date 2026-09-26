import type { XZ } from './schema.ts'

/**
 * Content migrations (map editor M8): how a save written against content revision N of a world
 * loads into revision N + 1 after the stateful IDs changed (doors, map containers, windows/curtains,
 * lamps, zombie zones added, removed or renamed).
 *
 * One file per step, `migrations/content-v<N>.json` in the world folder:
 * - `ids`: every stateful ID of revision N by kind (containers with their world position), so a save
 *   of revision N is checked exactly like against the map it was written for;
 * - `renamed`: old ID → new ID of the same kind (the new one takes the old one's state).
 * What was removed or added follows from `ids`, `renamed` and the next revision's IDs (the next
 * file's `ids`, or the current map). Deleted IDs are never handed out again (`retiredIds`,
 * `retiredLocalIds`), so an ID of revision N that is gone later never comes back as something else.
 * Pure and Node-runnable: the game (save load), validator, editor and CLI share it.
 */

export const CONTENT_MIGRATION_FORMAT = 'zombie-outbreak/content-migration'

export const STATEFUL_KINDS = ['doors', 'containers', 'windows', 'lamps', 'zones'] as const
export type StatefulKind = (typeof STATEFUL_KINDS)[number]

export interface StatefulIds {
  doors: string[]
  /** Map containers with their world position (removed ones drop their items there). */
  containers: { id: string; position: XZ }[]
  /** Windows (the save keeps their curtains). */
  windows: string[]
  lamps: string[]
  zones: string[]
}

export interface ContentMigration {
  format: typeof CONTENT_MIGRATION_FORMAT
  fromVersion: number
  toVersion: number
  ids: StatefulIds
  renamed: Record<string, string>
}

export function contentMigrationPath(fromVersion: number): string {
  return `migrations/content-v${fromVersion}.json`
}

/** Runtime/resolver pieces that carry saved state (MapData or resolved record parts). */
export interface StatefulParts {
  doors?: readonly { id: string }[]
  containers?: readonly { id: string; position: { x: number; z: number } }[]
  windows?: readonly { id: string }[]
  rooms?: readonly { lamp: { id: string } | null }[]
  zones?: readonly { id: string }[]
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const sorted = (ids: Iterable<string>) => [...ids].sort()

/** Stateful IDs of a set of parts, sorted (stable files and diffs). */
export function statefulIds(parts: Iterable<StatefulParts>): StatefulIds {
  const out: StatefulIds = { doors: [], containers: [], windows: [], lamps: [], zones: [] }
  for (const p of parts) {
    for (const d of p.doors ?? []) out.doors.push(d.id)
    for (const c of p.containers ?? []) out.containers.push({ id: c.id, position: { x: c.position.x, z: c.position.z } })
    for (const w of p.windows ?? []) out.windows.push(w.id)
    for (const r of p.rooms ?? []) if (r.lamp) out.lamps.push(r.lamp.id)
    for (const z of p.zones ?? []) out.zones.push(z.id)
  }
  return { doors: sorted(out.doors), containers: out.containers.sort(byId), windows: sorted(out.windows), lamps: sorted(out.lamps), zones: sorted(out.zones) }
}

export function idsOfKind(ids: StatefulIds, kind: StatefulKind): string[] {
  return kind === 'containers' ? ids.containers.map((c) => c.id) : ids[kind]
}

/** Kind of an ID in a set, or null. */
export function kindOf(ids: StatefulIds, id: string): StatefulKind | null {
  return STATEFUL_KINDS.find((k) => idsOfKind(ids, k).includes(id)) ?? null
}

export interface ContentDiff {
  removed: Record<StatefulKind, string[]>
  added: Record<StatefulKind, string[]>
}

/** What changed between two revisions' IDs, before renames. */
export function diffIds(before: StatefulIds, after: StatefulIds): ContentDiff {
  const removed = {} as ContentDiff['removed']
  const added = {} as ContentDiff['added']
  for (const k of STATEFUL_KINDS) {
    const a = new Set(idsOfKind(before, k))
    const b = new Set(idsOfKind(after, k))
    removed[k] = [...a].filter((id) => !b.has(id))
    added[k] = [...b].filter((id) => !a.has(id))
  }
  return { removed, added }
}

export function isEmptyDiff(d: ContentDiff): boolean {
  return STATEFUL_KINDS.every((k) => d.removed[k].length === 0 && d.added[k].length === 0)
}

/**
 * Problems of one step's renames against the next revision's IDs: a source must be an ID of this
 * revision that is gone in the next, a target a new ID of the same kind, each target used once.
 */
export function renameProblems(step: Pick<ContentMigration, 'ids' | 'renamed'>, next: StatefulIds): { from: string; message: string }[] {
  const out: { from: string; message: string }[] = []
  const targets = new Set<string>()
  for (const [from, to] of Object.entries(step.renamed)) {
    const kind = kindOf(step.ids, from)
    if (!kind) {
      out.push({ from, message: `"${from}" is not a stateful ID of the older revision` })
      continue
    }
    if (idsOfKind(next, kind).includes(from)) out.push({ from, message: `"${from}" still exists; only a removed ID can be renamed` })
    if (!idsOfKind(next, kind).includes(to)) out.push({ from, message: `rename target "${to}" is not a ${kind.slice(0, -1)} of the next revision` })
    else if (idsOfKind(step.ids, kind).includes(to)) out.push({ from, message: `rename target "${to}" already existed; it keeps its own state` })
    if (targets.has(to)) out.push({ from, message: `"${to}" is the target of two renames` })
    targets.add(to)
  }
  return out
}

/** Where every stateful ID of an old revision ends up in the current one. */
export interface ContentPlan {
  fromVersion: number
  toVersion: number
  /** IDs of the save's revision (the save must match them exactly). */
  expected: StatefulIds
  /** Old ID → current ID (same or renamed), or null when it was removed on the way. */
  target: Map<string, string | null>
}

/**
 * Compose the steps from `fromVersion` to the current revision. Null when a step is missing (saves
 * of that revision cannot be mapped) or the save is newer than the content.
 */
export function planContentMigration(migrations: readonly ContentMigration[], fromVersion: number, current: StatefulIds, currentVersion: number): ContentPlan | null {
  if (!(fromVersion < currentVersion)) return null
  const steps: ContentMigration[] = []
  for (let v = fromVersion; v < currentVersion; v++) {
    const step = migrations.find((m) => m.fromVersion === v)
    if (!step) return null
    steps.push(step)
  }
  const target = new Map<string, string | null>()
  const first = steps[0].ids
  for (const kind of STATEFUL_KINDS) {
    for (const id of idsOfKind(first, kind)) {
      let at: string | null = id
      for (let i = 0; i < steps.length && at !== null; i++) {
        const next = i + 1 < steps.length ? steps[i + 1].ids : current
        const renamed: string = steps[i].renamed[at] ?? at
        at = idsOfKind(next, kind).includes(renamed) ? renamed : null
      }
      target.set(id, at)
    }
  }
  return { fromVersion, toVersion: currentVersion, expected: first, target }
}

/** Plain-data check of a migration file (the validator adds paths and severities). */
export function contentMigrationShapeProblems(raw: unknown, fromVersion: number): string[] {
  const out: string[] = []
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
  if (!isObj(raw)) return ['expected an object']
  if (raw.format !== CONTENT_MIGRATION_FORMAT) out.push(`format must be "${CONTENT_MIGRATION_FORMAT}"`)
  if (raw.fromVersion !== fromVersion) out.push(`fromVersion must be ${fromVersion} (file name)`)
  if (raw.toVersion !== fromVersion + 1) out.push(`toVersion must be ${fromVersion + 1}`)
  const ids = raw.ids
  if (!isObj(ids)) out.push('ids must be an object')
  else {
    const seen = new Set<string>()
    const claim = (id: unknown, where: string) => {
      if (typeof id !== 'string' || !id) out.push(`${where}: expected a non-empty string`)
      else if (seen.has(id)) out.push(`${where}: "${id}" listed twice`)
      else seen.add(id)
    }
    for (const k of STATEFUL_KINDS) {
      const list = ids[k]
      if (!Array.isArray(list)) {
        out.push(`ids.${k} must be an array`)
        continue
      }
      list.forEach((e, i) => {
        if (k !== 'containers') return claim(e, `ids.${k}[${i}]`)
        const pos = isObj(e) ? e.position : undefined
        if (!isObj(e) || !isObj(pos) || typeof pos.x !== 'number' || typeof pos.z !== 'number' || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) out.push(`ids.containers[${i}]: expected { id, position: { x, z } }`)
        claim(isObj(e) ? e.id : undefined, `ids.containers[${i}]`)
      })
    }
  }
  if (!isObj(raw.renamed) || !Object.values(raw.renamed).every((v) => typeof v === 'string' && v)) out.push('renamed must map IDs to IDs')
  return out
}
