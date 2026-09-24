import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './app/App'
import { runtime } from './game/core/runtime'

// Chỉ ở dev: cho phép kiểm tra simulation từ console/kịch bản playtest tự động.
if (import.meta.env.DEV) {
  ;(window as unknown as { __runtime: typeof runtime }).__runtime = runtime
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
