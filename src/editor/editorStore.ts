import { create } from 'zustand'
import { bundledWorldFiles, bundledWorldIds, REGISTERED_LOOT_TABLES } from '../map/content'
import type { QuarterTurns, Rect, XZ } from '../map/schema'
import type { ValidationIssue } from '../map/validate'
import { type CommandResult } from '../map/editor/commands'
import { blankDocument, findRecord, forkDocument, resolvedRecords, statefulEntityIds, type MapDocument } from '../map/editor/document'
import { usedLocalIds } from '../map/editor/prefabCommands'
import { playPointProblem, playtestFiles } from '../map/editor/playtest'
import { deepCheck } from '../map/analysis'
import { generateTown, type Layout } from '../map/tools/generator'
import { defaultLayers, isEditable, LAYERS, layerOf, type LayerId, type LayerState, type LayerStates } from '../map/editor/layers'
import { documentFromFiles, exportPack, parsePack, validateDocument } from '../map/editor/pack'
import { applyCommand, initialEditState, redo, undo, type EditState } from '../map/editor/session'
import { listDrafts, readDraft, saveDraft, type DraftRecord } from './drafts'
import { documentReference, generatorBlockReason, layoutWorldFromGeoJson, libraryCatalog, LIBRARY_WORLD, reimportLayout, tracingGeoJson, withReference, type LayoutWorldRequest } from '../map/editor/generator'
import type { PrefabCatalog } from '../map/layout/buildings'
import { documentLibraryIssues, libraryFromDocument, libraryFromFiles, type SharedLibrary } from '../map/editor/library'
import type { LayoutIssue } from '../map/layout/schema'
import { documentLayout, syncGenerated, type SyncReport, type SyncRequest } from '../map/layout/worldSync'
import { editorWorldFiles } from './layoutFiles'
import { applyPatch } from '../map/editor/docPatch'
import { cancelJob, runJob, workersAvailable } from './generatorJobs'
import { addArea, addRoad, emptyTracing, markJunction, metresPerPixel, metresToPixel, referenceTransform, removeFeatures, ROAD_DEFAULTS, snapRoadPoint, type ReferenceTracing, type TracedRoad } from '../map/layout/reference'
import { sourceToWorld, worldToSource, type ImagePoint } from '../map/layout/coordinates'
import type { GridFrame, LandUseZone, RestrictedKind } from '../map/layout/schema'

/**
 * Editor state (M3, M4). The document and its history (`EditState`) are the only map data; the rest
 * is session state (tool, snap, camera mode, layers, preview, messages) and is never exported. The
 * Three.js scene is derived from the document on render.
 */

export const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
export const SNAP_STEPS = [1, 0.5, 0.25, 0] as const
export const DEFAULT_WORLD = 'neighborhood-50'

/** parcel (WG4, Generator tab): click picks a parcel of the world's layout (and its building). trace (WG6, Bản vẽ tab). */
export type Tool = 'select' | 'place' | 'chunk' | 'play' | 'parcel' | 'trace'

/** WG6: what a click does in the Bản vẽ tab. */
export type TraceMode = 'select' | 'road' | 'junction' | 'zone' | 'restricted' | 'calibrate' | 'measure'

/** A running Play From Here session (M6): the snapshot sent to the playtest frame. */
export interface Playtest {
  files: Record<string, unknown>
  spawn: XZ
  timeOfDay: number
  worldName: string
  /** Messages from the frame (started / error). */
  state: 'loading' | 'started' | 'error'
  error?: string
}

/** What the place tool puts down: a prefab instance or a palette record (M4). */
export type PlaceItem = { kind: 'prefab'; prefabId: string } | { kind: 'record'; presetId: string } | { kind: 'prefabItem'; presetId: string } | { kind: 'compound'; compoundId: string }

/** Palette tabs of the prefab editor (M5). */
export type PrefabTab = 'structure' | 'openings' | 'furniture' | 'containers' | 'decor' | 'rooms' | 'surfaces'

export type PaletteTab = 'prefabs' | 'objects' | 'roads' | 'zones' | 'spawns' | 'chunks' | 'generator' | 'reference'

/** WG4: layout layers drawn over the viewport (session state, never exported). */
export interface LayoutView {
  /** Roads as imported (before snapping). */
  source: boolean
  /** Snapped road network. */
  network: boolean
  parcels: boolean
  blocks: boolean
  /** Water, railways, no-build land. */
  restricted: boolean
}

/** WG4: a regeneration computed but not applied yet (shown in the viewport until Áp dụng / Hủy). */
export interface GeneratorPending {
  /** Document it was computed from: stale once the document changes. */
  base: MapDocument
  doc: MapDocument
  label: string
  summary: string
  report: SyncReport
}

/** WG4: result of the last generator action, for the Generator tab. */
export interface GeneratorReport {
  label: string
  summary: string
  issues: LayoutIssue[]
}

export interface Preview {
  doc: MapDocument
  /** Records drawn as a ghost (the instance being placed). */
  ghostIds: string[]
}

export interface Status {
  text: string
  kind: 'info' | 'error'
}

