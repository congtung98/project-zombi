/**
 * Character appearance is cosmetic only: every preset shares one rig, collider, speed and stats.
 * Saves store option IDs (never meshes, textures or colors), so palettes can be retuned later.
 */
export const BODY_PRESETS = ['balanced', 'sturdy', 'slim'] as const
export const HAIR_STYLES = ['short', 'long', 'mohawk'] as const
export const SKIN_TONES = ['light', 'tan', 'brown', 'dark'] as const
export const SHIRT_COLORS = ['blue', 'red', 'green', 'grey'] as const
export const PANTS_COLORS = ['denim', 'khaki', 'black', 'olive'] as const

export type BodyPreset = (typeof BODY_PRESETS)[number]
export type HairStyle = (typeof HAIR_STYLES)[number]
export type SkinTone = (typeof SKIN_TONES)[number]
export type ShirtColor = (typeof SHIRT_COLORS)[number]
export type PantsColor = (typeof PANTS_COLORS)[number]

export interface CharacterAppearance {
  preset: BodyPreset
  hair: HairStyle
  skin: SkinTone
  shirt: ShirtColor
  pants: PantsColor
}

export const DEFAULT_APPEARANCE: CharacterAppearance = { preset: 'balanced', hair: 'short', skin: 'tan', shirt: 'blue', pants: 'denim' }
export const DEFAULT_PLAYER_NAME = 'Người sống sót'
export const MAX_NAME_LENGTH = 24

export const APPEARANCE_LABELS = {
  preset: { balanced: 'Cân đối', sturdy: 'Vạm vỡ', slim: 'Mảnh khảnh' },
  hair: { short: 'Tóc ngắn', long: 'Tóc dài', mohawk: 'Mohawk' },
  skin: { light: 'Sáng', tan: 'Rám', brown: 'Nâu', dark: 'Sẫm' },
  shirt: { blue: 'Xanh dương', red: 'Đỏ', green: 'Xanh lá', grey: 'Xám' },
  pants: { denim: 'Jean', khaki: 'Kaki', black: 'Đen', olive: 'Ô liu' },
} as const

export const SKIN_HEX: Record<SkinTone, string> = { light: '#f1c9a5', tan: '#d69f73', brown: '#9c6a45', dark: '#5e3b26' }
export const SHIRT_HEX: Record<ShirtColor, string> = { blue: '#3f6fb5', red: '#b5403a', green: '#4c8a4a', grey: '#7b8088' }
export const PANTS_HEX: Record<PantsColor, string> = { denim: '#34465f', khaki: '#a58e62', black: '#2a2a2e', olive: '#5a6138' }

/** Trim, NFC, at most 24 characters (code points); blank → default name. */
export function normalizeName(raw: string): string {
  const trimmed = raw.normalize('NFC').trim()
  const clipped = Array.from(trimmed).slice(0, MAX_NAME_LENGTH).join('').trim()
  return clipped || DEFAULT_PLAYER_NAME
}

export function isValidName(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && normalizeName(v) === v
}

export function isAppearance(v: unknown): v is CharacterAppearance {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const a = v as Record<string, unknown>
  return Object.keys(a).length === 5 &&
    (BODY_PRESETS as readonly unknown[]).includes(a.preset) &&
    (HAIR_STYLES as readonly unknown[]).includes(a.hair) &&
    (SKIN_TONES as readonly unknown[]).includes(a.skin) &&
    (SHIRT_COLORS as readonly unknown[]).includes(a.shirt) &&
    (PANTS_COLORS as readonly unknown[]).includes(a.pants)
}

export function randomAppearance(rng: () => number = Math.random): CharacterAppearance {
  const pick = <T>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(rng() * list.length))]
  return { preset: pick(BODY_PRESETS), hair: pick(HAIR_STYLES), skin: pick(SKIN_TONES), shirt: pick(SHIRT_COLORS), pants: pick(PANTS_COLORS) }
}
