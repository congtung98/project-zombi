import type { RapierRigidBody } from '@react-three/rapier'
import { GAME_CONFIG } from './config'
import { GameClock } from './clock'
import { EventBus, type GameEvents } from './events'
import { createPlayerState, type PlayerState } from '../entities/player'
import { createZombieState, type ZombieState } from '../entities/zombie'
import { InputManager } from '../systems/input'
import { computeCameraBasis, computeMoveDirection, dampAngle, regenStamina, resolvePlayerSpeed } from '../systems/movement'
import { stepZombie } from '../systems/ai'
import { damagePlayer, tickSurvival } from '../systems/survival'
import { TEST_MAP, type MapData } from '../world/mapData'
import type { EntityId, Vec3 } from '../../types'

interface PendingAttack {
  sourceId: EntityId
  damage: number
}

const FACING_SMOOTHING = 14

/**
 * Trạng thái runtime của simulation. Không phải React state: render đọc trực
 * tiếp trong game loop, UI chỉ nhận snapshot theo nhịp chậm (hudStore).
 *
 * Thứ tự một tick: input → chuyển động/physics → AI → combat → survival/clock
 * → phát sự kiện → (render/UI tự đọc ở frame kế tiếp).
 */
export class GameRuntime {
  readonly config = GAME_CONFIG
  readonly input = new InputManager()
  readonly events = new EventBus<GameEvents>()
  readonly clock = new GameClock()
  readonly map: MapData
  readonly cameraBasis = computeCameraBasis(GAME_CONFIG.camera.offset)

  cameraZoom = GAME_CONFIG.camera.zoomDefault
  player: PlayerState
  zombies = new Map<EntityId, ZombieState>()
  /** Tăng mỗi ván mới; dùng làm key để remount scene và tạo lại physics body. */
  sessionId = 0

  private playerBody: RapierRigidBody | null = null
  private zombieBodies = new Map<EntityId, RapierRigidBody>()
  private nextZombieId = 1

  constructor(map: MapData = TEST_MAP) {
    this.map = map
    this.player = createPlayerState(map.playerSpawn)
    this.newGame()
  }

  newGame(): void {
    this.sessionId += 1
    this.clock.reset()
    this.events.clear()
    this.input.clear()
    this.cameraZoom = GAME_CONFIG.camera.zoomDefault
    this.player = createPlayerState(this.map.playerSpawn)
    this.zombies.clear()
    this.zombieBodies.clear()
    this.playerBody = null
    this.nextZombieId = 1
    for (const spawn of this.map.zombieSpawns) this.spawnZombie(spawn)
  }

  spawnZombie(position: Vec3): ZombieState {
    const id = `zombie-${this.nextZombieId++}`
    const zombie = createZombieState(id, position)
    this.zombies.set(id, zombie)
    return zombie
  }

  registerPlayerBody(body: RapierRigidBody | null): void {
    this.playerBody = body
  }

  registerZombieBody(id: EntityId, body: RapierRigidBody | null): void {
    if (body) this.zombieBodies.set(id, body)
    else this.zombieBodies.delete(id)
  }

  adjustZoom(steps: number): void {
    const cam = GAME_CONFIG.camera
    this.cameraZoom = Math.min(cam.zoomMax, Math.max(cam.zoomMin, this.cameraZoom + steps * cam.zoomStep))
  }

  /** Một bước simulation. `rawDt` tính bằng giây và được giới hạn để tránh nhảy sau khi tab mất focus. */
  tick(rawDt: number): void {
    const dt = Math.min(rawDt, GAME_CONFIG.loop.maxDelta)
    if (dt <= 0) return

    this.stepPlayerMovement(dt)
    const attacks = this.stepZombies(dt)
    this.stepCombat(attacks)
    this.stepSurvival(dt)
    this.clock.advance(dt)
    this.events.flush()
    this.input.endFrame()
  }

  private stepPlayerMovement(dt: number): void {
    const body = this.playerBody
    const player = this.player
    if (body) {
      const t = body.translation()
      player.position.x = t.x
      player.position.y = t.y
      player.position.z = t.z
    }

    const dir = computeMoveDirection(
      {
        forward: this.input.isDown('forward'),
        back: this.input.isDown('back'),
        left: this.input.isDown('left'),
        right: this.input.isDown('right'),
      },
      this.cameraBasis,
    )
    const moving = dir.x !== 0 || dir.z !== 0
    const { speed } = resolvePlayerSpeed(player, this.input.isDown('run'), moving, dt)

    if (moving && player.alive) {
      player.facing = dampAngle(player.facing, Math.atan2(dir.x, dir.z), FACING_SMOOTHING, dt)
    }

    if (body) {
      const v = body.linvel()
      body.setLinvel({ x: dir.x * speed, y: v.y, z: dir.z * speed }, true)
    }
  }

  private stepZombies(dt: number): PendingAttack[] {
    const attacks: PendingAttack[] = []
    const target = this.player.position
    for (const zombie of this.zombies.values()) {
      const body = this.zombieBodies.get(zombie.id)
      if (body) {
        const t = body.translation()
        zombie.position.x = t.x
        zombie.position.y = t.y
        zombie.position.z = t.z
      }

      const result = stepZombie(zombie, target, this.player.alive, dt)

      if (result.transition) {
        this.events.queue('zombie:stateChanged', { id: zombie.id, ...result.transition })
      }
      if (result.attack) {
        attacks.push({ sourceId: zombie.id, damage: GAME_CONFIG.zombie.damage })
      }
      if (body) {
        const v = body.linvel()
        body.setLinvel({ x: result.velocity.x, y: v.y, z: result.velocity.z }, true)
      }
    }
    return attacks
  }

  private stepCombat(attacks: PendingAttack[]): void {
    for (const attack of attacks) this.applyPlayerDamage(attack.damage, attack.sourceId)
  }

  private stepSurvival(dt: number): void {
    regenStamina(this.player, dt)
    const starvation = tickSurvival(this.player, dt)
    if (starvation > 0) this.applyPlayerDamage(starvation, 'starvation')
  }

  private applyPlayerDamage(amount: number, sourceId: EntityId): void {
    if (!this.player.alive) return
    const died = damagePlayer(this.player, amount)
    this.events.queue('player:damaged', { amount, health: this.player.health, sourceId })
    if (died) this.events.queue('player:died', { sourceId })
  }
}

/** Singleton runtime cho ứng dụng. Test tạo instance riêng bằng `new GameRuntime()`. */
export const runtime = new GameRuntime()
