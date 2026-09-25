import { lazy, Suspense, useEffect } from 'react'
import { DOOR_LAB_ENABLED } from '../game/world/doorLab'
import { GameCanvas } from './GameCanvas'
import { HUD } from '../components/HUD'
import { InventoryOverlay } from '../components/ContainerPanel'
import { GameOverScreen, MainMenu, PauseMenu } from '../components/Menus'
import { CharacterCreation } from '../components/CharacterCreation'
import { runtime } from '../game/core/runtime'
import { sfx } from '../game/audio/sfx'
import type { ItemEffect } from '../game/entities/items'
import { getItemDef } from '../game/entities/items'
import { useHudStore } from '../stores/hudStore'
import { useInventoryStore } from '../stores/inventoryStore'
import { useUiStore } from '../stores/uiStore'
import { useWorldStore } from '../stores/worldStore'
import { ACTION_CANCEL_TEXT, ACTION_FAILURE_TEXT } from '../components/craftText'

const USE_FAIL_TEXT = {
  'no-effect': 'chỉ số đã đầy, không cần dùng.',
  empty: 'ô trống.',
  dead: 'không thể dùng lúc này.',
  'not-usable': 'không dùng trực tiếp; dùng khi sửa vũ khí hoặc chế tạo.',
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
const UNAWARE = new Set(['IDLE', 'WANDER', 'MIGRATE'])

/** World sounds fade with distance from the player (full within 6 m, quiet but audible at 30 m). */
function doorGain(id: string): number {
  const door = runtime.map.doors.find((d) => d.id === id)
  if (!door) return 1
  const d = Math.hypot(door.center.x - runtime.player.position.x, door.center.z - runtime.player.position.z)
  return Math.max(0.15, Math.min(1, 1 - (d - 6) / 30))
}
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
      // P2-S4 timed craft/repair: nothing is spent unless the action completes.
      runtime.events.on('action:started', () => sfx.play('workStart')),
      runtime.events.on('action:rejected', (e) => useHudStore.getState().showToast(`${e.label}: ${ACTION_FAILURE_TEXT[e.reason]}.`, 2500, 'warn')),
      runtime.events.on('action:cancelled', (e) => {
        useHudStore.getState().showToast(`Đã hủy ${e.label.toLowerCase()} (${ACTION_CANCEL_TEXT[e.reason]}); không mất nguyên liệu.`, 2200, 'warn')
        sfx.play('workCancel')
      }),
      runtime.events.on('action:failed', (e) => {
        useHudStore.getState().showToast(`${e.label} không hoàn tất: ${ACTION_FAILURE_TEXT[e.reason]}; không mất nguyên liệu.`, 3000, 'warn')
        sfx.play('workCancel')
      }),
      runtime.events.on('action:completed', (e) => {
        const r = e.repair
        const text = r
          ? `Đã sửa ${getItemDef(r.itemId).name}: độ bền ${r.before} → ${r.after}/${r.max}.`
          : `Đã chế tạo ${e.outputItemId ? getItemDef(e.outputItemId).name : ''}.`
        useHudStore.getState().showToast(text, 2200)
        sfx.play('workDone')
      }),
      runtime.events.on('item:reserved', (e) =>
        useHudStore.getState().showToast(`${e.name} đang dùng cho "${e.label}". Hủy thao tác (X) trước.`, 2200, 'warn'),
      ),
      runtime.input.onAction('debug', () => ui().toggleDebug()),
      runtime.input.onAction('visionDebug', () => ui().toggleVisionDebug()),
      runtime.input.onAction('lightingDebug', () => ui().toggleLightingDebug()),
      runtime.events.on('player:died', () => ui().gameOver()),
      runtime.events.on('player:damaged', (e) => {
        if (e.sourceId !== 'starvation') useHudStore.getState().flashDamage()
      }),
      runtime.events.on('zombie:died', (e) => {
        if (e.sourceId === 'player') useHudStore.getState().showToast('Đã hạ một zombie.', 1500)
      }),
      runtime.events.on('door:changed', (e) => useWorldStore.getState().setDoor(e.id, e.state)),
      runtime.events.on('door:damaged', (e) => sfx.play('doorBash', doorGain(e.id))),
      runtime.events.on('door:destroyed', (e) => {
        sfx.play('doorBreak', doorGain(e.id))
        const door = runtime.map.doors.find((d) => d.id === e.id)
        if (door) useHudStore.getState().showToast(`${door.name} đã bị zombie phá vỡ!`, 3000, 'danger')
      }),
      runtime.events.on('drops:changed', () => useWorldStore.getState().syncFromRuntime(runtime)),
      runtime.events.on('zombie:spawned', (e) => useWorldStore.getState().addZombie(e.id)),
      runtime.events.on('zombie:removed', (e) => useWorldStore.getState().removeZombie(e.id)),
      runtime.events.on('container:opened', (e) => useWorldStore.getState().setContainerOpened(e.id)),

      // Âm thanh tổng hợp (không asset ngoài); mỗi sự kiện một hiệu ứng ngắn.
      runtime.events.on('player:attacked', (e) => sfx.play(e.hitIds.length > 0 ? 'hit' : 'swing')),
      runtime.events.on('player:pushed', () => sfx.play('push')),
      // Footsteps play exactly while zombies can hear the player (walk 5 m / run 12 m, P2-S5).
      runtime.events.on('player:footstep', (e) => sfx.play(e.running ? 'stepRun' : 'stepWalk')),
      runtime.events.on('zombie:damaged', () => sfx.play('zombieHurt')),
      runtime.events.on('zombie:died', () => sfx.play('zombieDie')),
      runtime.events.on('zombie:stateChanged', (e) => {
        if (e.to === 'CHASE' && UNAWARE.has(e.from)) sfx.play('zombieAlert')
      }),
      runtime.events.on('player:damaged', (e) => {
        if (e.sourceId !== 'starvation') sfx.play('playerHurt')
      }),
      runtime.events.on('door:toggled', () => sfx.play('door')),
      runtime.events.on('light:changed', () => sfx.play('switch')),
      runtime.events.on('curtain:changed', () => sfx.play('curtain')),
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
      {screen === 'create' && <CharacterCreation />}
      {screen === 'paused' && <PauseMenu />}
      {screen === 'gameover' && <GameOverScreen />}
    </div>
  )
}
