import { addChunk, deleteRecords, duplicateRecords, moveRecords, placeInstance, placeRecord, removeChunk, rotateRecords, type CommandResult } from '../map/editor/commands'
import { resolvedRecords, type MapDocument } from '../map/editor/document'
import { isEditable } from '../map/editor/layers'
import { snap } from '../map/editor/picking'
import { findPreset } from '../map/editor/presets'
import type { XZ } from '../map/schema'
import { chunkIdOf, chunkIndex, chunkOrigin } from '../map/transform'
import { useEditorStore, type PlaceItem } from './editorStore'

/**
 * Editor actions shared by the viewport, toolbar and hotkeys. They read the store directly
 * (no React state per pointer event) and go through the command functions, so every document
 * change is one history entry.
 */

const store = () => useEditorStore.getState()

export function snapPoint(p: XZ): XZ {
  const step = store().snapStep
  return { x: snap(p.x, step), z: snap(p.z, step) }
}

/** The place command for an item: prefabs drop at a point, records may be sized by a drag (M4). */
function placeCommand(doc: MapDocument, item: PlaceItem, from: XZ, to: XZ | null): CommandResult {
  if (item.kind === 'prefab') return placeInstance(doc, item.prefabId, from, store().placeTurns)
  return placeRecord(doc, item.presetId, from, to)
}

export function placeLabel(item: PlaceItem): string {
  return item.kind === 'prefab' ? `Đặt ${item.prefabId}` : `Đặt ${findPreset(item.presetId)?.label ?? item.presetId}`
}

/**
 * Ghost of what the place tool would put down: at the (snapped) cursor, or sized from `from`
 * (the press point) to the cursor while dragging a record preset.
 */
export function updatePlacePreview(cursor: XZ | null = store().cursor, from: XZ | null = null): void {
  const s = store()
  if (s.tool !== 'place' || !s.place || !s.edit || !cursor) return
  const at = snapPoint(cursor)
  const r = from ? placeCommand(s.edit.doc, s.place, from, at) : placeCommand(s.edit.doc, s.place, at, null)
  if (r.ok) s.setPreview({ doc: r.doc, ghostIds: r.selection })
  else {
    s.setPreview(null)
    s.setStatus(r.error, 'error')
  }
}

/** Put the item down: a click at `from`, or a drag from `from` to `to` (both snapped already). */
export function commitPlace(from: XZ, to: XZ | null = null): void {
  const s = store()
  const item = s.place
  if (!item) return
  const end = to && (to.x !== from.x || to.z !== from.z) ? to : null
  s.run(placeLabel(item), (doc) => placeCommand(doc, item, from, end))
}

/** Chunk tool click: select an existing chunk, or add one in an empty cell (M4). */
export function chunkClick(p: XZ): void {
  const s = store()
  if (!s.edit) return
  const S = s.edit.doc.world.chunkSize
  const cx = chunkIndex(p.x, S)
  const cz = chunkIndex(p.z, S)
  const id = chunkIdOf(cx, cz)
  if (s.edit.doc.chunks.has(id)) {
    s.set({ selectedChunk: id })
    return
  }
  if (s.run(`Thêm chunk ${id}`, (doc, sel) => addChunk(doc, cx, cz, sel))) s.set({ selectedChunk: id })
}

export function deleteChunk(chunkId: string): void {
  const s = store()
  if (s.run(`Xóa chunk ${chunkId}`, (doc, sel) => removeChunk(doc, chunkId, sel))) s.set({ selectedChunk: null })
}

export function focusChunk(chunkId: string): void {
  const s = store()
  const c = s.edit?.doc.chunks.get(chunkId)
  if (!c || !s.edit) return
  const S = s.edit.doc.world.chunkSize
  const o = chunkOrigin(c.cx, c.cz, S)
  s.set({ selectedChunk: chunkId })
  s.requestFocus({ minX: o.x, minZ: o.z, maxX: o.x + S, maxZ: o.z + S })
}

/** Arrow-key nudge by one snap step (0.25 m when snap is off). */
export function nudge(dx: number, dz: number): void {
  const s = store()
  const step = s.snapStep || 0.25
  s.run('Di chuyển', (doc, sel) => moveRecords(doc, sel, { x: dx * step, z: dz * step }))
}

export function rotateSelection(turns: number): void {
  const s = store()
  if (s.tool === 'place') {
    s.rotatePlacement(turns)
    updatePlacePreview()
    return
  }
  s.run('Xoay', (doc, sel) => rotateRecords(doc, sel, turns))
}

export function deleteSelection(): void {
  store().run('Xóa', (doc, sel) => deleteRecords(doc, sel))
}

export function duplicateSelection(): void {
  const s = store()
  const step = Math.max(1, s.snapStep)
  s.run('Nhân bản', (doc, sel) => duplicateRecords(doc, sel, { x: step, z: step }))
}

/** Ctrl+A: every record on a visible, unlocked layer. */
export function selectAll(): void {
  const s = store()
  if (!s.edit) return
  s.select(resolvedRecords(s.edit.doc).filter((r) => isEditable(r, s.layers)).map((r) => r.id))
}

export function cancel(): void {
  const s = store()
  if (s.tool !== 'select') s.setTool('select')
  else if (s.preview) s.setPreview(null)
  else s.select([])
}

export function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
