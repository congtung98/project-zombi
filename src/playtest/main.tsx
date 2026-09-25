import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { loadWorld } from '../map/content'
import { MapContentError } from '../map/validate'
import { enableMemorySaveStorage } from '../game/systems/saveStorage'
import { setPlaytestSession } from '../game/world/playtest'
import { isPlaytestMessage, PLAYTEST_CHANNEL, type PlaytestReply, type PlaytestStart } from './protocol'

/**
 * Playtest page (map editor M6): the real game on a snapshot sent by the editor that embeds this
 * page. Order matters: the snapshot is validated and the session set *before* the game modules are
 * imported, so the runtime singleton is built on it. Saves stay in memory (the player's IndexedDB
 * is never opened); invalid content shows its errors instead of falling back to another map.
 */

const root = document.getElementById('root')!
type Body<T> = T extends unknown ? Omit<T, 'channel'> : never
const reply = (msg: Body<PlaytestReply>) => window.parent.postMessage({ channel: PLAYTEST_CHANNEL, ...msg }, window.location.origin)

function showText(title: string, lines: string[] = []): void {
  root.innerHTML = ''
  const box = document.createElement('div')
  box.style.cssText = 'font: 14px system-ui; color: #e3e6e8; background: #1b1e21; padding: 24px; height: 100vh; box-sizing: border-box'
  const h = document.createElement('h2')
  h.textContent = title
  box.append(h)
  for (const l of lines) {
    const p = document.createElement('div')
    p.textContent = l
    box.append(p)
  }
  root.append(box)
}

let started = false

async function start(msg: PlaytestStart): Promise<void> {
  if (started) return
  started = true
  const files = new Map(Object.entries(msg.files))
  let map
  try {
    map = loadWorld((path) => {
      if (!files.has(path)) throw new Error(`Missing content file ${path}`)
      return files.get(path)
    }).map
  } catch (e) {
    const issues = e instanceof MapContentError ? e.issues.filter((i) => i.severity === 'error') : []
    const message = e instanceof Error ? e.message : String(e)
    showText('Không chơi thử được: nội dung không hợp lệ', issues.length ? issues.map((i) => `${i.code} ${i.path}: ${i.message}`) : [message])
    reply({ type: 'error', message, issues })
    return
  }
  enableMemorySaveStorage()
  setPlaytestSession({ map: { ...map, playerSpawn: { x: msg.spawn.x, y: 0, z: msg.spawn.z } }, timeOfDay: msg.timeOfDay })
  const [{ App }, { runtime }, { useUiStore }] = await Promise.all([import('../app/App'), import('../game/core/runtime'), import('../stores/uiStore'), import('../index.css')])
  if (import.meta.env.DEV) (window as unknown as { __runtime: typeof runtime }).__runtime = runtime
  root.innerHTML = ''
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  useUiStore.getState().startNewGame()
  runtime.clock.reset(msg.timeOfDay)
  runtime.lighting.markAllDirty()
  reply({ type: 'started', mapId: runtime.map.id })
}

window.addEventListener('message', (e: MessageEvent) => {
  if (e.origin !== window.location.origin || e.source !== window.parent || !isPlaytestMessage(e.data)) return
  if (e.data.type === 'start') void start(e.data as PlaytestStart)
})

if (window.parent === window) showText('Trang chơi thử của map editor', ['Mở từ editor: nút "Chơi thử" (Play From Here).'])
else {
  showText('Đang chờ editor gửi bản chụp…')
  reply({ type: 'ready' })
}
