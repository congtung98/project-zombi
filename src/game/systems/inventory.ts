import { getItemDef, type ItemId, type ItemInstance } from '../entities/items'

/** Một ô chứa: cùng `itemId` stack tới `stackLimit` của item. */
export interface ItemStack {
  itemId: ItemId
  quantity: number
}

/**
 * INV-LOOT (save v10): `player` = the main inventory, `container` = a map container, `drop` = a
 * dropped bag on the ground (before v11), `bag` = the contents of a wearable bag (`bag:<instance id>`),
 * `floor` = one 1 m cell of items on the ground (v11, no slot limit, items never merge there).
 */
export type InventoryKind = 'player' | 'container' | 'drop' | 'bag' | 'floor'

/**
 * An inventory is a list of instances with a slot limit: one real stack or one individual item
 * takes one slot (`items.length` slots are used). `slotCapacity` null = unlimited (Floor, later).
 * The list may exceed the limit only for data kept from an older save (overcapacity): operations
 * never add a slot then, but merging into a stack with room is still allowed.
 * Each instance lives in exactly one inventory; there is no second copy or registry.
 */
export interface Inventory {
  id: string
  kind: InventoryKind
  nextItemId: number
  items: ItemInstance[]
  slotCapacity: number | null
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

/** Why nothing (or not everything) could move. */
export type TransferBlock = 'missing' | 'same-inventory' | 'invalid-quantity' | 'bag-in-bag' | 'full'

export interface TransferResult {
  moved: number
  /** Còn lại ở nguồn (0 khi instance đã đi hết). */
  remainder: number
  /** Reason for the part that did not move; null when everything asked for moved. */
  reason: TransferBlock | null
}

export function createInventory(slotCapacity: number | null, id: string = crypto.randomUUID(), kind: InventoryKind = 'container'): Inventory {
  return { id, kind, nextItemId: 1, items: [], slotCapacity }
}

function nextId(inv: Inventory): string {
  return `${inv.id}:${inv.nextItemId++}`
}

export function findItem(inv: Inventory, instanceId: string): ItemInstance | undefined {
  return inv.items.find((i) => i.id === instanceId)
}

export function countItem(inv: Inventory, itemId: ItemId): number {
  let n = 0
  for (const s of inv.items) if (s.itemId === itemId) n += s.quantity
  return n
}

export function countUsedSlots(inv: Inventory): number {
  return inv.items.length
}

/** Slots still free; Infinity when the inventory has no limit, 0 when over capacity. */
export function freeSlots(inv: Inventory): number {
  return inv.slotCapacity === null ? Infinity : Math.max(0, inv.slotCapacity - inv.items.length)
}

export function isOvercapacity(inv: Inventory): boolean {
  return inv.slotCapacity !== null && inv.items.length > inv.slotCapacity
}

export function isEmpty(inv: Inventory): boolean {
  return inv.items.length === 0
}

/** Tổng số vật phẩm mọi loại; dùng để kiểm chứng "không mất, không nhân bản". */
export function totalQuantity(inv: Inventory): number {
  let n = 0
  for (const s of inv.items) n += s.quantity
  return n
}

/**
 * Two instances may merge only when they are stacks of the same item with the same favorite flag;
 * weapons, tools and bags carry state (condition, fuel, contents) and never merge.
 */
export function canStack(a: ItemInstance, b: ItemInstance): boolean {
  return a.kind === 'stack' && b.kind === 'stack' && a.itemId === b.itemId && !!a.favorite === !!b.favorite
}

/** Bags never go into a bag (no nesting, no ownership cycle). */
export function accepts(inv: Inventory, itemId: ItemId): boolean {
  return !(inv.kind === 'bag' && getItemDef(itemId).kind === 'bag')
}

/** Initial state for new individual items; omitted condition means a new (full) weapon. */
export interface ItemInit {
  condition?: number
}

function createInstance(inv: Inventory, itemId: ItemId, quantity: number, init: ItemInit): ItemInstance {
  const def = getItemDef(itemId)
  const id = nextId(inv)
  if (def.kind === 'weapon') return { id, itemId, kind: 'weapon', quantity: 1, condition: Math.min(def.maxCondition!, Math.max(0, Math.round(init.condition ?? def.maxCondition!))) }
  if (def.kind === 'tool') return { id, itemId, kind: 'tool', quantity: 1, ...(def.maxFuel === undefined ? {} : { fuel: def.maxFuel }) }
  if (def.kind === 'bag') return { id, itemId, kind: 'bag', quantity: 1 }
  return { id, itemId, kind: 'stack', quantity }
}

/**
 * Thêm `quantity` vật phẩm mới: lấp đầy các stack cùng loại (không favorite) trước, rồi thêm
 * stack/món mới khi còn ô. Không bao giờ vượt `stackLimit` hay số ô; phần dư trả về `remainder`.
 * A new bag instance needs its contents inventory created by the caller (`bags.ts`).
 */
export function addItem(inv: Inventory, itemId: ItemId, quantity: number, init: ItemInit = {}): AddResult {
  if (!Number.isFinite(quantity) || quantity <= 0) return { added: 0, remainder: Math.max(0, quantity || 0) }
  const total = Math.floor(quantity)
  if (!accepts(inv, itemId)) return { added: 0, remainder: total }
  const limit = getItemDef(itemId).stackLimit
  let left = total
  for (const s of inv.items) {
    if (left === 0) break
    if (s.kind !== 'stack' || s.itemId !== itemId || s.favorite || s.quantity >= limit) continue
    const take = Math.min(limit - s.quantity, left)
    s.quantity += take
    left -= take
  }
  while (left > 0 && freeSlots(inv) > 0) {
    const item = createInstance(inv, itemId, Math.min(limit, left), init)
    inv.items.push(item)
    left -= item.quantity
  }
  return { added: total - left, remainder: left }
}

/** Bỏ tối đa `quantity` khỏi một instance; về 0 thì instance rời inventory. Không bao giờ âm. */
export function removeQuantity(inv: Inventory, instanceId: string, quantity: number): RemoveResult {
  const index = inv.items.findIndex((i) => i.id === instanceId)
  if (index < 0 || !Number.isFinite(quantity) || quantity <= 0) return { removed: 0 }
  const s = inv.items[index]
  const removed = Math.min(s.quantity, Math.floor(quantity))
  if (removed <= 0) return { removed: 0 }
  if (s.kind === 'stack' && removed < s.quantity) s.quantity -= removed
  else inv.items.splice(index, 1)
  return { removed }
}

/** Bỏ tối đa `quantity` vật phẩm cùng loại (instance cuối trước để giữ stack đầu gọn). */
export function removeItem(inv: Inventory, itemId: ItemId, quantity: number): RemoveResult {
  let left = Math.max(0, Math.floor(quantity))
  let removed = 0
  for (let i = inv.items.length - 1; i >= 0 && left > 0; i--) {
    const s = inv.items[i]
    if (s.itemId !== itemId) continue
    const r = removeQuantity(inv, s.id, left)
    removed += r.removed
    left -= r.removed
  }
  return { removed }
}

/**
 * Units of `item` that `inv` can take right now: room in compatible stacks first, then free slots.
 * Individual items need one free slot each.
 */
export function roomFor(inv: Inventory, item: ItemInstance): number {
  if (!accepts(inv, item.itemId)) return 0
  if (item.kind !== 'stack') return freeSlots(inv) > 0 ? 1 : 0
  const limit = getItemDef(item.itemId).stackLimit
  let room = 0
  for (const s of inv.items) if (s !== item && canStack(s, item)) room += Math.max(0, limit - s.quantity)
  const free = freeSlots(inv)
  return free === Infinity ? Infinity : room + free * limit
}

export interface TransferPreview {
  /** Units that would move (≤ the request). */
  quantity: number
  /** Why the rest would not; null when all of it fits. */
  reason: TransferBlock | null
}

/** What `transferItem` would do, without changing anything. */
export function previewTransfer(from: Inventory, instanceId: string, to: Inventory, quantity?: number): TransferPreview {
  const s = findItem(from, instanceId)
  if (!s) return { quantity: 0, reason: 'missing' }
  if (from === to || from.id === to.id) return { quantity: 0, reason: 'same-inventory' }
  if (quantity !== undefined && (!Number.isFinite(quantity) || Math.floor(quantity) <= 0)) return { quantity: 0, reason: 'invalid-quantity' }
  const want = quantity === undefined ? s.quantity : Math.min(s.quantity, Math.floor(quantity))
  if (!accepts(to, s.itemId)) return { quantity: 0, reason: 'bag-in-bag' }
  const fits = Math.min(want, roomFor(to, s))
  return { quantity: fits, reason: fits < want ? 'full' : null }
}

/**
 * Chuyển tối đa `quantity` (mặc định cả instance) từ `from` sang `to`. Chỉ trừ ở nguồn đúng số đã
 * vào đích, nên tổng hai bên không đổi kể cả khi đích đầy. Stack gộp vào stack tương thích trước;
 * chuyển trọn một instance (không gộp hết) thì giữ ID, tách một phần thì phần mới có ID mới ở đích.
 */
export function transferItem(from: Inventory, instanceId: string, to: Inventory, quantity?: number): TransferResult {
  const preview = previewTransfer(from, instanceId, to, quantity)
  const s = findItem(from, instanceId)
  if (!s) return { moved: 0, remainder: 0, reason: 'missing' }
  if (preview.quantity <= 0) return { moved: 0, remainder: s.quantity, reason: preview.reason }
  if (s.kind !== 'stack') {
    from.items.splice(from.items.indexOf(s), 1)
    to.items.push(s)
    return { moved: 1, remainder: 0, reason: null }
  }
  const whole = preview.quantity === s.quantity
  const limit = getItemDef(s.itemId).stackLimit
  let left = preview.quantity
  // On the floor every drop is its own pile where it fell (it keeps its own position).
  for (const dest of to.kind === 'floor' ? [] : to.items) {
    if (left === 0) break
    if (!canStack(dest, s)) continue
    const n = Math.min(left, limit - dest.quantity)
    if (n <= 0) continue
    dest.quantity += n
    left -= n
  }
  if (left > 0) {
    // A whole stack keeps its ID; splitting allocates a new ID in the destination.
    to.items.push({ ...s, id: whole ? s.id : nextId(to), quantity: left })
  }
  removeQuantity(from, s.id, preview.quantity)
  return { moved: preview.quantity, remainder: findItem(from, s.id)?.quantity ?? 0, reason: preview.reason }
}

/** Chuyển mọi thứ có thể từ `from` sang `to`; phần không vừa ở lại nguồn. */
export function transferAll(from: Inventory, to: Inventory): TransferResult {
  let moved = 0
  let remainder = 0
  let reason: TransferBlock | null = null
  for (const id of from.items.map((i) => i.id)) {
    const r = transferItem(from, id, to)
    moved += r.moved
    remainder += r.remainder
    reason ??= r.reason
  }
  return { moved, remainder, reason }
}

/** Bản sao sâu (dùng cho snapshot UI/save, không cho view giữ tham chiếu vào simulation). */
export function cloneInventory(inv: Inventory): Inventory {
  return { id: inv.id, kind: inv.kind, nextItemId: inv.nextItemId, items: inv.items.map((s) => ({ ...s })), slotCapacity: inv.slotCapacity }
}

/** Grid view for the slot UI: the items, then empty cells up to the capacity (never fewer cells than items). */
export function slotView(inv: Inventory): (ItemInstance | null)[] {
  const cells = Math.max(inv.items.length, inv.slotCapacity ?? inv.items.length)
  return Array.from({ length: cells }, (_, i) => inv.items[i] ?? null)
}
