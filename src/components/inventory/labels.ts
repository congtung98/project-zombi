import { getItemDef, type ItemInstance, type ItemKind } from '../../game/entities/items'
import { recoveredItemId, recoveredQuantity } from '../../game/systems/recovery'
import type { TransferRefusal } from '../../game/systems/inventoryCommands'

/**
 * INV-LOOT: every label of the inventory/loot windows in one place (Vietnamese, owner decision D1).
 * Components never write their own strings, so wording stays consistent and can be translated later.
 */
export const L = {
  /** S5 recovery: an unknown item never goes into a bag (it may be a bag itself). */
  unknownNotInBag: 'Món không xác định không để vào túi được',
  inventory: 'Túi đồ',
  loot: 'Lục đồ',
  crafting: 'Chế tạo',
  main: 'Túi chính',
  worn: 'Balo đang đeo',
  pin: 'Ghim cửa sổ (giữ mở khi rời chuột)',
  unpin: 'Bỏ ghim (tự thu gọn một lúc sau khi rời chuột, hoặc khi bấm vào thế giới)',
  collapse: 'Thu gọn',
  expand: 'Mở rộng',
  close: 'Đóng',
  search: 'Tìm…',
  searchLabel: 'Tìm theo tên',
  allCategories: 'Tất cả',
  categoryFilter: 'Lọc theo loại',
  colName: 'Tên',
  colCategory: 'Loại',
  colQty: 'SL',
  colWeight: 'Kg',
  takeAll: 'Lấy hết',
  takeAllHint: 'Lấy mọi món trong tủ này, bỏ qua tìm kiếm và bộ lọc; món không vừa chỗ ở lại tủ.',
  takeSelected: 'Lấy đã chọn',
  storeSelected: 'Cất đã chọn',
  dropSelected: 'Bỏ xuống',
  empty: 'Trống',
  emptyInventory: 'Túi trống',
  noResults: 'Không có món nào khớp tìm kiếm/bộ lọc',
  noContainer: 'Chưa mở tủ nào. Đứng cạnh tủ và nhấn E.',
  slots: 'ô',
  kg: 'kg',
  overCapacity: 'Quá số ô (dữ liệu cũ): lấy ra được, không thêm ô mới',
  selected: (n: number) => `${n} đã chọn`,
  cancel: 'Hủy',
  cancelHint: 'Hủy thao tác (X hoặc Esc)',
  running: 'Đang làm',
  inReach: 'Trong tầm',
  outOfReach: 'Ngoài tầm — lại gần để lấy/cất',
  floor: 'Dưới đất',
  emptyFloor: 'Không có đồ dưới đất gần bạn',
  reset: 'Đặt lại bố cục',
  equippedWeapon: 'Đang cầm',
  wornBag: 'Đang đeo',
  favorite: 'Yêu thích',
  broken: 'Hỏng',
  reserved: 'Đang dùng',
  inspect: 'Chi tiết vật phẩm',
  expandGroup: 'Mở nhóm',
  collapseGroup: 'Gộp nhóm',
  perUnit: 'mỗi cái',
  condition: 'Độ bền',
  capacity: 'Sức chứa',
  contents: 'Đồ bên trong',
  repairWith: 'Sửa bằng',
  damage: 'Sát thương',
  range: 'Tầm',
  cooldown: 'Hồi',
  stamina: 'Thể lực',
  compactTabs: 'Chọn cửa sổ',
  queued: 'Chờ chuyển',
  waiting: 'Đang chờ',
  cancelAll: 'Hủy hết',
  cancelOne: 'Bỏ thao tác này khỏi hàng đợi',
  quantityTitle: 'Số lượng',
  quantityTo: 'Tới',
  quantityMax: 'Tối đa',
  confirm: 'Đồng ý',
  dragHint: (n: number) => (n > 1 ? `${n} món` : ''),
  progress: (done: number, total: number) => `${done}/${total}`,
} as const

