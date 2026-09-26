/**
 * G3b (graphics plan §7): the decor registry. A `decor` object of the map (prefab or chunk) names an
 * asset here and is drawn only: no collider, no nav blocker, no sight blocker, no interaction, no
 * saved state. Small things that tell a story (a cup left on the table, a packed bag by the door, an
 * oil stain in the garage). Pure data (validator, editor, tests); the parts are built in `assets.ts`.
 *
 * Convention (plan §7, loot that is not loot): anything the player can take shows the container
 * marker (a small yellow light, grey once opened) or is a dropped bag with its own marker. Decor never
 * has one, is never highlighted, and keeps muted colours, so a cup on a table never reads as an item.
 */

export const DECOR_IDS = [
  'decor/cup',
  'decor/plate',
  'decor/pot',
  'decor/cutting-board',
  'decor/food-boxes',
  'decor/cans',
  'decor/bottle',
  'decor/books',
  'decor/papers',
  'decor/clothes',
  'decor/rug',
  'decor/carton',
  'decor/duffel-bag',
  'decor/backpack',
  'decor/jerrycan',
  'decor/toolbox',
  'decor/tires',
  'decor/oil-stain',
] as const
export type DecorId = (typeof DECOR_IDS)[number]

export interface DecorInfo {
  label: string
  /** Footprint and height [x, y, z] at yaw 0 (editor picking and outlines; the parts fit inside). */
  size: readonly [number, number, number]
  /** Main colour when the content gives none. */
  color: string
  /** Lies flat on the floor (drawn just above the floor layers, never casts a shadow). */
  flat?: boolean
}

export const DECOR: Record<DecorId, DecorInfo> = {
  'decor/cup': { label: 'Cốc', size: [0.09, 0.1, 0.09], color: '#d8d2c4' },
  'decor/plate': { label: 'Đĩa', size: [0.24, 0.03, 0.24], color: '#e2ddd2' },
  'decor/pot': { label: 'Nồi', size: [0.38, 0.17, 0.26], color: '#5c6064' },
  'decor/cutting-board': { label: 'Thớt + bánh mì', size: [0.42, 0.09, 0.28], color: '#b58a5a' },
  'decor/food-boxes': { label: 'Hộp thực phẩm', size: [0.42, 0.28, 0.2], color: '#a4553c' },
  'decor/cans': { label: 'Lon đồ hộp', size: [0.22, 0.11, 0.1], color: '#8a8f93' },
  'decor/bottle': { label: 'Chai', size: [0.08, 0.28, 0.08], color: '#46604a' },
  'decor/books': { label: 'Chồng sách', size: [0.3, 0.13, 0.23], color: '#6b4a3a' },
  'decor/papers': { label: 'Giấy tờ vương vãi', size: [0.9, 0.012, 0.8], color: '#dcd6c6', flat: true },
  'decor/clothes': { label: 'Đống quần áo', size: [0.55, 0.09, 0.42], color: '#56627a' },
  'decor/rug': { label: 'Thảm', size: [2, 0.012, 1.4], color: '#7a4f45', flat: true },
  'decor/carton': { label: 'Thùng các-tông', size: [0.46, 0.37, 0.36], color: '#a27b50' },
  'decor/duffel-bag': { label: 'Túi du lịch', size: [0.62, 0.3, 0.32], color: '#44503f' },
  'decor/backpack': { label: 'Ba lô', size: [0.32, 0.44, 0.22], color: '#6b3b2e' },
  'decor/jerrycan': { label: 'Can xăng', size: [0.2, 0.36, 0.32], color: '#9a2f25' },
  'decor/toolbox': { label: 'Hộp đồ nghề', size: [0.46, 0.22, 0.22], color: '#a3322a' },
  'decor/tires': { label: 'Chồng lốp xe', size: [0.64, 0.42, 0.64], color: '#2b2a29' },
  'decor/oil-stain': { label: 'Vệt dầu', size: [1.1, 0.004, 0.8], color: '#4a4540', flat: true },
}

export function isDecorId(v: unknown): v is DecorId {
  return typeof v === 'string' && (DECOR_IDS as readonly string[]).includes(v)
}

/** Footprint [x, z] of a decor object turned `yawDegrees` (editor picking and outlines); unknown assets: 0.3 m. */
export function decorFootprint(assetId: string, yawDegrees = 0): [number, number] {
  const [w, , d] = isDecorId(assetId) ? DECOR[assetId].size : [0.3, 0.3, 0.3]
  const a = (yawDegrees * Math.PI) / 180
  const c = Math.abs(Math.cos(a))
  const s = Math.abs(Math.sin(a))
  const r = (v: number) => Math.round(v * 1e4) / 1e4
  return [r(c * w + s * d), r(s * w + c * d)]
}
