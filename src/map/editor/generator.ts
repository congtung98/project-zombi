import type { PrefabDocument, PrefabEntry, WorldDocument } from '../schema.ts'
import type { ValidationOptions } from '../validate.ts'
import { placeBuildings, prefabCatalog, type PrefabCatalog } from '../layout/buildings.ts'
import { importGeoJsonLayout, LayoutImportError } from '../layout/importer.ts'
import { LayoutPlanError, planLayout } from '../layout/plan.ts'
import type { LayoutIssue, WorldMode } from '../layout/schema.ts'
import { createLayoutWorld, type ParcelState } from '../layout/worldSync.ts'
import type { MapDocument } from './document.ts'

/**
 * World generator in the editor (WG4): the pieces of the Generator tab that do not need React.
 * The layout, its plan and the generator's manifest live in the document (`layout/world-layout.json`),
 * so undo/redo, drafts and export carry them like any other content.
 */

/** Parcel outline colours in the viewport and the tab's legend. */
export const PARCEL_COLORS: Record<ParcelState, string> = { generated: '#6fcf6f', modified: '#ff5fd2', locked: '#4aa8ff', empty: '#b8b8b8', open: '#6b8f5a' }

export const PROFILE_LABEL: Record<string, string> = { default: 'Mặc định (lô rộng)', 'vn-urban': 'Đô thị VN (nhà ống)' }

/** Repo world holding the prefab library (hidden from the game's menu, Q6). */
export const LIBRARY_WORLD = 'prefab-library'

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
}

export type LayoutWorldResult = { ok: true; doc: MapDocument; issues: LayoutIssue[] } | { ok: false; error: string; issues: LayoutIssue[] }

/** Import reference → snapped network → plan → (FULL) buildings → a new world with its layout. */
export function layoutWorldFromGeoJson(req: LayoutWorldRequest, catalog: PrefabCatalog | null, validation?: ValidationOptions): LayoutWorldResult {
  let issues: LayoutIssue[] = []
  try {
    const layout = importGeoJsonLayout(req.text, { layoutId: req.worldId, name: req.name, file: req.file, clip: req.clip })
    issues = [...layout.issues, ...(layout.normalized?.issues ?? [])]
    const importErrors = layout.issues.filter((i) => i.severity === 'error')
    if (importErrors.length) return { ok: false, error: importErrors[0].message, issues }
    if (!layout.normalized?.valid) return { ok: false, error: `mạng đường nắn vuông góc có lỗi: ${layout.normalized?.issues.find((i) => i.severity === 'error')?.message ?? 'không có đường'}`, issues }
    if (req.mode === 'full' && !catalog) return { ok: false, error: `không có thư viện prefab (content/maps/${LIBRARY_WORLD})`, issues }
    let plan = planLayout(layout, { seed: req.seed, profile: req.profile })
    issues.push(...plan.issues)
    if (req.mode === 'full') {
      const r = placeBuildings(plan, catalog!)
      plan = r.plan
      issues.push(...r.issues)
    }
    const doc = createLayoutWorld({ ...layout, plan }, { worldId: req.worldId, name: req.name, mode: req.mode, catalog: catalog ?? undefined, validation })
    return { ok: true, doc, issues }
  } catch (e) {
    if (e instanceof LayoutImportError || e instanceof LayoutPlanError) return { ok: false, error: e.message, issues }
    return { ok: false, error: e instanceof Error ? e.message : String(e), issues }
  }
}
