import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './editor.css'
import { EditorApp } from './EditorApp'
import { useEditorStore } from './editorStore'

// Map editor entry (editor.html). Separate from the game entry: the game bundle never imports
// anything under src/editor/ (see scripts/check-game-bundle.mjs).
if (import.meta.env.DEV) {
  ;(window as unknown as { __editor: typeof useEditorStore }).__editor = useEditorStore
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EditorApp />
  </StrictMode>,
)
