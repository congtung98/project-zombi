export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Vec2 {
  x: number
  z: number
}

export type EntityId = string

/**
 * IDLE nghỉ → WANDER đi tới điểm ngẫu nhiên quanh vùng → IDLE; MIGRATE do hệ thống di cư bên ngoài
 * đẩy cả nhóm sang vùng khác. CHASE thấy người chơi; SEARCH tới vị trí nhớ (thấy hoặc nghe);
 * APPROACH_STRUCTURE/ATTACK_STRUCTURE tới và đập cửa chặn tuyến tới vị trí nhớ (P2-S5).
 */
export type ZombieAIState =
  | 'IDLE'
  | 'WANDER'
  | 'MIGRATE'
  | 'CHASE'
  | 'SEARCH'
  | 'APPROACH_STRUCTURE'
  | 'ATTACK_STRUCTURE'
  | 'ATTACK'
  | 'DEAD'
