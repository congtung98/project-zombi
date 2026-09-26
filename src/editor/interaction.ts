import { addChunk, deleteRecords, duplicateRecords, moveRecords, placeInstance, placeRecord, removeChunk, rotateRecords, type CommandResult } from '../map/editor/commands'
import { instancesOf, resolvedRecords, type MapDocument } from '../map/editor/document'
import { isEditable } from '../map/editor/layers'
import { pickRecord, recordsInRect, snap } from '../map/editor/picking'
import { findPreset } from '../map/editor/presets'
import { findPrefabPreset } from '../map/editor/prefabPresets'
import {
  deletePrefabItems,
  duplicatePrefabItems,
  isStatefulItem,
  itemsInRect,
  movePrefabItems,
  pickPrefabItem,
  placePrefabItem,
  prefabItems,
  rotatePrefabItems,
} from '../map/editor/prefabCommands'
import type { Rect, XZ } from '../map/schema'
import { dragPrefabHandle, dragRecordHandle, FOOTPRINT_KEY, prefabItemHandles, recordHandles, type Handle, type HandleKey } from '../map/editor/handles'
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
  if (item.kind === 'prefabItem') return placePrefabItem(doc, store().prefabMode ?? '', item.presetId, from, to, store().placeTurns)
  return placeRecord(doc, item.presetId, from, to)
}

export function placeLabel(item: PlaceItem): string {
  if (item.kind === 'prefab') return `Đặt ${item.prefabId}`
  if (item.kind === 'prefabItem') return `Đặt ${findPrefabPreset(item.presetId)?.label ?? item.presetId} (prefab)`
  return `Đặt ${findPreset(item.presetId)?.label ?? item.presetId}`
}

/** Prefab being edited, or null in world mode (M5). */
const prefabMode = () => store().prefabMode

/**
 * Ask before an edit that drops local IDs saves hold state for (door, container, window, lamp)
 * in a prefab with instances: old saves of the world will no longer match (M5).
 */
export function confirmStateful(prefabId: string, keys: readonly string[], action: string): boolean {
  const s = store()
  const doc = s.edit?.doc
  const prefab = doc?.prefabs.get(prefabId)
  if (!doc || !prefab) return true
  const hit = keys.filter((k) => isStatefulItem(prefab, k))
  const n = instancesOf(doc, prefabId).length
  if (!hit.length || !n) return true
  return window.confirm(
    `${action} ${hit.join(', ')} của prefab gốc ${prefabId} (${n} instance): save cũ có trạng thái cho <instance>/${hit[0]} sẽ không còn khớp — cần tăng contentVersion của world. Local ID cũ bị khóa, không dùng lại. Tiếp tục?`,
  )
}

/** Item/record under a ground point, respecting the mode (and layers in world mode). */
export function pickAt(g: XZ): string | null {
  const s = store()
  if (!s.edit) return null
  const p = prefabMode()
  if (p) {
    const prefab = s.edit.doc.prefabs.get(p)
    return prefab ? (pickPrefabItem(prefabItems(prefab), g)?.key ?? null) : null
  }
  return pickRecord(resolvedRecords(s.edit.doc), g, (r) => !isEditable(r, s.layers))?.id ?? null
}

/** Selection box (M4, prefab items since M5): keys entirely inside `rect`. */
export function keysInRect(rect: Rect): string[] {
  const s = store()
  if (!s.edit) return []
  const p = prefabMode()
  if (p) {
    const prefab = s.edit.doc.prefabs.get(p)
    return prefab ? itemsInRect(prefabItems(prefab), rect) : []
  }
  return recordsInRect(resolvedRecords(s.edit.doc), rect, (r) => !isEditable(r, s.layers)).map((r) => r.id)
}

/**
 * Resize handles of the one selected record or prefab item (M7), in the frame the viewport draws.
 * Only the select tool shows them, and never on the rotated (view-only) prefab preview.
 */
export function currentHandles(doc: MapDocument | undefined = store().edit?.doc): Handle[] {
  const s = store()
  const id = currentHandleTarget()
  if (!doc || !s.edit || s.tool !== 'select' || id === null) return []
  const p = prefabMode()
  if (p) {
    const prefab = doc.prefabs.get(p)
    return prefab && s.prefabView === 0 ? prefabItemHandles(prefab, id) : []
  }
  return recordHandles(doc, id)
}

/**
 * Whose handles show: the one selected record/item, or (M11a) in the prefab editor with nothing
 * selected and "Sửa outline" on, the footprint outline of an L/T/U building (`FOOTPRINT_KEY`).
 */
export function currentHandleTarget(): string | null {
  const s = store()
  if (!s.edit) return null
  if (s.edit.selection.length === 1) return s.edit.selection[0]
  const p = prefabMode()
  return p && s.outlineEdit && s.edit.selection.length === 0 && s.edit.doc.prefabs.get(p)?.outline ? FOOTPRINT_KEY : null
}

/** The handle-drag command for the mode (the selected record/item, handle `key`, pointer `at`). */
export function handleCommand(doc: MapDocument, id: string, key: HandleKey, at: XZ): CommandResult {
  const p = prefabMode()
  return p ? dragPrefabHandle(doc, p, id, key, at) : dragRecordHandle(doc, id, key, at)
}

export function handleLabel(key: HandleKey): string {
  if (key === 'fixture') return 'Dời đèn'
  if (key === 'from' || key === 'to') return 'Kéo dài tường'
  if (key === 'radius') return 'Đổi bán kính'
  if (/^v\d+$/.test(key)) return 'Kéo đỉnh'
  if (/^e\d+$/.test(key)) return 'Kéo cạnh'
  return 'Đổi kích thước'
}

/** The move command for the mode. */
export function moveCommand(doc: MapDocument, ids: readonly string[], delta: XZ): CommandResult {
  const p = prefabMode()
  return p ? movePrefabItems(doc, p, ids, delta) : moveRecords(doc, ids, delta)
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
  s.run('Di chuyển', (doc, sel) => moveCommand(doc, sel, { x: dx * step, z: dz * step }))
}

export function rotateSelection(turns: number): void {
  const s = store()
  if (s.tool === 'place') {
    s.rotatePlacement(turns)
    updatePlacePreview()
    return
  }
  const p = prefabMode()
  s.run('Xoay', (doc, sel) => (p ? rotatePrefabItems(doc, p, sel, turns) : rotateRecords(doc, sel, turns)))
}

export function deleteSelection(): void {
  const s = store()
  const p = prefabMode()
  if (p) {
    if (!s.edit?.selection.length || !confirmStateful(p, s.edit.selection, 'Xóa')) return
    s.run('Xóa (prefab)', (doc, sel) => deletePrefabItems(doc, p, sel))
    return
  }
  s.run('Xóa', (doc, sel) => deleteRecords(doc, sel))
}

export function duplicateSelection(): void {
  const s = store()
  const p = prefabMode()
  const step = Math.max(1, s.snapStep)
  s.run('Nhân bản', (doc, sel) => (p ? duplicatePrefabItems(doc, p, sel, { x: step, z: step }) : duplicateRecords(doc, sel, { x: step, z: step })))
}

/** Ctrl+A: every record on a visible, unlocked layer (prefab mode: every item). */
export function selectAll(): void {
  const s = store()
  if (!s.edit) return
  const p = prefabMode()
  const prefab = p ? s.edit.doc.prefabs.get(p) : null
  if (prefab) s.select([...new Set(prefabItems(prefab).map((it) => it.key))])
  else s.select(resolvedRecords(s.edit.doc).filter((r) => isEditable(r, s.layers)).map((r) => r.id))
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
