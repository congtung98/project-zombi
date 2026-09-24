/**
 * Definitions describe a type; inventory-owned instances hold identity and mutable state.
 * S1 adds the legacy bat; new loot, weapon stats and wear arrive in P2-S2.
 */
export type ItemId = 'canned_food' | 'chips' | 'water' | 'soda' | 'bandage' | 'medkit' | 'baseball_bat'

export type ItemKind = 'food' | 'drink' | 'medical' | 'weapon' | 'tool' | 'material'

/** Lượng hồi khi dùng; giá trị âm là tác dụng phụ (ví dụ đồ mặn làm khát). */
export interface ItemEffect {
  health?: number
  hunger?: number
  thirst?: number
  stamina?: number
}

export interface ItemDefinition {
  id: ItemId
  name: string
  kind: ItemKind
  stackLimit: number
  effect: ItemEffect
  /** Ký hiệu hiển thị trong ô inventory (không cần asset ngoài ở MVP). */
  icon: string
  description: string
  maxCondition?: number
  maxFuel?: number
}

export type ItemDef = ItemDefinition

/** itemId references the definition; quantity is always 1 for individual equipment. */
export type ItemInstance =
  | { id: string; itemId: ItemId; kind: 'stack'; quantity: number }
  | { id: string; itemId: ItemId; kind: 'weapon'; quantity: 1; condition: number }
  | { id: string; itemId: ItemId; kind: 'tool'; quantity: 1; fuel?: number }

export interface Equipment {
  weaponInstanceId: string | null
}

export const ITEMS: Record<ItemId, ItemDef> = {
  baseball_bat: {
    id: 'baseball_bat', name: 'Gậy bóng chày', kind: 'weapon', stackLimit: 1,
    maxCondition: 80, effect: {}, icon: '🏏',
    description: 'Gậy Phase 1. Hao mòn và sát thương khi hỏng sẽ có ở Sprint P2-S2.',
  },
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
