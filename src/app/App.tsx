import { useEffect } from 'react'
import { GameCanvas } from './GameCanvas'
import { HUD } from '../components/HUD'
import { GameOverScreen, MainMenu, PauseMenu } from '../components/Menus'
import { runtime } from '../game/core/runtime'
import { useUiStore } from '../stores/uiStore'

export function App() {
  const screen = useUiStore((s) => s.screen)

  useEffect(() => {
    const ui = () => useUiStore.getState()
    const offPause = runtime.input.onAction('pause', () => ui().togglePause())
    const offDebug = runtime.input.onAction('debug', () => ui().toggleDebug())
    const offDied = runtime.events.on('player:died', () => ui().gameOver())

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
      offPause()
      offDebug()
      offDied()
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
