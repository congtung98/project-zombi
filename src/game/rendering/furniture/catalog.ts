/**
 * G3a (graphics plan §7): the furniture registry. A prop or container of the map may name an asset
 * (`visual.assetId`); the renderer then draws the asset's parts inside the object's box instead of the
 * plain box. The box stays the collider, the nav and sight blocker and the interaction target: an asset
 * changes looks only, never IDs, loot, colliders or saves. Pure data (validator, editor, tests); the
 * parts are built in `assets.ts`.
 *
 * Every asset fills its box: it is sized from the box the content gives (a 2 m bed and a 1.4 m bed are
 * the same asset), so swapping an asset never changes what the player bumps into.
 */

export const FURNITURE_IDS = [
  'furniture/bed',
  'furniture/sofa',
  'furniture/table',
  'furniture/desk',
  'furniture/chair',
  'furniture/counter',
  'furniture/cabinet',
  'furniture/fridge',
  'furniture/wardrobe',
  'furniture/nightstand',
  'furniture/bookshelf',
  'furniture/shelving',
  'furniture/crate',
] as const
export type FurnitureId = (typeof FURNITURE_IDS)[number]

export interface FurnitureInfo {
  /** Editor label. */
  label: string
  /**
   * Front to back longer than side to side (a bed: head against the wall). Picks the facing when the
   * content leaves it out and two walls touch the box (`placement.autoFacing`).
   */
  deep: boolean
}

/**
 * Front: the side a person uses (doors of a wardrobe, the seat of a sofa, the foot of a bed). A
 * facing of q quarter turns puts the front towards `rotateXZ(0, 1, q)`: 0 south (+Z), 1 east (+X),
 * 2 north (−Z), 3 west (−X), like the inside of a window.
 */
export const FURNITURE: Record<FurnitureId, FurnitureInfo> = {
  'furniture/bed': { label: 'Giường', deep: true },
  'furniture/sofa': { label: 'Sofa / ghế bành', deep: false },
  'furniture/table': { label: 'Bàn', deep: false },
  'furniture/desk': { label: 'Bàn làm việc', deep: false },
  'furniture/chair': { label: 'Ghế tựa', deep: false },
  'furniture/counter': { label: 'Tủ bếp có mặt đá', deep: false },
  'furniture/cabinet': { label: 'Tủ thấp', deep: false },
  'furniture/fridge': { label: 'Tủ lạnh', deep: false },
  'furniture/wardrobe': { label: 'Tủ quần áo', deep: false },
  'furniture/nightstand': { label: 'Tủ đầu giường', deep: false },
  'furniture/bookshelf': { label: 'Kệ sách', deep: false },
  'furniture/shelving': { label: 'Kệ kho', deep: false },
  'furniture/crate': { label: 'Thùng gỗ', deep: false },
}

export function isFurnitureId(v: unknown): v is FurnitureId {
  return typeof v === 'string' && (FURNITURE_IDS as readonly string[]).includes(v)
}

/** Editor labels of the four facings. */
export const FACING_LABELS = ['Nam (+Z)', 'Đông (+X)', 'Bắc (−Z)', 'Tây (−X)'] as const
