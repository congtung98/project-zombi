import { deleteRecords, duplicateRecords, moveRecords, placeInstance, rotateInstances } from '../map/editor/commands'
import { snap } from '../map/editor/picking'
import type { XZ } from '../map/schema'
import { useEditorStore } from './editorStore'

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

/** Ghost of the prefab being placed at the (snapped) cursor. */
export function updatePlacePreview(cursor: XZ | null = store().cursor): void {
  const s = store()
  if (s.tool !== 'place' || !s.placePrefab || !s.edit || !cursor) return
  const r = placeInstance(s.edit.doc, s.placePrefab, snapPoint(cursor), s.placeTurns)
  if (r.ok) s.setPreview({ doc: r.doc, ghostIds: r.selection })
  else {
    s.setPreview(null)
    s.setStatus(r.error, 'error')
  }
}

export function commitPlace(cursor: XZ): void {
  const s = store()
  if (!s.placePrefab) return
  const prefab = s.placePrefab
  const at = snapPoint(cursor)
  const turns = s.placeTurns
  s.run(`Đặt ${prefab}`, (doc) => placeInstance(doc, prefab, at, turns))
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
  s.run('Xoay', (doc, sel) => rotateInstances(doc, sel, turns))
}

export function deleteSelection(): void {
  store().run('Xóa', (doc, sel) => deleteRecords(doc, sel))
}

export function duplicateSelection(): void {
  const s = store()
  const step = Math.max(1, s.snapStep)
  s.run('Nhân bản', (doc, sel) => duplicateRecords(doc, sel, { x: step, z: step }))
}

export function cancel(): void {
  const s = store()
  if (s.tool === 'place') s.setTool('select')
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
