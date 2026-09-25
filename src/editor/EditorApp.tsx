import { useEffect, useRef } from 'react'
import { DEFAULT_WORLD, isDirty, useEditorStore } from './editorStore'
import { cancel, deleteSelection, duplicateSelection, nudge, rotateSelection, selectAll } from './interaction'
import { Inspector } from './Inspector'
import { DuplicatePrefabDialog, IssuesPanel, NewDialog, NewPrefabDialog, OpenDialog, Palette, StatusBar, TopBar } from './Panels'
import { Viewport } from './Viewport'
import { PlaytestOverlay } from './Playtest'

/** Hotkeys act on the editor only; typing in an input/select/textarea is never intercepted. */
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

function onKey(e: KeyboardEvent): void {
  if (isTyping(e)) return
  const s = useEditorStore.getState()
  // The playtest frame has its own keyboard; the editor underneath stays still.
  if (s.playtest) return
  if (s.dialog) {
    if (e.key === 'Escape') s.set({ dialog: null })
    return
  }
  const mod = e.ctrlKey || e.metaKey
  const key = e.key.toLowerCase()
  const handled = () => e.preventDefault()
  if (mod && key === 'z' && !e.shiftKey) return handled(), s.undo()
  if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) return handled(), s.redo()
  if (mod && key === 's') return handled(), void s.saveDraft()
  if (mod && key === 'd') return handled(), duplicateSelection()
  if (mod && key === 'a') return handled(), selectAll()
  if (mod) return
  switch (e.key) {
    case 'Delete':
    case 'Backspace':
      return handled(), deleteSelection()
    case 'Escape':
      return cancel()
    case 'r':
    case 'R':
      return rotateSelection(e.shiftKey ? 3 : 1)
    case 'f':
    case 'F':
      return s.requestFocus()
    case 'Tab':
      return handled(), s.set({ view: s.view === 'top' ? 'iso' : 'top' })
    case 'ArrowLeft':
      return handled(), nudge(-1, 0)
    case 'ArrowRight':
      return handled(), nudge(1, 0)
    case 'ArrowUp':
      return handled(), nudge(0, -1)
    case 'ArrowDown':
      return handled(), nudge(0, 1)
  }
}

export function EditorApp() {
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!useEditorStore.getState().edit) useEditorStore.getState().openBundled(DEFAULT_WORLD)
    void useEditorStore.getState().refreshDrafts()
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty(useEditorStore.getState())) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [])

  const onImport = () => {
    if (isDirty(useEditorStore.getState()) && !window.confirm('Document có thay đổi chưa lưu. Bỏ các thay đổi đó?')) return
    file.current?.click()
  }

  return (
    <div className="editor">
      <TopBar onImport={onImport} />
      <Palette />
      <main className="viewport">
        <Viewport />
      </main>
      <Inspector />
      <IssuesPanel />
      <StatusBar />
      <OpenDialog />
      <NewDialog />
      <NewPrefabDialog />
      <DuplicatePrefabDialog />
      <PlaytestOverlay />
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        hidden
        data-import
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) useEditorStore.getState().openPack(await f.text(), `import ${f.name}`, false)
        }}
      />
    </div>
  )
}
