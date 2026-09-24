import { create } from 'zustand'
import { runtime } from '../game/core/runtime'
import { summarizeSave, validateSaveGame } from '../game/systems/save'
import { commitMigratedSave, deleteSave, readSave, writeSave } from '../game/systems/saveStorage'
import type { SaveSummary } from '../types/save'
import { sfx } from '../game/audio/sfx'
import { useHudStore } from './hudStore'
import { useInventoryStore } from './inventoryStore'
import { useWorldStore } from './worldStore'

export type Screen = 'menu' | 'playing' | 'paused' | 'gameover'
const ACTIVE_SAVE_SLOT = runtime.map.id === 'door-lab' ? 'slot-lab' : 'slot-1'
const NEW_CONTAINERS_NOTE = 'Có thêm tủ vũ khí mới chưa mở; tủ cũ không sinh lại loot.'
const MIGRATION_TOAST: Record<number, string> = {
  1: `Đã nâng cấp save Phase 1 và giữ bản sao v1. Gậy cũ ở túi hoặc túi đồ rơi dưới chân. ${NEW_CONTAINERS_NOTE}`,
  2: `Đã nâng cấp save và giữ bản sao v2. ${NEW_CONTAINERS_NOTE}`,
}

/** Trạng thái slot lưu để menu quyết định bật Continue và cảnh báo ghi đè. */
export type SaveSlotState =
  | { kind: 'unknown' }
  | { kind: 'empty' }
  | { kind: 'ready'; summary: SaveSummary }
  | { kind: 'incompatible'; detail: string }
  | { kind: 'corrupt'; detail: string }
  | { kind: 'error'; detail: string }

interface UiState {
  screen: Screen
  /** Đồng bộ với runtime.sessionId để remount scene khi bắt đầu ván mới hoặc load. */
  sessionId: number
  debug: boolean
  saveSlot: SaveSlotState
  /** Đang ghi/đọc IndexedDB; menu khóa nút để tránh thao tác chồng. */
  busy: boolean
  /** false cho tới khi game loop chạy frame đầu của phiên (che khung hình body chưa đặt đúng chỗ). */
  sceneReady: boolean
  markSceneReady: () => void
  startNewGame: () => void
  continueGame: () => Promise<void>
  refreshSaveSlot: () => Promise<void>
  /** Chụp snapshot ngay bây giờ (giữa hai tick) và ghi xuống IndexedDB. */
  saveGame: (label?: string) => Promise<boolean>
  discardSave: () => Promise<void>
  pause: () => void
  resume: () => void
  togglePause: () => void
  gameOver: () => void
  toMenu: () => void
  toggleDebug: () => void
}

function enterSession(set: (s: Partial<UiState>) => void): void {
  useWorldStore.getState().syncFromRuntime(runtime)
  useInventoryStore.getState().reset()
  set({ screen: 'playing', sessionId: runtime.sessionId, sceneReady: false })
}

export const useUiStore = create<UiState>((set, get) => ({
  screen: 'menu',
  sessionId: runtime.sessionId,
  debug: false,
  saveSlot: { kind: 'unknown' },
  busy: false,
  sceneReady: false,
  markSceneReady: () => {
    if (!get().sceneReady) set({ sceneReady: true })
  },

  startNewGame: () => {
    runtime.newGame()
    enterSession(set)
    if (runtime.map.containers.some((c) => c.id === 'ct-safehouse-closet')) {
      useHudStore.getState().showToast('Bạn đang tay không. Tủ quần áo trong nhà an toàn có vũ khí: lại gần, nhấn E, rồi trang bị trong túi.', 6000)
    }
  },

  refreshSaveSlot: async () => {
    const r = await readSave(ACTIVE_SAVE_SLOT)
    if (!r.ok) {
      set({ saveSlot: { kind: 'error', detail: r.error } })
      return
    }
    if (r.value === undefined) {
      set({ saveSlot: { kind: 'empty' } })
      return
    }
    const v = validateSaveGame(r.value, runtime.map.id)
    if (v.ok) set({ saveSlot: { kind: 'ready', summary: summarizeSave(v.save) } })
    else if (v.reason === 'incompatible') set({ saveSlot: { kind: 'incompatible', detail: v.detail } })
    else set({ saveSlot: { kind: 'corrupt', detail: `${v.reason}: ${v.detail}` } })
  },

  continueGame: async () => {
    if (get().busy) return
    set({ busy: true })
    try {
      const r = await readSave(ACTIVE_SAVE_SLOT)
      if (!r.ok || r.value === undefined) {
        set({ saveSlot: r.ok ? { kind: 'empty' } : { kind: 'error', detail: r.error } })
        return
      }
      const v = validateSaveGame(r.value, runtime.map.id)
      if (!v.ok) {
        set({ saveSlot: v.reason === 'incompatible' ? { kind: 'incompatible', detail: v.detail } : { kind: 'corrupt', detail: v.detail } })
        return
      }
      if (v.migrated) {
        const migration = await commitMigratedSave(r.value, v.save, ACTIVE_SAVE_SLOT)
        if (!migration.ok) {
          set({ saveSlot: { kind: 'error', detail: migration.error } })
          return
        }
      }
      runtime.loadSnapshot(v.save)
      enterSession(set)
      if (v.migrated) useHudStore.getState().showToast(MIGRATION_TOAST[v.fromVersion] ?? 'Đã nâng cấp save.', 7000)
    } finally {
      set({ busy: false })
    }
  },

  saveGame: async (label = 'Đã lưu game.') => {
    if (get().busy) return false
    const screen = get().screen
    if (screen !== 'playing' && screen !== 'paused') return false
    if (!runtime.player.alive) return false
    const snapshot = runtime.createSnapshot()
    const checked = validateSaveGame(snapshot, runtime.map.id, runtime.map)
    if (!checked.ok) {
      useHudStore.getState().showToast(`Không lưu được: ${checked.detail}`, 4000)
      return false
    }
    set({ busy: true })
    try {
      const r = await writeSave(snapshot, ACTIVE_SAVE_SLOT)
      if (r.ok) {
        set({ saveSlot: { kind: 'ready', summary: summarizeSave(snapshot) } })
        useHudStore.getState().showToast(label, 1500)
        sfx.play('save')
        return true
      }
      useHudStore.getState().showToast(`Không lưu được: ${r.error}`, 4000)
      return false
    } finally {
      set({ busy: false })
    }
  },

  discardSave: async () => {
    const r = await deleteSave(ACTIVE_SAVE_SLOT)
    set({ saveSlot: r.ok ? { kind: 'empty' } : { kind: 'error', detail: r.error } })
  },

  pause: () => {
    if (get().screen !== 'playing') return
    runtime.input.clear()
    set({ screen: 'paused' })
  },

  resume: () => {
    if (get().screen !== 'paused') return
    runtime.input.clear()
    set({ screen: 'playing' })
  },

  togglePause: () => {
    const screen = get().screen
    if (screen === 'playing') get().pause()
    else if (screen === 'paused') get().resume()
  },

  gameOver: () => {
    runtime.input.clear()
    set({ screen: 'gameover' })
    // Chết là hết ván: xóa bản lưu để Continue không hồi sinh.
    void get().discardSave()
  },

  toMenu: () => {
    runtime.input.clear()
    useInventoryStore.getState().reset()
    set({ screen: 'menu' })
    void get().refreshSaveSlot()
  },

  toggleDebug: () => set((s) => ({ debug: !s.debug })),
}))
