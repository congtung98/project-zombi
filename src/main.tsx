import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { preloadStartupWorld } from './game/world/worldChoice'

/**
 * M10: the world to play is loaded first (its own chunk unless it is the default world), then the
 * game modules, whose runtime singleton is built on it at import.
 */
async function main(): Promise<void> {
  // C0 (character plan): dev-only character lab; production builds drop this branch.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('lab') === 'characters') {
    const { default: CharacterLab } = await import('./lab/CharacterLab')
    createRoot(document.getElementById('root')!).render(<CharacterLab />)
    return
  }
  await preloadStartupWorld()
  const [{ App }, { runtime }] = await Promise.all([import('./app/App'), import('./game/core/runtime')])

  // Chỉ ở dev, hoặc bản build `--mode e2e` (production build đo hiệu năng bằng script, INV-LOOT S6):
  // cho phép kiểm tra simulation từ console/kịch bản playtest tự động. Bản phát hành không có.
  if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') {
    ;(window as unknown as { __runtime: typeof runtime }).__runtime = runtime
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void main()
