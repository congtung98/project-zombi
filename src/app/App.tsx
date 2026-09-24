import { useEffect } from 'react'
import { GameCanvas } from './GameCanvas'
import { HUD } from '../components/HUD'
import { InventoryOverlay } from '../components/ContainerPanel'
import { GameOverScreen, MainMenu, PauseMenu } from '../components/Menus'
import { runtime } from '../game/core/runtime'
import type { ItemEffect } from '../game/entities/items'
import { useHudStore } from '../stores/hudStore'
import { useInventoryStore } from '../stores/inventoryStore'
import { useUiStore } from '../stores/uiStore'
import { useWorldStore } from '../stores/worldStore'

const USE_FAIL_TEXT = {
  'no-effect': 'chỉ số đã đầy, không cần dùng.',
  empty: 'ô trống.',
  dead: 'không thể dùng lúc này.',
} as const

function describeEffect(effect: ItemEffect): string {
  const parts: string[] = []
  const fmt = (v: number, label: string) => parts.push(`${v > 0 ? '+' : ''}${v} ${label}`)
  if (effect.health) fmt(effect.health, 'máu')
  if (effect.hunger) fmt(effect.hunger, 'đói')
  if (effect.thirst) fmt(effect.thirst, 'khát')
  if (effect.stamina) fmt(effect.stamina, 'thể lực')
  return parts.join(', ')
}

export function App() {
  const screen = useUiStore((s) => s.screen)

  useEffect(() => {
    const ui = () => useUiStore.getState()
    const inv = () => useInventoryStore.getState()
    const offs = [
      // Esc: đóng túi/tủ trước; không có gì mở thì mới tạm dừng.
      runtime.input.onAction('pause', () => {
        if (ui().screen === 'playing' && runtime.uiOpen) runtime.closeAllUi()
        else ui().togglePause()
      }),
      runtime.input.onAction('inventory', () => {
        if (ui().screen === 'playing') runtime.toggleInventory()
      }),
      runtime.events.on('inventory:changed', () => inv().sync(runtime)),
      runtime.events.on('item:used', (e) =>
        useHudStore.getState().showToast(`Đã dùng ${e.name}: ${describeEffect(e.effect)}.`, 1800),
      ),
      runtime.events.on('item:useFailed', (e) => useHudStore.getState().showToast(`${e.name}: ${USE_FAIL_TEXT[e.reason]}`, 1800)),
      runtime.input.onAction('debug', () => ui().toggleDebug()),
      runtime.events.on('player:died', () => ui().gameOver()),
      runtime.events.on('player:damaged', (e) => {
        if (e.sourceId !== 'starvation') useHudStore.getState().flashDamage()
      }),
      runtime.events.on('zombie:died', (e) => {
        if (e.sourceId === 'player') useHudStore.getState().showToast('Đã hạ một zombie.', 1500)
      }),
      runtime.events.on('door:toggled', (e) => useWorldStore.getState().setDoor(e.id, e.open)),
      runtime.events.on('container:opened', (e) => useWorldStore.getState().setContainerOpened(e.id)),
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
      {screen === 'playing' && <InventoryOverlay />}
      {screen === 'menu' && <MainMenu />}
      {screen === 'paused' && <PauseMenu />}
      {screen === 'gameover' && <GameOverScreen />}
    </div>
  )
}
