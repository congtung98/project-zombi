import { describe, expect, it } from 'vitest'
import { GameRuntime } from './runtime'
import { GAME_CONFIG } from './config'
import type { MapData } from '../world/mapData'

const tinyMap: MapData = {
  id: 'test',
  size: 20,
  playerSpawn: { x: 0, y: 0, z: 0 },
  zombieSpawns: [{ x: 1, y: 0, z: 0 }],
  walls: [],
}

describe('GameRuntime tick', () => {
  it('clamps delta time so a long stall cannot advance the clock too far', () => {
    const rt = new GameRuntime(tinyMap)
    rt.tick(5)
    expect(rt.clock.elapsed).toBe(GAME_CONFIG.loop.maxDelta)
  })

  it('zombie next to the player damages it and eventually kills it, emitting events', () => {
    const rt = new GameRuntime(tinyMap)
    const damaged: number[] = []
    let died = 0
    rt.events.on('player:damaged', (e) => damaged.push(e.amount))
    rt.events.on('player:died', () => (died += 1))

    const dt = 1 / 60
    for (let t = 0; t < 30; t += dt) rt.tick(dt)

    expect(damaged.length).toBeGreaterThan(0)
    expect(damaged[0]).toBe(GAME_CONFIG.zombie.damage)
    expect(rt.player.alive).toBe(false)
    expect(rt.player.health).toBe(0)
    expect(died).toBe(1)
  })

  it('newGame resets state and bumps the session id', () => {
    const rt = new GameRuntime(tinyMap)
    const firstSession = rt.sessionId
    rt.player.health = 10
    rt.tick(0.5)
    rt.newGame()
    expect(rt.sessionId).toBe(firstSession + 1)
    expect(rt.player.health).toBe(GAME_CONFIG.player.maxHealth)
    expect(rt.clock.elapsed).toBe(0)
    expect(rt.zombies.size).toBe(1)
    expect(Array.from(rt.zombies.values())[0].ai).toBe('IDLE')
  })

  it('edge-triggered input is consumed after one tick', () => {
    const rt = new GameRuntime(tinyMap)
    rt.input.simulateKey('KeyE', true)
    expect(rt.input.wasPressed('interact')).toBe(true)
    rt.tick(1 / 60)
    expect(rt.input.wasPressed('interact')).toBe(false)
    expect(rt.input.isDown('interact')).toBe(true)
    rt.input.clear()
    expect(rt.input.isDown('interact')).toBe(false)
  })
})
