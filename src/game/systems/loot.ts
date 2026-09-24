import type { ItemId } from '../entities/items'
import { addItem, createInventory, type Inventory, type ItemStack } from './inventory'

/** Một dòng loot: `null` itemId nghĩa là "không ra gì" (cho phép tủ trống một phần). */
export interface LootEntry {
  itemId: ItemId | null
  weight: number
  min: number
  max: number
}

export interface GuaranteedEntry {
  itemId: ItemId
  min: number
  max: number
}

/**
 * Bảng loot: `guaranteed` luôn có (đảm bảo khu khởi đầu đủ nhu yếu phẩm),
 * rồi quay `rolls` lần trong `pool` theo trọng số.
 */
export interface LootTable {
  id: string
  guaranteed: GuaranteedEntry[]
  rolls: number
  pool: LootEntry[]
}

export type Rng = () => number

/** mulberry32: PRNG nhỏ, xác định theo seed 32-bit. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Băm chuỗi (FNV-1a) trộn với seed ván để mỗi container có seed riêng, độc lập thứ tự mở. */
export function hashSeed(worldSeed: number, key: string): number {
  let h = (0x811c9dc5 ^ (worldSeed >>> 0)) >>> 0
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0
}

function randInt(rng: Rng, min: number, max: number): number {
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  return lo + Math.floor(rng() * (hi - lo + 1))
}

function pickWeighted(rng: Rng, pool: readonly LootEntry[]): LootEntry | null {
  let total = 0
  for (const e of pool) total += Math.max(0, e.weight)
  if (total <= 0) return null
  let r = rng() * total
  for (const e of pool) {
    r -= Math.max(0, e.weight)
    if (r < 0) return e
  }
  return pool[pool.length - 1]
}

/** Sinh danh sách stack từ bảng loot bằng RNG đã seed. Thuần, không phụ thuộc runtime. */
export function rollLoot(table: LootTable, rng: Rng): ItemStack[] {
  const out: ItemStack[] = []
  for (const g of table.guaranteed) {
    const q = randInt(rng, g.min, g.max)
    if (q > 0) out.push({ itemId: g.itemId, quantity: q })
  }
  for (let i = 0; i < table.rolls; i++) {
    const e = pickWeighted(rng, table.pool)
    if (!e || !e.itemId) continue
    const q = randInt(rng, e.min, e.max)
    if (q > 0) out.push({ itemId: e.itemId, quantity: q })
  }
  return out
}

/**
 * Sinh nội dung một container đúng một lần cho ván: seed = hash(seed ván, id container).
 * Kết quả được lưu vào `WorldState`; mở lại không gọi hàm này nữa.
 */
export function generateContainerLoot(table: LootTable | undefined, worldSeed: number, containerId: string, slots: number): Inventory {
  const inv = createInventory(slots)
  if (!table) return inv
  const rng = createRng(hashSeed(worldSeed, containerId))
  for (const stack of rollLoot(table, rng)) addItem(inv, stack.itemId, stack.quantity)
  return inv
}
