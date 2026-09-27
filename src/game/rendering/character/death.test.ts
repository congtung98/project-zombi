import { describe, expect, it } from 'vitest'
import { chooseFall, fallDirection, fallOrder } from './death'

describe('C4 death falls', () => {
  it('a recent hit decides the fall: pushed back, forward or sideways', () => {
    expect(fallOrder('zombie-1', Math.PI)[0]).toBe('back')
    expect(fallOrder('zombie-1', 0.2)[0]).toBe('front')
    expect(fallOrder('zombie-1', Math.PI / 2)[0]).toBe('left')
    expect(fallOrder('zombie-1', -Math.PI / 2)[0]).toBe('right')
  })

  it('without a hit the order is stable per ID and varies across a crowd; crumpling is always last', () => {
    expect(fallOrder('zombie-7', null)).toEqual(fallOrder('zombie-7', null))
    const firsts = new Set(Array.from({ length: 40 }, (_, i) => fallOrder(`zombie-${i}`, null)[0]))
    expect(firsts.size).toBeGreaterThanOrEqual(3)
    for (let i = 0; i < 20; i++) {
      const o = fallOrder(`zombie-${i}`, null)
      expect(o).toHaveLength(5)
      expect(new Set(o).size).toBe(5)
      expect(o.at(-1)).toBe('crumple')
    }
  })

  it('fall directions follow the facing (head toward −Z locally when falling back)', () => {
    const back = fallDirection('back', 0)
    expect(back.x).toBeCloseTo(0, 6)
    expect(back.z).toBeCloseTo(-1, 6)
    const front = fallDirection('front', Math.PI / 2)
    expect(front.x).toBeCloseTo(1, 6)
    expect(front.z).toBeCloseTo(0, 6)
    const left = fallDirection('left', 0)
    expect(left.x).toBeCloseTo(1, 6)
  })

  it('a wall behind skips that fall; walls all around make it crumple', () => {
    const wallBehind = (d: { x: number; z: number }) => d.z < -0.5
    expect(chooseFall(['back', 'front', 'left', 'right', 'crumple'], 0, wallBehind)).toBe('front')
    expect(chooseFall(['back', 'front', 'left', 'right', 'crumple'], 0, () => true)).toBe('crumple')
    expect(chooseFall(['right', 'back', 'front', 'left', 'crumple'], 0, () => false)).toBe('right')
  })
})
