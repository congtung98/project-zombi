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
  // ---- P2-S2 melee loot. Phase 1 tables above are unchanged so their seeded rolls stay identical.
  'safehouse-closet': {
    id: 'safehouse-closet',
    // Guaranteed basic melee in the starting house: no seed leaves the player without a weapon.
    guaranteed: [{ oneOf: [{ itemId: 'baseball_bat', weight: 3 }, { itemId: 'metal_pipe', weight: 1 }], min: 1, max: 1, condition: [0.6, 1] }],
    rolls: 0,
    pool: [],
  },
  'house-nightstand': {
    id: 'house-nightstand',
    guaranteed: [],
    rolls: 2,
    pool: [
      { itemId: 'bandage', weight: 2, min: 1, max: 1 },
      { itemId: 'chips', weight: 2, min: 1, max: 1 },
      { itemId: 'baseball_bat', weight: 1, min: 1, max: 1, condition: [0.3, 0.9] },
      { itemId: null, weight: 2, min: 0, max: 0 },
    ],
  },
  'tool-shelf': {
    id: 'tool-shelf',
    // A hammer always exists on the near exploration route (crafting/barricade tool from S4/S6).
    guaranteed: [{ itemId: 'hammer', min: 1, max: 1, condition: [0.5, 1] }],
    rolls: 1,
    pool: [
      { itemId: 'metal_pipe', weight: 2, min: 1, max: 1, condition: [0.4, 1] },
      { itemId: 'crowbar', weight: 1, min: 1, max: 1, condition: [0.4, 1] },
      { itemId: null, weight: 3, min: 0, max: 0 },
    ],
  },
  'park-toolbox': {
    id: 'park-toolbox',
    guaranteed: [],
    rolls: 2,
    pool: [
      { itemId: 'metal_pipe', weight: 2, min: 1, max: 1, condition: [0.25, 0.8] },
      { itemId: 'crowbar', weight: 1, min: 1, max: 1, condition: [0.25, 0.8] },
      { itemId: 'hammer', weight: 1, min: 1, max: 1, condition: [0.25, 0.8] },
      { itemId: null, weight: 3, min: 0, max: 0 },
    ],
  },
  // ---- P2-S4 materials (new containers, save v5). Earlier tables stay unchanged so seeds reproduce.
  'safehouse-toolbox': {
    id: 'safehouse-toolbox',
    // Starter repair kit a few steps from spawn: enough for one repair of either group, not a club.
    guaranteed: [
      { itemId: 'wood_plank', min: 1, max: 1 },
      { itemId: 'duct_tape', min: 1, max: 1 },
      { itemId: 'scrap_metal', min: 1, max: 1 },
    ],
    rolls: 0,
    pool: [],
  },
  'hardware-shelf': {
    id: 'hardware-shelf',
    // Near exploration route (store): nails, wood and tape are always here; scrap metal often.
    guaranteed: [
      { itemId: 'nails', min: 6, max: 12 },
      { itemId: 'wood_plank', min: 1, max: 2 },
      { itemId: 'duct_tape', min: 1, max: 1 },
    ],
    rolls: 2,
    pool: [
      { itemId: 'scrap_metal', weight: 2, min: 1, max: 2 },
      { itemId: 'wood_plank', weight: 1, min: 1, max: 2 },
      { itemId: 'duct_tape', weight: 1, min: 1, max: 1 },
      { itemId: null, weight: 2, min: 0, max: 0 },
    ],
  },
  'scrap-pile': {
    id: 'scrap-pile',
    // Outdoors behind the house, near two zombie spawns: more materials for more risk.
    guaranteed: [{ itemId: 'scrap_metal', min: 1, max: 2 }],
    rolls: 3,
    pool: [
      { itemId: 'wood_plank', weight: 3, min: 1, max: 2 },
      { itemId: 'scrap_metal', weight: 2, min: 1, max: 1 },
      { itemId: 'duct_tape', weight: 1, min: 1, max: 1 },
      { itemId: 'nails', weight: 1, min: 4, max: 8 },
      { itemId: null, weight: 2, min: 0, max: 0 },
    ],
  },

  // ---- Prefab library P3–P5: one table per kind of place, made only of the existing items (owner
  // decision D5). A prefab names its place's table, so its loot can grow later without touching the
  // prefab. Earlier tables stay unchanged so their seeded rolls reproduce.
  'office-desk': {
    id: 'office-desk',
    guaranteed: [],
    rolls: 2,
    pool: [
      { itemId: 'chips', weight: 2, min: 1, max: 1 },
      { itemId: 'soda', weight: 2, min: 1, max: 1 },
      { itemId: 'duct_tape', weight: 1, min: 1, max: 1 },
      { itemId: 'bandage', weight: 1, min: 1, max: 1 },
      { itemId: null, weight: 4, min: 0, max: 0 },
    ],
  },
  'bank-vault': {
    id: 'bank-vault',
    // The vault keeps the branch's emergency stock (no money item exists).
    guaranteed: [{ itemId: 'water', min: 1, max: 2 }],
    rolls: 2,
    pool: [
      { itemId: 'canned_food', weight: 3, min: 1, max: 2 },
      { itemId: 'medkit', weight: 1, min: 1, max: 1 },
      { itemId: 'bandage', weight: 2, min: 1, max: 2 },
      { itemId: 'crowbar', weight: 1, min: 1, max: 1, condition: [0.5, 1] },
      { itemId: null, weight: 2, min: 0, max: 0 },
    ],
  },
  'bookstore-shelf': {
    id: 'bookstore-shelf',
    guaranteed: [],
    rolls: 1,
    pool: [
      { itemId: 'chips', weight: 1, min: 1, max: 1 },
      { itemId: 'water', weight: 1, min: 1, max: 1 },
      { itemId: 'duct_tape', weight: 1, min: 1, max: 1 },
      { itemId: null, weight: 6, min: 0, max: 0 },
    ],
  },
  'garage-shelf': {
    id: 'garage-shelf',
    guaranteed: [],
    rolls: 2,
    pool: [
      { itemId: 'scrap_metal', weight: 3, min: 1, max: 2 },
      { itemId: 'duct_tape', weight: 2, min: 1, max: 1 },
      { itemId: 'metal_pipe', weight: 1, min: 1, max: 1, condition: [0.3, 0.9] },
      { itemId: 'nails', weight: 1, min: 4, max: 10 },
      { itemId: null, weight: 2, min: 0, max: 0 },
    ],
  },
  'workshop-bench': {
    id: 'workshop-bench',
    guaranteed: [{ oneOf: [{ itemId: 'hammer', weight: 2 }, { itemId: 'crowbar', weight: 1 }, { itemId: 'metal_pipe', weight: 1 }], min: 1, max: 1, condition: [0.4, 1] }],
    rolls: 2,
    pool: [
      { itemId: 'scrap_metal', weight: 3, min: 1, max: 3 },
      { itemId: 'nails', weight: 2, min: 6, max: 14 },
      { itemId: 'duct_tape', weight: 1, min: 1, max: 1 },
      { itemId: null, weight: 1, min: 0, max: 0 },
    ],
  },
  'medical-cabinet': {
    id: 'medical-cabinet',
    guaranteed: [{ itemId: 'bandage', min: 1, max: 2 }],
    rolls: 2,
    pool: [
      { itemId: 'bandage', weight: 3, min: 1, max: 2 },
      { itemId: 'medkit', weight: 2, min: 1, max: 1 },
      { itemId: 'water', weight: 1, min: 1, max: 1 },
      { itemId: null, weight: 3, min: 0, max: 0 },
    ],
  },
  'pharmacy-shelf': {
    id: 'pharmacy-shelf',
    guaranteed: [],
    rolls: 3,
    pool: [
      { itemId: 'bandage', weight: 4, min: 1, max: 3 },
      { itemId: 'medkit', weight: 2, min: 1, max: 1 },
      { itemId: null, weight: 3, min: 0, max: 0 },
    ],
  },
  'police-armory': {
    id: 'police-armory',
    // Melee only (D5: no guns): batons are bats and pipes here.
    guaranteed: [{ oneOf: [{ itemId: 'baseball_bat', weight: 2 }, { itemId: 'metal_pipe', weight: 2 }, { itemId: 'crowbar', weight: 1 }], min: 1, max: 1, condition: [0.6, 1] }],
    rolls: 2,
    pool: [
      { itemId: 'bandage', weight: 2, min: 1, max: 2 },
      { itemId: 'medkit', weight: 1, min: 1, max: 1 },
      { itemId: 'duct_tape', weight: 1, min: 1, max: 1 },
      { itemId: null, weight: 2, min: 0, max: 0 },
    ],
  },
  locker: {
    id: 'locker',
    guaranteed: [],
    rolls: 1,
    pool: [
      { itemId: 'chips', weight: 2, min: 1, max: 1 },
      { itemId: 'soda', weight: 2, min: 1, max: 1 },
      { itemId: 'baseball_bat', weight: 1, min: 1, max: 1, condition: [0.3, 0.9] },
      { itemId: 'bandage', weight: 1, min: 1, max: 1 },
      { itemId: null, weight: 4, min: 0, max: 0 },
    ],
  },
  'canteen-fridge': {
    id: 'canteen-fridge',
    guaranteed: [],
    rolls: 2,
    pool: [
      { itemId: 'water', weight: 3, min: 1, max: 2 },
      { itemId: 'soda', weight: 2, min: 1, max: 2 },
      { itemId: 'canned_food', weight: 2, min: 1, max: 2 },
      { itemId: null, weight: 1, min: 0, max: 0 },
    ],
  },
  'kiosk-counter': {
    id: 'kiosk-counter',
    guaranteed: [],
    rolls: 2,
    pool: [
      { itemId: 'chips', weight: 3, min: 1, max: 2 },
      { itemId: 'soda', weight: 3, min: 1, max: 2 },
      { itemId: 'water', weight: 2, min: 1, max: 1 },
      { itemId: null, weight: 2, min: 0, max: 0 },
    ],
  },
}
