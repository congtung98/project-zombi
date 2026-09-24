import { create } from 'zustand'
import type { GameRuntime } from '../game/core/runtime'
import { countUsedSlots } from '../game/systems/inventory'
import { equippedWeapon } from '../game/systems/equipment'
import { conditionLevel, type ConditionLevel } from '../game/systems/weapons'
import { getItemDef } from '../game/entities/items'
import type { EntityId, ZombieAIState } from '../types'

export interface ZombieHudInfo {
  id: EntityId
  ai: ZombieAIState
  health: number
  distance: number
  /** F3 debug (P2-S5): zone, memory age/source, door being bashed. */
  zone: string | null
  memory: string | null
  door: string | null
}

export interface HudWeapon {
  name: string
  icon: string
  condition: number
  maxCondition: number
  level: ConditionLevel
}

export type ToastTone = 'info' | 'warn' | 'danger'

/** Progress of the running craft/repair (simulation time, so it stops while paused). */
export interface HudAction {
  label: string
  progress: number
  remaining: number
}

interface HudSnapshot {
  playerName: string
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
  /** F3: footstep noise radius and seconds to the next horde migration. */
  noise: number
  hordeTimer: number
  /** Nội dung prompt tương tác, ví dụ "Mở Cửa nhà an toàn". */
  interactPrompt: string | null
  kills: number
  /** Cooldown gậy còn lại (giây), để HUD báo sẵn sàng. */
  attackCooldown: number
  pushCooldown: number
  /** Số ô túi đang dùng / tổng, hiện cạnh phím I. */
  bagUsed: number
  bagSize: number
  inventoryOpen: boolean
  /** Vũ khí đang cầm (null = tay không), đọc từ instance trong túi. */
  weapon: HudWeapon | null
  action: HudAction | null
}

interface HudState extends HudSnapshot {
  toast: string | null
  toastTone: ToastTone
  /** Tăng mỗi lần người chơi trúng đòn; HUD dùng làm key để chạy lại hiệu ứng lóe đỏ. */
  damageFlash: number
  /** Chụp snapshot từ runtime theo nhịp chậm (không phải mỗi frame). */
  sync: (rt: GameRuntime, fps: number) => void
  showToast: (text: string, durationMs?: number, tone?: ToastTone) => void
  flashDamage: () => void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useHudStore = create<HudState>((set) => ({
  playerName: '',
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
  noise: 0,
  hordeTimer: 0,
  interactPrompt: null,
  kills: 0,
  attackCooldown: 0,
  pushCooldown: 0,
  bagUsed: 0,
  bagSize: 12,
  inventoryOpen: false,
  weapon: null,
  action: null,
  toast: null,
  toastTone: 'info',
  damageFlash: 0,

  sync: (rt, fps) => {
    const p = rt.player
    const cfg = rt.config.player
    const w = equippedWeapon(p.inventory, p.equipment)
    const def = w ? getItemDef(w.itemId) : null
    const zombies: ZombieHudInfo[] = []
    for (const z of rt.zombies.values()) {
      zombies.push({
        id: z.id,
        ai: z.ai,
        health: z.health,
        distance: Math.hypot(z.position.x - p.position.x, z.position.z - p.position.z),
        zone: z.zoneId,
        memory: z.lastKnownTarget ? `${z.memorySource === 'noise' ? 'nghe' : 'thấy'} ${z.memoryAge.toFixed(0)}s` : null,
        door: z.structureTargetId,
      })
    }
    set({
      playerName: p.name,
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
      noise: rt.playerNoise,
      hordeTimer: rt.hordeTimer,
      interactPrompt: rt.interactPrompt,
      kills: p.kills,
      attackCooldown: p.attackCooldown,
      pushCooldown: p.pushCooldown,
      bagUsed: countUsedSlots(p.inventory),
      bagSize: p.inventory.slots.length,
      inventoryOpen: rt.inventoryOpen,
      weapon: w && def
        ? { name: def.name, icon: def.icon, condition: w.condition, maxCondition: def.maxCondition!, level: conditionLevel(w.itemId, w.condition) }
        : null,
      action: rt.action
        ? { label: rt.action.label, progress: rt.action.elapsed / rt.action.duration, remaining: Math.max(0, rt.action.duration - rt.action.elapsed) }
        : null,
    })
  },

  flashDamage: () => set((s) => ({ damageFlash: s.damageFlash + 1 })),

  showToast: (text, durationMs = 2500, tone = 'info') => {
    if (toastTimer) clearTimeout(toastTimer)
    set({ toast: text, toastTone: tone })
    toastTimer = setTimeout(() => {
      toastTimer = null
      set({ toast: null })
    }, durationMs)
  },
}))
