import type { PrefabDocument, PrefabEntry, WorldDocument } from '../schema.ts'
import type { ValidationOptions } from '../validate.ts'
import { placeBuildings, prefabCatalog, type PrefabCatalog } from '../layout/buildings.ts'
import { importGeoJsonLayout, LayoutImportError } from '../layout/importer.ts'
import { checkReference, HAND_TRACING, REFERENCE_FILE, type ReferenceTracing } from '../layout/reference.ts'
import { LayoutPlanError, planLayout } from '../layout/plan.ts'
import type { EnvironmentParams, LayoutIssue, WorldLayout, WorldMode } from '../layout/schema.ts'
import { createLayoutWorld, type ParcelState } from '../layout/worldSync.ts'
import type { ENVIRONMENT_KINDS } from '../layout/environment.ts'
import type { MapDocument } from './document.ts'
import { LIBRARY_WORLD } from './library.ts'

/**
 * World generator in the editor (WG4): the pieces of the Generator tab that do not need React.
 * The layout, its plan and the generator's manifest live in the document (`layout/world-layout.json`),
 * so undo/redo, drafts and export carry them like any other content.
 */

/** Parcel outline colours in the viewport and the tab's legend. */
export const PARCEL_COLORS: Record<ParcelState, string> = { generated: '#6fcf6f', modified: '#ff5fd2', locked: '#4aa8ff', empty: '#b8b8b8', open: '#6b8f5a' }

export const PROFILE_LABEL: Record<string, string> = { default: 'Mặc định (lô rộng)', 'vn-urban': 'Đô thị VN (nhà ống)' }

/** WG5: environment density choices of the editor. */
export const DENSITY_CHOICES: [number, string][] = [
  [0, 'Không có'],
  [0.3, 'Thưa'],
  [0.6, 'Vừa'],
  [1, 'Dày'],
]
export const ENVIRONMENT_LABEL: Record<(typeof ENVIRONMENT_KINDS)[number], string> = {
  trees: 'Cây',
  planting: 'Bụi, cỏ',
  fences: 'Hàng rào sau',
  streetFurniture: 'Thùng rác, hộp thư',
  streetlights: 'Đèn đường',
  vehicles: 'Xe đỗ, xe bỏ hoang',
  litter: 'Rác, lốp, vệt dầu',
}

/** Repo world holding the prefab library (hidden from the game's menu, Q6; the shared library of P1). */
export { LIBRARY_WORLD }

/** Placeable prefabs of the library world's files (`world.json` + prefabs), or null when it is missing. */
export function libraryCatalog(files: ReadonlyMap<string, unknown>): PrefabCatalog | null {
  const world = files.get('world.json') as WorldDocument | undefined
  if (!world || !Array.isArray(world.prefabs)) return null
  const prefabs = world.prefabs.flatMap((entry: PrefabEntry) => {
    const doc = files.get(entry.path) as PrefabDocument | undefined
    return doc ? [{ entry, doc }] : []
  })
  const catalog = prefabCatalog(`${world.worldId}@${world.contentVersion}`, prefabs)
  return catalog.prefabs.length ? catalog : null
}

/**
 * Owner decision Q3: the generator rewrites only worlds nobody plays yet. A world in `content/maps/`
 * is published (saves may hold its IDs): the Generator tab only shows it and toggles locks there.
 * "Lưu thành…" makes an unpublished copy to regenerate.
 */
export function generatorBlockReason(worldId: string, publishedIds: readonly string[]): string | null {
  return publishedIds.includes(worldId)
    ? `${worldId} đã có trong content/maps (có thể đã có save): generator chỉ xem và khóa, không sinh lại (Q3). Lưu thành… một worldId mới để sinh lại trên bản chưa phát hành.`
    : null
}

export interface LayoutWorldRequest {
  worldId: string
  name: string
  /** GeoJSON text (a local file: the editor never fetches anything). */
  text: string
  file?: string
  mode: WorldMode
  seed: number
  profile: string
  /** Keep only this rectangle (m) around the centre of the data, e.g. 500 × 500. */
  clip?: { width: number; depth: number }
  /** WG5: environment of a FULL world (default `DEFAULT_ENVIRONMENT`). */
  environment?: EnvironmentParams
  /** WG6: projection origin (a traced reference is already in world metres: origin 0, 0). */
  origin?: { x: number; y: number }
  /** WG6: extra files for the new world (the reference tracing it came from). */
  extras?: [string, unknown][]
}

export type LayoutWorldResult = { ok: true; doc: MapDocument; issues: LayoutIssue[] } | { ok: false; error: string; issues: LayoutIssue[] }

