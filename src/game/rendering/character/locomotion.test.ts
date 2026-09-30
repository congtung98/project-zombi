import { describe, expect, it } from 'vitest'
import { advancePlayerGait, createPlayerGait, MAX_HIP_TURN, type PlayerGait } from './locomotion'
import { computePose, type PoseInput } from './pose'

const STRIDE = 2.2
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/**
 * Physics steps at a fixed 60 Hz (the body only moves then), frames render at `hz`. `motion` gives
 * the body's real velocity (after collisions); the simulation advances its stride phase from the
 * intended speed every step, like the runtime.
 */
function simulate(hz: number, seconds: number, o: { intended: number; vx: number; vz: number; facing?: number }, g: PlayerGait = createPlayerGait()) {
  let x = 0
  let z = 0
  let stride = 0
  let physicsTime = 0
  const frame = 1 / hz
  for (let t = 0; t < seconds; t += frame) {
    while (physicsTime + 1 / 60 <= t + frame) {
      physicsTime += 1 / 60
      x += o.vx / 60
      z += o.vz / 60
      stride = (stride + (o.intended / 60 / STRIDE) * Math.PI * 2) % (Math.PI * 2)
    }
    advancePlayerGait(g, { x, z, facing: o.facing ?? 0, intendedSpeed: o.intended, stridePhase: stride, stride: STRIDE, alive: true }, frame)
  }
  return { g, stride }
}

describe('C3 player locomotion', () => {
  it('blocked by a wall: the legs stop instead of running in place, at any frame rate', () => {
    for (const hz of [30, 60, 144, 240]) {
      const { g } = simulate(hz, 1, { intended: 4, vx: 0, vz: 0 })
      const before = g.phase
      simulate(hz, 0.5, { intended: 4, vx: 0, vz: 0 }, g)
      expect(g.speed, `${hz} Hz`).toBeLessThan(0.05)
      expect(Math.abs(wrap(g.phase - before)), `${hz} Hz`).toBeLessThan(0.02)
    }
  })

  it('walking freely: speed is the real speed and the phase locks onto the footstep stride', () => {
    for (const hz of [60, 144, 240]) {
      const { g, stride } = simulate(hz, 2, { intended: 4, vx: 0, vz: 4 })
      expect(g.speed, `${hz} Hz`).toBeGreaterThan(3.8)
      expect(g.speed).toBeLessThanOrEqual(4)
      expect(Math.abs(wrap(g.phase - stride)), `${hz} Hz`).toBeLessThan(0.15)
      expect(Math.abs(g.hipTurn)).toBeLessThan(0.02)
    }
  })

  it('sliding along a wall: the legs take the speed along the wall, not the intended one', () => {
    const { g } = simulate(144, 1.5, { intended: 4, vx: 1.5, vz: 0, facing: Math.PI / 2 })
    expect(g.speed).toBeGreaterThan(1.35)
    expect(g.speed).toBeLessThan(1.65)
  })

  it('backing off (facing kept on the cursor): the gait runs backwards; strafing turns the pelvis toward the path', () => {
    const back = simulate(144, 1, { intended: 4, vx: 0, vz: -4, facing: 0 }).g
    expect(back.direction).toBeLessThan(-0.9)
    const p0 = back.phase
    simulate(144, 0.1, { intended: 4, vx: 0, vz: -4, facing: 0 }, back)
    expect(wrap(back.phase - p0)).toBeLessThan(-0.3)
    expect(Math.abs(back.hipTurn)).toBeLessThan(0.05)
    const side = simulate(144, 1, { intended: 4, vx: 4, vz: 0, facing: 0 }).g
    expect(side.hipTurn).toBeCloseTo(MAX_HIP_TURN, 2)
    const diag = simulate(144, 1, { intended: 4, vx: -2.83, vz: 2.83, facing: 0 }).g
    expect(diag.hipTurn).toBeLessThan(-0.6)
  })

  it('paused (delta 0) changes nothing; a teleport is not motion', () => {
    const { g } = simulate(60, 1, { intended: 4, vx: 0, vz: 4 })
    const copy = structuredClone(g)
    advancePlayerGait(g, { x: 50, z: 50, facing: 0, intendedSpeed: 4, stridePhase: 1, stride: STRIDE, alive: true }, 0)
    expect(g).toEqual(copy)
    advancePlayerGait(g, { x: 50, z: 50, facing: 0, intendedSpeed: 4, stridePhase: 1, stride: STRIDE, alive: true }, 1 / 60)
    expect(Math.hypot(g.vx, g.vz)).toBeLessThan(4)
  })

  it('pose: the pelvis turns toward the path while the chest keeps the facing; idle shifts weight', () => {
    const base: PoseInput = { kind: 'player', time: 0, gaitPhase: 1, speed: 4, swing: -1, hitAt: 0.43, shove: -1, attack: -1, hurt: 0, dead: -1, armed: true }
    const straight = computePose(base)
    const turned = computePose({ ...base, hipTurn: 0.6 })
    expect(turned.hipsYaw - straight.hipsYaw).toBeCloseTo(0.6, 5)
    expect(turned.hipsYaw + turned.torsoTwist).toBeCloseTo(straight.hipsYaw + straight.torsoTwist, 5)
    const rolls = [0, 2, 4, 6].map((time) => computePose({ ...base, speed: 0, time }).hipsRoll)
    expect(Math.max(...rolls) - Math.min(...rolls)).toBeGreaterThan(0.02)
    expect(computePose({ ...base, speed: 4, time: 3 }).hipsRoll).toBe(0)
  })
})
