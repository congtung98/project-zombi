import type { ActionStartFailure } from '../game/core/runtime'
import type { ActionCancelReason } from '../game/systems/timedAction'
import type { ActionFailure } from '../game/actions/types'

/** Short player-facing reasons, shared by the craft panel, repair card and toasts. */
export const ACTION_FAILURE_TEXT: Record<ActionStartFailure, string> = {
  'no-target': 'món này không còn trong túi',
  'not-repairable': 'món này không sửa được',
  'full-condition': 'độ bền đã đầy',
  'missing-input': 'thiếu nguyên liệu',
  'missing-tool': 'thiếu dụng cụ dùng được (dụng cụ hỏng không tính)',
  'no-space': 'túi không đủ chỗ cho thành phẩm (tính sau khi tiêu nguyên liệu)',
  busy: 'đang ra đòn',
  dead: 'không thể lúc này',
  'missing-carried': 'chưa đủ nguyên liệu đang mang (đồ đang chuyển chưa tính)',
  'already-queued': 'món này đã có trong hàng đợi',
  'queue-full': 'hàng đợi đã đầy',
  duplicate: 'đã gửi lệnh này',
}

export const ACTION_CANCEL_TEXT: Record<ActionCancelReason, string> = {
  moved: 'di chuyển',
  attacked: 'ra đòn',
  hit: 'bị trúng đòn',
  stance: 'vào thế chiến đấu',
  cancelled: 'bấm hủy',
  dead: 'đã chết',
  'target-damaged': 'mục tiêu bị zombie đánh',
  unreachable: 'tủ đã ngoài tầm',
}

/** The Action System's own reasons (AX1), for the rare failure that is not a recipe's. */
const ACTION_SYSTEM_FAILURE_TEXT: Record<ActionFailure, string> = {
  DUPLICATE: 'đã gửi lệnh này',
  QUEUE_FULL: 'hàng đợi đã đầy',
  TARGET_CHANGED: 'mục tiêu đã thay đổi',
  TARGET_GONE: 'không còn ở đó',
  OUT_OF_RANGE: 'quá xa, lại gần hơn',
  MISSING_ITEM: 'món không còn ở đó',
  RESERVED: 'đang dùng cho thao tác khác',
}

export function actionFailureText(reason: ActionStartFailure | ActionFailure): string {
  return reason in ACTION_FAILURE_TEXT ? ACTION_FAILURE_TEXT[reason as ActionStartFailure] : ACTION_SYSTEM_FAILURE_TEXT[reason as ActionFailure]
}
