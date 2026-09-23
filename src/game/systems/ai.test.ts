import { describe, expect, it } from 'vitest'
import { stepZombie } from './ai'
import { createZombieState } from '../entities/zombie'
import { GAME_CONFIG } from '../core/config'

const cfg = GAME_CONFIG.zombie
const DT = 1 / 60

function zombieAt(x: number, z: number) {
  return createZombieState('z1', { x, y: 0, z })
}

describe('zombie FSM', () => {
  it('stays IDLE while the target is out of detection range', () => {
    const z = zombieAt(0, 0)
    const r = stepZombie(z, { x: cfg.detectRange + 5, y: 0, z: 0 }, true, DT)
    expect(z.ai).toBe('IDLE')
    expect(r.velocity).toEqual({ x: 0, z: 0 })
  })

  it('transitions IDLE → CHASE when the target is within range and moves toward it', () => {
    const z = zombieAt(0, 0)
    const r = stepZombie(z, { x: 5, y: 0, z: 0 }, true, DT)
    expect(r.transition).toEqual({ from: 'IDLE', to: 'CHASE' })
    const r2 = stepZombie(z, { x: 5, y: 0, z: 0 }, true, DT)
    expect(r2.velocity.x).toBeCloseTo(cfg.speed)
    expect(r2.velocity.z).toBeCloseTo(0)
  })

  it('does not chase when the target cannot be reached (wall between)', () => {
    const z = zombieAt(0, 0)
    stepZombie(z, { x: 3, y: 0, z: 0 }, true, DT, cfg, { canReach: () => false })
    expect(z.ai).toBe('IDLE')
  })

  it('attacks once per cooldown when in range and stops moving', () => {
    const z = zombieAt(0, 0)
    const target = { x: 1, y: 0, z: 0 }
    stepZombie(z, target, true, DT) // IDLE -> CHASE
    const toAttack = stepZombie(z, target, true, DT)
    expect(toAttack.transition).toEqual({ from: 'CHASE', to: 'ATTACK' })
    expect(toAttack.velocity).toEqual({ x: 0, z: 0 })

    const first = stepZombie(z, target, true, DT)
    expect(first.attack).toBe(true)
    const second = stepZombie(z, target, true, DT)
    expect(second.attack).toBe(false)

    // Sau khi hết cooldown thì đánh lại.
    let attacked = false
    for (let t = 0; t < cfg.attackCooldown + DT; t += DT) {
      if (stepZombie(z, target, true, DT).attack) attacked = true
    }
    expect(attacked).toBe(true)
  })

  it('does not deal damage when a wall blocks at the moment of the attack', () => {
    const z = zombieAt(0, 0)
    const target = { x: 1, y: 0, z: 0 }
    let reachable = true
    const ctx = { canReach: () => reachable }
    stepZombie(z, target, true, DT, cfg, ctx) // IDLE -> CHASE
    stepZombie(z, target, true, DT, cfg, ctx) // CHASE -> ATTACK
    expect(z.ai).toBe('ATTACK')
    reachable = false
    const r = stepZombie(z, target, true, DT, cfg, ctx)
    expect(r.attack).toBe(false)
    expect(z.attackCooldown).toBe(0)
    // Sau lần kiểm tra phát hiện tiếp theo, zombie mất mục tiêu và rời ATTACK.
    for (let t = 0; t < cfg.detectInterval + DT; t += DT) stepZombie(z, target, true, DT, cfg, ctx)
    expect(z.ai).not.toBe('ATTACK')
  })

  it('returns to CHASE when the target steps out of attack range', () => {
    const z = zombieAt(0, 0)
    const near = { x: 1, y: 0, z: 0 }
    stepZombie(z, near, true, DT)
    stepZombie(z, near, true, DT)
    expect(z.ai).toBe('ATTACK')
    const r = stepZombie(z, { x: 4, y: 0, z: 0 }, true, DT)
    expect(r.transition).toEqual({ from: 'ATTACK', to: 'CHASE' })
  })

  it('loses the target and returns to IDLE after the delay', () => {
    const z = zombieAt(0, 0)
    stepZombie(z, { x: 3, y: 0, z: 0 }, true, DT)
    expect(z.ai).toBe('CHASE')
    const far = { x: cfg.detectRange + 20, y: 0, z: 0 }
    for (let t = 0; t < cfg.loseTargetDelay + cfg.detectInterval + DT; t += DT) {
      stepZombie(z, far, true, DT)
    }
    expect(z.ai).toBe('IDLE')
  })

  it('does not attack a dead target', () => {
    const z = zombieAt(0, 0)
    const target = { x: 1, y: 0, z: 0 }
    stepZombie(z, target, true, DT)
    stepZombie(z, target, true, DT)
    const r = stepZombie(z, target, false, DT)
    expect(r.attack).toBe(false)
    expect(z.ai).not.toBe('ATTACK')
  })

  it('DEAD zombies do nothing', () => {
    const z = zombieAt(0, 0)
    z.health = 0
    const r = stepZombie(z, { x: 1, y: 0, z: 0 }, true, DT)
    expect(r.transition).toEqual({ from: 'IDLE', to: 'DEAD' })
    const r2 = stepZombie(z, { x: 1, y: 0, z: 0 }, true, DT)
    expect(r2.attack).toBe(false)
    expect(r2.velocity).toEqual({ x: 0, z: 0 })
    expect(z.ai).toBe('DEAD')
  })
})