interface EditorStore {
  edit: EditState | null
  /** Document at the last open / draft save / export (dirty = differs). */
  savedDoc: MapDocument | null
  /** Document as opened: changes to it without a new contentVersion are flagged. */
  baseline: MapDocument | null
  source: string
  issues: ValidationIssue[]
  /** Issues of a rejected import/draft (the open document is kept). */
  rejected: { title: string; issues: ValidationIssue[] } | null
  tool: Tool
  place: PlaceItem | null
  placeTurns: QuarterTurns
  paletteTab: PaletteTab
  layers: LayerStates
  /** Chunk picked in the chunk tool / panel. */
  selectedChunk: string | null
  /** Box select in progress (world rect), drawn by the viewport. */
  marquee: Rect | null
  /** Prefab being edited (M5); null = world mode. The selection then holds its local IDs. */
  prefabMode: string | null
  prefabTab: PrefabTab
  /** View-only turn of the prefab preview (0 = editable). */
  prefabView: QuarterTurns
  /** M11c-2: storey being edited (0 = ground): picking, placing and drawing work on it. */
  prefabFloor: number
  /** M11a: the footprint outline's handles show (prefab editor, nothing selected). */
  outlineEdit: boolean
  /** Draw interaction reach around containers and lamp switches. */
  showReach: boolean
  /** Prefab a dialog acts on (duplicate). */
  dialogPrefab: string | null
  /** Start hour of a playtest (0..24). */
  playHour: number
  playtest: Playtest | null
  /** Last deep check (M6) and the document it ran on (stale once the document changes). */
  deep: { doc: MapDocument; issues: ValidationIssue[]; ms: number } | null
  snapStep: number
  view: 'top' | 'iso'
  preview: Preview | null
  status: Status | null
  cursor: XZ | null
  dialog: 'open' | 'new' | 'saveAs' | 'newPrefab' | 'duplicatePrefab' | 'libraryUpdate' | 'saveCompound' | null
  /** Prefab library P1: what the update dialog previews (a world prefab copy, or a placed compound group). */
  libraryUpdate: { kind: 'prefab' | 'compound'; id: string } | null
  showIssues: boolean
  drafts: DraftRecord[]
  focusRequest: number
  /** Area the next focus frames (a chunk); null = the selection or the whole world. */
  focusRect: Rect | null
  /** WG4 (Generator tab). */
  layoutView: LayoutView
  selectedParcel: string | null
  genPending: GeneratorPending | null
  genReport: GeneratorReport | null
  /** WG5: generator job running in the worker (the tab shows it with a Hủy button). */
  genBusy: { label: string; started: number } | null
  /** WG6 (Bản vẽ tab): tracing tool state, never exported. Draft points are image pixels. */
  trace: {
    mode: TraceMode
    draft: ImagePoint[]
    selected: string | null
    road: TracedRoad
    zone: LandUseZone
    restricted: RestrictedKind
    autoJunctions: boolean
    opacity: number
    showImage: boolean
    measure: ImagePoint[]
  }

  openDocument(doc: MapDocument, source: string, issues?: ValidationIssue[]): void
  run(label: string, command: (doc: MapDocument, selection: string[]) => CommandResult): boolean
  undo(): void
  redo(): void
  select(ids: string[]): void
  setPreview(preview: Preview | null): void
  setStatus(text: string, kind?: Status['kind']): void
  setTool(tool: Tool, place?: PlaceItem | null): void
  rotatePlacement(turns: number): void
  setLayer(id: LayerId, patch: Partial<LayerState>): void
  set(patch: Partial<Pick<EditorStore, 'snapStep' | 'view' | 'cursor' | 'dialog' | 'showIssues' | 'paletteTab' | 'selectedChunk' | 'marquee' | 'prefabTab' | 'prefabView' | 'outlineEdit' | 'showReach' | 'dialogPrefab' | 'playHour' | 'libraryUpdate'>>): void
  /** Play From Here: snapshot the document and open the playtest frame (never touches saves or drafts). */
  startPlaytest(spawn: XZ): boolean
  stopPlaytest(): void
  /** Deep checks (reachability, interaction reach, overlaps) through the game's own systems. */
  runDeepCheck(): void
  setPlaytestState(state: Playtest['state'], error?: string): void
  enterPrefab(prefabId: string): void
  exitPrefab(): void
  /** M11c-2: edit another storey of the prefab (selection and ghost cleared). */
  setPrefabFloor(floor: number): void
  requestFocus(rect?: Rect | null): void
  reject(title: string, error: string, issues: ValidationIssue[]): void

  openBundled(worldId: string): boolean
  openPack(text: string, source: string, allowContentErrors: boolean): boolean
  newWorld(worldId: string, name: string, generate?: { seed: number; blocksX: number; blocksZ: number; layout?: Layout; trees?: number }): boolean
  saveDraft(): Promise<void>
  /** Save as a new world (new worldId/name, contentVersion 1) and continue editing the copy. */
  saveAsWorld(worldId: string, name: string): Promise<boolean>
  exportFile(): { name: string; text: string } | null
  refreshDrafts(): Promise<void>

  /** WG4: world generator actions. */
  setLayoutView(patch: Partial<LayoutView>): void
  selectParcel(id: string | null): void
  /** Run a generator action as one command (or, with `preview`, compute it for Áp dụng / Hủy). Q3: refused on published worlds except locks. */
  generate(label: string, request: SyncRequest, opts?: { preview?: boolean }): boolean
  applyPending(): boolean
  cancelPending(): void
  /** New world from a GeoJSON reference (Mới → Từ GeoJSON). */
  newLayoutWorld(req: LayoutWorldRequest): boolean
  commitGenerated(label: string, doc: MapDocument, report: GeneratorReport): boolean
  /** WG5: stop the running generator job (nothing changes). */
  cancelGenerator(): void
  /** Result of a generator action (worker or in place): preview it or apply it as one command. */
  finishGenerated(label: string, base: MapDocument, doc: MapDocument, summary: string, report: SyncReport, ms: number, preview: boolean): boolean
  /** Result of an import (worker or in place): open the new world. */
  openLayoutWorld(req: LayoutWorldRequest, doc: MapDocument, issues: LayoutIssue[]): boolean

