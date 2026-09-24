import { getItemDef, type ItemId } from '../entities/items'

/** Một ô chứa: cùng `itemId` stack tới `stackLimit` của item. */
export interface ItemStack {
  itemId: ItemId
  quantity: number
}

/**
 * Inventory có số ô cố định; ô trống là `null`. Dùng chung cho túi người chơi
 * và container. Cấu trúc tuần tự hóa được (mảng object thuần) để lưu ở Sprint 5.
 */
export interface Inventory {
  slots: (ItemStack | null)[]
}

export interface AddResult {
  /** Số lượng đã vào inventory. */
  added: number
  /** Số lượng không có chỗ; người gọi phải giữ lại, không được làm mất. */
  remainder: number
}

export interface RemoveResult {
  /** Số lượng thực sự bỏ ra (≤ số yêu cầu, ≥ 0). */
  removed: number
}

export interface TransferResult {
  moved: number
  /** Còn lại ở nguồn vì đích hết chỗ. */
  remainder: number
}

export function createInventory(size: number): Inventory {
  return { slots: Array.from({ length: size }, () => null) }
}

export function countItem(inv: Inventory, itemId: ItemId): number {
  let n = 0
  for (const s of inv.slots) if (s && s.itemId === itemId) n += s.quantity
  return n
}

export function countUsedSlots(inv: Inventory): number {
  let n = 0
  for (const s of inv.slots) if (s) n += 1
  return n
}

export function isEmpty(inv: Inventory): boolean {
  return countUsedSlots(inv) === 0
}

/** Tổng số vật phẩm mọi loại; dùng để kiểm chứng "không mất, không nhân bản". */
export function totalQuantity(inv: Inventory): number {
  let n = 0
  for (const s of inv.slots) if (s) n += s.quantity
  return n
}

/**
 * Thêm `quantity` vật phẩm: lấp đầy các stack cùng loại trước, rồi tới ô trống.
 * Không bao giờ vượt `stackLimit`; phần không chứa được trả về trong `remainder`.
 */
export function addItem(inv: Inventory, itemId: ItemId, quantity: number): AddResult {
  if (!Number.isFinite(quantity) || quantity <= 0) return { added: 0, remainder: Math.max(0, quantity || 0) }
  const limit = getItemDef(itemId).stackLimit
  let left = Math.floor(quantity)

  for (const s of inv.slots) {
    if (left === 0) break
    if (!s || s.itemId !== itemId || s.quantity >= limit) continue
    const take = Math.min(limit - s.quantity, left)
    s.quantity += take
    left -= take
  }
  for (let i = 0; i < inv.slots.length && left > 0; i++) {
    if (inv.slots[i]) continue
    const take = Math.min(limit, left)
    inv.slots[i] = { itemId, quantity: take }
    left -= take
  }
  return { added: Math.floor(quantity) - left, remainder: left }
}

/** Bỏ tối đa `quantity` khỏi một ô; ô về 0 thì thành trống. Không bao giờ âm. */
export function removeFromSlot(inv: Inventory, slot: number, quantity: number): RemoveResult {
  const s = inv.slots[slot]
  if (!s || quantity <= 0) return { removed: 0 }
  const removed = Math.min(s.quantity, Math.floor(quantity))
  s.quantity -= removed
  if (s.quantity <= 0) inv.slots[slot] = null
  return { removed }
}

/** Bỏ tối đa `quantity` vật phẩm cùng loại từ mọi ô (ô cuối trước để giữ stack đầu gọn). */
export function removeItem(inv: Inventory, itemId: ItemId, quantity: number): RemoveResult {
  let left = Math.max(0, Math.floor(quantity))
  let removed = 0
  for (let i = inv.slots.length - 1; i >= 0 && left > 0; i--) {
    const s = inv.slots[i]
    if (!s || s.itemId !== itemId) continue
    const r = removeFromSlot(inv, i, left)
    removed += r.removed
    left -= r.removed
  }
  return { removed }
}

/**
 * Chuyển vật phẩm từ ô `slot` của `from` sang `to`. Chỉ trừ ở nguồn đúng số
 * lượng đã vào đích, nên tổng số hai bên không đổi kể cả khi đích đầy.
 */
export function transferSlot(from: Inventory, slot: number, to: Inventory, quantity?: number): TransferResult {
  const s = from.slots[slot]
  if (!s) return { moved: 0, remainder: 0 }
  const want = quantity === undefined ? s.quantity : Math.min(s.quantity, Math.max(0, Math.floor(quantity)))
  if (want <= 0) return { moved: 0, remainder: s.quantity }
  const { added } = addItem(to, s.itemId, want)
  removeFromSlot(from, slot, added)
  return { moved: added, remainder: s.quantity }
}

/** Chuyển mọi thứ có thể từ `from` sang `to`; phần không vừa ở lại nguồn. */
export function transferAll(from: Inventory, to: Inventory): TransferResult {
  let moved = 0
  let remainder = 0
  for (let i = 0; i < from.slots.length; i++) {
    if (!from.slots[i]) continue
    const r = transferSlot(from, i, to)
    moved += r.moved
    remainder += r.remainder
  }
  return { moved, remainder }
}

/** Bản sao sâu (dùng cho snapshot UI, không cho view giữ tham chiếu vào simulation). */
export function cloneInventory(inv: Inventory): Inventory {
  return { slots: inv.slots.map((s) => (s ? { ...s } : null)) }
}
