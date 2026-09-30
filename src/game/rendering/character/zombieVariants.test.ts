import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import { computePose, type PoseInput } from './pose'
import { lookPalette, zombieLook } from './rig'
import { SLOT } from './body'
import { POSTURES, ZOMBIE_POSTURES, zombieMotion } from './zombieVariants'

const base: PoseInput = { kind: 'zombie', time: 1, gaitPhase: 1, speed: 2.3, swing: -1, hitAt: 1, shove: -1, attack: -1, hurt: 0, dead: -1, armed: false }
const ids = Array.from({ length: 60 }, (_, i) => `zombie-${i + 1}`)

describe('C5 zombie variants', () => {
  it('posture, phase, stride and clock come from the ID: stable, and a crowd covers every posture', () => {
    expect(zombieMotion('zombie-9')).toEqual(zombieMotion('zombie-9'))
    const motions = ids.map(zombieMotion)
    expect(new Set(motions.map((m) => m.posture)).size).toBe(ZOMBIE_POSTURES.length)
    for (const m of motions) {
      expect(m.stride).toBeGreaterThanOrEqual(0.85)
      expect(m.stride).toBeLessThanOrEqual(1.15)
      expect(m.phase).toBeGreaterThanOrEqual(0)
      expect(m.phase).toBeLessThan(Math.PI * 2)
    }
    // Not in step: phases and strides spread over their ranges.
    expect(new Set(motions.map((m) => m.phase.toFixed(2))).size).toBeGreaterThan(50)
    const strides = motions.map((m) => m.stride)
    expect(Math.max(...strides) - Math.min(...strides)).toBeGreaterThan(0.2)
  })

  it('each posture has its own silhouette; the lurcher reaches with one arm; hanging vs reaching arms', () => {
    const poses = ZOMBIE_POSTURES.map((posture) => computePose({ ...base, posture }))
    expect(new Set(poses.map((p) => p.bodyPitch.toFixed(2))).size).toBe(ZOMBIE_POSTURES.length)
    const lurch = computePose({ ...base, posture: 'lurcher', reach: 1 })
    expect(lurch.armL.x).toBeLessThan(-1)
    expect(lurch.armR.x).toBeGreaterThan(-0.6)
    for (const posture of ZOMBIE_POSTURES) {
      const hang = computePose({ ...base, posture, reach: 0 }).armL.x
      const reach = computePose({ ...base, posture, reach: 1 }).armL.x
      expect(hang, posture).toBeGreaterThan(-0.6)
      expect(reach, posture).toBeLessThan(-0.75)
      expect(hang - reach, posture).toBeGreaterThan(0.6)
    }
    // The dragged leg swings less and keeps its knee straighter.
    const drag = computePose({ ...base, posture: 'shambler', gaitPhase: Math.PI / 2 })
    expect(Math.abs(drag.legL)).toBeLessThan(Math.abs(drag.legR))
    expect(POSTURES.shambler.drag).toBe(1)
  })

  it('worn, faded clothes: most zombies grimy or bloodied, colours dulled, the rest clean', () => {
    const looks = ids.map(zombieLook)
    const worn = looks.filter((l) => l.worn).length
    expect(worn).toBeGreaterThan(ids.length * 0.5)
    expect(worn).toBeLessThan(ids.length * 0.9)
    const sat = (hex: string) => {
      const hsl = { h: 0, s: 0, l: 0 }
      new Color(hex).getHSL(hsl)
      return hsl.s
    }
    // Dulled: no zombie shirt as saturated as the player's red or blue.
    for (const l of looks) expect(sat(l.shirt)).toBeLessThan(sat('#b5403a'))
    for (const l of looks) expect(lookPalette(l)[SLOT.stain]).not.toBe(lookPalette(l)[SLOT.top])
  })

  it('gameplay never reads the visual variants: no simulation module imports the character rendering', () => {
    const sources = import.meta.glob<string>(['../../core/*.ts', '../../systems/*.ts', '../../entities/*.ts', '../../world/*.ts', '!**/*.test.ts'], { query: '?raw', import: 'default', eager: true })
    expect(Object.keys(sources).length).toBeGreaterThan(20)
    for (const [file, text] of Object.entries(sources)) expect(text, file).not.toMatch(/rendering\/character/)
  })
})
