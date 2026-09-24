import type { LootTable } from '../systems/loot'

/**
 * Bảng loot đặt tay theo loại container (map data trỏ tới bằng `loot`).
 * Nguyên tắc cân bằng (kế hoạch §4): nhà an toàn luôn có đủ nhu yếu phẩm cho
 * lần khám phá đầu; cửa hàng là nguồn chính; nhà dân ít hơn nhưng có đồ y tế.
 */
export const LOOT_TABLES: Record<string, LootTable> = {
  'safehouse-cabinet': {
    id: 'safehouse-cabinet',
    guaranteed: [
      { itemId: 'water', min: 1, max: 1 },
      { itemId: 'canned_food', min: 1, max: 1 },
      { itemId: 'bandage', min: 1, max: 1 },
    ],
    rolls: 1,
    pool: [
      { itemId: 'chips', weight: 2, min: 1, max: 1 },
      { itemId: 'soda', weight: 1, min: 1, max: 1 },
      { itemId: null, weight: 1, min: 0, max: 0 },
    ],
  },
  'store-shelf': {
    id: 'store-shelf',
    guaranteed: [],
    rolls: 2,
    pool: [
      { itemId: 'canned_food', weight: 3, min: 1, max: 2 },
      { itemId: 'chips', weight: 3, min: 1, max: 2 },
      { itemId: 'water', weight: 2, min: 1, max: 2 },
      { itemId: 'soda', weight: 2, min: 1, max: 1 },
      { itemId: 'bandage', weight: 1, min: 1, max: 1 },
      { itemId: null, weight: 1, min: 0, max: 0 },
    ],
  },
  'store-fridge': {
    id: 'store-fridge',
    guaranteed: [{ itemId: 'water', min: 1, max: 2 }],
    rolls: 1,
    pool: [
      { itemId: 'soda', weight: 3, min: 1, max: 2 },
      { itemId: 'water', weight: 1, min: 1, max: 1 },
    ],
  },
  'house-wardrobe': {
    id: 'house-wardrobe',
    guaranteed: [],
    rolls: 2,
    pool: [
      { itemId: 'bandage', weight: 3, min: 1, max: 1 },
      { itemId: 'medkit', weight: 1, min: 1, max: 1 },
      { itemId: 'chips', weight: 1, min: 1, max: 1 },
      { itemId: null, weight: 2, min: 0, max: 0 },
    ],
  },
  'house-kitchen': {
    id: 'house-kitchen',
    guaranteed: [{ itemId: 'canned_food', min: 1, max: 2 }],
    rolls: 1,
    pool: [
      { itemId: 'water', weight: 2, min: 1, max: 1 },
      { itemId: 'chips', weight: 1, min: 1, max: 2 },
      { itemId: null, weight: 1, min: 0, max: 0 },
    ],
  },
}
