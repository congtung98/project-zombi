import { GAME_CONFIG } from '../core/config'

/**
 * Definitions describe a type; inventory-owned instances hold identity and mutable state.
 * Weapon stats live on the definition; condition lives only on the instance.
 */
export type ItemId =
  | 'canned_food' | 'chips' | 'water' | 'soda' | 'bandage' | 'medkit'
  | 'baseball_bat' | 'metal_pipe' | 'crowbar' | 'hammer'

export type ItemKind = 'food' | 'drink' | 'medical' | 'weapon' | 'tool' | 'material'

/** Lượng hồi khi dùng; giá trị âm là tác dụng phụ (ví dụ đồ mặn làm khát). */
export interface ItemEffect {
  health?: number
  hunger?: number
  thirst?: number
  stamina?: number
}

/** Per-weapon swing stats; hit timing, arc and knockback are shared in GAME_CONFIG.melee. */
export interface MeleeStats {
  damage: number
  /** Reach measured to the target's edge, like Phase 1. */
  range: number
  /** Minimum time between two swing starts. */
  cooldown: number
  stamina: number
}

/** Tool capabilities for later recipes (S4/S6); a tool at condition 0 never satisfies them. */
export type ToolTag = 'hammer' | 'pry'

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
  melee?: MeleeStats
  toolTags?: readonly ToolTag[]
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

const BAT = GAME_CONFIG.melee

export const ITEMS: Record<ItemId, ItemDef> = {
  // Bat = Phase 1 soak-balanced baseline (GAME_CONFIG.melee). Others scale from it by the
  // plan's relative cooldown/stamina, not its absolute numbers. Zombie HP 50: bat/pipe/crowbar
  // kill in 2 hits, hammer in 3; the heavier weapons trade speed/stamina for durability.
  baseball_bat: {
    id: 'baseball_bat', name: 'Gậy bóng chày', kind: 'weapon', stackLimit: 1, maxCondition: 80, effect: {}, icon: '🏏',
    melee: { damage: BAT.damage, range: BAT.range, cooldown: BAT.cooldown, stamina: BAT.stamina },
    description: 'Cân bằng, tầm xa nhất.',
  },
  metal_pipe: {
    id: 'metal_pipe', name: 'Ống sắt', kind: 'weapon', stackLimit: 1, maxCondition: 120, effect: {}, icon: '🔩',
    melee: { damage: 28, range: 1.8, cooldown: 1.2, stamina: 15 },
    description: 'Bền, chậm hơn và tốn thể lực hơn gậy.',
  },
  crowbar: {
    id: 'crowbar', name: 'Xà beng', kind: 'weapon', stackLimit: 1, maxCondition: 150, effect: {}, icon: '🪝',
    melee: { damage: 32, range: 1.8, cooldown: 1.25, stamina: 17 }, toolTags: ['pry'],
    description: 'Hiếm, rất bền. Sau này dùng để tháo gia cố.',
  },
  hammer: {
    id: 'hammer', name: 'Búa', kind: 'weapon', stackLimit: 1, maxCondition: 100, effect: {}, icon: '🔨',
    melee: { damage: 18, range: 1.3, cooldown: 0.8, stamina: 10 }, toolTags: ['hammer'],
    description: 'Dụng cụ chế tạo; đánh nhanh nhưng yếu và tầm ngắn.',
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
