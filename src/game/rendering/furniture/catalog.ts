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
  'furniture/workbench',
  'outdoor/car',
  'outdoor/fence',
  'outdoor/bin',
  'outdoor/mailbox',
  'outdoor/streetlight',
  // Prefab library P2–P5: pieces of the new places.
  'furniture/hospital-bed',
  'furniture/operating-table',
  'furniture/machine',
  'furniture/atm',
  'outdoor/tombstone',
  'outdoor/bench',
  'outdoor/slide',
  'outdoor/swing',
  'outdoor/sandbox',
  'outdoor/hoop',
  'outdoor/flagpole',
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
  'furniture/workbench': { label: 'Bàn thợ', deep: false },
  // G4: outdoor props (the car keeps its box collider; front = the bonnet).
  'outdoor/car': { label: 'Xe con', deep: true },
  'outdoor/fence': { label: 'Hàng rào gỗ', deep: false },
  'outdoor/bin': { label: 'Thùng rác có bánh', deep: false },
  'outdoor/mailbox': { label: 'Hộp thư', deep: false },
  // World generator WG5: a post-top streetlight, decorative (Q8: no light cast), inside its thin post box.
  'outdoor/streetlight': { label: 'Đèn đường', deep: false },
  'furniture/hospital-bed': { label: 'Giường bệnh', deep: true },
  'furniture/operating-table': { label: 'Bàn mổ', deep: false },
  'furniture/machine': { label: 'Máy công cụ', deep: false },
  'furniture/atm': { label: 'Cây ATM', deep: false },
  'outdoor/tombstone': { label: 'Bia mộ', deep: false },
  'outdoor/bench': { label: 'Ghế công viên', deep: false },
  'outdoor/slide': { label: 'Cầu trượt', deep: true },
  'outdoor/swing': { label: 'Xích đu', deep: false },
  'outdoor/sandbox': { label: 'Hố cát', deep: false },
  'outdoor/hoop': { label: 'Cột bóng rổ', deep: true },
  'outdoor/flagpole': { label: 'Cột cờ', deep: false },
}

/**
 * G3b: looks an asset offers (`visual.variantId`), the first being the default. A house variant may
 * pick another default (`variants.ts`: an abandoned house has unmade beds and emptied shelves).
 */
export const FURNITURE_VARIANTS: Partial<Record<FurnitureId, readonly string[]>> = {
  'furniture/bed': ['made', 'unmade'],
  'furniture/bookshelf': ['full', 'sparse'],
  'furniture/shelving': ['goods', 'tools', 'sparse'],
}

/** Editor labels of the furniture variants. */
export const FURNITURE_VARIANT_LABELS: Record<string, string> = {
  made: 'Gọn gàng',
  unmade: 'Bừa bộn',
  full: 'Đầy sách',
  sparse: 'Thưa, đã bị lấy bớt',
  goods: 'Hàng hóa',
  tools: 'Đồ nghề',
}

export function isFurnitureId(v: unknown): v is FurnitureId {
  return typeof v === 'string' && (FURNITURE_IDS as readonly string[]).includes(v)
}

/** Editor labels of the four facings. */
export const FACING_LABELS = ['Nam (+Z)', 'Đông (+X)', 'Bắc (−Z)', 'Tây (−X)'] as const
