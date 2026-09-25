import { create } from 'zustand'
import { bundledWorldFiles, REGISTERED_LOOT_TABLES } from '../map/content'
import type { QuarterTurns, Rect, XZ } from '../map/schema'
import type { ValidationIssue } from '../map/validate'
import { type CommandResult } from '../map/editor/commands'
import { blankDocument, resolvedRecords, type MapDocument } from '../map/editor/document'
import { defaultLayers, isEditable, LAYERS, layerOf, type LayerId, type LayerState, type LayerStates } from '../map/editor/layers'
import { documentFromFiles, exportPack, parsePack, validateDocument } from '../map/editor/pack'
import { applyCommand, initialEditState, redo, undo, type EditState } from '../map/editor/session'
import { listDrafts, saveDraft, type DraftRecord } from './drafts'

/**
 * Editor state (M3, M4). The document and its history (`EditState`) are the only map data; the rest
 * is session state (tool, snap, camera mode, layers, preview, messages) and is never exported. The
 * Three.js scene is derived from the document on render.
 */

export const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
export const SNAP_STEPS = [1, 0.5, 0.25, 0] as const
export const DEFAULT_WORLD = 'neighborhood-50'

export type Tool = 'select' | 'place' | 'chunk'

/** What the place tool puts down: a prefab instance or a palette record (M4). */
export type PlaceItem = { kind: 'prefab'; prefabId: string } | { kind: 'record'; presetId: string }

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
  snapStep: number
  view: 'top' | 'iso'
  preview: Preview | null
  status: Status | null
  cursor: XZ | null
  dialog: 'open' | 'new' | null
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
  set(patch: Partial<Pick<EditorStore, 'snapStep' | 'view' | 'cursor' | 'dialog' | 'showIssues' | 'paletteTab' | 'selectedChunk' | 'marquee'>>): void
  requestFocus(rect?: Rect | null): void
  reject(title: string, error: string, issues: ValidationIssue[]): void

  openBundled(worldId: string): boolean
  openPack(text: string, source: string, allowContentErrors: boolean): boolean
  newWorld(worldId: string, name: string): boolean
  saveDraft(): Promise<void>
  exportFile(): { name: string; text: string } | null
  refreshDrafts(): Promise<void>
}

/** Editor-only warning: content differs from what was opened but the world keeps its contentVersion. */
function editorWarnings(doc: MapDocument, baseline: MapDocument | null): ValidationIssue[] {
  if (!baseline || baseline.world.worldId !== doc.world.worldId || doc.world.contentVersion !== baseline.world.contentVersion) return []
  const changed =
    doc.world.chunks.some((e) => {
      const a = doc.chunks.get(e.chunkId)
      const b = baseline.chunks.get(e.chunkId)
      return a !== b && JSON.stringify(a) !== JSON.stringify(b)
    }) || doc.world.chunks.length !== baseline.world.chunks.length
  if (!changed) return []
  return [
    {
      severity: 'warning',
      code: 'content-changed-same-version',
      message: `Bố cục đã khác bản mở ra nhưng contentVersion vẫn là ${doc.world.contentVersion}: save cũ của world này sẽ lệch ID. Tăng contentVersion (Inspector → World) trước khi phát hành.`,
      path: 'world.json#/contentVersion',
    },
  ]
}

function issuesFor(doc: MapDocument, baseline: MapDocument | null): ValidationIssue[] {
  return [...validateDocument(doc, OPTS), ...editorWarnings(doc, baseline)]
}

/** Selection without records on hidden or locked layers (they can't be picked or edited). */
export function editableSelection(doc: MapDocument, ids: readonly string[], layers: LayerStates): string[] {
  const wanted = new Set(ids)
  const blocked = new Set(resolvedRecords(doc).filter((r) => wanted.has(r.id) && !isEditable(r, layers)).map((r) => r.id))
  return blocked.size ? ids.filter((id) => !blocked.has(id)) : [...ids]
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
    const next = { ...back, selection: editableSelection(back.doc, back.selection, get().layers) }
    set({ edit: next, preview: null, issues: issuesFor(next.doc, baseline), status: { text: `Hoàn tác: ${label}`, kind: 'info' } })
  },

  redo() {
    const { edit, baseline } = get()
    if (!edit || edit.future.length === 0) return
    const label = edit.future[0].label
    const forward = redo(edit)
    const next = { ...forward, selection: editableSelection(forward.doc, forward.selection, get().layers) }
    set({ edit: next, preview: null, issues: issuesFor(next.doc, baseline), status: { text: `Làm lại: ${label}`, kind: 'info' } })
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
    return true
  },

  newWorld(worldId, name) {
    const lib = documentFromFiles(bundledWorldFiles(DEFAULT_WORLD), OPTS)
    if (!lib.ok) {
      get().reject('Không nạp được thư viện prefab', lib.error, lib.issues)
      return false
    }
    const prefabs = lib.doc.world.prefabs.map((entry) => ({ entry, doc: lib.doc.prefabs.get(entry.prefabId)! }))
    const doc = blankDocument({ worldId, name, prefabs })
    const issues = validateDocument(doc, OPTS)
    if (issues.some((i) => i.severity === 'error')) {
      get().reject('World mới không hợp lệ', issues[0].message, issues)
      return false
    }
    get().openDocument(doc, 'world mới')
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
