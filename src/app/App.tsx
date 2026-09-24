import { lazy, Suspense, useEffect } from 'react'
import { DOOR_LAB_ENABLED } from '../game/world/doorLab'
import { GameCanvas } from './GameCanvas'
import { HUD } from '../components/HUD'
import { InventoryOverlay } from '../components/ContainerPanel'
import { GameOverScreen, MainMenu, PauseMenu } from '../components/Menus'
import { runtime } from '../game/core/runtime'
import { sfx } from '../game/audio/sfx'
import type { ItemEffect } from '../game/entities/items'
import { getItemDef } from '../game/entities/items'
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

const ITEM_SFX = { food: 'eat', drink: 'drink', medical: 'heal', weapon: 'pickup', tool: 'pickup', material: 'pickup' } as const
const DoorLab = lazy(() => import('../components/DoorLab'))

export function App() {
  const screen = useUiStore((s) => s.screen)
  const sceneReady = useUiStore((s) => s.sceneReady)

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
      // Vũ khí P2-S2: tay không, đổi vũ khí, hao mòn (chỉ đồng bộ UI, không phát âm pickup), sắp hỏng, hỏng.
      runtime.events.on('player:unarmed', () =>
        useHudStore.getState().showToast('Tay không: tìm vũ khí trong tủ (E để mở), trang bị trong túi (I). Space để đẩy.', 2200, 'warn'),
      ),
      runtime.events.on('item:equipped', (e) =>
        useHudStore.getState().showToast(e.itemId ? `Đang cầm ${getItemDef(e.itemId).name}.` : 'Đã cất vũ khí: tay không.', 1400),
      ),
      runtime.events.on('weapon:worn', () => inv().sync(runtime)),
      runtime.events.on('weapon:lowCondition', (e) => useHudStore.getState().showToast(`${e.name} sắp hỏng (≤ 25% độ bền).`, 2500, 'warn')),
      runtime.events.on('weapon:broken', (e) => {
        useHudStore.getState().showToast(`${e.name} đã HỎNG! Sát thương còn 20%. Đổi vũ khí khác trong túi (I).`, 3500, 'danger')
        sfx.play('weaponBreak')
      }),
      runtime.input.onAction('debug', () => ui().toggleDebug()),
      runtime.events.on('player:died', () => ui().gameOver()),
      runtime.events.on('player:damaged', (e) => {
        if (e.sourceId !== 'starvation') useHudStore.getState().flashDamage()
      }),
      runtime.events.on('zombie:died', (e) => {
        if (e.sourceId === 'player') useHudStore.getState().showToast('Đã hạ một zombie.', 1500)
      }),
      runtime.events.on('door:changed', (e) => useWorldStore.getState().setDoor(e.id, e.state)),
      runtime.events.on('drops:changed', () => useWorldStore.getState().syncFromRuntime(runtime)),
      runtime.events.on('zombie:spawned', (e) => useWorldStore.getState().addZombie(e.id)),
      runtime.events.on('zombie:removed', (e) => useWorldStore.getState().removeZombie(e.id)),
      runtime.events.on('container:opened', (e) => useWorldStore.getState().setContainerOpened(e.id)),

      // Âm thanh tổng hợp (không asset ngoài); mỗi sự kiện một hiệu ứng ngắn.
      runtime.events.on('player:attacked', (e) => sfx.play(e.hitIds.length > 0 ? 'hit' : 'swing')),
      runtime.events.on('player:pushed', () => sfx.play('push')),
      runtime.events.on('zombie:damaged', () => sfx.play('zombieHurt')),
      runtime.events.on('zombie:died', () => sfx.play('zombieDie')),
      runtime.events.on('zombie:stateChanged', (e) => {
        if (e.to === 'CHASE' && e.from === 'IDLE') sfx.play('zombieAlert')
      }),
      runtime.events.on('player:damaged', (e) => {
        if (e.sourceId !== 'starvation') sfx.play('playerHurt')
      }),
      runtime.events.on('door:toggled', () => sfx.play('door')),
      runtime.events.on('container:opened', () => sfx.play('container')),
      runtime.events.on('item:used', (e) => sfx.play(ITEM_SFX[getItemDef(e.itemId).kind])),
      runtime.events.on('inventory:changed', () => sfx.play('pickup')),
    ]

    // Trình duyệt chỉ cho phát âm thanh sau tương tác người dùng.
    const unlock = () => sfx.unlock()
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)

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
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      window.removeEventListener('blur', pauseIfPlaying)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    <div className="app">
      <GameCanvas />
      {(screen === 'playing' || screen === 'paused') && <HUD />}
      {screen === 'playing' && !sceneReady && (
        <div className="overlay overlay-dim">
          <div className="loading">Đang tải…</div>
        </div>
      )}
      {screen === 'playing' && <InventoryOverlay />}
      {DOOR_LAB_ENABLED && screen === 'playing' && <Suspense fallback={null}><DoorLab /></Suspense>}
      {screen === 'menu' && <MainMenu />}
      {screen === 'paused' && <PauseMenu />}
      {screen === 'gameover' && <GameOverScreen />}
    </div>
  )
}
