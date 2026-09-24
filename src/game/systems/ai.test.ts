import { describe, expect, it } from 'vitest'
import { applyKnockback, damageZombie, stepZombie, type ZombieAIContext } from './ai'
import { createZombieState } from '../entities/zombie'
import { GAME_CONFIG } from '../core/config'
import type { Vec3 } from '../../types'

const cfg = GAME_CONFIG.zombie
const DT = 1 / 60

function zombieAt(x: number, z: number) {
  return createZombieState('z1', { x, y: 0, z })
}

/** Chạy tick cho tới khi đủ `seconds` giây; trả về true nếu có tick nào ra đòn. */
function run(z: ReturnType<typeof zombieAt>, target: Vec3, seconds: number, ctx?: ZombieAIContext) {
  let attacked = false
  for (let t = 0; t < seconds; t += DT) {
    if (stepZombie(z, target, true, DT, cfg, ctx).attack) attacked = true
  }
  return attacked
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

  it('winds up, attacks once per cooldown when in range and stops moving', () => {
    const z = zombieAt(0, 0)
    const target = { x: 1, y: 0, z: 0 }
    stepZombie(z, target, true, DT) // IDLE -> CHASE
    const toAttack = stepZombie(z, target, true, DT)
    expect(toAttack.transition).toEqual({ from: 'CHASE', to: 'ATTACK' })
    expect(toAttack.velocity).toEqual({ x: 0, z: 0 })

    // Chưa gây sát thương ngay: phải chờ hết wind-up.
    expect(run(z, target, cfg.attackWindup * 0.5)).toBe(false)
    expect(run(z, target, cfg.attackWindup * 0.6)).toBe(true)
    // Trong cooldown không đánh lại.
    expect(run(z, target, cfg.attackCooldown * 0.5)).toBe(false)
    // Sau cooldown + wind-up thì đánh lại.
    expect(run(z, target, cfg.attackCooldown * 0.5 + cfg.attackWindup + DT * 2)).toBe(true)
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
    // Tường chắn xuất hiện ngay trước khung gây sát thương: không có đòn nào trúng.
    expect(run(z, target, cfg.attackWindup + DT * 2, ctx)).toBe(false)
    // Sau lần kiểm tra phát hiện tiếp theo, zombie mất mục tiêu và rời ATTACK.
    run(z, target, cfg.detectInterval + DT, ctx)
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

  it('remembers the last seen position, searches it, then returns to IDLE', () => {
    const z = zombieAt(0, 0)
    stepZombie(z, { x: 3, y: 0, z: 0 }, true, DT)
    expect(z.ai).toBe('CHASE')
    expect(z.lastKnownTarget).toEqual({ x: 3, y: 0, z: 0 })

    const far = { x: cfg.detectRange + 20, y: 0, z: 0 }
    run(z, far, cfg.detectInterval + DT)
    expect(z.ai).toBe('SEARCH')
    // Trong SEARCH, zombie đi về phía vị trí cuối thấy người chơi (+X).
    const r = stepZombie(z, far, true, DT)
    expect(r.velocity.x).toBeGreaterThan(0)

    // Tới nơi (mô phỏng physics đưa nó tới) và hết thời gian chờ → IDLE.
    z.position.x = 3
    run(z, far, cfg.loseTargetDelay + DT)
    expect(z.ai).toBe('IDLE')
    expect(z.lastKnownTarget).toBeNull()
  })

  it('gives up searching after the timeout even if it never arrives', () => {
    const z = zombieAt(0, 0)
    stepZombie(z, { x: 3, y: 0, z: 0 }, true, DT)
    const far = { x: cfg.detectRange + 20, y: 0, z: 0 }
    run(z, far, cfg.searchTimeout + cfg.detectInterval + DT)
    expect(z.ai).toBe('IDLE')
  })

  it('follows a path from the navigation context when the straight line is blocked', () => {
    const z = zombieAt(0, 0)
    const target = { x: 6, y: 0, z: 0 }
    const detour: Vec3[] = [
      { x: 0, y: 0, z: 3 },
      { x: 6, y: 0, z: 3 },
      { x: 6, y: 0, z: 0 },
    ]
    let calls = 0
    let navVersion = 1
    const ctx: ZombieAIContext = {
      canReach: () => true,
      hasLineOfWalk: () => false,
      findPath: () => {
        calls += 1
        return detour.map((p) => ({ ...p }))
      },
      getNavVersion: () => navVersion,
    }
    stepZombie(z, target, true, DT, cfg, ctx)
    const r = stepZombie(z, target, true, DT, cfg, ctx)
    // Đi về waypoint đầu (+Z) thay vì đi thẳng (+X).
    expect(r.velocity.z).toBeCloseTo(cfg.speed)
    expect(Math.abs(r.velocity.x)).toBeLessThan(1e-6)
    expect(calls).toBe(1)

    // Tới waypoint đầu → chuyển sang waypoint kế (+X), không tìm đường lại.
    z.position.z = 3
    const r2 = stepZombie(z, target, true, DT, cfg, ctx)
    expect(r2.velocity.x).toBeCloseTo(cfg.speed)
    expect(calls).toBe(1)

    // Lưới đổi (cửa mở/đóng) → tìm đường lại ngay.
    navVersion = 2
    stepZombie(z, target, true, DT, cfg, ctx)
    expect(calls).toBe(2)
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

describe('zombie damage and knockback', () => {
  it('damageZombie reduces health and kills at zero exactly once', () => {
    const z = zombieAt(0, 0)
    expect(damageZombie(z, 25)).toBe(false)
    expect(z.health).toBe(cfg.health - 25)
    expect(damageZombie(z, 25)).toBe(true)
    expect(z.ai).toBe('DEAD')
    expect(damageZombie(z, 25)).toBe(false)
    expect(z.health).toBe(0)
  })

  it('knockback pushes away from the source, staggers and cancels the wind-up', () => {
    const z = zombieAt(0, 0)
    const target = { x: 1, y: 0, z: 0 }
    stepZombie(z, target, true, DT)
    stepZombie(z, target, true, DT)
    run(z, target, cfg.attackWindup * 0.5)
    expect(z.attackWindup).toBeGreaterThan(0)

    applyKnockback(z, target, 1.5, 0.35)
    expect(z.attackWindup).toBe(-1)
    // Bị đẩy về -X (ra xa người chơi ở +X) và không tấn công trong lúc khựng.
    const r = stepZombie(z, target, true, DT)
    expect(r.velocity.x).toBeLessThan(0)
    expect(r.attack).toBe(false)

    // Tổng quãng đường trôi ≈ knockback (vận tốc / damping), giảm dần về 0.
    let travelled = 0
    for (let t = 0; t < 2; t += DT) {
      stepZombie(z, target, true, DT)
      travelled += -z.knockback.x * DT
    }
    expect(travelled).toBeGreaterThan(1.2)
    expect(travelled).toBeLessThan(1.8)
    expect(z.knockback).toEqual({ x: 0, z: 0 })
  })
})
