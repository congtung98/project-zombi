import { getItemDef, type ItemId, type ItemInstance } from '../entities/items'

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
  id: string
  nextItemId: number
  slots: (ItemInstance | null)[]
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

export function createInventory(size: number, id: string = crypto.randomUUID()): Inventory {
  return { id, nextItemId: 1, slots: Array.from({ length: size }, () => null) }
}

function nextId(inv: Inventory): string {
  return `${inv.id}:${inv.nextItemId++}`
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
  const def = getItemDef(itemId)
  const limit = def.stackLimit
  let left = Math.floor(quantity)

  for (const s of inv.slots) {
    if (left === 0) break
    if (!s || s.kind !== 'stack' || s.itemId !== itemId || s.quantity >= limit) continue
    const take = Math.min(limit - s.quantity, left)
    s.quantity += take
    left -= take
  }
  for (let i = 0; i < inv.slots.length && left > 0; i++) {
    if (inv.slots[i]) continue
    const take = Math.min(limit, left)
    const id = nextId(inv)
    inv.slots[i] = def.kind === 'weapon'
      ? { id, itemId, kind: 'weapon', quantity: 1, condition: def.maxCondition! }
      : def.kind === 'tool'
        ? { id, itemId, kind: 'tool', quantity: 1, ...(def.maxFuel === undefined ? {} : { fuel: def.maxFuel }) }
        : { id, itemId, kind: 'stack', quantity: take }
    left -= take
  }
  return { added: Math.floor(quantity) - left, remainder: left }
}

/** Bỏ tối đa `quantity` khỏi một ô; ô về 0 thì thành trống. Không bao giờ âm. */
export function removeFromSlot(inv: Inventory, slot: number, quantity: number): RemoveResult {
  const s = inv.slots[slot]
  if (!s || !Number.isFinite(quantity) || quantity <= 0) return { removed: 0 }
  const removed = Math.min(s.quantity, Math.floor(quantity))
  if (s.kind === 'stack') s.quantity -= removed
  if (removed === 1 && s.kind !== 'stack' || s.quantity <= 0) inv.slots[slot] = null
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
  if (from === to || (quantity !== undefined && !Number.isFinite(quantity))) return { moved: 0, remainder: s.quantity }
  const want = quantity === undefined ? s.quantity : Math.min(s.quantity, Math.max(0, Math.floor(quantity)))
  if (want <= 0) return { moved: 0, remainder: s.quantity }
  if (to.slots.some((item) => item?.id === s.id)) return { moved: 0, remainder: s.quantity }
  if (s.kind !== 'stack') {
    const empty = to.slots.indexOf(null)
    if (empty < 0) return { moved: 0, remainder: 1 }
    to.slots[empty] = s
    from.slots[slot] = null
    return { moved: 1, remainder: 0 }
  }
  let left = want
  for (const dest of to.slots) {
    if (!dest || dest.kind !== 'stack' || dest.itemId !== s.itemId) continue
    const n = Math.min(left, getItemDef(s.itemId).stackLimit - dest.quantity)
    dest.quantity += n
    left -= n
  }
  const empty = to.slots.indexOf(null)
  if (left > 0 && empty >= 0) {
    // A whole stack keeps its ID; splitting allocates a new ID in the destination.
    to.slots[empty] = { ...s, id: want === s.quantity ? s.id : nextId(to), quantity: left }
    left = 0
  }
  const moved = want - left
  removeFromSlot(from, slot, moved)
  return { moved, remainder: from.slots[slot]?.quantity ?? 0 }
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
  return { id: inv.id, nextItemId: inv.nextItemId, slots: inv.slots.map((s) => (s ? { ...s } : null)) }
}
