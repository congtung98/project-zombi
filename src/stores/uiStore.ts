import { create } from 'zustand'
import { runtime } from '../game/core/runtime'
import { summarizeSave, validateSaveGame } from '../game/systems/save'
import { commitMigratedSave, deleteSave, readSave, writeSave } from '../game/systems/saveStorage'
import type { SaveSummary } from '../types/save'
import type { CharacterProfile } from '../game/entities/player'
import { sfx } from '../game/audio/sfx'
import { STRESS_MAP_PREFIX } from '../game/world/stressMap'
import { useHudStore } from './hudStore'
import { useInventoryStore } from './inventoryStore'
import { useWorldStore } from './worldStore'

export type Screen = 'menu' | 'create' | 'playing' | 'paused' | 'gameover'
/** DEBUG_PLAYER_VISION: config flag or `?vision=debug` starts the session with the vision debug drawn. */
const DEBUG_PLAYER_VISION =
  runtime.config.playerVision.debug || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('vision') === 'debug')
/** DEBUG_BUILDING_LIGHTING: config flag or `?lighting=debug`. */
const DEBUG_BUILDING_LIGHTING =
  runtime.config.buildingLighting.debug || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('lighting') === 'debug')
/** Dev maps never touch the player's save: the door lab and the stress map (`?stress=N`) use their own slots. */
/** R0 perf HUD (F7); `?perf=1` starts with it on. */
const PERF_HUD = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('perf') === '1'
const ACTIVE_SAVE_SLOT = runtime.map.id === 'door-lab' ? 'slot-lab' : runtime.map.id.startsWith(STRESS_MAP_PREFIX) ? 'slot-stress' : 'slot-1'
const NEW_CONTAINERS_NOTE = 'Có thêm tủ vũ khí mới chưa mở; tủ cũ không sinh lại loot.'
const DEFAULT_LOOK_NOTE = 'Nhân vật dùng tên và ngoại hình mặc định.'
const MATERIALS_NOTE = 'Có 3 chỗ vật liệu mới (hộp đồ nghề nhà an toàn, kệ vật liệu cửa hàng, đống phế liệu sau nhà dân) để sửa/chế tạo.'
const ZOMBIE_AI_NOTE = 'Zombie giờ lang thang theo đàn, nghe tiếng bước chân và đập cửa khi đã phát hiện bạn.'
const LIGHTING_NOTE = 'Nhà có cửa sổ, rèm và đèn (công tắc cạnh cửa, E); nhà dân có thêm phòng ngủ.'
const MIGRATION_TOAST: Record<number, string> = {
  1: `Đã nâng cấp save Phase 1 và giữ bản sao v1. Gậy cũ ở túi hoặc túi đồ rơi dưới chân. ${NEW_CONTAINERS_NOTE} ${MATERIALS_NOTE} ${DEFAULT_LOOK_NOTE} ${ZOMBIE_AI_NOTE} ${LIGHTING_NOTE}`,
  2: `Đã nâng cấp save và giữ bản sao v2. ${NEW_CONTAINERS_NOTE} ${MATERIALS_NOTE} ${DEFAULT_LOOK_NOTE} ${ZOMBIE_AI_NOTE} ${LIGHTING_NOTE}`,
  3: `Đã nâng cấp save và giữ bản sao v3. ${MATERIALS_NOTE} ${DEFAULT_LOOK_NOTE} ${ZOMBIE_AI_NOTE} ${LIGHTING_NOTE}`,
  4: `Đã nâng cấp save và giữ bản sao v4. ${MATERIALS_NOTE} ${ZOMBIE_AI_NOTE} ${LIGHTING_NOTE}`,
  5: `Đã nâng cấp save và giữ bản sao v5. ${ZOMBIE_AI_NOTE} ${LIGHTING_NOTE}`,
  6: `Đã nâng cấp save và giữ bản sao v6. ${LIGHTING_NOTE}`,
  7: 'Đã nâng cấp save sang dữ liệu map mới (ID ổn định) và giữ bản sao v7.',
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
  /** Player vision debug drawing (F4; `?vision=debug` or `playerVision.debug` start with it on). */
  visionDebug: boolean
  /** Building lighting debug drawing (F6). */
  lightingDebug: boolean
  /** Performance HUD (F7). */
  perfHud: boolean
  saveSlot: SaveSlotState
  /** Đang ghi/đọc IndexedDB; menu khóa nút để tránh thao tác chồng. */
  busy: boolean
  /** false cho tới khi game loop chạy frame đầu của phiên (che khung hình body chưa đặt đúng chỗ). */
  sceneReady: boolean
  markSceneReady: () => void
  /** New Game → character creation. Nothing is deleted or created until the player confirms. */
  openCharacterCreation: () => void
  /** Back from character creation: the existing save is untouched. */
  cancelCharacterCreation: () => void
  /** Confirmed start: replaces the save slot (if any), then builds the world with this character. */
  beginNewGame: (profile: CharacterProfile) => Promise<void>
  startNewGame: (profile?: CharacterProfile) => void
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
  toggleVisionDebug: () => void
  toggleLightingDebug: () => void
  togglePerfHud: () => void
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
  visionDebug: DEBUG_PLAYER_VISION,
  lightingDebug: DEBUG_BUILDING_LIGHTING,
  perfHud: PERF_HUD,
  saveSlot: { kind: 'unknown' },
  busy: false,
  sceneReady: false,
  markSceneReady: () => {
    if (!get().sceneReady) set({ sceneReady: true })
  },

  openCharacterCreation: () => {
    runtime.input.clear()
    set({ screen: 'create' })
    void get().refreshSaveSlot()
  },

  cancelCharacterCreation: () => {
    set({ screen: 'menu' })
    void get().refreshSaveSlot()
  },

  beginNewGame: async (profile) => {
    if (get().busy) return
    const slot = get().saveSlot.kind
    // One slot: the old save is removed only now, after the player confirmed in creation.
    if (slot === 'ready' || slot === 'incompatible' || slot === 'corrupt') await get().discardSave()
    get().startNewGame(profile)
  },

  startNewGame: (profile) => {
    runtime.newGame(undefined, profile)
    enterSession(set)
    if (runtime.map.containers.some((c) => c.id === 'c-1_-1/safehouse/closet')) {
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
  toggleVisionDebug: () => set((s) => ({ visionDebug: !s.visionDebug })),
  toggleLightingDebug: () => set((s) => ({ lightingDebug: !s.lightingDebug })),
  togglePerfHud: () => set((s) => ({ perfHud: !s.perfHud })),
}))
