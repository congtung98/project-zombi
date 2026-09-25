import { create } from 'zustand'
import { sfx } from '../game/audio/sfx'

export type ShadowQuality = 'off' | 'low' | 'high'

export interface Settings {
  volume: number
  muted: boolean
  shadows: ShadowQuality
  /** Giới hạn tỉ lệ pixel (1 = không dùng HiDPI) cho máy yếu. */
  maxPixelRatio: number
  showHints: boolean
  /** Darken the ground outside what the character can see (player vision mask). */
  visionMask: boolean
}

interface SettingsState extends Settings {
  set: (patch: Partial<Settings>) => void
  reset: () => void
}

const STORAGE_KEY = 'zombie-outbreak.settings.v1'

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.8,
  muted: false,
  shadows: 'high',
  maxPixelRatio: 1.5,
  showHints: true,
  visionMask: true,
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<Settings>
    return sanitize({ ...DEFAULT_SETTINGS, ...parsed })
  } catch {
    return DEFAULT_SETTINGS
  }
}

function sanitize(s: Settings): Settings {
  return {
    volume: Number.isFinite(s.volume) ? Math.min(1, Math.max(0, s.volume)) : DEFAULT_SETTINGS.volume,
    muted: !!s.muted,
    shadows: s.shadows === 'off' || s.shadows === 'low' || s.shadows === 'high' ? s.shadows : DEFAULT_SETTINGS.shadows,
    maxPixelRatio: s.maxPixelRatio === 1 || s.maxPixelRatio === 1.5 || s.maxPixelRatio === 2 ? s.maxPixelRatio : DEFAULT_SETTINGS.maxPixelRatio,
    showHints: s.showHints !== false,
    visionMask: s.visionMask !== false,
  }
}

function persist(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // localStorage bị chặn: chỉ mất persist, không chặn game.
  }
}

function applyAudio(s: Settings): void {
  sfx.setVolume(s.volume)
  sfx.setMuted(s.muted)
}

const initial = load()
applyAudio(initial)

/** Cài đặt người chơi, lưu trong localStorage (không phải save game). */
export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...initial,
  set: (patch) => {
    const next = sanitize({ ...pick(get()), ...patch })
    persist(next)
    applyAudio(next)
    set(next)
  },
  reset: () => {
    persist(DEFAULT_SETTINGS)
    applyAudio(DEFAULT_SETTINGS)
    set(DEFAULT_SETTINGS)
  },
}))

function pick(s: SettingsState): Settings {
  return { volume: s.volume, muted: s.muted, shadows: s.shadows, maxPixelRatio: s.maxPixelRatio, showHints: s.showHints, visionMask: s.visionMask }
}
