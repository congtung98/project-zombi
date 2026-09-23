import type { Vec3 } from '../../types'

export type InteractableKind = 'door' | 'container'

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
export const INTERACT_RANGE = 2

/** Trọng số ưu tiên đối tượng nằm theo hướng người chơi đang nhìn. */
const FACING_WEIGHT = 0.75

/**
 * Chọn đối tượng gần nhất trong tầm, ưu tiên đối tượng người chơi đang nhìn.
 * `isBlocked` (raycast physics) loại các đối tượng bị tường chắn; chỉ kiểm tra
 * vài ứng viên tốt nhất để tiết kiệm truy vấn.
 */
export function selectInteractable(
  playerPos: Vec3,
  facing: number,
  items: readonly Interactable[],
  isBlocked: (item: Interactable) => boolean = () => false,
  range = INTERACT_RANGE,
): Interactable | null {
  const fx = Math.sin(facing)
  const fz = Math.cos(facing)
  const candidates: { item: Interactable; score: number }[] = []

  for (const item of items) {
    const dx = item.position.x - playerPos.x
    const dz = item.position.z - playerPos.z
    const dist = Math.hypot(dx, dz)
    if (dist > range + item.radius) continue
    const dot = dist > 1e-4 ? (dx * fx + dz * fz) / dist : 1
    candidates.push({ item, score: dist - FACING_WEIGHT * dot })
  }

  candidates.sort((a, b) => a.score - b.score)
  const limit = Math.min(candidates.length, 3)
  for (let i = 0; i < limit; i++) {
    if (!isBlocked(candidates[i].item)) return candidates[i].item
  }
  return null
}