// ---- WG6: the reference tracing stored with a world, and updating a world from its reference ----

const referenceCache = new WeakMap<object, { ref: ReferenceTracing | null; issues: LayoutIssue[] }>()

/** The reference (picture, calibration, tracing) stored with the document, checked once per object. */
export function documentReference(doc: MapDocument): { ref: ReferenceTracing | null; issues: LayoutIssue[] } {
  const raw = doc.extras.get(REFERENCE_FILE)
  if (raw === undefined) return { ref: null, issues: [] }
  if (!raw || typeof raw !== 'object') return { ref: null, issues: [{ severity: 'error', code: 'schema', message: `${REFERENCE_FILE}: không hợp lệ` }] }
  let r = referenceCache.get(raw)
  if (!r) {
    const issues = checkReference(raw)
    r = { ref: issues.some((i) => i.severity === 'error') ? null : (raw as ReferenceTracing), issues }
    referenceCache.set(raw, r)
  }
  return r
}

/** The document with this reference (or without one: null). An edit of the reference is a command like any other. */
export function withReference(doc: MapDocument, ref: ReferenceTracing | null): MapDocument {
  const extras = new Map(doc.extras)
  if (ref) extras.set(REFERENCE_FILE, ref)
  else extras.delete(REFERENCE_FILE)
  return { ...doc, extras }
}

/** GeoJSON text of a tracing (the hand extractor), with its issues. */
export function tracingGeoJson(ref: ReferenceTracing): { text: string; issues: LayoutIssue[] } {
  const r = HAND_TRACING.extract(ref)
  return { text: JSON.stringify(r.geojson), issues: r.issues }
}

/**
 * Import an updated reference for a world that already has a layout: same layout ID, projection
 * origin, clip and default zone, and the old frame pinned (rotation and offset), so unchanged streets
 * snap to the same world positions and their blocks, parcels and buildings come out identical.
 */
export function reimportLayout(old: WorldLayout, text: string, file?: string): WorldLayout {
  const origin = old.projection.origin
  const clip = old.clip ? { width: old.clip.maxX - old.clip.minX, depth: old.clip.maxZ - old.clip.minZ } : undefined
  const frame = old.normalized?.frame
  return importGeoJsonLayout(text, {
    layoutId: old.layoutId,
    name: old.name,
    file: file ?? old.source.file,
    origin,
    clip,
    crs: old.source.crs,
    defaultZone: old.defaults.zone,
    attribution: old.source.attribution ?? undefined,
    normalize: frame ? { ...old.normalized!.params, alignment: frame.rotationDeg, offset: frame.offset } : undefined,
  })
}

/** Import reference → snapped network → plan → (FULL) buildings → a new world with its layout. */
export function layoutWorldFromGeoJson(req: LayoutWorldRequest, catalog: PrefabCatalog | null, validation?: ValidationOptions): LayoutWorldResult {
  let issues: LayoutIssue[] = []
  try {
    const layout = importGeoJsonLayout(req.text, { layoutId: req.worldId, name: req.name, file: req.file, clip: req.clip, origin: req.origin })
    issues = [...layout.issues, ...(layout.normalized?.issues ?? [])]
    const importErrors = layout.issues.filter((i) => i.severity === 'error')
    if (importErrors.length) return { ok: false, error: importErrors[0].message, issues }
    if (!layout.normalized?.valid) return { ok: false, error: `mạng đường nắn vuông góc có lỗi: ${layout.normalized?.issues.find((i) => i.severity === 'error')?.message ?? 'không có đường'}`, issues }
    if (req.mode === 'full' && !catalog) return { ok: false, error: `không có thư viện prefab (content/maps/${LIBRARY_WORLD})`, issues }
    let plan = planLayout(layout, { seed: req.seed, profile: req.profile })
    if (req.environment) plan = { ...plan, environment: req.environment }
    issues.push(...plan.issues)
    if (req.mode === 'full') {
      const r = placeBuildings(plan, catalog!)
      plan = r.plan
      issues.push(...r.issues)
    }
    let doc = createLayoutWorld({ ...layout, plan }, { worldId: req.worldId, name: req.name, mode: req.mode, catalog: catalog ?? undefined, validation })
    if (req.extras?.length) doc = { ...doc, extras: new Map([...doc.extras, ...req.extras]) }
    return { ok: true, doc, issues }
  } catch (e) {
    if (e instanceof LayoutImportError || e instanceof LayoutPlanError) return { ok: false, error: e.message, issues }
    return { ok: false, error: e instanceof Error ? e.message : String(e), issues }
  }
}
