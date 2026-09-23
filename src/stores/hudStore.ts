import { create } from 'zustand'
import type { GameRuntime } from '../game/core/runtime'
import type { EntityId, ZombieAIState } from '../types'

export interface ZombieHudInfo {
  id: EntityId
  ai: ZombieAIState
  health: number
  distance: number
}

interface HudSnapshot {
  health: number
  maxHealth: number
  stamina: number
  maxStamina: number
  hunger: number
  maxHunger: number
  thirst: number
  maxThirst: number
  running: boolean
  timeLabel: string
  day: number
  isNight: boolean
  fps: number
  playerX: number
  playerZ: number
  zombies: ZombieHudInfo[]
  /** Nội dung prompt tương tác, ví dụ "Mở Cửa nhà an toàn". */
  interactPrompt: string | null
}

interface HudState extends HudSnapshot {
  toast: string | null
  /** Chụp snapshot từ runtime theo nhịp chậm (không phải mỗi frame). */
  sync: (rt: GameRuntime, fps: number) => void
  showToast: (text: string, durationMs?: number) => void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useHudStore = create<HudState>((set) => ({
  health: 100,
  maxHealth: 100,
  stamina: 100,
  maxStamina: 100,
  hunger: 100,
  maxHunger: 100,
  thirst: 100,
  maxThirst: 100,
  running: false,
  timeLabel: '07:00',
  day: 1,
  isNight: false,
  fps: 0,
  playerX: 0,
  playerZ: 0,
  zombies: [],
  interactPrompt: null,
  toast: null,

  sync: (rt, fps) => {
    const p = rt.player
    const cfg = rt.config.player
    const zombies: ZombieHudInfo[] = []
    for (const z of rt.zombies.values()) {
      zombies.push({
        id: z.id,
        ai: z.ai,
        health: z.health,
        distance: Math.hypot(z.position.x - p.position.x, z.position.z - p.position.z),
      })
    }
    set({
      health: p.health,
      maxHealth: cfg.maxHealth,
      stamina: p.stamina,
      maxStamina: cfg.maxStamina,
      hunger: p.hunger,
      maxHunger: cfg.maxHunger,
      thirst: p.thirst,
      maxThirst: cfg.maxThirst,
      running: p.isRunning,
      timeLabel: rt.clock.formatTime(),
      day: rt.clock.day,
      isNight: rt.clock.isNight,
      fps,
      playerX: p.position.x,
      playerZ: p.position.z,
      zombies,
      interactPrompt: rt.interactPrompt,
    })
  },

  showToast: (text, durationMs = 2500) => {
    if (toastTimer) clearTimeout(toastTimer)
    set({ toast: text })
    toastTimer = setTimeout(() => {
      toastTimer = null
      set({ toast: null })
    }, durationMs)
  },
}))
