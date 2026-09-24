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

/** Body giả: tích phân vận tốc mà simulation đặt, thay cho Rapier trong test. */
function fakeBody(x: number, z: number) {
  const pos = { x, y: 0.9, z }
  let vel = { x: 0, y: 0, z: 0 }
  let enabled = true
  const body = {
    translation: () => ({ ...pos }),
    linvel: () => ({ ...vel }),
    setLinvel: (v: { x: number; y: number; z: number }) => {
      vel = { ...v }
    },
    setEnabled: (e: boolean) => {
      enabled = e
    },
    isEnabled: () => enabled,
    step: (dt: number) => {
      if (!enabled) return
      pos.x += vel.x * dt
      pos.z += vel.z * dt
    },
  }
  return body
}

type FakeBody = ReturnType<typeof fakeBody>
const asRigidBody = (b: FakeBody) => b as unknown as Parameters<GameRuntime['registerPlayerBody']>[0]

describe('GameRuntime combat', () => {
  const DT = 1 / 60
  const melee = GAME_CONFIG.melee

  function swing(rt: GameRuntime) {
    rt.input.simulateKey('Mouse0', true)
    rt.tick(DT)
    rt.input.simulateKey('Mouse0', false)
    for (let t = 0; t < melee.hitDelay + DT; t += DT) rt.tick(DT)
  }

  it('a swing toward a zombie damages it once, knocks it back, and a second swing kills it', () => {
    const rt = new GameRuntime(makeMap([{ x: 1, y: 0, z: 0 }]))
    const zombie = Array.from(rt.zombies.values())[0]
    const damaged: number[] = []
    const died: string[] = []
    rt.events.on('zombie:damaged', (e) => damaged.push(e.health))
    rt.events.on('zombie:died', (e) => died.push(e.sourceId))
    rt.player.facing = Math.PI / 2 // nhìn về +X

    swing(rt)
    expect(zombie.health).toBe(GAME_CONFIG.zombie.health - melee.damage)
    expect(damaged).toEqual([GAME_CONFIG.zombie.health - melee.damage])
    expect(zombie.staggerTimer).toBeGreaterThan(0)
    expect(zombie.knockback.x).toBeGreaterThan(0) // bị đẩy ra xa (+X)
    expect(rt.player.stamina).toBeLessThan(GAME_CONFIG.player.maxStamina)

    // Giữ chuột không tạo đòn mới; hết cooldown mới vung tiếp.
    for (let t = 0; t < melee.cooldown; t += DT) rt.tick(DT)
    swing(rt)
    expect(zombie.ai).toBe('DEAD')
    expect(died).toEqual(['player'])
    expect(rt.player.kills).toBe(1)

    // Zombie chết không còn gây sát thương.
    const health = rt.player.health
    for (let t = 0; t < 5; t += DT) rt.tick(DT)
    expect(rt.player.health).toBe(health)
  })

  it('does not hit a zombie behind the player or one behind a wall', () => {
    const rt = new GameRuntime(makeMap([{ x: 1, y: 0, z: 0 }]))
    const zombie = Array.from(rt.zombies.values())[0]
    rt.player.facing = -Math.PI / 2 // quay lưng về zombie
    swing(rt)
    expect(zombie.health).toBe(GAME_CONFIG.zombie.health)

    rt.player.facing = Math.PI / 2
    rt.registerPhysicsQuery({ isBlocked: () => true })
    for (let t = 0; t < melee.cooldown; t += DT) rt.tick(DT)
    swing(rt)
    expect(zombie.health).toBe(GAME_CONFIG.zombie.health)
  })

  it('Space pushes a zombie back without damage and cancels its attack', () => {
    const rt = new GameRuntime(makeMap([{ x: 1, y: 0, z: 0 }]))
    const zombie = Array.from(rt.zombies.values())[0]
    rt.player.facing = Math.PI / 2
    rt.tick(DT)
    rt.tick(DT)
    expect(zombie.ai).toBe('ATTACK')
    let pushed: string[] | null = null
    rt.events.on('player:pushed', (e) => (pushed = e.hitIds))
    rt.input.simulateKey('Space', true)
    rt.tick(DT)
    expect(pushed).toEqual([zombie.id])
    expect(zombie.health).toBe(GAME_CONFIG.zombie.health)
    expect(zombie.staggerTimer).toBeGreaterThan(0)
    expect(zombie.attackWindup).toBe(-1)
    expect(rt.player.pushCooldown).toBeGreaterThan(0)
  })

  it('a zombie outside a closed hut waits, then walks through the opened door and attacks', () => {
    const rt = new GameRuntime(makeMap([{ x: 0, y: 0, z: 8 }]))
    // Tường chắn tầm nhìn xấp xỉ bằng lưới điều hướng (thay cho raycast Rapier).
    rt.registerPhysicsQuery({ isBlocked: (a, b) => !rt.nav.hasLineOfWalk(a, b) })
    rt.player.position = { x: 0, y: 0.9, z: -1 }
    const playerBody = fakeBody(0, -1)
    const zombieBody = fakeBody(0, 8)
    rt.registerPlayerBody(asRigidBody(playerBody))
    rt.registerZombieBody('zombie-1', asRigidBody(zombieBody))
    const zombie = rt.zombies.get('zombie-1')!

    const step = (seconds: number) => {
      for (let t = 0; t < seconds; t += DT) {
        playerBody.step(DT)
        zombieBody.step(DT)
        rt.tick(DT)
      }
    }
    // Người chơi đứng yên (không giữ phím) → body người chơi vận tốc 0.
    step(2)
    expect(zombie.ai).toBe('IDLE')
    expect(zombieBody.translation().z).toBeCloseTo(8, 1)

    const door = rt.interactables.find((i) => i.id === 'door-hut')!
    rt.interact(door)
    let damaged = 0
    rt.events.on('player:damaged', () => (damaged += 1))
    step(12)
    // Zombie đã vào trong nhà và tới sát người chơi, gây sát thương.
    expect(zombieBody.translation().z).toBeLessThan(2)
    expect(zombie.ai).toBe('ATTACK')
    expect(damaged).toBeGreaterThan(0)
  })
})