  /** WG6: tracing. */
  setTrace(patch: Partial<EditorStore['trace']>): void
  /** Change the reference of the document as one command (a tracing is created when there is none). */
  editReference(label: string, fn: (ref: ReferenceTracing) => ReferenceTracing): boolean
  /** Click at a world point with a snapping reach (m on screen) in the current trace mode. */
  traceClick(at: XZ, reachMetres: number): void
  traceFinish(): void
  traceCancel(): void
  traceBackspace(): void
  /** Draw from the tracing: a new world (like Mới → Từ GeoJSON). */
  createWorldFromTracing(req: Omit<LayoutWorldRequest, 'text' | 'origin' | 'extras'>): boolean
  /** Update this world from its changed reference (tracing or a new GeoJSON file): previewed, then applied. */
  updateWorldFromReference(text: string | null, file?: string, overwrite?: boolean): boolean
}

/** WG6: source metres (the tracing's frame) ↔ world, through the layout's frame when the world has one. */
export function referenceFrame(doc: MapDocument): GridFrame | null {
  return documentLayout(doc).layout?.normalized?.frame ?? null
}

export function worldToPixel(doc: MapDocument, ref: ReferenceTracing, at: XZ): ImagePoint {
  const frame = referenceFrame(doc)
  return metresToPixel(ref, frame ? worldToSource(frame, at) : at)
}

export function pixelToWorld(doc: MapDocument, ref: ReferenceTracing, p: ImagePoint): XZ {
  const m = referenceTransform(ref)
  const src = { x: m.a * p.u + m.b * p.v + m.tx, z: m.c * p.u + m.d * p.v + m.tz }
  const frame = referenceFrame(doc)
  return frame ? sourceToWorld(frame, src) : src
}

const LOOT_TABLE_IDS = [...REGISTERED_LOOT_TABLES]
const REFERENCE_FILE_PATH = 'layout/reference.json'

let catalogMemo: { catalog: PrefabCatalog | null } | null = null
/** Prefab library of the generator (the repo world `prefab-library`), read once. */
export function generatorCatalog(): PrefabCatalog | null {
  catalogMemo ??= { catalog: bundledWorldIds().includes(LIBRARY_WORLD) ? libraryCatalog(editorWorldFiles(LIBRARY_WORLD)) : null }
  return catalogMemo.catalog
}

/** Q3: why generator actions that change content are refused on this world, or null. */
export function generatorBlocked(doc: MapDocument): string | null {
  return generatorBlockReason(doc.world.worldId, bundledWorldIds())
}

/**
 * Editor-only warning (M3, precise since M5): the set of IDs a save holds state for (doors,
 * containers, windows, lamps, zones) differs from the document as opened while the world keeps
 * its contentVersion. Saves of this world would then be refused as corrupt instead of reported as
 * another content revision. Edits that keep the set (moving, resizing, recolouring, walls, props)
 * are compatible: saves load and keep their state.
 */
function editorWarnings(doc: MapDocument, baseline: MapDocument | null): ValidationIssue[] {
  if (!baseline || baseline.world.worldId !== doc.world.worldId || doc.world.contentVersion !== baseline.world.contentVersion) return []
  if (doc.chunks === baseline.chunks && doc.prefabs === baseline.prefabs) return []
  const before = statefulEntityIds(baseline)
  const after = statefulEntityIds(doc)
  if (before.length === after.length && before.every((id, i) => id === after[i])) return []
  const removed = before.filter((id) => !after.includes(id))
  const added = after.filter((id) => !before.includes(id))
  const list = (ids: string[]) => ids.slice(0, 3).join(', ') + (ids.length > 3 ? ` … (+${ids.length - 3})` : '')
  return [
    {
      severity: 'warning',
      code: 'content-changed-same-version',
      message: `ID có trạng thái trong save đã đổi (${[added.length ? `thêm ${list(added)}` : '', removed.length ? `bỏ ${list(removed)}` : ''].filter(Boolean).join('; ')}) nhưng contentVersion vẫn là ${doc.world.contentVersion}: save cũ của world này sẽ bị từ chối. Inspector → World → Tương thích save: tạo migration (tăng contentVersion, save cũ được chuyển sang nội dung mới).`,
      path: 'world.json#/contentVersion',
    },
  ]
}

function issuesFor(doc: MapDocument, baseline: MapDocument | null): ValidationIssue[] {
  return [...validateDocument(doc, OPTS), ...editorWarnings(doc, baseline), ...documentLibraryIssues(doc, OPTS)]
}

let libraryMemo: { library: SharedLibrary | null } | null = null
const liveLibrary = new WeakMap<object, SharedLibrary>()
/**
 * Prefab library P1: the shared library (the repo world `prefab-library`, read once). While the
 * library world itself is open, its live content (so a compound saved a moment ago is listed).
 */
export function sharedLibrary(doc: MapDocument | null = useEditorStore.getState().edit?.doc ?? null): SharedLibrary | null {
  if (doc && doc.world.worldId === LIBRARY_WORLD) {
    let lib = liveLibrary.get(doc.extras)
    if (!lib || lib.prefabs !== doc.prefabs) {
      lib = libraryFromDocument(doc, OPTS)
      liveLibrary.set(doc.extras, lib)
    }
    return lib
  }
  libraryMemo ??= { library: bundledWorldIds().includes(LIBRARY_WORLD) ? libraryFromFiles(editorWorldFiles(LIBRARY_WORLD), OPTS) : null }
  return libraryMemo.library
}

/** The repo copy of a world (the published revision), if the world is bundled. */
export function publishedDocument(worldId: string): MapDocument | null {
  if (!bundledWorldIds().includes(worldId)) return null
  const r = documentFromFiles(bundledWorldFiles(worldId), OPTS)
  return r.ok ? r.doc : null
}

