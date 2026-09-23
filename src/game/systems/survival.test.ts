import { describe, expect, it } from 'vitest'
import { damagePlayer, tickSurvival } from './survival'
import { createPlayerState } from '../entities/player'
import { GAME_CONFIG } from '../core/config'

describe('tickSurvival', () => {
  it('decreases hunger and thirst over time and clamps at zero', () => {
    const p = createPlayerState({ x: 0, y: 0, z: 0 })
    tickSurvival(p, 60)
    expect(p.hunger).toBeCloseTo(100 - GAME_CONFIG.survival.hungerPerSec * 60)
    expect(p.thirst).toBeCloseTo(100 - GAME_CONFIG.survival.thirstPerSec * 60)
    tickSurvival(p, 100000)
    expect(p.hunger).toBe(0)
    expect(p.thirst).toBe(0)
  })

  it('reports starvation damage only when a stat is at zero', () => {
    const p = createPlayerState({ x: 0, y: 0, z: 0 })
    expect(tickSurvival(p, 1)).toBe(0)
    p.hunger = 0
    p.thirst = 50
    expect(tickSurvival(p, 1)).toBeCloseTo(GAME_CONFIG.survival.starvationDamagePerSec)
    p.thirst = 0
    expect(tickSurvival(p, 1)).toBeCloseTo(GAME_CONFIG.survival.starvationDamagePerSec * 2)
  })
})

describe('damagePlayer', () => {
  it('reduces health, clamps at zero and reports death once', () => {
    const p = createPlayerState({ x: 0, y: 0, z: 0 })
    expect(damagePlayer(p, 30)).toBe(false)
    expect(p.health).toBe(70)
    expect(damagePlayer(p, 100)).toBe(true)
    expect(p.health).toBe(0)
    expect(p.alive).toBe(false)
    expect(damagePlayer(p, 10)).toBe(false)
  })
})
