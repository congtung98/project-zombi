import { formatJson } from '../format.ts'
import { checkWorldDocuments, hasErrors, type ValidationIssue, type ValidationOptions } from '../validate.ts'
import { documentFiles, documentFrom, type MapDocument } from './document.ts'

/**
 * Content pack (M3 import/export): one JSON file holding every file of a world folder by its
 * relative path, in a stable order and formatted like the files on disk. `unpack.ts` writes it back
 * into `content/maps/<worldId>/` byte for byte; the editor never writes into the repo itself.
 */

export const PACK_FORMAT = 'zombie-outbreak/map-pack'
export const PACK_FORMAT_VERSION = 1

export interface MapPack {
  format: typeof PACK_FORMAT
  formatVersion: number
  worldId: string
  files: Record<string, unknown>
}

export function toPack(doc: MapDocument): MapPack {
  return { format: PACK_FORMAT, formatVersion: PACK_FORMAT_VERSION, worldId: doc.world.worldId, files: Object.fromEntries(documentFiles(doc)) }
}

export function exportPack(doc: MapDocument): string {
  return formatJson(toPack(doc))
}

/** Every issue of a document, through the same checks as the runtime loader and `map:check`. */
export function validateDocument(doc: MapDocument, opts: ValidationOptions = {}): ValidationIssue[] {
  const files = new Map(documentFiles(doc))
  return checkWorldDocuments((path) => {
    if (!files.has(path)) throw new Error(`Missing content file ${path}`)
    return files.get(path)
  }, opts).issues
}

export type OpenResult = { ok: true; doc: MapDocument; issues: ValidationIssue[] } | { ok: false; error: string; issues: ValidationIssue[] }

const RELATIVE_JSON = /^(?:[a-z0-9_.-]+\/)*[a-z0-9_.-]+\.json$/i

/**
 * Build a document from the files of a world folder. `allowContentErrors` accepts world-level
 * errors (a draft may be half done); every document must still pass its own checks.
 */
export function documentFromFiles(files: ReadonlyMap<string, unknown>, opts: ValidationOptions & { allowContentErrors?: boolean } = {}): OpenResult {
  const bad = [...files.keys()].filter((p) => !RELATIVE_JSON.test(p) || p.split('/').some((s) => s === '.' || s === '..'))
  if (bad.length) return { ok: false, error: `Đường dẫn file không hợp lệ: ${bad.join(', ')}`, issues: [] }
  const read = (path: string) => {
    if (!files.has(path)) throw new Error(`Missing content file ${path}`)
    return structuredClone(files.get(path))
  }
  const checked = checkWorldDocuments(read, opts)
  if (!checked.docs) return { ok: false, error: 'Nội dung không hợp lệ', issues: checked.issues }
  if (!opts.allowContentErrors && hasErrors(checked.issues)) return { ok: false, error: 'Nội dung có lỗi', issues: checked.issues }
  const docs = checked.docs
  const own = new Set(['world.json', ...docs.world.prefabs.map((e) => e.path), ...docs.world.chunks.map((e) => e.path)])
  const extras = new Map([...files].filter(([p]) => !own.has(p)).map(([p, v]) => [p, structuredClone(v)] as const))
  return { ok: true, doc: documentFrom(docs, extras), issues: checked.issues }
}

/** Parse an exported pack. A broken pack never yields a document (the open one stays). */
export function parsePack(text: string, opts: ValidationOptions & { allowContentErrors?: boolean } = {}): OpenResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `Không đọc được JSON: ${e instanceof Error ? e.message : String(e)}`, issues: [] }
  }
  const pack = raw as Partial<MapPack> | null
  if (!pack || typeof pack !== 'object' || pack.format !== PACK_FORMAT) return { ok: false, error: `Không phải content pack (${PACK_FORMAT})`, issues: [] }
  if (pack.formatVersion !== PACK_FORMAT_VERSION) return { ok: false, error: `Phiên bản pack ${String(pack.formatVersion)} không hỗ trợ (cần ${PACK_FORMAT_VERSION})`, issues: [] }
  if (!pack.files || typeof pack.files !== 'object' || Array.isArray(pack.files)) return { ok: false, error: 'Pack thiếu "files"', issues: [] }
  const result = documentFromFiles(new Map(Object.entries(pack.files)), opts)
  if (result.ok && result.doc.world.worldId !== pack.worldId) return { ok: false, error: `Pack ghi worldId ${String(pack.worldId)} nhưng world.json là ${result.doc.world.worldId}`, issues: result.issues }
  return result
}
