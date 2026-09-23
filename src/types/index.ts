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

export type ZombieAIState = 'IDLE' | 'CHASE' | 'ATTACK' | 'DEAD'
