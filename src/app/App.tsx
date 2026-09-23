import { useEffect } from 'react'
import { GameCanvas } from './GameCanvas'
import { HUD } from '../components/HUD'
import { GameOverScreen, MainMenu, PauseMenu } from '../components/Menus'
import { runtime } from '../game/core/runtime'
import { useHudStore } from '../stores/hudStore'
import { useUiStore } from '../stores/uiStore'
import { useWorldStore } from '../stores/worldStore'

export function App() {
  const screen = useUiStore((s) => s.screen)

  useEffect(() => {
    const ui = () => useUiStore.getState()
    const offs = [
      runtime.input.onAction('pause', () => ui().togglePause()),
      runtime.input.onAction('debug', () => ui().toggleDebug()),
      runtime.events.on('player:died', () => ui().gameOver()),
      runtime.events.on('door:toggled', (e) => useWorldStore.getState().setDoor(e.id, e.open)),
      runtime.events.on('container:opened', (e) => {
        useWorldStore.getState().setContainerOpened(e.id)
        useHudStore
          .getState()
          .showToast(e.firstTime ? `Đã mở ${e.name}. Vật phẩm và loot sẽ có ở Sprint 4.` : `${e.name}: đã mở trước đó.`)
      }),
    ]

    // Tab mất focus/ẩn: tự tạm dừng để không kẹt phím và không mô phỏng khi không nhìn thấy.
    const pauseIfPlaying = () => {
      if (ui().screen === 'playing') ui().pause()
    }
    const onVisibility = () => {
      if (document.hidden) pauseIfPlaying()
    }
    window.addEventListener('blur', pauseIfPlaying)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      for (const off of offs) off()
      window.removeEventListener('blur', pauseIfPlaying)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    <div className="app">
      <GameCanvas />
      {(screen === 'playing' || screen === 'paused') && <HUD />}
      {screen === 'menu' && <MainMenu />}
      {screen === 'paused' && <PauseMenu />}
      {screen === 'gameover' && <GameOverScreen />}
    </div>
  )
}
