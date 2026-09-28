import { GAME_CONFIG } from '../core/config'

/**
 * Definitions describe a type; inventory-owned instances hold identity and mutable state.
 * Weapon stats live on the definition; condition lives only on the instance.
 */
export type ItemId =
  | 'canned_food' | 'chips' | 'water' | 'soda' | 'bandage' | 'medkit'
  | 'baseball_bat' | 'metal_pipe' | 'crowbar' | 'hammer' | 'wooden_club'
  | 'wood_plank' | 'scrap_metal' | 'duct_tape' | 'nails'
  | 'backpack'
  | 'unknown_item'

/** `unknown`: an item a save holds that this version does not know (INV-LOOT S5 recovery). */
export type ItemKind = 'food' | 'drink' | 'medical' | 'weapon' | 'tool' | 'material' | 'bag' | 'unknown'

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

/** Which repair recipe restores a weapon's condition (plan §7.2). */
export type RepairGroup = 'wood' | 'metal'

/**
 * INV-LOOT: small items move in batches (`batch` units per step of `seconds`); without it an item
 * moves one unit per step, timed from its weight (GAME_CONFIG.transfer).
 */
export interface TransferSpec {
  batch: number
  seconds: number
}

/** A wearable bag owns an inventory of its own (never another bag). */
export interface BagSpec {
  slots: number
}

export interface ItemDefinition {
  id: ItemId
  name: string
  kind: ItemKind
  stackLimit: number
  /** Weight of one unit (kg); shown and used for transfer time, never a carry limit (INV-LOOT §2.3). */
  weightKg: number
  transfer?: TransferSpec
  bag?: BagSpec
  effect: ItemEffect
  /** Ký hiệu hiển thị trong ô inventory (không cần asset ngoài ở MVP). */
  icon: string
  description: string
  maxCondition?: number
  maxFuel?: number
  melee?: MeleeStats
  toolTags?: readonly ToolTag[]
  repairGroup?: RepairGroup
}

export type ItemDef = ItemDefinition

/**
 * itemId references the definition; quantity is always 1 for individual equipment. `favorite` is
 * stored only when set; stacks merge only with stacks of the same item and the same favorite flag.
 * A bag's contents live in the bag inventory `bag:<id>` (WorldState.bags), never inside the instance.
 */
export type ItemInstance =
  | { id: string; itemId: ItemId; kind: 'stack'; quantity: number; favorite?: true }
  | { id: string; itemId: ItemId; kind: 'weapon'; quantity: 1; condition: number; favorite?: true }
  | { id: string; itemId: ItemId; kind: 'tool'; quantity: 1; fuel?: number; favorite?: true }
  | { id: string; itemId: ItemId; kind: 'bag'; quantity: 1; favorite?: true }
  | UnknownItemInstance

/**
 * The stored form of an item as a save wrote it (JSON), kept untouched when this version does not
 * know its `itemId`.
 */
export type SavedItemPayload = Readonly<Record<string, unknown>>

/**
 * INV-LOOT S5 (spec §11.3.7, T19): an item from a save whose definition this version does not have
 * (a removed item, a newer or edited save). It is kept, shown, moved and dropped like one whole
 * thing, never used, equipped, merged, split or put into a bag, and saved back exactly as it was
 * (`raw`, under its current ID and favorite flag), so a version that knows it gets it back.
 */
export interface UnknownItemInstance {
  id: string
  itemId: 'unknown_item'
  kind: 'unknown'
  quantity: 1
  favorite?: true
  raw: SavedItemPayload
}

/** References only (never copies): both instances live in the player's main inventory. */
export interface Equipment {
  weaponInstanceId: string | null
  /** INV-LOOT (save v10): the worn bag; its contents are usable while it is worn. */
  backInstanceId: string | null
}

const BAT = GAME_CONFIG.melee