export const CATEGORY_LABEL: Record<ItemKind, string> = {
  food: 'Đồ ăn',
  drink: 'Đồ uống',
  medical: 'Y tế',
  weapon: 'Vũ khí',
  tool: 'Dụng cụ',
  material: 'Vật liệu',
  bag: 'Túi',
  unknown: 'Không xác định',
}

/** Context menu entries (capability-based, see `itemActions.ts`). */
export const ACTION_LABEL = {
  equip: 'Trang bị',
  unequip: 'Bỏ trang bị',
  wear: 'Đeo balo',
  takeOff: 'Tháo balo',
  eat: 'Ăn',
  drink: 'Uống',
  use: 'Dùng',
  repair: 'Sửa',
  moveTo: (name: string) => `Chuyển vào ${name}`,
  take: (name: string) => `Lấy vào ${name}`,
  store: (name: string) => `Cất vào ${name}`,
  drop: 'Bỏ xuống đất',
  favorite: 'Đánh dấu yêu thích',
  unfavorite: 'Bỏ yêu thích',
  inspect: 'Xem chi tiết',
  quantity: 'Chọn số lượng…',
} as const

/** Why an action is disabled or an item did not move (shown in menus and summaries). */
export const REFUSAL_LABEL: Record<TransferRefusal | 'not-carried' | 'not-main' | 'no-effect' | 'repair' | 'dead', string> = {
  missing: 'Món không còn ở đó',
  'same-inventory': 'Đã ở đây',
  'invalid-quantity': 'Số lượng không hợp lệ',
  'bag-in-bag': 'Không để túi trong túi',
  full: 'Hết chỗ',
  equipped: 'Đang trang bị — tháo ra trước',
  favorite: 'Món yêu thích — bỏ yêu thích trước',
  reserved: 'Đang dùng cho thao tác khác',
  queued: 'Đã xếp hàng',
  'queue-full': 'Hàng đợi đã đầy',
  unreachable: 'Ngoài tầm',
  dead: 'Không thể lúc này',
  busy: 'Đang ra đòn',
  'not-carried': 'Lấy vào túi trước',
  'not-main': 'Chuyển vào túi chính trước',
  'no-effect': 'Chỉ số đã đầy',
  repair: 'Chưa sửa được',
}

/** One line for a batch: "Đã chuyển 5 · 2 món không chuyển: Hết chỗ (1), Đang trang bị — tháo ra trước (1)". */
export function summaryText(moved: number, skipped: readonly string[], verb = 'chuyển'): string {
  const head = moved > 0 ? `Đã ${verb} ${moved}` : `Không ${verb} được món nào`
  if (skipped.length === 0) return `${head}.`
  const counts = new Map<string, number>()
  for (const r of skipped) counts.set(r, (counts.get(r) ?? 0) + 1)
  const parts = [...counts].map(([r, n]) => `${REFUSAL_LABEL[r as keyof typeof REFUSAL_LABEL] ?? r} (${n})`)
  return `${head} · ${skipped.length} món không ${verb}: ${parts.join(', ')}.`
}

/** "+35 đói, -5 khát" from a definition's effect (only the stats it really changes). */
export function effectText(effect: { health?: number; hunger?: number; thirst?: number; stamina?: number }): string {
  const parts: string[] = []
  const fmt = (v: number | undefined, label: string) => v && parts.push(`${v > 0 ? '+' : ''}${v} ${label}`)
  fmt(effect.health, 'máu')
  fmt(effect.hunger, 'đói')
  fmt(effect.thirst, 'khát')
  fmt(effect.stamina, 'thể lực')
  return parts.join(', ')
}

/** Vietnamese-insensitive search key: lower case, no diacritics, đ → d. */
export function searchKey(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase()
}

/**
 * The name a row, card or drag preview shows for an instance: the definition's name, or for an
 * unknown item (S5 recovery) the ID it was saved with and the units its payload holds.
 */
export function itemName(item: ItemInstance): string {
  if (item.kind !== 'unknown') return getItemDef(item.itemId).name
  const q = recoveredQuantity(item)
  return `${getItemDef('unknown_item').name} (${recoveredItemId(item)}${q > 1 ? ` ×${q}` : ''})`
}
