import type { RapierRigidBody } from '@react-three/rapier'
import { GAME_CONFIG } from './config'
import { GameClock } from './clock'
import { EventBus, type GameEvents } from './events'
import { createPlayerState, type PlayerState } from '../entities/player'
import { createZombieState, type ZombieState } from '../entities/zombie'
import { InputManager } from '../systems/input'
import { computeCameraBasis, computeMoveDirection, dampAngle, regenStamina, resolvePlayerSpeed } from '../systems/movement'
import { applyKnockback, damageZombie, stepZombie, type ZombieAIContext } from '../systems/ai'
import { facingTowards, resolveConeHits, startAttack, startPush, tickPlayerCombat, type MeleeTarget } from '../systems/combat'
import { damagePlayer, tickSurvival, consumeInventoryItem, type UseItemResult } from '../systems/survival'
import { INTERACT_RANGE, selectInteractable, type Interactable } from '../systems/interaction'
import { transferAll, transferSlot, type TransferResult } from '../systems/inventory'
import { randomSeed } from '../systems/loot'
import { getItemDef } from '../entities/items'
import { NEIGHBORHOOD_MAP, type MapData } from '../world/mapData'
import { NavGrid } from '../world/navigation'
import { createWorldState, type ContainerState, type WorldState } from '../world/worldState'
import type { EntityId, Vec3 } from '../../types'

interface PendingAttack {
  sourceId: EntityId
  damage: number
}

/**
 * Truy vấn vật lý do tầng render (Rapier) cung cấp. Simulation không import
 * Rapier trực tiếp để logic vẫn test được không cần WASM.
 */
export interface PhysicsQuery {
  /** true nếu có khối chặn (tường, cửa đóng...) giữa hai điểm, bỏ qua các ID trong `ignoreIds`. */
  isBlocked(from: Vec3, to: Vec3, ignoreIds: readonly string[]): boolean
}

const FACING_SMOOTHING = 14
/** Độ cao raycast tầm nhìn zombie: nhìn qua được hàng rào/thùng thấp, không qua tường/cửa. */
const EYE_HEIGHT = 1.5
/** Độ cao raycast kiểm tra tường chắn đòn gậy. */
const SWING_HEIGHT = 1.2

/**
 * Trạng thái runtime của simulation. Không phải React state: render đọc trực
 * tiếp trong game loop, UI chỉ nhận snapshot theo nhịp chậm (hudStore).
 *
 * Thứ tự một tick: input → chuyển động/physics → tương tác → AI → combat →
 * survival/clock → phát sự kiện → (render/UI tự đọc ở frame kế tiếp).
 */
export class GameRuntime {
  readonly config = GAME_CONFIG
  readonly input = new InputManager()
  readonly events = new EventBus<GameEvents>()
  readonly clock = new GameClock()
  readonly map: MapData
  readonly nav: NavGrid
  readonly cameraBasis = computeCameraBasis(GAME_CONFIG.camera.offset)
  /** Danh sách đối tượng tương tác được, dựng một lần từ map data. */
  readonly interactables: readonly Interactable[]
  private readonly interactableById: Map<string, Interactable>

  cameraZoom = GAME_CONFIG.camera.zoomDefault
  player: PlayerState
  zombies = new Map<EntityId, ZombieState>()
  world: WorldState
  /** Đối tượng đang được nhắm để tương tác (hiện prompt E). */
  currentInteractable: Interactable | null = null
  interactPrompt: string | null = null
  /** Điểm con trỏ chiếu xuống mặt đất (tầng render cập nhật mỗi frame); null khi ngoài canvas. */
  cursorWorld: Vec3 | null = null
  /** UI (inventory/container) đang mở thì không kích hoạt đòn đánh ngoài ý muốn. Suy ra từ hai trường dưới. */
  uiOpen = false
  /** Túi đồ đang mở (phím I hoặc tự mở khi mở container). */
  inventoryOpen = false
  /** Container đang hiện panel; null khi không có. */
  openContainerId: string | null = null
  /** Tăng mỗi ván mới; dùng làm key để remount scene và tạo lại physics body. */
  sessionId = 0

  private playerBody: RapierRigidBody | null = null
  private zombieBodies = new Map<EntityId, RapierRigidBody>()
  private physics: PhysicsQuery | null = null
  private nextZombieId = 1
  private readonly zombieAIContext: ZombieAIContext