/** Selection without records on hidden or locked layers (they can't be picked or edited). */
export function editableSelection(doc: MapDocument, ids: readonly string[], layers: LayerStates): string[] {
  const wanted = new Set(ids)
  const blocked = new Set(resolvedRecords(doc).filter((r) => wanted.has(r.id) && !isEditable(r, layers)).map((r) => r.id))
  return blocked.size ? ids.filter((id) => !blocked.has(id)) : [...ids]
}

/** Selection that fits the mode: local IDs of the edited prefab, or editable world records. */
export function validSelection(doc: MapDocument, ids: readonly string[], layers: LayerStates, prefabMode: string | null): string[] {
  if (prefabMode) {
    const prefab = doc.prefabs.get(prefabMode)
    if (!prefab) return []
    const used = usedLocalIds(prefab)
    return ids.filter((id) => used.has(id))
  }
  return editableSelection(
    doc,
    ids.filter((id) => findRecord(doc, id)),
    layers,
  )
}

/** Layer label of a record, for status messages. */
export function layerLabel(doc: MapDocument, id: string): string | null {
  const r = resolvedRecords(doc).find((x) => x.id === id)
  return r ? LAYERS.find((l) => l.id === layerOf(r))!.label : null
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  edit: null,
  savedDoc: null,
  baseline: null,
  source: '',
  issues: [],
  rejected: null,
  tool: 'select',
  place: null,
  placeTurns: 0,
  paletteTab: 'prefabs',
  layers: defaultLayers(),
  selectedChunk: null,
  marquee: null,
  prefabMode: null,
  prefabTab: 'structure',
  prefabView: 0,
  prefabFloor: 0,
  outlineEdit: false,
  showReach: true,
  dialogPrefab: null,
  libraryUpdate: null,
  playHour: 9,
  playtest: null,
  deep: null,
  snapStep: 0.5,
  view: 'top',
  preview: null,
  status: null,
  cursor: null,
  dialog: null,
  showIssues: false,
  drafts: [],
  focusRequest: 0,
  focusRect: null,
  layoutView: { source: false, network: true, parcels: true, blocks: false, restricted: true },
  selectedParcel: null,
  genPending: null,
  genReport: null,
  genBusy: null,
  trace: { mode: 'road', draft: [], selected: null, road: { ...ROAD_DEFAULTS.local }, zone: 'residential', restricted: 'water', autoJunctions: true, opacity: 0.6, showImage: true, measure: [] },

  openDocument(doc, source, issues) {
    // A generator job of the previous document never lands on this one.
    cancelJob()
    set({
      genBusy: null,
      edit: initialEditState(doc),
      savedDoc: doc,
      baseline: doc,
      source,
      issues: issues ?? issuesFor(doc, doc),
      rejected: null,
      preview: null,
      tool: 'select',
      place: null,
      selectedChunk: null,
      marquee: null,
      focusRect: null,
      prefabMode: null,
      prefabView: 0,
      outlineEdit: false,
      dialog: null,
      selectedParcel: null,
      genPending: null,
      genReport: null,
      status: { text: `Đã mở ${doc.world.name} (${doc.world.worldId}) — ${source}`, kind: 'info' },
      focusRequest: get().focusRequest + 1,
    })
  },

  run(label, command) {
    const { edit, baseline } = get()
    if (!edit) return false
    const r = applyCommand(edit, label, command(edit.doc, edit.selection))
    if (r.error) {
      set({ status: { text: r.error, kind: 'error' }, preview: null })
      return false
    }
    const docChanged = r.state.doc !== edit.doc
    set({
      edit: r.state,
      preview: null,
      ...(docChanged ? { issues: issuesFor(r.state.doc, baseline) } : {}),
      status: { text: r.note ?? label, kind: 'info' },
    })
    return true
  },

  undo() {
    const { edit, baseline } = get()
    if (!edit || edit.past.length === 0) return
    const label = edit.past[edit.past.length - 1].label
    const back = undo(edit)
    const prefabMode = get().prefabMode && back.doc.prefabs.has(get().prefabMode!) ? get().prefabMode : null
    const next = { ...back, selection: validSelection(back.doc, back.selection, get().layers, prefabMode) }
    set({ edit: next, prefabMode, preview: null, genPending: null, issues: issuesFor(next.doc, baseline), status: { text: `Hoàn tác: ${label}`, kind: 'info' } })
  },

  redo() {
    const { edit, baseline } = get()
    if (!edit || edit.future.length === 0) return
    const label = edit.future[0].label
    const forward = redo(edit)
    const prefabMode = get().prefabMode && forward.doc.prefabs.has(get().prefabMode!) ? get().prefabMode : null
    const next = { ...forward, selection: validSelection(forward.doc, forward.selection, get().layers, prefabMode) }
    set({ edit: next, prefabMode, preview: null, genPending: null, issues: issuesFor(next.doc, baseline), status: { text: `Làm lại: ${label}`, kind: 'info' } })
  },

  select(ids) {
    const { edit } = get()
    if (!edit) return
    set({ edit: { ...edit, selection: ids } })
  },

  setPreview(preview) {
    set({ preview })
  },

  setStatus(text, kind = 'info') {
    set({ status: { text, kind } })
  },

  setTool(tool, place = null) {
    set({ tool, place: tool === 'place' ? place : null, preview: null, marquee: null })
  },

  rotatePlacement(turns) {
    set({ placeTurns: ((((get().placeTurns + turns) % 4) + 4) % 4) as QuarterTurns })
  },

  setLayer(id, patch) {
    const layers = { ...get().layers, [id]: { ...get().layers[id], ...patch } }
    const { edit } = get()
    set({ layers, ...(edit ? { edit: { ...edit, selection: editableSelection(edit.doc, edit.selection, layers) } } : {}) })
  },

  set(patch) {
    set(patch)
  },

  startPlaytest(spawn) {
    const { edit, issues } = get()
    if (!edit) return false
    const errors = issues.filter((i) => i.severity === 'error')
    if (errors.length) {
      set({ showIssues: true, status: { text: `Chơi thử bị chặn: ${errors.length} lỗi (xem bảng Validate)`, kind: 'error' } })
      return false
    }
    const problem = playPointProblem(edit.doc, spawn)
    if (problem) {
      set({ status: { text: `Không bắt đầu được: ${problem}`, kind: 'error' } })
      return false
    }
    set({
      playtest: { files: playtestFiles(edit.doc), spawn, timeOfDay: get().playHour / 24, worldName: edit.doc.world.name, state: 'loading' },
      tool: 'select',
      preview: null,
      status: { text: `Chơi thử từ (${spawn.x}, ${spawn.z}) — save chỉ trong bộ nhớ, document không đổi`, kind: 'info' },
    })
    return true
  },

  runDeepCheck() {
    const { edit, issues } = get()
    if (!edit) return
    if (issues.some((i) => i.severity === 'error')) {
      set({ showIssues: true, status: { text: 'Sửa lỗi Validate trước khi kiểm tra sâu', kind: 'error' } })
      return
    }
    const r = deepCheck(edit.doc)
    set({ deep: { doc: edit.doc, issues: r.issues, ms: r.ms }, showIssues: true, status: { text: `Kiểm tra sâu: ${r.issues.length} cảnh báo (${r.ms.toFixed(0)} ms)`, kind: 'info' } })
  },

  stopPlaytest() {
    set({ playtest: null, status: { text: 'Đã về editor (document, vùng chọn và camera giữ nguyên)', kind: 'info' } })
  },

  setPlaytestState(state, error) {
    const pt = get().playtest
    if (pt) set({ playtest: { ...pt, state, ...(error ? { error } : {}) } })
  },

  enterPrefab(prefabId) {
    const { edit } = get()
    if (!edit?.doc.prefabs.has(prefabId)) return
    set({
      prefabMode: prefabId,
      prefabView: 0,
      prefabFloor: 0,
      outlineEdit: false,
      tool: 'select',
      place: null,
      preview: null,
      marquee: null,
      edit: { ...edit, selection: [] },
      status: { text: `Sửa prefab gốc ${prefabId}: mọi instance của nó thay đổi theo`, kind: 'info' },
      focusRect: null,
      focusRequest: get().focusRequest + 1,
    })
  },

  setPrefabFloor(floor) {
    const { edit, prefabMode } = get()
    const prefab = prefabMode ? edit?.doc.prefabs.get(prefabMode) : null
    if (!edit || !prefab) return
    const storeys = prefab.building?.storeys ?? 1
    const next = Math.min(storeys - 1, Math.max(0, floor))
    if (next === get().prefabFloor) return
    set({ prefabFloor: next, preview: null, marquee: null, edit: { ...edit, selection: [] }, status: { text: `Sửa tầng ${next + 1}/${storeys}`, kind: 'info' } })
  },

  exitPrefab() {
    const { edit } = get()
    set({
      prefabMode: null,
      prefabFloor: 0,
      tool: 'select',
      place: null,
      preview: null,
      marquee: null,
      ...(edit ? { edit: { ...edit, selection: [] } } : {}),
      focusRect: null,
      focusRequest: get().focusRequest + 1,
    })
  },

  requestFocus(rect = null) {
    set({ focusRequest: get().focusRequest + 1, focusRect: rect })
  },

  reject(title, error, issues) {
    set({ rejected: { title: `${title}: ${error}`, issues }, showIssues: true, status: { text: `${title}: ${error}`, kind: 'error' } })
  },

  openBundled(worldId) {
    // WG4: with the world's layout files (editor only; the game never loads them).
    const r = documentFromFiles(editorWorldFiles(worldId), OPTS)
    if (!r.ok) {
      get().reject(`Không mở được ${worldId}`, r.error, r.issues)
      return false
    }
    get().openDocument(r.doc, `bundle content/maps/${worldId}`, [...r.issues, ...documentLibraryIssues(r.doc, OPTS)])
    return true
  },

  openPack(text, source, allowContentErrors) {
    const r = parsePack(text, { ...OPTS, allowContentErrors })
    if (!r.ok) {
      get().reject(`Không mở được ${source}`, r.error, r.issues)
      return false
    }
    get().openDocument(r.doc, source)
    // M8: a draft or pack of a world that is in the repo compares with the published copy, so
    // changes made before the draft was saved still count for save compatibility.
    const published = publishedDocument(r.doc.world.worldId)
    if (published) set({ baseline: published, issues: issuesFor(r.doc, published) })
    return true
  },

  newWorld(worldId, name, generate) {
    const lib = documentFromFiles(bundledWorldFiles(DEFAULT_WORLD), OPTS)
    if (!lib.ok) {
      get().reject('Không nạp được thư viện prefab', lib.error, lib.issues)
      return false
    }
    const prefabs = lib.doc.world.prefabs.map((entry) => ({ entry, doc: lib.doc.prefabs.get(entry.prefabId)! }))
    let doc: MapDocument
    if (generate) {
      // Offline generator (M6): same code and output as `npm run map:generate`.
      try {
        doc = generateTown({ worldId, name, ...generate }, { id: `${lib.doc.world.worldId}@${lib.doc.world.contentVersion}`, prefabs }, OPTS)
      } catch (e) {
        get().reject('Generator lỗi', e instanceof Error ? e.message : String(e), [])
        return false
      }
    } else doc = blankDocument({ worldId, name, prefabs })
    const issues = validateDocument(doc, OPTS)
    if (issues.some((i) => i.severity === 'error')) {
      get().reject('World mới không hợp lệ', issues[0].message, issues)
      return false
    }
    get().openDocument(doc, generate ? `generator seed ${generate.seed}` : 'world mới')
    // Never published: no save can hold its IDs yet, so no contentVersion warning.
    set({ savedDoc: null, baseline: null, issues: issuesFor(doc, null) })
    return true
  },

  async saveDraft() {
    const { edit } = get()
    if (!edit) return
    const doc = edit.doc
    try {
      await saveDraft({ worldId: doc.world.worldId, name: doc.world.name, savedAt: new Date().toISOString(), pack: exportPack(doc) })
      set({ savedDoc: doc, status: { text: `Đã lưu nháp ${doc.world.worldId} (IndexedDB của editor, không đụng save game)`, kind: 'info' } })
      await get().refreshDrafts()
    } catch (e) {
      set({ status: { text: `Lưu nháp lỗi: ${e instanceof Error ? e.message : String(e)}`, kind: 'error' } })
    }
  },

  async saveAsWorld(worldId, name) {
    const { edit } = get()
    if (!edit) return false
    const fail = (text: string) => (set({ status: { text: `Lưu thành world mới: ${text}`, kind: 'error' } }), false)
    if (worldId === edit.doc.world.worldId) return fail('worldId phải khác world đang mở')
    if (bundledWorldIds().includes(worldId)) return fail(`content/maps/${worldId} đã có trong repo, chọn worldId khác`)
    try {
      if (await readDraft(worldId)) return fail(`đã có bản nháp ${worldId} (Mở… để sửa tiếp, hoặc xóa nháp đó), chọn worldId khác`)
    } catch {
      // No IndexedDB: saveDraft below reports it; the copy still opens.
    }
    const from = edit.doc.world.worldId
    const doc = forkDocument(edit.doc, worldId, name)
    // A new history: undoing past this point would bring the old worldId back. Selection, prefab
    // mode and camera stay. Never published, so no contentVersion warning (baseline null).
    set({
      edit: { ...initialEditState(doc), selection: edit.selection },
      savedDoc: null,
      baseline: null,
      source: `lưu thành từ ${from}`,
      issues: issuesFor(doc, null),
      deep: null,
      preview: null,
      dialog: null,
    })
    await get().saveDraft()
    if (get().savedDoc === doc) set({ status: { text: `Đã lưu thành world mới ${worldId} (bản nháp; ${from} không đổi). Export → ${worldId}.mappack.json rồi npm run map:unpack.`, kind: 'info' } })
    return true
  },

  exportFile() {
    const { edit, issues } = get()
    if (!edit) return null
    const errors = issues.filter((i) => i.severity === 'error')
    if (errors.length) {
      set({ showIssues: true, status: { text: `Export bị chặn: ${errors.length} lỗi (xem bảng Validate)`, kind: 'error' } })
      return null
    }
    set({ savedDoc: edit.doc, status: { text: `Đã export ${edit.doc.world.worldId}.mappack.json — ghi vào repo bằng npm run map:unpack`, kind: 'info' } })
    return { name: `${edit.doc.world.worldId}.mappack.json`, text: exportPack(edit.doc) }
  },

  async refreshDrafts() {
    try {
      set({ drafts: await listDrafts() })
    } catch {
      set({ drafts: [] })
    }
  },

  setLayoutView(patch) {
    set({ layoutView: { ...get().layoutView, ...patch } })
  },

  selectParcel(id) {
    set({ selectedParcel: id })
  },

  generate(label, request, opts = {}) {
    const { edit, genBusy } = get()
    if (!edit) return false
    if (genBusy) {
      set({ status: { text: `Đang chạy ${genBusy.label}: đợi xong hoặc Hủy`, kind: 'error' } })
      return false
    }
    const blocked = request.kind === 'lock' ? null : generatorBlocked(edit.doc)
    if (blocked) {
      set({ status: { text: blocked, kind: 'error' } })
      return false
    }
    const base = edit.doc
    const preview = !!opts.preview
    // Locks only touch the layout: always in place. Everything else runs in the worker when there is one.
    if (request.kind === 'lock' || !workersAvailable()) {
      const t0 = performance.now()
      const r = syncGenerated(base, request, { catalog: generatorCatalog(), validation: OPTS })
      if (!r.ok) {
        set({ status: { text: `${label}: ${r.error}`, kind: 'error' } })
        return false
      }
      return get().finishGenerated(label, base, r.doc, r.summary, r.report, performance.now() - t0, preview)
    }
    set({ genBusy: { label, started: Date.now() }, status: { text: `Đang ${label.toLowerCase()}… (có thể Hủy trong tab Generator)`, kind: 'info' } })
    void runJob({ kind: 'sync', doc: base, request, catalog: generatorCatalog(), lootTables: LOOT_TABLE_IDS }).then((r) => {
      if (!get().genBusy) return
      set({ genBusy: null })
      if (!r) return
      if (!r.ok) {
        set({ status: { text: `${label}: ${r.error}`, kind: 'error' } })
        return
      }
      if (r.kind !== 'sync') return
      // The worker's patch goes onto the document it was computed from: unchanged chunks keep their identity.
      get().finishGenerated(label, base, applyPatch(base, r.patch), r.summary, r.report, r.ms, preview)
    })
    return true
  },

  finishGenerated(label, base, doc, summary, report, ms, preview) {
    const genReport: GeneratorReport = { label, summary, issues: report.issues }
    if (preview) {
      set({
        genPending: { base, doc, label, summary, report },
        genReport,
        status: { text: `Xem trước ${label}: ${summary} (${ms.toFixed(0)} ms) — Áp dụng hoặc Hủy trong tab Generator`, kind: 'info' },
      })
      return true
    }
    if (get().edit?.doc !== base) {
      set({ genReport, status: { text: `${label}: document đã đổi trong lúc sinh, kết quả bị bỏ (làm lại thao tác)`, kind: 'error' } })
      return false
    }
    return get().commitGenerated(label, doc, genReport)
  },

  cancelGenerator() {
    const busy = get().genBusy
    if (!busy) return
    cancelJob()
    set({ genBusy: null, status: { text: `Đã hủy ${busy.label} (document không đổi)`, kind: 'info' } })
  },

  applyPending() {
    const { edit, genPending } = get()
    if (!edit || !genPending) return false
    if (genPending.base !== edit.doc) {
      set({ genPending: null, status: { text: 'Bản xem trước đã cũ (document đổi sau đó): xem trước lại', kind: 'error' } })
      return false
    }
    return get().commitGenerated(genPending.label, genPending.doc, { label: genPending.label, summary: genPending.summary, issues: genPending.report.issues })
  },

  cancelPending() {
    set({ genPending: null, status: { text: 'Đã hủy bản xem trước (document không đổi)', kind: 'info' } })
  },

  commitGenerated(label, doc, report) {
    const selection = get().edit?.selection ?? []
    const done = get().run(label, () => ({ ok: true, doc, selection: selection.filter((id) => findRecord(doc, id)), note: `${label}: ${report.summary}` }))
    if (done) set({ genReport: report, genPending: null })
    return done
  },

  newLayoutWorld(req) {
    if (get().genBusy) return false
    const failed = (error: string, issues: LayoutIssue[] = []) => {
      get().reject('Không tạo được world từ GeoJSON', error, [])
      set({ genReport: { label: 'Tạo world từ GeoJSON', summary: error, issues } })
      return false
    }
    if (!workersAvailable()) {
      const r = layoutWorldFromGeoJson(req, generatorCatalog(), OPTS)
      return r.ok ? get().openLayoutWorld(req, r.doc, r.issues) : failed(r.error, r.issues)
    }
    set({ genBusy: { label: 'Tạo world từ GeoJSON', started: Date.now() }, dialog: null, status: { text: `Đang tạo world từ ${req.file ?? 'GeoJSON'}…`, kind: 'info' } })
    void runJob({ kind: 'import', request: req, catalog: generatorCatalog(), lootTables: LOOT_TABLE_IDS }).then((r) => {
      if (!get().genBusy) return
      set({ genBusy: null })
      if (!r) return
      if (!r.ok) return void failed(r.error, r.issues)
      if (r.kind === 'import') get().openLayoutWorld(req, r.doc, r.issues)
    })
    return true
  },

  setTrace(patch) {
    set({ trace: { ...get().trace, ...patch } })
  },

  editReference(label, fn) {
    return get().run(label, (doc, sel) => {
      const { ref, issues } = documentReference(doc)
      if (!ref && issues.length) return { ok: false, error: `${label}: layout/reference.json hỏng (${issues[0].message})` }
      try {
        return { ok: true, doc: withReference(doc, fn(ref ?? emptyTracing())), selection: sel }
      } catch (e) {
        return { ok: false, error: `${label}: ${e instanceof Error ? e.message : String(e)}` }
      }
    })
  },

  traceClick(at, reachMetres) {
    const { edit, trace } = get()
    if (!edit) return
    const ref = documentReference(edit.doc).ref ?? emptyTracing()
    const px = worldToPixel(edit.doc, ref, at)
    const tol = reachMetres / Math.max(1e-6, metresPerPixel(referenceTransform(ref)))
    switch (trace.mode) {
      case 'road': {
        // Snapping may put a vertex into an existing road (a junction): that part is a command of its own.
        const snap = snapRoadPoint(ref, px, tol)
        if (snap.ref !== ref) get().editReference('Thêm giao lộ', () => snap.ref)
        const last = trace.draft[trace.draft.length - 1]
        // Clicking the last point again finishes the road.
        if (last && Math.hypot(last.u - snap.point.u, last.v - snap.point.v) < Math.max(0.5, tol / 3)) return get().traceFinish()
        get().setTrace({ draft: [...trace.draft, snap.point] })
        return
      }
      case 'zone':
      case 'restricted': {
        const first = trace.draft[0]
        if (first && trace.draft.length >= 3 && Math.hypot(first.u - px.u, first.v - px.v) < tol) return get().traceFinish()
        get().setTrace({ draft: [...trace.draft, px] })
        return
      }
      case 'junction': {
        let roads = 0
        const ok = get().editReference('Đánh dấu giao lộ', (r) => {
          const m = markJunction(r, px, tol * 1.5)
          roads = m.roads
          return m.ref
        })
        if (ok) get().setStatus(roads >= 2 ? `Giao lộ: ${roads} đường gặp nhau` : 'Không có hai đường nào trong tầm: không tạo giao lộ', roads >= 2 ? 'info' : 'error')
        return
      }
      case 'calibrate': {
        // A new control point where the picture is now: nothing moves until its world position is edited.
        get().editReference('Thêm điểm hiệu chỉnh', (r) => ({ ...r, calibration: { ...r.calibration, points: [...r.calibration.points, { image: { u: Math.round(px.u * 10) / 10, v: Math.round(px.v * 10) / 10 }, world: (() => { const m = referenceTransform(r); const w = { x: m.a * px.u + m.b * px.v + m.tx, z: m.c * px.u + m.d * px.v + m.tz }; return { x: Math.round(w.x * 100) / 100, z: Math.round(w.z * 100) / 100 } })() }] } }))
        return
      }
      case 'measure': {
        const pts = trace.measure.length >= 2 ? [px] : [...trace.measure, px]
        get().setTrace({ measure: pts })
        return
      }
      case 'select': {
        return
      }
    }
  },

  traceFinish() {
    const { trace } = get()
    const pts = trace.draft
    if (trace.mode === 'road') {
      if (pts.length < 2) return get().setStatus('Đường cần ít nhất 2 điểm', 'error')
      if (get().editReference('Vẽ đường', (r) => addRoad(r, pts, trace.road, trace.autoJunctions).ref)) get().setTrace({ draft: [] })
      return
    }
    if (trace.mode === 'zone' || trace.mode === 'restricted') {
      if (pts.length < 3) return get().setStatus('Vùng cần ít nhất 3 điểm', 'error')
      const area = trace.mode === 'zone' ? { zone: trace.zone } : { restricted: trace.restricted }
      if (get().editReference(trace.mode === 'zone' ? 'Khoanh vùng đất' : 'Khoanh vùng cấm', (r) => addArea(r, pts, area).ref)) get().setTrace({ draft: [] })
    }
  },

  traceCancel() {
    const { trace } = get()
    if (trace.draft.length || trace.measure.length) set({ trace: { ...trace, draft: [], measure: [] } })
    else if (trace.selected) set({ trace: { ...trace, selected: null } })
    else get().setTool('select')
  },

  traceBackspace() {
    const { trace } = get()
    if (trace.draft.length) return set({ trace: { ...trace, draft: trace.draft.slice(0, -1) } })
    if (trace.selected) {
      const id = trace.selected
      if (get().editReference('Xóa nét vẽ', (r) => removeFeatures(r, [id]))) set({ trace: { ...get().trace, selected: null } })
    }
  },

  createWorldFromTracing(req) {
    const { edit } = get()
    if (!edit) return false
    const { ref } = documentReference(edit.doc)
    if (!ref) return (get().setStatus('Chưa có bản vẽ', 'error'), false)
    const { text, issues } = tracingGeoJson(ref)
    const error = issues.find((i) => i.severity === 'error')
    if (error) return (get().setStatus(`Tạo world từ bản vẽ: ${error.message}`, 'error'), false)
    // Traced in world metres around the origin; the new world keeps the reference to trace on and update.
    return get().newLayoutWorld({ ...req, text, origin: { x: 0, y: 0 }, extras: [[REFERENCE_FILE_PATH, ref]] })
  },

  updateWorldFromReference(text, file, overwrite = false) {
    const { edit } = get()
    if (!edit) return false
    const { layout } = documentLayout(edit.doc)
    if (!layout) return (get().setStatus('World này chưa có layout: tạo world từ bản vẽ trước', 'error'), false)
    let source = text
    if (source === null) {
      const { ref } = documentReference(edit.doc)
      if (!ref) return (get().setStatus('Chưa có bản vẽ', 'error'), false)
      if (layout.projection.method !== 'local-metres') return (get().setStatus('Layout này đến từ dữ liệu địa lý: cập nhật bằng file GeoJSON mới (tab Generator)', 'error'), false)
      const t = tracingGeoJson(ref)
      const error = t.issues.find((i) => i.severity === 'error')
      if (error) return (get().setStatus(error.message, 'error'), false)
      source = t.text
    }
    let updated
    try {
      updated = reimportLayout(layout, source, file)
    } catch (e) {
      return (get().setStatus(`Không đọc được reference: ${e instanceof Error ? e.message : String(e)}`, 'error'), false)
    }
    if (!updated.normalized?.valid) return (get().setStatus(`Mạng đường mới có lỗi: ${updated.normalized?.issues.find((i) => i.severity === 'error')?.message ?? 'không có đường'}`, 'error'), false)
    set({ paletteTab: 'generator' })
    get().setTool('parcel')
    return get().generate(text === null ? 'Cập nhật từ bản vẽ' : `Cập nhật từ ${file ?? 'GeoJSON'}`, { kind: 'layout', layout: updated, overwrite }, { preview: true })
  },

  openLayoutWorld(req, doc, layoutIssues) {
    const r = { doc, issues: layoutIssues }
    const issues = validateDocument(r.doc, OPTS)
    if (issues.some((i) => i.severity === 'error')) {
      get().reject('World sinh từ GeoJSON không hợp lệ', issues[0].message, issues)
      return false
    }
    get().openDocument(r.doc, `World Generator — ${req.file ?? 'GeoJSON'}`)
    const count = (k: 'roads' | 'instances') => [...r.doc.chunks.values()].reduce((n, c) => n + c[k].length, 0)
    const summary = `${count('roads')} mặt đường, ${count('instances')} công trình, ${r.doc.world.chunks.length} chunk`
    // Never published: no save holds its IDs, no contentVersion warning, the generator may rewrite it (Q3).
    set({
      savedDoc: null,
      baseline: null,
      issues: issuesFor(r.doc, null),
      paletteTab: 'generator',
      tool: 'parcel',
      genReport: { label: 'Tạo world từ GeoJSON', summary, issues: r.issues },
      status: { text: `Đã tạo ${r.doc.world.worldId} từ ${req.file ?? 'GeoJSON'}: ${summary}. Lưu nháp để giữ lại.`, kind: 'info' },
    })
    return true
  },
}))

export function isDirty(s: Pick<EditorStore, 'edit' | 'savedDoc'>): boolean {
  return !!s.edit && s.edit.doc !== s.savedDoc
}
