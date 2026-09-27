import { describe, expect, it } from 'vitest'
import { aimYawTowards, angleDiff, cancelStance, createStanceControl, setStanceMode, turnToward, updateStanceRequest } from './stance'

const DEG = Math.PI / 180

describe('CS1 angles', () => {
  it('angleDiff takes the shortest way and exactly opposite is always +π', () => {
    expect(angleDiff(0, 90 * DEG)).toBeCloseTo(90 * DEG)
    expect(angleDiff(170 * DEG, -170 * DEG)).toBeCloseTo(20 * DEG)
    expect(angleDiff(-170 * DEG, 170 * DEG)).toBeCloseTo(-20 * DEG)
    expect(angleDiff(0, Math.PI)).toBe(Math.PI)
    expect(angleDiff(0, -Math.PI)).toBe(Math.PI)
    expect(angleDiff(Math.PI / 2, -Math.PI / 2)).toBe(Math.PI)
  })

  it('turnToward is limited per step, never overshoots and lands exactly', () => {
    const s = { turnSign: 1 }
    let a = 0
    const steps: number[] = []
    for (let i = 0; i < 40 && a !== 1; i++) {
      const next = turnToward(a, 1, 0.1, s)
      steps.push(Math.abs(angleDiff(a, next)))
      a = next
    }
    expect(a).toBeCloseTo(1, 12)
    expect(Math.max(...steps)).toBeLessThanOrEqual(0.1 + 1e-12)
    expect(turnToward(1, 1, 0.1, s)).toBeCloseTo(1, 12)
  })

  it('a target right behind turns one fixed side and keeps it while the aim wobbles across the back', () => {
    const s = { turnSign: 1 }
    let a = 0
    a = turnToward(a, Math.PI, 0.05, s)
    expect(a).toBeCloseTo(0.05)
    // The cursor wobbles ±3° around the back: the body keeps turning the same way.
    for (const wobble of [-3, 3, -3, 3]) {
      const before = a
      a = turnToward(a, Math.PI + wobble * DEG, 0.05, s)
      expect(angleDiff(before, a)).toBeGreaterThan(0)
    }
    // Clearly on the other side: it may reverse.
    const t = { turnSign: 1 }
    expect(turnToward(0, -150 * DEG, 0.05, t)).toBeCloseTo(-0.05)
  })

  it('no NaN or jump when the cursor sits on the player or is missing', () => {
    const p = { x: 1, y: 0, z: 1 }
    expect(aimYawTowards(p, null)).toBeNull()
    expect(aimYawTowards(p, { x: 1.1, y: 0, z: 1.1 })).toBeNull()
    expect(aimYawTowards(p, { x: Number.NaN, y: 0, z: 3 })).toBeNull()
    expect(aimYawTowards(p, { x: 1, y: 0, z: 3 })).toBeCloseTo(0)
    expect(aimYawTowards(p, { x: 3, y: 0, z: 1 })).toBeCloseTo(Math.PI / 2)
  })
})

describe('CS1 stance request', () => {
  it('hold: follows the button; a button held through a cancel must be released first', () => {
    const c = createStanceControl('hold')
    expect(updateStanceRequest(c, true, true, true)).toBe(true)
    expect(updateStanceRequest(c, false, false, true)).toBe(false)
    updateStanceRequest(c, true, true, true)
    cancelStance(c, true)
    expect(updateStanceRequest(c, true, false, true)).toBe(false)
    expect(updateStanceRequest(c, false, false, true)).toBe(false)
    expect(updateStanceRequest(c, true, true, true)).toBe(true)
  })

  it('hold: a press and release between two ticks still asks for the stance for one tick', () => {
    const c = createStanceControl('hold')
    expect(updateStanceRequest(c, false, true, true)).toBe(true)
    expect(updateStanceRequest(c, false, false, true)).toBe(false)
    // Held through a cancel, released and pressed again within one frame: a new press counts.
    updateStanceRequest(c, true, true, true)
    cancelStance(c, true)
    expect(updateStanceRequest(c, true, true, true)).toBe(true)
  })

  it('toggle: one press edge = one switch, holding never repeats', () => {
    const c = createStanceControl('toggle')
    expect(updateStanceRequest(c, true, true, true)).toBe(true)
    for (let i = 0; i < 5; i++) expect(updateStanceRequest(c, true, false, true)).toBe(true)
    expect(updateStanceRequest(c, false, false, true)).toBe(true)
    expect(updateStanceRequest(c, true, true, true)).toBe(false)
    expect(updateStanceRequest(c, true, false, true)).toBe(false)
  })

  it('not allowed (UI, dead) drops the request and a held button waits for a release', () => {
    const c = createStanceControl('hold')
    updateStanceRequest(c, true, true, true)
    expect(updateStanceRequest(c, true, false, false)).toBe(false)
    expect(updateStanceRequest(c, true, false, true)).toBe(false)
    updateStanceRequest(c, false, false, true)
    expect(updateStanceRequest(c, true, true, true)).toBe(true)
    const t = createStanceControl('toggle')
    updateStanceRequest(t, true, true, true)
    updateStanceRequest(t, false, false, false)
    expect(updateStanceRequest(t, false, false, true)).toBe(false)
  })

  it('switching the mode resets a latched or held request', () => {
    const c = createStanceControl('toggle')
    updateStanceRequest(c, true, true, true)
    setStanceMode(c, 'hold', true)
    expect(c.requested).toBe(false)
    expect(updateStanceRequest(c, true, false, true)).toBe(false)
    setStanceMode(c, 'toggle', false)
    expect(updateStanceRequest(c, false, false, true)).toBe(false)
  })
})
