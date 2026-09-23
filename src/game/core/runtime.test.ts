import { describe, expect, it } from 'vitest'
import { GameRuntime } from './runtime'
import { GAME_CONFIG } from './config'
import type { MapData } from '../world/mapData'
import { generateBuildingWalls, generateDoorPlacements, type BuildingDef } from '../world/buildings'

const hut: BuildingDef = {
  id: 'hut',
  name: 'Hut',
  center: { x: 0, z: 0 },
  size: { w: 6, d: 6 },
  height: 3,
  wallThickness: 0.3,
  wallColor: '#fff',
  roofColor: '#000',
  floorColor: '#888',
  doors: [{ id: 'door-hut', name: 'Cửa', side: 'S', offset: 0, width: 1.4 }],
  containers: [{ id: 'ct-hut', name: 'Tủ', position: { x: 0, y: 0.5, z: -2.5 }, size: [1, 1, 0.6], color: '#000' }],
}

function makeMap(zombieSpawns: MapData['zombieSpawns']): MapData {
  return {
    id: 'test',
    size: 20,
    playerSpawn: { x: 0, y: 0, z: 0 },
    zombieSpawns,
    buildings: [hut],
    walls: generateBuildingWalls(hut),
    doors: generateDoorPlacements(hut),
    containers: hut.containers,
    roads: [],
  }
}

describe('GameRuntime tick', () => {
  it('clamps delta time so a long stall cannot advance the clock too far', () => {
    const rt = new GameRuntime(makeMap([]))
    rt.tick(5)
    expect(rt.clock.elapsed).toBe(GAME_CONFIG.loop.maxDelta)
  })

  it('zombie next to the player damages it and eventually kills it, emitting events', () => {
    const rt = new GameRuntime(makeMap([{ x: 1, y: 0, z: 0 }]))
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

  it('zombie behind a wall (physics reports blocked) never damages the player', () => {
    const rt = new GameRuntime(makeMap([{ x: 1, y: 0, z: 0 }]))
    rt.registerPhysicsQuery({ isBlocked: () => true })
    let damaged = 0
    rt.events.on('player:damaged', () => (damaged += 1))
    const dt = 1 / 60
    for (let t = 0; t < 10; t += dt) rt.tick(dt)
    expect(damaged).toBe(0)
    expect(rt.player.health).toBe(GAME_CONFIG.player.maxHealth)
    expect(Array.from(rt.zombies.values())[0].ai).toBe('IDLE')
  })

  it('newGame resets state and bumps the session id', () => {
    const rt = new GameRuntime(makeMap([{ x: 1, y: 0, z: 0 }]))
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
    const rt = new GameRuntime(makeMap([]))
    rt.input.simulateKey('KeyE', true)
    expect(rt.input.wasPressed('interact')).toBe(true)
    rt.tick(1 / 60)
    expect(rt.input.wasPressed('interact')).toBe(false)
    expect(rt.input.isDown('interact')).toBe(true)
    rt.input.clear()
    expect(rt.input.isDown('interact')).toBe(false)
  })
})

describe('GameRuntime interaction', () => {
  it('shows a prompt near the door and toggles it with E, emitting events', () => {
    const rt = new GameRuntime(makeMap([]))
    const toggles: boolean[] = []
    rt.events.on('door:toggled', (e) => toggles.push(e.open))

    rt.player.position = { x: 0, y: 0.9, z: 1.8 }
    rt.player.facing = 0 // nhìn về +Z, phía cửa
    rt.tick(1 / 60)
    expect(rt.currentInteractable?.id).toBe('door-hut')
    expect(rt.interactPrompt).toBe('Mở Cửa')

    rt.input.simulateKey('KeyE', true)
    rt.tick(1 / 60)
    expect(rt.world.doors.get('door-hut')?.open).toBe(true)
    expect(rt.interactPrompt).toBe('Đóng Cửa')
    rt.input.simulateKey('KeyE', false)

    rt.input.simulateKey('KeyE', true)
    rt.tick(1 / 60)
    expect(rt.world.doors.get('door-hut')?.open).toBe(false)
    expect(toggles).toEqual([true, false])
  })

  it('opens a container once and reports later opens as not first time', () => {
    const rt = new GameRuntime(makeMap([]))
    const opens: boolean[] = []
    rt.events.on('container:opened', (e) => opens.push(e.firstTime))

    rt.player.position = { x: 0, y: 0.9, z: -1.5 }
    rt.player.facing = Math.PI
    rt.tick(1 / 60)
    expect(rt.currentInteractable?.id).toBe('ct-hut')

    rt.interact(rt.currentInteractable!)
    rt.interact(rt.currentInteractable!)
    rt.events.flush()
    expect(rt.world.containers.get('ct-hut')?.opened).toBe(true)
    expect(opens).toEqual([true, false])
  })

  it('ignores targets the physics query reports as blocked', () => {
    const rt = new GameRuntime(makeMap([]))
    rt.registerPhysicsQuery({ isBlocked: () => true })
    rt.player.position = { x: 0, y: 0.9, z: 1.8 }
    rt.tick(1 / 60)
    expect(rt.currentInteractable).toBeNull()
    expect(rt.interactPrompt).toBeNull()
  })

  it('offers no interaction when the player is dead', () => {
    const rt = new GameRuntime(makeMap([]))
    rt.player.position = { x: 0, y: 0.9, z: 1.8 }
    rt.player.alive = false
    rt.tick(1 / 60)
    expect(rt.currentInteractable).toBeNull()
  })
})
