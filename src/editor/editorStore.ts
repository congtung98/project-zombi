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

/**
 * Editor state (M3, M4). The document and its history (`EditState`) are the only map data; the rest
 * is session state (tool, snap, camera mode, layers, preview, messages) and is never exported. The
 * Three.js scene is derived from the document on render.
 */

export const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
export const SNAP_STEPS = [1, 0.5, 0.25, 0] as const
export const DEFAULT_WORLD = 'neighborhood-50'

export type Tool = 'select' | 'place' | 'chunk' | 'play'

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
export type PlaceItem = { kind: 'prefab'; prefabId: string } | { kind: 'record'; presetId: string } | { kind: 'prefabItem'; presetId: string }

/** Palette tabs of the prefab editor (M5). */
export type PrefabTab = 'structure' | 'openings' | 'furniture' | 'containers' | 'rooms'

export type PaletteTab = 'prefabs' | 'objects' | 'roads' | 'zones' | 'spawns' | 'chunks'

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
  dialog: 'open' | 'new' | 'saveAs' | 'newPrefab' | 'duplicatePrefab' | null
  showIssues: boolean
  drafts: DraftRecord[]
  focusRequest: number
  /** Area the next focus frames (a chunk); null = the selection or the whole world. */
  focusRect: Rect | null

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
  set(patch: Partial<Pick<EditorStore, 'snapStep' | 'view' | 'cursor' | 'dialog' | 'showIssues' | 'paletteTab' | 'selectedChunk' | 'marquee' | 'prefabTab' | 'prefabView' | 'showReach' | 'dialogPrefab' | 'playHour'>>): void
  /** Play From Here: snapshot the document and open the playtest frame (never touches saves or drafts). */
  startPlaytest(spawn: XZ): boolean
  stopPlaytest(): void
  /** Deep checks (reachability, interaction reach, overlaps) through the game's own systems. */
  runDeepCheck(): void
  setPlaytestState(state: Playtest['state'], error?: string): void
  enterPrefab(prefabId: string): void
  exitPrefab(): void
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
  return [...validateDocument(doc, OPTS), ...editorWarnings(doc, baseline)]
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
  showReach: true,
  dialogPrefab: null,
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

  openDocument(doc, source, issues) {
    set({
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
      dialog: null,
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
    set({ edit: next, prefabMode, preview: null, issues: issuesFor(next.doc, baseline), status: { text: `Hoàn tác: ${label}`, kind: 'info' } })
  },

  redo() {
    const { edit, baseline } = get()
    if (!edit || edit.future.length === 0) return
    const label = edit.future[0].label
    const forward = redo(edit)
    const prefabMode = get().prefabMode && forward.doc.prefabs.has(get().prefabMode!) ? get().prefabMode : null
    const next = { ...forward, selection: validSelection(forward.doc, forward.selection, get().layers, prefabMode) }
    set({ edit: next, prefabMode, preview: null, issues: issuesFor(next.doc, baseline), status: { text: `Làm lại: ${label}`, kind: 'info' } })
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

  exitPrefab() {
    const { edit } = get()
    set({
      prefabMode: null,
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
    const r = documentFromFiles(bundledWorldFiles(worldId), OPTS)
    if (!r.ok) {
      get().reject(`Không mở được ${worldId}`, r.error, r.issues)
      return false
    }
    get().openDocument(r.doc, `bundle content/maps/${worldId}`, [...r.issues])
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
}))

export function isDirty(s: Pick<EditorStore, 'edit' | 'savedDoc'>): boolean {
  return !!s.edit && s.edit.doc !== s.savedDoc
}
