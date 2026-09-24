import { describe, expect, it } from 'vitest'
import { resolveConeHits, startAttack, startPush, tickPlayerCombat, type MeleeTarget } from './combat'
import { createPlayerState } from '../entities/player'
import { GAME_CONFIG } from '../core/config'

const melee = GAME_CONFIG.melee
const DT = 1 / 60

function target(id: string, x: number, z: number, alive = true): MeleeTarget {
  return { id, position: { x, y: 0, z }, radius: 0.4, alive }
}

describe('resolveConeHits', () => {
  const origin = { x: 0, y: 0, z: 0 }
  const facingPlusZ = 0

  it('hits targets in front within range and ignores those behind, too far or dead', () => {
    const hits = resolveConeHits(
      origin,
      facingPlusZ,
      [
        target('front', 0, 1.5),
        target('edge', 0, melee.range + 0.3), // trong tầm nhờ bán kính
        target('far', 0, melee.range + 1),
        target('behind', 0, -1.5),
        target('side', 1.5, 0), // 90° so với hướng nhìn, ngoài hình quạt 60°
        target('dead', 0, 1, false),
      ],
      melee,
    )
    expect(hits.map((h) => h.id)).toEqual(['front', 'edge'])
  })

  it('accepts targets inside the cone angle and rejects those just outside', () => {
    const inside = Math.sin(((melee.halfAngleDeg - 5) * Math.PI) / 180)
    const outside = Math.sin(((melee.halfAngleDeg + 5) * Math.PI) / 180)
    const hits = resolveConeHits(
      origin,
      facingPlusZ,
      [target('in', inside, Math.sqrt(1 - inside * inside)), target('out', outside, Math.sqrt(1 - outside * outside))],
      melee,
    )
    expect(hits.map((h) => h.id)).toEqual(['in'])
  })

  it('skips targets the wall check reports as blocked', () => {
    const hits = resolveConeHits(origin, facingPlusZ, [target('a', 0, 1), target('b', 0.3, 1.2)], melee, (t) => t.id === 'a')
    expect(hits.map((h) => h.id)).toEqual(['b'])
  })

  it('returns each target at most once', () => {
    const t = target('dup', 0, 1)
    const hits = resolveConeHits(origin, facingPlusZ, [t, t], melee)
    expect(hits).toHaveLength(1)
  })
})

describe('player attack timing', () => {
  it('costs stamina, starts a cooldown and fires the hit window exactly once', () => {
    const p = createPlayerState({ x: 0, y: 0, z: 0 })
    expect(startAttack(p)).toBe(true)
    expect(p.stamina).toBe(GAME_CONFIG.player.maxStamina - melee.stamina)
    expect(p.attackCooldown).toBe(melee.cooldown)
    // Không thể vung lại trong cooldown.
    expect(startAttack(p)).toBe(false)

    let hits = 0
    for (let t = 0; t < melee.cooldown + DT; t += DT) {
      if (tickPlayerCombat(p, DT)) hits += 1
    }
    expect(hits).toBe(1)
    expect(p.attackTimer).toBe(-1)
    expect(p.attackCooldown).toBe(0)
    expect(startAttack(p)).toBe(true)
  })

  it('fires the hit window at hitDelay, not immediately', () => {
    const p = createPlayerState({ x: 0, y: 0, z: 0 })
    startAttack(p)
    expect(tickPlayerCombat(p, DT)).toBe(false)
    let elapsed = DT
    let fired = false
    while (elapsed < melee.hitDelay + DT) {
      fired = tickPlayerCombat(p, DT)
      elapsed += DT
      if (fired) break
    }
    expect(fired).toBe(true)
    expect(elapsed).toBeGreaterThanOrEqual(melee.hitDelay)
  })

  it('refuses to attack or push without enough stamina or when dead', () => {
    const p = createPlayerState({ x: 0, y: 0, z: 0 })
    p.stamina = melee.stamina - 1
    expect(startAttack(p)).toBe(false)
    p.stamina = GAME_CONFIG.push.stamina - 1
    expect(startPush(p)).toBe(false)
    p.stamina = 100
    p.alive = false
    expect(startAttack(p)).toBe(false)
    expect(startPush(p)).toBe(false)
  })

  it('push has its own cooldown independent from the melee cooldown', () => {
    const p = createPlayerState({ x: 0, y: 0, z: 0 })
    expect(startPush(p)).toBe(true)
    expect(startPush(p)).toBe(false)
    expect(startAttack(p)).toBe(true)
    for (let t = 0; t < GAME_CONFIG.push.cooldown + DT; t += DT) tickPlayerCombat(p, DT)
    expect(startPush(p)).toBe(true)
  })
})