export const ITEMS: Record<ItemId, ItemDef> = {
  // Bat = Phase 1 soak-balanced baseline (GAME_CONFIG.melee). Others scale from it by the
  // plan's relative cooldown/stamina, not its absolute numbers. Zombie HP 50: bat/pipe/crowbar
  // kill in 2 hits, hammer in 3; the heavier weapons trade speed/stamina for durability.
  baseball_bat: {
    id: 'baseball_bat', name: 'Gậy bóng chày', kind: 'weapon', stackLimit: 1, weightKg: 1.0, maxCondition: 80, effect: {}, icon: '🏏',
    melee: { damage: BAT.damage, range: BAT.range, cooldown: BAT.cooldown, stamina: BAT.stamina }, repairGroup: 'wood',
    description: 'Cân bằng, tầm xa nhất.',
  },
  metal_pipe: {
    id: 'metal_pipe', name: 'Ống sắt', kind: 'weapon', stackLimit: 1, weightKg: 1.5, maxCondition: 120, effect: {}, icon: '🔩',
    melee: { damage: 28, range: 1.8, cooldown: 1.2, stamina: 15 }, repairGroup: 'metal',
    description: 'Bền, chậm hơn và tốn thể lực hơn gậy.',
  },
  crowbar: {
    id: 'crowbar', name: 'Xà beng', kind: 'weapon', stackLimit: 1, weightKg: 2.0, maxCondition: 150, effect: {}, icon: '🪝',
    melee: { damage: 32, range: 1.8, cooldown: 1.25, stamina: 17 }, toolTags: ['pry'], repairGroup: 'metal',
    description: 'Hiếm, rất bền. Sau này dùng để tháo gia cố.',
  },
  hammer: {
    id: 'hammer', name: 'Búa', kind: 'weapon', stackLimit: 1, weightKg: 0.7, maxCondition: 100, effect: {}, icon: '🔨',
    melee: { damage: 18, range: 1.3, cooldown: 0.8, stamina: 10 }, toolTags: ['hammer'], repairGroup: 'metal',
    description: 'Dụng cụ chế tạo; đánh nhanh nhưng yếu và tầm ngắn.',
  },
  // P2-S4 crafted stopgap: plan 18 dmg / 1.7 m; cooldown 0.85 s and stamina 9 scaled by the same
  // bat ratio as S2 (1.0/0.8, 12/10). Low durability; zombie 50 HP takes 3 hits.
  wooden_club: {
    id: 'wooden_club', name: 'Gậy gỗ tự chế', kind: 'weapon', stackLimit: 1, weightKg: 1.0, maxCondition: 40, effect: {}, icon: '🏑',
    melee: { damage: 18, range: 1.7, cooldown: 1.05, stamina: 11 }, repairGroup: 'wood',
    description: 'Đồ tạm từ ván gỗ và băng keo; yếu và mau hỏng.',
  },
  // P2-S4 materials: stack by type, no direct use; consumed by recipes.
  wood_plank: {
    id: 'wood_plank', name: 'Ván gỗ', kind: 'material', stackLimit: 10, weightKg: 2.0, effect: {}, icon: '🪵',
    description: 'Sửa vũ khí gỗ, chế tạo gậy; sau này đóng barricade/xây.',
  },
  scrap_metal: {
    id: 'scrap_metal', name: 'Kim loại vụn', kind: 'material', stackLimit: 10, weightKg: 0.5, effect: {}, icon: '⚙️',
    description: 'Sửa vũ khí kim loại (ống sắt, xà beng, búa).',
  },
  duct_tape: {
    id: 'duct_tape', name: 'Băng keo', kind: 'material', stackLimit: 10, weightKg: 0.2, transfer: { batch: 5, seconds: 0.3 }, effect: {}, icon: '🧻',
    description: 'Cần cho mọi lần sửa vũ khí và chế tạo gậy gỗ.',
  },
  nails: {
    id: 'nails', name: 'Đinh', kind: 'material', stackLimit: 50, weightKg: 0.01, transfer: { batch: 10, seconds: 0.3 }, effect: {}, icon: '📌',
    description: 'Đếm từng chiếc; dùng để xây và đóng barricade (sprint sau).',
  },
  // INV-LOOT S5: stands in for any item a save holds that this version does not know (never looted,
  // crafted or saved under this ID: the save keeps the original payload).
  unknown_item: {
    id: 'unknown_item', name: 'Vật phẩm không xác định', kind: 'unknown', stackLimit: 1, weightKg: 0, effect: {}, icon: '❓',
    description: 'Món từ bản lưu mà phiên bản game này không nhận ra. Được giữ nguyên để phục hồi khi cập nhật; không dùng được.',
  },
  // INV-LOOT: the sample worn bag (8 slots of its own, no weight reduction, never inside a bag).
  backpack: {
    id: 'backpack', name: 'Balo', kind: 'bag', stackLimit: 1, weightKg: 0.8, bag: { slots: 8 }, effect: {}, icon: '🎒',
    description: 'Đeo lên lưng để có thêm 8 ô. Không giảm khối lượng đồ bên trong.',
  },
  canned_food: {
    id: 'canned_food',
    name: 'Đồ hộp',
    kind: 'food',
    stackLimit: 5, weightKg: 0.4,
    effect: { hunger: 35 },
    icon: '🥫',
    description: 'Hồi 35 đói.',
  },
  chips: {
    id: 'chips',
    name: 'Snack',
    kind: 'food',
    stackLimit: 5, weightKg: 0.15,
    effect: { hunger: 15, thirst: -5 },
    icon: '🍪',
    description: 'Hồi 15 đói, gây khát nhẹ.',
  },
  water: {
    id: 'water',
    name: 'Nước',
    kind: 'drink',
    stackLimit: 5, weightKg: 0.6,
    effect: { thirst: 40 },
    icon: '💧',
    description: 'Hồi 40 khát.',
  },
  soda: {
    id: 'soda',
    name: 'Nước ngọt',
    kind: 'drink',
    stackLimit: 5, weightKg: 0.35,
    effect: { thirst: 25, stamina: 20 },
    icon: '🥤',
    description: 'Hồi 25 khát và 20 thể lực.',
  },
  bandage: {
    id: 'bandage',
    name: 'Băng gạc',
    kind: 'medical',
    stackLimit: 3, weightKg: 0.05, transfer: { batch: 3, seconds: 0.25 },
    effect: { health: 25 },
    icon: '🩹',
    description: 'Hồi 25 máu.',
  },
  medkit: {
    id: 'medkit',
    name: 'Hộp cứu thương',
    kind: 'medical',
    stackLimit: 1, weightKg: 1.0,
    effect: { health: 60 },
    icon: '🧰',
    description: 'Hồi 60 máu.',
  },
}

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[]

export function getItemDef(id: ItemId): ItemDef {
  return ITEMS[id]
}
