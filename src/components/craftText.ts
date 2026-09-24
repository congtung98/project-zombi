import type { ActionStartFailure } from '../game/core/runtime'
import type { ActionCancelReason } from '../game/systems/timedAction'

/** Short player-facing reasons, shared by the craft panel, repair card and toasts. */
export const ACTION_FAILURE_TEXT: Record<ActionStartFailure, string> = {
  'no-target': 'món này không còn trong túi',
  'not-repairable': 'món này không sửa được',
  'full-condition': 'độ bền đã đầy',
  'missing-input': 'thiếu nguyên liệu',
  'missing-tool': 'thiếu dụng cụ dùng được (dụng cụ hỏng không tính)',
  'no-space': 'túi không đủ chỗ cho thành phẩm (tính sau khi tiêu nguyên liệu)',
  busy: 'đang làm việc khác',
  dead: 'không thể lúc này',
}

export const ACTION_CANCEL_TEXT: Record<ActionCancelReason, string> = {
  moved: 'di chuyển',
  attacked: 'ra đòn',
  hit: 'bị trúng đòn',
  cancelled: 'bấm hủy',
  dead: 'đã chết',
  'target-damaged': 'mục tiêu bị zombie đánh',
}
