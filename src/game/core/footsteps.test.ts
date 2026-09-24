import { describe, expect, it } from 'vitest'
import { GameRuntime } from './runtime'
import { GAME_CONFIG } from './config'
import type { MapData } from '../world/mapData'

const OPEN: MapData = { id: 'open', size: 30, playerSpawn: { x: 0, y: 0, z: 0 }, zombieSpawns: [], buildings: [], walls: [], doors: [], containers: [], roads: [] }

/** Footsteps are the audible cue of the P2-S5 noise: one sound per half stride, only while noisy. */
function walk(seconds: number, run: boolean, fps = 60) {
  const rt = new GameRuntime(OPEN)
  const steps: { t: number; running: boolean; noise: number }[] = []
  let t = 0
  rt.events.on('player:footstep', (e) => steps.push({ t, running: e.running, noise: rt.playerNoise }))
  rt.input.simulateKey('KeyW', true)
  if (run) rt.input.simulateKey('ShiftLeft', true)
  for (; t < seconds - 1e-9; t += 1 / fps) rt.tick(1 / fps)
  return { rt, steps }
}

describe('player footsteps', () => {
  it('walking: first step at once, then one per half stride, each while the walk noise is on', () => {
    const { steps } = walk(3, false)
    const cfg = GAME_CONFIG.player
    const expected = 1 + Math.floor((3 * cfg.walkSpeed) / (cfg.walkStride / 2))
    expect(steps[0].t).toBe(0)
    expect(Math.abs(steps.length - expected)).toBeLessThanOrEqual(1)
    for (const s of steps) expect(s).toMatchObject({ running: false, noise: GAME_CONFIG.hearing.walkRadius })
    const gap = steps[2].t - steps[1].t
    expect(gap).toBeCloseTo(cfg.walkStride / 2 / cfg.walkSpeed, 1)
  })

  it('running steps are marked running and come at the running cadence', () => {
    const { steps } = walk(2, true)
    const cfg = GAME_CONFIG.player
    expect(steps.every((s) => s.running && s.noise === GAME_CONFIG.hearing.runRadius)).toBe(true)
    expect(Math.abs(steps.length - (1 + Math.floor((2 * cfg.runSpeed) / (cfg.runStride / 2))))).toBeLessThanOrEqual(1)
  })

  it('the cadence does not depend on the frame rate', () => {
    const counts = [60, 144, 240].map((fps) => walk(3, false, fps).steps.length)
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
  })

  it('standing still, or stopping, is silent (and so is the noise)', () => {
    const { rt, steps } = walk(1, false)
    const n = steps.length
    rt.input.simulateKey('KeyW', false)
    for (let t = 0; t < 2; t += 1 / 60) rt.tick(1 / 60)
    expect(steps.length).toBe(n)
    expect(rt.playerNoise).toBe(0)
    expect(rt.player.moveSpeed).toBe(0)
  })
})
