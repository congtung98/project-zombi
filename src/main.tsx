import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { preloadStartupWorld } from './game/world/worldChoice'

/**
 * M10: the world to play is loaded first (its own chunk unless it is the default world), then the
 * game modules, whose runtime singleton is built on it at import.
 */
async function main(): Promise<void> {
  await preloadStartupWorld()
  const [{ App }, { runtime }] = await Promise.all([import('./app/App'), import('./game/core/runtime')])

  // Chỉ ở dev: cho phép kiểm tra simulation từ console/kịch bản playtest tự động.
  if (import.meta.env.DEV) {
    ;(window as unknown as { __runtime: typeof runtime }).__runtime = runtime
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void main()
