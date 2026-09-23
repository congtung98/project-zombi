import { create } from 'zustand'
import { runtime } from '../game/core/runtime'
import { useWorldStore } from './worldStore'

export type Screen = 'menu' | 'playing' | 'paused' | 'gameover'

interface UiState {
  screen: Screen
  /** Đồng bộ với runtime.sessionId để remount scene khi bắt đầu ván mới. */
  sessionId: number
  debug: boolean
  startNewGame: () => void
  pause: () => void
  resume: () => void
  togglePause: () => void
  gameOver: () => void
  toMenu: () => void
  toggleDebug: () => void
}

export const useUiStore = create<UiState>((set, get) => ({
  screen: 'menu',
  sessionId: runtime.sessionId,
  debug: false,

  startNewGame: () => {
    runtime.newGame()
    useWorldStore.getState().reset()
    set({ screen: 'playing', sessionId: runtime.sessionId })
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
  },

  toMenu: () => {
    runtime.input.clear()
    set({ screen: 'menu' })
  },

  toggleDebug: () => set((s) => ({ debug: !s.debug })),
}))
