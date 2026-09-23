import { describe, expect, it } from 'vitest'
import { computeCameraBasis, computeMoveDirection, regenStamina, resolvePlayerSpeed } from './movement'
import { createPlayerState } from '../entities/player'
import { GAME_CONFIG } from '../core/config'

const basis = computeCameraBasis({ x: 20, y: 24, z: 20 })

describe('computeCameraBasis', () => {
  it('forward points away from the camera and right is perpendicular', () => {
    expect(basis.forward.x).toBeCloseTo(-Math.SQRT1_2)
    expect(basis.forward.z).toBeCloseTo(-Math.SQRT1_2)
    const dot = basis.forward.x * basis.right.x + basis.forward.z * basis.right.z
    expect(dot).toBeCloseTo(0)
    // Camera at +X +Z looking toward origin: screen-right is (+X, -Z).
    expect(basis.right.x).toBeGreaterThan(0)
    expect(basis.right.z).toBeLessThan(0)
  })
})

describe('computeMoveDirection', () => {
  it('returns zero when no keys are held', () => {
    expect(computeMoveDirection({ forward: false, back: false, left: false, right: false }, basis)).toEqual({ x: 0, z: 0 })
  })

  it('cancels opposite keys', () => {
    expect(computeMoveDirection({ forward: true, back: true, left: false, right: false }, basis)).toEqual({ x: 0, z: 0 })
  })

  it('normalizes diagonal movement so it is not faster', () => {
    const d = computeMoveDirection({ forward: true, back: false, left: false, right: true }, basis)
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1)
  })

  it('moves along camera forward when pressing forward', () => {
    const d = computeMoveDirection({ forward: true, back: false, left: false, right: false }, basis)
    expect(d.x).toBeCloseTo(basis.forward.x)
    expect(d.z).toBeCloseTo(basis.forward.z)
  })
})

describe('resolvePlayerSpeed / regenStamina', () => {
  const cfg = GAME_CONFIG.player

  it('walks at walk speed and runs at run speed while draining stamina', () => {
    const p = createPlayerState({ x: 0, y: 0, z: 0 })
    expect(resolvePlayerSpeed(p, false, true, 0.1).speed).toBe(cfg.walkSpeed)
    const before = p.stamina
    expect(resolvePlayerSpeed(p, true, true, 0.1).speed).toBe(cfg.runSpeed)
    expect(p.stamina).toBeCloseTo(before - cfg.sprintStaminaPerSec * 0.1)
  })

  it('does not consume stamina when standing still with shift held', () => {
    const p = createPlayerState({ x: 0, y: 0, z: 0 })
    const r = resolvePlayerSpeed(p, true, false, 0.5)
    expect(r.speed).toBe(0)
    expect(r.running).toBe(false)
    expect(p.stamina).toBe(cfg.maxStamina)
  })

  it('cannot start running below the minimum stamina threshold', () => {
    const p = createPlayerState({ x: 0, y: 0, z: 0 })
    p.stamina = cfg.minStaminaToRun - 1
    const r = resolvePlayerSpeed(p, true, true, 0.1)
    expect(r.running).toBe(false)
    expect(r.speed).toBe(cfg.walkSpeed)
  })

  it('stamina never goes below zero and regenerates after the delay', () => {
    const p = createPlayerState({ x: 0, y: 0, z: 0 })
    p.stamina = 1
    p.isRunning = true
    resolvePlayerSpeed(p, true, true, 1)
    expect(p.stamina).toBe(0)

    regenStamina(p, cfg.staminaRegenDelay / 2)
    expect(p.stamina).toBe(0)
    regenStamina(p, cfg.staminaRegenDelay / 2)
    regenStamina(p, 1)
    expect(p.stamina).toBeCloseTo(cfg.staminaRegenPerSec)
  })

  it('dead player does not move', () => {
    const p = createPlayerState({ x: 0, y: 0, z: 0 })
    p.alive = false
    expect(resolvePlayerSpeed(p, true, true, 0.1).speed).toBe(0)
  })
})
