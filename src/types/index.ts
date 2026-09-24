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

/** SEARCH: mất dấu người chơi, đi tới vị trí cuối cùng còn thấy. */
export type ZombieAIState = 'IDLE' | 'CHASE' | 'SEARCH' | 'ATTACK' | 'DEAD'
