import type { FurnitureId } from './furniture/catalog'

/**
 * G3b (graphics plan §7, variants): one layout, three states of the same house. A prefab lists the
 * variants it offers (`visual.variants`); an instance names one (`visual.variantId`) or gets one from
 * a stable seed of its instance ID and the prefab's content version (never per load). A variant only
 * changes looks: the palette of the building's pieces, which decor objects appear (a decor object
 * may list the variants it belongs to) and the default look of some furniture. Colliders, nav, loot
 * and saves never depend on it. Pure data (validator, resolver, renderer, editor).
 */

export const VARIANT_IDS = ['intact', 'lived-in', 'abandoned'] as const
export type VariantId = (typeof VARIANT_IDS)[number]

export interface VariantInfo {
  label: string
  /** Colour change of the building's own pieces: saturation factor, lightness shift, grime mix. */
  palette: { saturation: number; lightness: number; grime: number }
  /** Furniture variant used when the object names none (`FURNITURE_VARIANTS`). */
  furniture: Partial<Record<FurnitureId, string>>
}

export const VARIANTS: Record<VariantId, VariantInfo> = {
  intact: { label: 'Nguyên vẹn', palette: { saturation: 1.05, lightness: 0.03, grime: 0 }, furniture: {} },
  'lived-in': { label: 'Đang có người ở', palette: { saturation: 1, lightness: 0, grime: 0 }, furniture: {} },
  abandoned: {
    label: 'Bỏ hoang',
    palette: { saturation: 0.72, lightness: -0.06, grime: 0.14 },
    furniture: { 'furniture/bed': 'unmade', 'furniture/bookshelf': 'sparse', 'furniture/shelving': 'sparse' },
  },
}

/** Dust and dirt the grime mixes in. */
const GRIME = [0.42, 0.38, 0.31]

export function isVariantId(v: unknown): v is VariantId {
  return typeof v === 'string' && (VARIANT_IDS as readonly string[]).includes(v)
}

/** FNV-1a, 32 bit: the same text always gives the same number, on every machine. */
export function stableHash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/**
 * The variant of an instance: its own when the prefab offers it, else one of the prefab's picked by
 * `instanceId@contentVersion` (stable until the prefab's content changes). None when the prefab
 * offers none.
 */
export function resolveVariant(offered: readonly string[] | undefined, chosen: string | undefined, instanceId: string, contentVersion: number): VariantId | undefined {
  const list = (offered ?? []).filter(isVariantId)
  if (list.length === 0) return undefined
  if (chosen && (list as string[]).includes(chosen)) return chosen as VariantId
  return list[stableHash(`${instanceId}@${contentVersion}`) % list.length]
}

/** A colour as it looks in a variant (hex in, hex out; the lived-in look is the content colour). */
export function variantColor(hex: string, variant: VariantId | undefined): string {
  if (!variant) return hex
  const { saturation, lightness, grime } = VARIANTS[variant].palette
  if (saturation === 1 && lightness === 0 && grime === 0) return hex
  const n = parseInt(hex.replace('#', ''), 16)
  let rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255)
  const grey = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
  rgb = rgb.map((v, i) => {
    const s = grey + (v - grey) * saturation
    const g = s + (GRIME[i] - s) * grime
    return Math.min(1, Math.max(0, g + lightness))
  })
  return `#${rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`
}