  constructor(map: MapData = NEIGHBORHOOD_MAP) {
    this.map = map
    this.nav = new NavGrid(map, GAME_CONFIG.nav)
    this.interactables = buildInteractables(map)
    this.interactableById = new Map(this.interactables.map((i) => [i.id, i]))
    this.player = createPlayerState(map.playerSpawn)
    this.world = createWorldState(map, 0)

    // Zombie chỉ phát hiện và gây sát thương khi không có tường/cửa đóng giữa nó và người chơi;
    // đường đi lấy từ lưới điều hướng (đi vòng tường, qua cửa mở).
    this.zombieAIContext = {
      canReach: (zombie, target) =>
        this.physics ? !this.physics.isBlocked(atHeight(zombie.position, EYE_HEIGHT), atHeight(target, EYE_HEIGHT), []) : true,
      findPath: (from, to) => this.nav.findPath(from, to),
      hasLineOfWalk: (from, to) => this.nav.hasLineOfWalk(from, to),
      getNavVersion: () => this.nav.version,
    }

    this.newGame()
  }

  /** Ván mới với seed loot; loot mọi container được sinh ngay tại đây, một lần cho cả ván. */
  newGame(seed: number = randomSeed()): void {
    this.sessionId += 1
    this.clock.reset()
    this.events.clear()
    this.input.clear()
    this.cameraZoom = GAME_CONFIG.camera.zoomDefault
    this.player = createPlayerState(this.map.playerSpawn)
    this.world = createWorldState(this.map, seed)
    this.nav.resetDoors()
    this.currentInteractable = null
    this.interactPrompt = null
    this.cursorWorld = null
    this.inventoryOpen = false
    this.openContainerId = null
    this.uiOpen = false
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

  registerPhysicsQuery(query: PhysicsQuery | null): void {
    this.physics = query
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
    this.stepInteraction()
    const attacks = this.stepZombies(dt)
    this.stepCombat(attacks, dt)
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

    // Khi đang vung gậy, giữ hướng nhìn về con trỏ; chuyển động không xoay nhân vật.
    if (moving && player.alive && player.attackTimer < 0) {
      player.facing = dampAngle(player.facing, Math.atan2(dir.x, dir.z), FACING_SMOOTHING, dt)
    }

    if (body) {
      const v = body.linvel()
      body.setLinvel({ x: dir.x * speed, y: v.y, z: dir.z * speed }, true)
    }
  }

  private stepInteraction(): void {
    const player = this.player
    if (!player.alive) {
      this.currentInteractable = null
      this.interactPrompt = null
      this.closeAllUi()
      return
    }

    // Đi xa container đang mở thì panel tự đóng (không loot từ xa).
    if (this.openContainerId) {
      const item = this.interactableById.get(this.openContainerId)
      const maxDist = item ? INTERACT_RANGE + item.radius + GAME_CONFIG.inventory.closeDistanceSlack : 0
      if (!item || Math.hypot(item.position.x - player.position.x, item.position.z - player.position.z) > maxDist) {
        this.closeContainer()
      }
    }

    const from: Vec3 = { x: player.position.x, y: player.position.y, z: player.position.z }
    const target = selectInteractable(player.position, player.facing, this.interactables, (item) =>
      this.physics ? this.physics.isBlocked(from, item.position, [item.id]) : false,
    )
    this.currentInteractable = target
    this.interactPrompt = target ? this.describeInteraction(target) : null

    if (target && this.input.wasPressed('interact')) this.interact(target)
  }

  private describeInteraction(target: Interactable): string {
    if (target.kind === 'door') {
      const door = this.world.doors.get(target.id)
      return `${door?.open ? 'Đóng' : 'Mở'} ${target.name}`
    }
    if (this.openContainerId === target.id) return `Đóng ${target.name}`
    const container = this.world.containers.get(target.id)
    return `${container?.opened ? 'Xem' : 'Mở'} ${target.name}`
  }

  /** Thực hiện tương tác với đối tượng; có thể gọi từ test mà không cần input. */
  interact(target: Interactable): void {
    if (target.kind === 'door') {
      const door = this.world.doors.get(target.id)
      if (!door) return
      door.open = !door.open
      this.nav.setDoorOpen(door.id, door.open)
      this.events.queue('door:toggled', { id: door.id, open: door.open })
      this.interactPrompt = this.describeInteraction(target)
      return
    }
    const container = this.world.containers.get(target.id)
    if (!container) return
    if (this.openContainerId === container.id) {
      // Nhấn E lần nữa ở cùng container: đóng panel.
      this.closeContainer()
      this.interactPrompt = this.describeInteraction(target)
      return
    }
    const firstTime = !container.opened
    container.opened = true
    // Loot đã sinh khi tạo ván; mở lại chỉ hiện nội dung còn lại, không gieo thêm.
    this.openContainerId = container.id
    this.inventoryOpen = true
    this.syncUiOpen()
    this.events.queue('container:opened', { id: container.id, name: target.name, firstTime })
    this.queueInventoryChanged()
    this.interactPrompt = this.describeInteraction(target)
  }

  // ----- Inventory / container: gọi từ UI (ngoài tick) hoặc test -----

  /** Phím I: mở/đóng túi. Đóng túi cũng đóng panel container. */
  toggleInventory(): void {
    if (this.inventoryOpen) this.closeAllUi()
    else this.setInventoryOpen(true)
  }

  setInventoryOpen(open: boolean): void {
    if (this.inventoryOpen === open) return
    this.inventoryOpen = open
    if (!open) this.closeContainer()
    this.syncUiOpen()
    this.queueInventoryChanged()
  }

  closeContainer(): void {
    const id = this.openContainerId
    if (!id) return
    this.openContainerId = null
    this.syncUiOpen()
    this.events.queue('container:closed', { id })
    this.queueInventoryChanged()
  }

  closeAllUi(): void {
    if (!this.inventoryOpen && !this.openContainerId) return
    this.inventoryOpen = false
    if (this.openContainerId) {
      this.closeContainer()
      return
    }
    this.syncUiOpen()
    this.queueInventoryChanged()
  }

  /** Container đang mở panel, hoặc null. */
  get openContainer(): ContainerState | null {
    return this.openContainerId ? (this.world.containers.get(this.openContainerId) ?? null) : null
  }

  /** Dùng vật phẩm ở ô `slot`; chỉ trừ khi dùng thành công. */
  consumeItem(slot: number): UseItemResult {
    const result = consumeInventoryItem(this.player, slot)
    if (result.ok) {
      this.events.queue('item:used', { itemId: result.itemId, name: getItemDef(result.itemId).name, effect: result.effect })
      this.queueInventoryChanged()
    } else if (result.itemId) {
      this.events.queue('item:useFailed', { itemId: result.itemId, name: getItemDef(result.itemId).name, reason: result.reason })
    }
    return result
  }

  /** Lấy ô `slot` của container đang mở vào túi; phần không vừa ở lại container. */
  takeFromContainer(slot: number): TransferResult {
    const c = this.openContainer
    if (!c) return { moved: 0, remainder: 0 }
    const r = transferSlot(c.items, slot, this.player.inventory)
    if (r.moved > 0) this.queueInventoryChanged()
    return r
  }

  /** Cất ô `slot` của túi vào container đang mở. */
  putIntoContainer(slot: number): TransferResult {
    const c = this.openContainer
    if (!c) return { moved: 0, remainder: 0 }
    const r = transferSlot(this.player.inventory, slot, c.items)
    if (r.moved > 0) this.queueInventoryChanged()
    return r
  }

  /** Lấy tất cả có thể; hết chỗ thì đồ còn lại vẫn ở container. */
  takeAll(): TransferResult {
    const c = this.openContainer
    if (!c) return { moved: 0, remainder: 0 }
    const r = transferAll(c.items, this.player.inventory)
    if (r.moved > 0) this.queueInventoryChanged()
    return r
  }

  private syncUiOpen(): void {
    this.uiOpen = this.inventoryOpen || this.openContainerId !== null
  }

  private queueInventoryChanged(): void {
    this.events.queue('inventory:changed', { inventoryOpen: this.inventoryOpen, containerId: this.openContainerId })
  }

  private stepZombies(dt: number): PendingAttack[] {
    const attacks: PendingAttack[] = []
    const target = this.player.position
    const cfg = GAME_CONFIG.zombie
    for (const zombie of this.zombies.values()) {
      const body = this.zombieBodies.get(zombie.id)
      if (body) {
        const t = body.translation()
        zombie.position.x = t.x
        zombie.position.y = t.y
        zombie.position.z = t.z
      }

      const result = stepZombie(zombie, target, this.player.alive, dt, cfg, this.zombieAIContext)

      if (result.transition) {
        this.events.queue('zombie:stateChanged', { id: zombie.id, ...result.transition })
        if (result.transition.to === 'DEAD') this.onZombieDied(zombie, 'unknown')
      }
      if (result.attack) {
        attacks.push({ sourceId: zombie.id, damage: cfg.damage })
      }
      if (body && zombie.ai !== 'DEAD') {
        const sep = this.separation(zombie)
        const v = body.linvel()
        body.setLinvel({ x: result.velocity.x + sep.x, y: v.y, z: result.velocity.z + sep.z }, true)
      }
    }
    return attacks
  }

  /** Đẩy nhẹ zombie ra khỏi các zombie còn sống khác để không chồng lên một điểm. */
  private separation(zombie: ZombieState): { x: number; z: number } {
    const cfg = GAME_CONFIG.zombie
    let x = 0
    let z = 0
    for (const other of this.zombies.values()) {
      if (other === zombie || other.ai === 'DEAD') continue
      const dx = zombie.position.x - other.position.x
      const dz = zombie.position.z - other.position.z
      const d = Math.hypot(dx, dz)
      if (d >= cfg.separationRadius || d < 1e-4) continue
      const w = (cfg.separationRadius - d) / cfg.separationRadius
      x += (dx / d) * w
      z += (dz / d) * w
    }
    return { x: x * cfg.separationSpeed, z: z * cfg.separationSpeed }
  }

  private stepCombat(attacks: PendingAttack[], dt: number): void {
    const player = this.player
    if (player.alive && !this.uiOpen) {
      if (this.input.wasPressed('attack') && startAttack(player)) {
        if (this.cursorWorld) player.facing = facingTowards(player.position, this.cursorWorld)
      }
      if (this.input.wasPressed('push') && startPush(player)) {
        if (this.cursorWorld) player.facing = facingTowards(player.position, this.cursorWorld)
        this.resolvePlayerPush()
      }
    }
    if (tickPlayerCombat(player, dt)) this.resolvePlayerMelee()

    // Chỉ zombie còn sống sau khi người chơi ra đòn mới gây sát thương.
    for (const attack of attacks) {
      const zombie = this.zombies.get(attack.sourceId)
      if (!zombie || zombie.ai === 'DEAD') continue
      this.applyPlayerDamage(attack.damage, attack.sourceId)
    }
  }

  private meleeTargets(): MeleeTarget[] {
    const r = GAME_CONFIG.zombie.radius
    const list: MeleeTarget[] = []
    for (const z of this.zombies.values()) list.push({ id: z.id, position: z.position, radius: r, alive: z.ai !== 'DEAD' })
    return list
  }

  private isTargetBlocked(target: MeleeTarget): boolean {
    if (!this.physics) return false
    return this.physics.isBlocked(atHeight(this.player.position, SWING_HEIGHT), atHeight(target.position, SWING_HEIGHT), [])
  }

  private resolvePlayerMelee(): void {
    const cfg = GAME_CONFIG.melee
    const hits = resolveConeHits(this.player.position, this.player.facing, this.meleeTargets(), cfg, (t) => this.isTargetBlocked(t))
    const hitIds: EntityId[] = []
    for (const hit of hits) {
      const zombie = this.zombies.get(hit.id)
      if (!zombie) continue
      hitIds.push(zombie.id)
      const from = zombie.ai
      const died = damageZombie(zombie, cfg.damage)
      this.events.queue('zombie:damaged', { id: zombie.id, amount: cfg.damage, health: zombie.health })
      if (died) {
        this.events.queue('zombie:stateChanged', { id: zombie.id, from, to: 'DEAD' })
        this.onZombieDied(zombie, 'player')
      } else {
        applyKnockback(zombie, this.player.position, cfg.knockback, cfg.stagger)
      }
    }
    this.events.queue('player:attacked', { hitIds })
  }

  private resolvePlayerPush(): void {
    const cfg = GAME_CONFIG.push
    const hits = resolveConeHits(this.player.position, this.player.facing, this.meleeTargets(), cfg, (t) => this.isTargetBlocked(t))
    const hitIds: EntityId[] = []
    for (const hit of hits) {
      const zombie = this.zombies.get(hit.id)
      if (!zombie) continue
      hitIds.push(zombie.id)
      applyKnockback(zombie, this.player.position, cfg.knockback, cfg.stagger)
    }
    this.events.queue('player:pushed', { hitIds })
  }

  /** DEAD hủy AI, collider và đòn đang chờ: tắt body để không chặn đường và không nhận đòn. */
  private onZombieDied(zombie: ZombieState, sourceId: EntityId): void {
    if (sourceId === 'player') this.player.kills += 1
    const body = this.zombieBodies.get(zombie.id)
    if (body) {
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      body.setEnabled(false)
    }
    this.events.queue('zombie:died', { id: zombie.id, sourceId })
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

function atHeight(p: Vec3, y: number): Vec3 {
  return { x: p.x, y, z: p.z }
}

function buildInteractables(map: MapData): Interactable[] {
  const list: Interactable[] = []
  for (const door of map.doors) {
    list.push({
      id: door.id,
      kind: 'door',
      name: door.name,
      position: { x: door.center.x, y: 1, z: door.center.z },
      radius: door.width / 2 + 0.4,
    })
  }
  for (const c of map.containers) {
    list.push({
      id: c.id,
      kind: 'container',
      name: c.name,
      position: { ...c.position },
      radius: Math.max(c.size[0], c.size[2]) / 2 + 0.3,
    })
  }
  return list
}

/** Singleton runtime cho ứng dụng. Test tạo instance riêng bằng `new GameRuntime()`. */
export const runtime = new GameRuntime()
