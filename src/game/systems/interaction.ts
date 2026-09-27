import type { Vec3 } from '../../types'

/** `light` = a lamp's wall switch, `window` = its curtain (building lighting sprint). */
export type InteractableKind = 'door' | 'container' | 'light' | 'window'

export interface Interactable {
  id: string
  kind: InteractableKind
  name: string
  /** Tâm đối tượng trong thế giới. */
  position: Vec3
  /** Bán kính cộng thêm vào tầm tương tác (đối tượng to thì với từ xa hơn). */
  radius: number
}

/** Tầm tương tác tính từ tâm người chơi tới mép đối tượng. */
export const INTERACT_RANGE = 1

/** Trọng số ưu tiên đối tượng nằm theo hướng người chơi đang nhìn. */
const FACING_WEIGHT = 0.75

/**
 * A new best target must beat the current one by this much (score, ≈ metres) before the prompt moves:
 * two containers side by side never make it flicker while the player shifts between them.
 */
export const TARGET_STICKINESS = 0.25

export interface InteractSelectOptions {
  /**
   * CS1c: distance (m) from the cursor ray, taken at the object's height, to the object's centre, or
   * null when the pointer is off the canvas. An object under the cursor (within its radius) and in
   * reach wins over the proximity rule.
   */
  pointerDistance?: (item: Interactable) => number | null
  /** ID of the current target (kept unless another one is clearly better). */
  current?: string | null
}

/**
 * Chọn đối tượng tương tác: trong tầm (từ người chơi tới mép), không bị tường chắn (`isBlocked`,
 * raycast), cùng tầng (lọc trước). Ưu tiên (CS1c): vật dưới con trỏ; không có thì gần nhất, ưu
 * tiên vật trước mặt, và giữ mục tiêu hiện tại nếu vật khác không tốt hơn rõ rệt. Chỉ kiểm tra tia
 * cho vài ứng viên tốt nhất để tiết kiệm truy vấn.
 */
export function selectInteractable(
  playerPos: Vec3,
  facing: number,
  items: readonly Interactable[],
  isBlocked: (item: Interactable) => boolean = () => false,
  range = INTERACT_RANGE,
  options: InteractSelectOptions = {},
): Interactable | null {
  const fx = Math.sin(facing)
  const fz = Math.cos(facing)
  const candidates: { item: Interactable; score: number }[] = []
  const hovered: { item: Interactable; d: number }[] = []

  for (const item of items) {
    const dx = item.position.x - playerPos.x
    const dz = item.position.z - playerPos.z
    const dist = Math.hypot(dx, dz)
    if (dist > range + item.radius) continue
    const dot = dist > 1e-4 ? (dx * fx + dz * fz) / dist : 1
    candidates.push({ item, score: dist - FACING_WEIGHT * dot })
    const d = options.pointerDistance?.(item)
    if (d != null && d <= item.radius) hovered.push({ item, d })
  }

  const blocked = new Map<string, boolean>()
  const open = (item: Interactable) => {
    let b = blocked.get(item.id)
    if (b === undefined) {
      b = isBlocked(item)
      blocked.set(item.id, b)
    }
    return !b
  }

  hovered.sort((a, b) => a.d - b.d)
  for (let i = 0; i < Math.min(hovered.length, 2); i++) if (open(hovered[i].item)) return hovered[i].item

  candidates.sort((a, b) => a.score - b.score)
  const limit = Math.min(candidates.length, 3)
  let best: { item: Interactable; score: number } | null = null
  for (let i = 0; i < limit; i++) {
    if (open(candidates[i].item)) {
      best = candidates[i]
      break
    }
  }
  if (!best) return null
  const current = options.current ? candidates.find((c) => c.item.id === options.current) : undefined
  if (current && current !== best && current.score <= best.score + TARGET_STICKINESS && open(current.item)) return current.item
  return best.item
}
