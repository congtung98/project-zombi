import { describe, expect, it } from 'vitest'
import { advanceMeasuredGait, createMeasuredGait, smoothSpeed } from './gait'

/**
 * A body moving at `speed` m/s whose position only changes on fixed 60 Hz physics steps, observed
 * at `fps` frames per second (the situation that made legs flicker on high refresh screens).
 */
function observe(fps: number, speed: number, seconds: number, stride = 1.6) {
  const g = createMeasuredGait()
  const frame = 1 / fps
  let physicsTime = 0
  let x = 0
  const speeds: number[] = []
  for (let t = 0; t < seconds - 1e-9; t += frame) {
    while (physicsTime + 1 / 60 <= t + frame + 1e-9) {
      physicsTime += 1 / 60
      x += speed / 60
    }
    advanceMeasuredGait(g, x, 0, frame, stride)
    speeds.push(g.speed)
  }
  return { g, speeds }
}

describe('frame-rate independent gait', () => {
  it('filtered speed settles on the real speed with little ripple at 60, 144 and 240 Hz', () => {
    for (const fps of [60, 144, 240]) {
      const { speeds } = observe(fps, 2.3, 3)
      const tail = speeds.slice(Math.floor(speeds.length / 2))
      const mean = tail.reduce((a, b) => a + b, 0) / tail.length
      expect(mean).toBeGreaterThan(2.3 * 0.95)
      expect(mean).toBeLessThan(2.3 * 1.05)
      // Raw per-frame speed at 144 Hz alternates 0 / ~5.5 m/s; filtered ripple stays under 15%.
      expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(2.3 * 0.15)
    }
  })

  it('the gait cycle rate is the same at every frame rate (distance / stride)', () => {
    const phases = [60, 144, 240].map((fps) => {
      const g = createMeasuredGait()
      let cycles = 0
      let prev = 0
      const frame = 1 / fps
      let physicsTime = 0
      let x = 0
      for (let t = 0; t < 4 - 1e-9; t += frame) {
        while (physicsTime + 1 / 60 <= t + frame + 1e-9) { physicsTime += 1 / 60; x += 2.3 / 60 }
        advanceMeasuredGait(g, x, 0, frame, 1.6)
        if (g.phase < prev) cycles += 1
        prev = g.phase
      }
      return cycles + g.phase / (Math.PI * 2)
    })
    // ~9.2 m in 4 s over a 1.6 m stride, minus the ease-in: about 5.5 cycles everywhere.
    for (const c of phases) expect(Math.abs(c - phases[0])).toBeLessThan(0.1)
    expect(phases[0]).toBeGreaterThan(5)
    expect(phases[0]).toBeLessThan(6)
  })

  it('eases to rest and ignores teleports', () => {
    let s = 4
    for (let i = 0; i < 60; i++) s = smoothSpeed(s, 0, 1 / 60)
    expect(s).toBe(0)
    const g = createMeasuredGait()
    advanceMeasuredGait(g, 0, 0, 1 / 60, 1.6)
    advanceMeasuredGait(g, 30, 0, 1 / 60, 1.6)
    expect(g.speed).toBe(0)
  })
})
