import { useEffect, useRef } from 'react'
import { isPlaytestMessage, PLAYTEST_CHANNEL, type PlaytestReply, type PlaytestStart } from '../playtest/protocol'
import { useEditorStore } from './editorStore'

/**
 * Play From Here (M6): the real game in a frame over the editor, on a snapshot of the document.
 * The editor stays mounted underneath (document, history, selection and camera untouched); closing
 * the frame discards the whole game session. The frame keeps saves in memory only.
 */
export function PlaytestOverlay() {
  const playtest = useEditorStore((s) => s.playtest)
  const frame = useRef<HTMLIFrameElement>(null)
  const active = playtest !== null

  useEffect(() => {
    if (!active) return
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow || !isPlaytestMessage(e.data)) return
      const msg = e.data as PlaytestReply
      const s = useEditorStore.getState()
      if (msg.type === 'ready' && s.playtest) {
        const start: PlaytestStart = { channel: PLAYTEST_CHANNEL, type: 'start', files: s.playtest.files, spawn: s.playtest.spawn, timeOfDay: s.playtest.timeOfDay }
        frame.current!.contentWindow!.postMessage(start, window.location.origin)
      } else if (msg.type === 'started') {
        s.setPlaytestState('started')
        frame.current?.focus()
      } else if (msg.type === 'error') {
        s.setPlaytestState('error', msg.message)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [active])

  if (!playtest) return null
  const hour = Math.round(playtest.timeOfDay * 24)
  return (
    <div className="playtest" data-playtest>
      <header>
        <button onClick={() => useEditorStore.getState().stopPlaytest()} data-stop-playtest>
          ← Về editor
        </button>
        <strong>Chơi thử: {playtest.worldName}</strong>
        <span>
          từ ({playtest.spawn.x}, {playtest.spawn.z}) lúc {String(hour).padStart(2, '0')}:00 · save chỉ trong bộ nhớ, map và bản nháp không đổi
        </span>
        <span className={playtest.state === 'error' ? 'error' : ''} data-playtest-state={playtest.state}>
          {playtest.state === 'loading' ? 'Đang nạp…' : playtest.state === 'started' ? 'Đang chơi' : `Lỗi: ${playtest.error ?? ''}`}
        </span>
      </header>
      <iframe ref={frame} src="playtest.html" title="Chơi thử" />
    </div>
  )
}
