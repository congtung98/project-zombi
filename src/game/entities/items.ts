/**
 * Định nghĩa vật phẩm: dữ liệu cố định, ID ổn định để lưu ở Sprint 5.
 * Theo kế hoạch MVP chỉ có nhu yếu phẩm (thức ăn, nước, y tế); không có
 * wood/scrap vì chưa có crafting nên mọi vật phẩm nhặt được đều dùng được.
 */
export type ItemId = 'canned_food' | 'chips' | 'water' | 'soda' | 'bandage' | 'medkit'

export type ItemKind = 'food' | 'drink' | 'medical'

/** Lượng hồi khi dùng; giá trị âm là tác dụng phụ (ví dụ đồ mặn làm khát). */
export interface ItemEffect {
  health?: number
  hunger?: number
  thirst?: number
  stamina?: number
}

export interface ItemDef {
  id: ItemId
  name: string
  kind: ItemKind
  stackLimit: number
  effect: ItemEffect
  /** Ký hiệu hiển thị trong ô inventory (không cần asset ngoài ở MVP). */
  icon: string
  description: string
}

export const ITEMS: Record<ItemId, ItemDef> = {
  canned_food: {
    id: 'canned_food',
    name: 'Đồ hộp',
    kind: 'food',
    stackLimit: 5,
    effect: { hunger: 35 },
    icon: '🥫',
    description: 'Hồi 35 đói.',
  },
  chips: {
    id: 'chips',
    name: 'Snack',
    kind: 'food',
    stackLimit: 5,
    effect: { hunger: 15, thirst: -5 },
    icon: '🍪',
    description: 'Hồi 15 đói, gây khát nhẹ.',
  },
  water: {
    id: 'water',
    name: 'Nước',
    kind: 'drink',
    stackLimit: 5,
    effect: { thirst: 40 },
    icon: '💧',
    description: 'Hồi 40 khát.',
  },
  soda: {
    id: 'soda',
    name: 'Nước ngọt',
    kind: 'drink',
    stackLimit: 5,
    effect: { thirst: 25, stamina: 20 },
    icon: '🥤',
    description: 'Hồi 25 khát và 20 thể lực.',
  },
  bandage: {
    id: 'bandage',
    name: 'Băng gạc',
    kind: 'medical',
    stackLimit: 3,
    effect: { health: 25 },
    icon: '🩹',
    description: 'Hồi 25 máu.',
  },
  medkit: {
    id: 'medkit',
    name: 'Hộp cứu thương',
    kind: 'medical',
    stackLimit: 1,
    effect: { health: 60 },
    icon: '🧰',
    description: 'Hồi 60 máu.',
  },
}

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[]

export function getItemDef(id: ItemId): ItemDef {
  return ITEMS[id]
}
