import type { RapierRigidBody } from '@react-three/rapier'
import { GAME_CONFIG } from './config'
import { GameClock } from './clock'
import { EventBus, type GameEvents } from './events'
import { createPlayerState, type CharacterProfile, type PlayerState } from '../entities/player'
import { normalizeName } from '../entities/appearance'
import { createZombieState, UNAWARE_STATES, type ZombieState } from '../entities/zombie'
import { InputManager } from '../systems/input'
import { computeCameraBasis, computeMoveDirection, dampAngle, regenStamina, resolvePlayerSpeed } from '../systems/movement'
import { applyKnockback, damageZombie, stepZombie, type ZombieAIContext } from '../systems/ai'
import { facingTowards, resolveConeHits, startAttack, startPush, tickPlayerCombat, type MeleeTarget } from '../systems/combat'
import { damagePlayer, tickSurvival, consumeInventoryItem, type UseItemResult } from '../systems/survival'
import { INTERACT_RANGE, selectInteractable, type Interactable } from '../systems/interaction'
import { transferAll, transferSlot, type TransferResult } from '../systems/inventory'
import { createRng, hashSeed, randomSeed } from '../systems/loot'
import { pickSpawnPoint, spawnInterval } from '../systems/spawn'
import { migrationInterval, nearestZone, planMigration } from '../systems/horde'
import { getItemDef } from '../entities/items'
import { cloneInventory } from '../systems/inventory'
import { createInventory } from '../systems/inventory'
import { applyWeaponWear, meleeStats, weaponHitDamage } from '../systems/weapons'
import { equipWeapon, equippedWeapon, reconcileEquipment } from '../systems/equipment'
import { validateSaveGame } from '../systems/save'
import { checkRecipe, commitRecipe, type CraftFailure } from '../systems/crafting'
import { advanceAction, reservationBlocks, reservationFor, type ActionCancelReason, type TimedAction } from '../systems/timedAction'
import { RECIPES, repairRecipeFor, type Recipe, type RecipeId } from '../entities/recipes'
import { DOOR_MAX_HP, type DoorStatus } from '../world/doors'
import { SAVE_SCHEMA_VERSION, type SaveGame } from '../../types/save'
import { NEIGHBORHOOD_MAP, type MapData } from '../world/mapData'
import { NavGrid } from '../world/navigation'
import { isInsideBuilding } from '../world/buildings'
import { createWorldState, type ContainerState, type WorldState } from '../world/worldState'
import type { EntityId, Vec3 } from '../../types'
import { DOOR_LAB_ENABLED, DOOR_LAB_MAP } from '../world/doorLab'
import { STRESS_TILES, buildStressMap } from '../world/stressMap'
import { DEV_WORLD_ID, loadDevWorld } from '../world/devWorld'
import { playtestSession } from '../world/playtest'
import { buildVisionOccluders, type VisionOccluderSet } from '../world/visionOccluders'
import { PlayerVisionSystem, type VisionTarget } from '../systems/playerVision'
import { BuildingLightingSystem, buildLightingBuildings, outdoorLightLevel } from '../lighting/buildingLighting'
import { mapRooms, mapWindows } from '../world/mapData'
import { PerfMonitor } from './perf'
import { SpatialHash } from './spatialHash'
import { AIScheduler, type ScheduledUpdate } from '../systems/aiScheduler'
import { PathfindingQueue } from '../world/pathfindingQueue'
import { StaticColliderRegistry, registerMapColliders } from '../world/staticColliders'
import { moveZombie, pushOutOfCircle, resolveStatic, type Circle, type MoveEnv } from '../systems/zombieMovement'
import type { BuildingInfo } from '../world/buildings'

interface PendingAttack {
  sourceId: EntityId
  damage: number
}

interface PendingStructureHit {
  sourceId: EntityId
  doorId: string
}

/**
 * R2: what the runtime needs from a zombie's physics body. Rapier's kinematic body satisfies it; the
 * simulation writes the position, never reads it back.
 */
export interface ZombieBodyProxy {
  setNextKinematicTranslation(t: { x: number; y: number; z: number }): void
  setEnabled?(enabled: boolean): void
}

export type ActionStartFailure = CraftFailure | 'busy' | 'dead'
export type ActionStartResult = { ok: true; id: number } | { ok: false; reason: ActionStartFailure }

/**
 * Obstruction query. R3b: the runtime answers it itself from `staticColliders` (the boxes Rapier
 * was given); tests may install a stand-in with `setLineOfSightOverride`.
 */
export interface LineOfSightQuery {
  /** true nếu có khối chặn (tường, cửa đóng...) giữa hai điểm, bỏ qua các ID trong `ignoreIds`. */
  isBlocked(from: Vec3, to: Vec3, ignoreIds: readonly string[]): boolean
}

const FACING_SMOOTHING = 14
/** Duration of the player's hit-reaction pose (view only). */
const PLAYER_HURT_TIME = 0.3
/** Độ cao raycast tầm nhìn zombie: nhìn qua được hàng rào/thùng thấp, không qua tường/cửa. */
const EYE_HEIGHT = 1.5
/** Độ cao raycast kiểm tra tường chắn đòn gậy. */
const SWING_HEIGHT = 1.2
/**
 * R1 spatial index cell sizes (m): zombies ≈ the separation/melee/vision query scale, interactables
 * the interaction range, buildings their footprint (a query touches one or two cells).
 */
const ZOMBIE_CELL = 4
const INTERACTABLE_CELL = 4
const BUILDING_CELL = 16

/**
 * Trạng thái runtime của simulation. Không phải React state: render đọc trực
 * tiếp trong game loop, UI chỉ nhận snapshot theo nhịp chậm (hudStore).
 *
 * Thứ tự một tick: input → chuyển động/physics → tương tác → AI → combat →
 * survival/clock → tầm nhìn người chơi (chỉ cho render) → phát sự kiện → (render/UI tự đọc ở frame kế tiếp).
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
  interactables: Interactable[]
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
  /** Tăng mỗi ván mới hoặc mỗi lần load; dùng làm key để remount scene và tạo lại physics body. */
  sessionId = 0
  /** Đếm ngược tới lần spawn kế tiếp (giây game). */
  spawnTimer = 0
  /** Số lần đã spawn; seed RNG spawn = hash(seed ván, counter) để tái lập sau load. */
  spawnCounter = 0
  /** Đếm ngược autosave; khi hết, `autosaveDue` bật và game loop chụp snapshot ngay sau tick. */
  autosaveTimer = GAME_CONFIG.save.autosaveInterval
  autosaveDue = false
  /**
   * Timed craft/repair in progress (plan §7.1). Runtime only: never saved, so a snapshot taken
   * mid-action holds the unconsumed materials, and load/New Game drop it.
   */
  action: TimedAction | null = null
  private nextActionId = 1
  /** P2-S5: radius of the player's footstep noise this tick (0 = silent); zombies inside hear it. */
  playerNoise = 0
  /** P2-S5 horde director: seconds to the next migration attempt and attempt counter (seeds its RNG). */
  hordeTimer: number = GAME_CONFIG.horde.intervalMin
  hordeCounter = 0
  /** Contact slots per door side (`doorId:side` → zombie IDs); at most two zombies bash a side. */
  private doorSlots = new Map<string, (EntityId | null)[]>()
  /** Rest-time RNG for the AI (not saved; wander targets use per-zombie seeds). */
  private aiRng = createRng(1)

  private playerBody: RapierRigidBody | null = null
  /** R2: kinematic bodies of ACTIVE zombies (mounted by the view layer); positions are pushed into them. */
  private zombieBodies = new Map<EntityId, ZombieBodyProxy>()
  /** Test stand-in for the obstruction query (null = the simulation's own boxes). */
  private losOverride: LineOfSightQuery | null = null
  private nextZombieId = 1
  private readonly zombieAIContext: ZombieAIContext
  /** Walls, tall furniture and closed doors that block the player's sight (door state read live). */
  readonly visionOccluders: VisionOccluderSet
  /**
   * What the player character can see (render only: fade/hide zombies, debug, mask). Runs last in
   * the tick and never feeds the AI; hidden zombies keep wandering, chasing and bashing doors.
   */
  readonly vision: PlayerVisionSystem
  /**
   * Building lighting (room graph): derived room light from windows, doors, lamps and power. World
   * state only drives it through dirty marks; it never reads the player's facing or vision.
   */
  readonly lighting: BuildingLightingSystem
  /** R0 instrumentation: section timings, counters and gauges over a rolling window (perf HUD, benchmarks). */
  readonly perf = new PerfMonitor()
  /**
   * R1 spatial indexes. Zombies are re-bucketed as they move (queries: separation, melee, player
   * vision); interactables (map objects + dropped bags) and buildings are static. Results come in
   * insertion order, which is the order of the lists they replace.
   */
  readonly zombieIndex = new SpatialHash<ZombieState>(ZOMBIE_CELL)
  private readonly interactableIndex = new SpatialHash<Interactable>(INTERACTABLE_CELL)
  private readonly buildingIndex = new SpatialHash<BuildingInfo>(BUILDING_CELL)
  /** Largest interactable radius: the interaction query reaches `INTERACT_RANGE` + this. */
  private maxInteractRadius = 0
  private readonly nearbyScratch: ZombieState[] = []
  private readonly neighbourScratch: ZombieState[] = []
  /**
   * R2: the simulation owns zombie transforms. `zombie.position` is authoritative; Rapier only
   * mirrors ACTIVE zombies with kinematic bodies. (Benchmarks and tests check this flag.)
   */
  readonly simulationOwnsZombies = true
  /** Solid boxes for zombie movement (walls, containers, panes, door leaves); R3 registers per chunk. */
  readonly staticColliders = new StaticColliderRegistry()
  /** Decides which zombies run their AI each tick (levels, rates, budget). */
  readonly aiScheduler = new AIScheduler(GAME_CONFIG.simulation)
  /** A* requests of the AI, served after the AI pass within a budget. */
  readonly pathQueue = new PathfindingQueue()
  /**
   * Budget of `pathQueue` per tick. The time part depends on the machine; deterministic runs (soak,
   * replays) set `maxPathMs` to Infinity and keep only the count.
   */
  pathBudget = { ...GAME_CONFIG.pathfinding }
  private readonly aiUpdates: ScheduledUpdate[] = []
  /** DORMANT zombies move only when their AI ran, by the time step it received. */
  private readonly dormantStep = new Map<EntityId, number>()
  private readonly moveEnv: MoveEnv

  constructor(map: MapData = NEIGHBORHOOD_MAP) {
    this.map = map
    this.nav = new NavGrid(map, GAME_CONFIG.nav)
    this.interactables = buildInteractables(map)
    this.interactableById = new Map(this.interactables.map((i) => [i.id, i]))
    for (const b of map.buildings) this.buildingIndex.insert(b.id, b, b.center.x, b.center.z, b.size.w / 2, b.size.d / 2)
    registerMapColliders(this.staticColliders, map, (id) => this.world.doors.get(id)?.state)
    this.moveEnv = {
      colliders: this.staticColliders,
      radius: GAME_CONFIG.zombie.radius,
      height: GAME_CONFIG.zombie.height,
      substep: GAME_CONFIG.simulation.movementSubstep,
    }
    this.player = createPlayerState(map.playerSpawn)
    this.world = createWorldState(map, 0)
    this.visionOccluders = buildVisionOccluders(
      map,
      (id) => this.world.doors.get(id)?.state,
      GAME_CONFIG.playerVision.occluderMinHeight,
      (id) => this.world.curtains.get(id) === true,
    )
    this.lighting = new BuildingLightingSystem(GAME_CONFIG.buildingLighting, {
      doorState: (id) => this.world.doors.get(id)?.state,
      curtainClosed: (id) => this.world.curtains.get(id) === true,
      lampOn: (id) => this.world.lamps.get(id) === true,
      electricity: () => this.world.electricity,
    }, buildLightingBuildings(map, GAME_CONFIG.buildingLighting))
    this.vision = new PlayerVisionSystem(GAME_CONFIG.playerVision, {
      getNearbyEntities: (center, radius) => this.getNearbyZombies(center, radius),
      hasLineOfSight: (from, to) => {
        this.perf.count('visionRaycasts')
        return this.visionOccluders.firstBlocker(from, to) === null
      },
    })

    // Zombie chỉ phát hiện và gây sát thương khi không có tường/cửa đóng giữa nó và người chơi;
    // đường đi lấy từ lưới điều hướng (đi vòng tường, qua cửa mở).
    this.zombieAIContext = {
      canReach: (zombie, target) => {
        this.perf.count('zombieRaycasts')
        return !this.isBlocked(atHeight(zombie.position, EYE_HEIGHT), atHeight(target, EYE_HEIGHT), [])
      },
      // R2: the AI files path requests; A* runs in `stepPathQueue` after the AI pass (budgeted).
      requestPath: (zombie, from, to) => {
        const t = this.perf.begin()
        this.perf.count('pathRequests')
        const kind = this.nav.routeKind(from, to)
        let result: 'none' | 'ready' | 'queued' = 'queued'
        if (kind === 'none') {
          this.pathQueue.cancel(zombie.id)
          zombie.pathPending = false
          result = 'none'
        } else if (kind === 'direct') {
          this.pathQueue.cancel(zombie.id)
          zombie.path = this.nav.findPath(from, to) ?? []
          zombie.pathIndex = 0
          zombie.pathPending = false
          result = 'ready'
        } else {
          this.pathQueue.request(zombie.id, to, zombie.simLevel)
          zombie.pathPending = true
        }
        this.perf.end('nav', t)
        return result
      },
      hasLineOfWalk: (from, to) => this.nav.hasLineOfWalk(from, to),
      getNavVersion: () => this.nav.version,
      noiseRadius: () => this.playerNoise,
      findDoorRoute: (from, to) => {
        const t = this.perf.begin()
        this.perf.count('doorRoutes')
        const route = this.nav.findDoorRoute(from, to)
        this.perf.end('nav', t)
        return route
      },
      getDoor: (id) => {
        const door = this.world.doors.get(id)
        const portal = this.nav.portals.get(id)
        return door && portal ? { state: door.state, center: portal.center } : null
      },
      claimDoorSlot: (zombie, doorId, side) => this.claimDoorSlot(zombie, doorId, side),
      pickWanderPoint: (zombie) => this.pickWanderPoint(zombie),
      random: () => this.aiRng(),
    }

    this.newGame()
  }

  /**
   * Ván mới với seed loot; loot mọi container được sinh ngay tại đây, một lần cho cả ván.
   * `profile` comes from character creation (cosmetic only); omitted = default look.
   */
  newGame(seed: number = randomSeed(), profile?: CharacterProfile): void {
    this.sessionId += 1
    this.clock.reset()
    this.events.clear()
    this.input.clear()
    this.cameraZoom = GAME_CONFIG.camera.zoomDefault
    // P2-S2: New Game starts unarmed (shove still works); melee is looted from containers.
    // Only the v1 save migration grants the Phase 1 bat.
    this.player = createPlayerState(this.map.playerSpawn, profile && { name: normalizeName(profile.name), appearance: profile.appearance })
    this.world = createWorldState(this.map, seed)
    this.interactables = buildInteractables(this.map)
    this.interactableById.clear()
    this.interactableIndex.clear()
    this.maxInteractRadius = 0
    for (const item of this.interactables) this.indexInteractable(item)
    this.nav.resetDoors()
    this.currentInteractable = null
    this.interactPrompt = null
    this.cursorWorld = null
    this.inventoryOpen = false
    this.openContainerId = null
    this.uiOpen = false
    this.zombies.clear()
    this.zombieIndex.clear()
    this.aiScheduler.clear()
    this.pathQueue.clear()
    this.dormantStep.clear()
    this.zombieBodies.clear()
    this.playerBody = null
    this.nextZombieId = 1
    this.spawnCounter = 0
    this.spawnTimer = spawnInterval(this.clock.isNight)
    this.autosaveTimer = GAME_CONFIG.save.autosaveInterval
    this.autosaveDue = false
    this.action = null
    this.playerNoise = 0
    this.hordeTimer = GAME_CONFIG.horde.intervalMin
    this.hordeCounter = 0
    this.doorSlots.clear()
    this.vision.clear()
    this.lighting.markAllDirty()
    this.aiRng = createRng(hashSeed(seed, 'ai'))
    for (const spawn of this.map.zombieSpawns) this.spawnZombie(spawn)
  }

  /** New zombies join the group of the zone nearest their spawn point. */
  spawnZombie(position: Vec3): ZombieState {
    const id = `zombie-${this.nextZombieId++}`
    return this.addZombie(id, position, nearestZone(position, this.map.zombieZones)?.id ?? null)
  }

  private addZombie(id: EntityId, position: Vec3, zoneId: string | null): ZombieState {
    const zombie = createZombieState(id, position, zoneId)
    this.zombies.set(id, zombie)
    this.zombieIndex.insert(id, zombie, position.x, position.z)
    this.aiScheduler.add(zombie, this.player.position)
    return zombie
  }

  // ----- Save / load: snapshot ở ranh giới tick, dữ liệu thuần -----

  /** Chụp toàn bộ simulation. Gọi giữa hai tick (game loop hoặc khi pause). */
  createSnapshot(): SaveGame {
    const p = this.player
    const zombies: SaveGame['zombies'] = []
    for (const z of this.zombies.values()) {
      if (z.ai === 'DEAD') continue
      zombies.push({
        id: z.id,
        position: { ...z.position },
        facing: z.facing,
        health: z.health,
        ai: z.ai,
        lastKnownTarget: z.lastKnownTarget ? { ...z.lastKnownTarget } : null,
        memoryAge: z.lastKnownTarget ? z.memoryAge : 0,
        memorySource: z.lastKnownTarget ? z.memorySource : null,
        zoneId: z.zoneId,
        structureTargetId: z.structureTargetId,
      })
    }
    return {
      schemaVersion: SAVE_SCHEMA_VERSION,
      savedAt: Date.now(),
      mapId: this.map.id,
      contentVersion: this.map.contentVersion ?? 0,
      worldSeed: this.world.seed,
      clock: { elapsed: this.clock.elapsed, timeOfDay: this.clock.timeOfDay, day: this.clock.day },
      player: {
        name: p.name,
        appearance: { ...p.appearance },
        position: { ...p.position },
        facing: p.facing,
        health: p.health,
        stamina: p.stamina,
        hunger: p.hunger,
        thirst: p.thirst,
        kills: p.kills,
        inventory: cloneInventory(p.inventory),
        equipment: { ...p.equipment },
      },
      doors: Array.from(this.world.doors.values()).map((d) => ({ ...d })),
      containers: Array.from(this.world.containers.values()).map((c) => ({ id: c.id, opened: c.opened, items: cloneInventory(c.items), ...(c.position ? { position: { ...c.position } } : {}) })),
      zombies,
      spawn: { nextZombieId: this.nextZombieId, timer: this.spawnTimer, counter: this.spawnCounter },
      horde: { timer: this.hordeTimer, counter: this.hordeCounter },
      lighting: {
        curtains: Array.from(this.world.curtains, ([id, closed]) => ({ id, closed })),
        lamps: Array.from(this.world.lamps, ([id, on]) => ({ id, on })),
        electricity: this.world.electricity,
      },
      cameraZoom: this.cameraZoom,
    }
  }

  /**
   * Nạp bản lưu đã được `validateSaveGame` kiểm tra. Bắt đầu như ván mới với
   * cùng seed rồi ghi đè: không tạo zombie từ điểm spawn (tránh nhân đôi), nội
   * dung container lấy từ bản lưu (không gieo lại). Scene remount theo `sessionId`
   * và đặt body tại vị trí đã lưu.
   */
  loadSnapshot(save: SaveGame): void {
    const validation = validateSaveGame(save, this.map.id, this.map)
    if (!validation.ok) throw new Error(`Invalid save: ${validation.detail}`)
    save = validation.save
    this.newGame(save.worldSeed, { name: save.player.name, appearance: save.player.appearance })
    this.zombies.clear()
    this.zombieIndex.clear()
    this.aiScheduler.clear()
    this.pathQueue.clear()
    this.clock.restore(save.clock.elapsed, save.clock.timeOfDay, save.clock.day)
    this.cameraZoom = Math.min(GAME_CONFIG.camera.zoomMax, Math.max(GAME_CONFIG.camera.zoomMin, save.cameraZoom))

    const p = this.player
    const lim = GAME_CONFIG.player
    p.position = { ...save.player.position }
    p.facing = save.player.facing
    p.health = clamp(save.player.health, 0, lim.maxHealth)
    p.stamina = clamp(save.player.stamina, 0, lim.maxStamina)
    p.hunger = clamp(save.player.hunger, 0, lim.maxHunger)
    p.thirst = clamp(save.player.thirst, 0, lim.maxThirst)
    p.kills = save.player.kills
    p.alive = p.health > 0
    p.inventory = cloneInventory(save.player.inventory)
    p.equipment = { ...save.player.equipment }

    for (const d of save.doors) {
      const door = this.world.doors.get(d.id)
      if (!door) continue
      door.state = d.state
      door.hp = d.hp
      this.nav.setDoorState(door.id, door.state)
    }
    // Lighting inputs (derived room light is recomputed, never saved).
    for (const c of save.lighting.curtains) if (this.world.curtains.has(c.id)) this.world.curtains.set(c.id, c.closed)
    for (const l of save.lighting.lamps) if (this.world.lamps.has(l.id)) this.world.lamps.set(l.id, l.on)
    this.world.electricity = save.lighting.electricity
    this.lighting.markAllDirty()
    for (const c of save.containers) {
      if (c.position) {
        this.world.containers.set(c.id, { ...c, position: { ...c.position }, items: cloneInventory(c.items) })
        this.registerDropInteractable(c.id, c.position)
        continue
      }
      const container = this.world.containers.get(c.id)!
      container.opened = c.opened
      container.items = cloneInventory(c.items)
    }

    // AI resumes in the saved state; timers, paths and door slots are recomputed (never saved).
    for (const z of save.zombies) {
      const zombie = this.addZombie(z.id, z.position, z.zoneId)
      zombie.facing = z.facing
      zombie.health = clamp(z.health, 0, GAME_CONFIG.zombie.health)
      zombie.ai = z.ai === 'DEAD' ? 'IDLE' : z.ai
      zombie.lastKnownTarget = z.lastKnownTarget ? { ...z.lastKnownTarget } : null
      zombie.memoryAge = z.memoryAge
      zombie.memorySource = z.memorySource
      zombie.structureTargetId = z.structureTargetId
      const portal = z.structureTargetId ? this.nav.portals.get(z.structureTargetId) : undefined
      if (portal) {
        const side = planar(portal.sides[0], z.position) <= planar(portal.sides[1], z.position) ? 0 : 1
        zombie.structureSide = side
        zombie.structureApproach = { ...portal.sides[side] }
      }
    }
    this.nextZombieId = Math.max(save.spawn.nextZombieId, maxZombieNumber(this.zombies) + 1)
    this.spawnTimer = Math.max(0, save.spawn.timer)
    this.spawnCounter = save.spawn.counter
    this.hordeTimer = Math.max(0, save.horde.timer)
    this.hordeCounter = save.horde.counter
  }

  /** Game loop gọi ngay sau tick; true đúng một lần mỗi khi tới hạn autosave. */
  consumeAutosave(): boolean {
    if (!this.autosaveDue) return false
    this.autosaveDue = false
    return true
  }

  registerPlayerBody(body: RapierRigidBody | null): void {
    this.playerBody = body
  }

  /** A kinematic body appears when the zombie becomes ACTIVE and goes away when it leaves ACTIVE or dies. */
  registerZombieBody(id: EntityId, body: ZombieBodyProxy | null): void {
    if (body) this.zombieBodies.set(id, body)
    else this.zombieBodies.delete(id)
  }

  /** Replace the obstruction query (tests); null restores the simulation's own collider boxes. */
  setLineOfSightOverride(query: LineOfSightQuery | null): void {
    this.losOverride = query
  }

  /** Solid box between two points (walls, containers, window glass, door leaves), ignoring `ignoreIds`. */
  isBlocked(from: Vec3, to: Vec3, ignoreIds: readonly string[]): boolean {
    if (this.losOverride) return this.losOverride.isBlocked(from, to, ignoreIds)
    return this.staticColliders.segmentBlocked(from, to, ignoreIds[0])
  }

  adjustZoom(steps: number): void {
    const cam = GAME_CONFIG.camera
    this.cameraZoom = Math.min(cam.zoomMax, Math.max(cam.zoomMin, this.cameraZoom + steps * cam.zoomStep))
  }

  /** Một bước simulation. `rawDt` tính bằng giây và được giới hạn để tránh nhảy sau khi tab mất focus. */
  tick(rawDt: number): void {
    const dt = Math.min(rawDt, GAME_CONFIG.loop.maxDelta)
    if (dt <= 0) return
    const perf = this.perf
    const tickStart = perf.begin()

    this.stepPlayerMovement(dt)
    this.stepInteraction()
    let t = perf.begin()
    const { attacks, structureHits } = this.stepZombies(dt)
    perf.end('ai', t)
    t = perf.begin()
    this.stepCombat(attacks, dt)
    this.stepStructureHits(structureHits)
    perf.end('combat', t)
    this.stepAction(dt)
    this.stepSurvival(dt)
    t = perf.begin()
    this.stepSpawn(dt)
    this.stepHorde(dt)
    perf.end('spawn', t)
    // Building lighting: the day/night level (throttled) + dirty buildings only (doors, lamps...).
    t = perf.begin()
    this.lighting.updateOutdoorLight(outdoorLightLevel(this.clock.timeOfDay, GAME_CONFIG.buildingLighting))
    this.lighting.update()
    perf.end('lighting', t)
    // Player vision last: reads final positions this tick, writes only render-facing state.
    t = perf.begin()
    this.vision.update(dt, this.player)
    perf.end('vision', t)
    this.clock.advance(dt)
    this.events.flush()
    this.input.endFrame()
    perf.end('sim', tickStart)
    this.recordPerfGauges()
    perf.endTick()

    if (this.player.alive) {
      this.autosaveTimer -= dt
      if (this.autosaveTimer <= 0) {
        this.autosaveTimer = GAME_CONFIG.save.autosaveInterval
        this.autosaveDue = true
      }
    }
  }

  /** Per-tick gauges for the perf HUD (counts only; no allocation). */
  private recordPerfGauges(): void {
    const perf = this.perf
    let alive = 0
    for (const z of this.zombies.values()) if (z.ai !== 'DEAD') alive += 1
    const levels = this.aiScheduler.countLevels(this.zombies.values())
    perf.gauge('zombies', this.zombies.size)
    perf.gauge('zombiesAlive', alive)
    perf.gauge('zombiesActive', levels.ACTIVE)
    perf.gauge('zombiesNear', levels.NEAR)
    perf.gauge('zombiesDormant', levels.DORMANT)
    perf.gauge('zombieBodies', this.zombieBodies.size)
    perf.gauge('pathQueue', this.pathQueue.size)
    perf.count('occluderTests', this.visionOccluders.testCount)
    this.visionOccluders.testCount = 0
  }

  /**
   * Dọn xác cũ và spawn có giới hạn: chỉ khi số zombie sống dưới `maxActive`,
   * theo nhịp ngày/đêm, tại điểm đặt tay đủ xa người chơi (ưu tiên khuất tầm nhìn).
   * Không spawn khi người chơi đã chết.
   */
  private stepSpawn(dt: number): void {
    const cfg = GAME_CONFIG.spawn
    let alive = 0
    for (const z of this.zombies.values()) {
      if (z.ai === 'DEAD') {
        if (z.deadTimer >= cfg.corpseLifetime) this.removeZombie(z.id)
      } else {
        alive += 1
      }
    }
    if (!this.player.alive) return

    this.spawnTimer -= dt
    if (this.spawnTimer > 0) return
    this.spawnTimer = spawnInterval(this.clock.isNight)
    if (alive >= (this.map.maxActiveZombies ?? cfg.maxActive)) return

    const aliveZombies: Vec3[] = []
    for (const z of this.zombies.values()) if (z.ai !== 'DEAD') aliveZombies.push(z.position)
    const playerEye = atHeight(this.player.position, EYE_HEIGHT)
    const point = pickSpawnPoint(
      this.map.zombieSpawns,
      {
        playerPos: this.player.position,
        aliveZombies,
        isHiddenFromPlayer: (pt) => {
          this.perf.count('otherRaycasts')
          return this.isBlocked(playerEye, atHeight(pt, EYE_HEIGHT), [])
        },
        // Plan §10.5: never inside a building (a barricaded shelter stays empty) or a blocked cell.
        isAllowed: (pt) => this.nav.isWalkable(pt.x, pt.z) && this.buildingAt(pt, 0.5) === null,
      },
      createRng(hashSeed(this.world.seed, `spawn:${this.spawnCounter}`)),
    )
    this.spawnCounter += 1
    if (!point) return
    const zombie = this.spawnZombie(point)
    this.events.queue('zombie:spawned', { id: zombie.id })
  }

  /**
   * Zombies (dead ones too, for their fade-out) within the square of half-size `radius` around a
   * point: the player vision broad phase. R1: a spatial-hash query, same items and order as the old
   * loop over every zombie. The returned array is reused by the next call.
   */
  getNearbyZombies(center: Vec3, radius: number): readonly VisionTarget[] {
    const out = this.nearbyScratch
    out.length = 0
    return this.zombieIndex.queryAABB(center.x - radius, center.z - radius, center.x + radius, center.z + radius, out)
  }

  /** Re-bucket every zombie at its current position (positions may be changed from outside a tick). */
  private syncZombieIndex(): void {
    for (const z of this.zombies.values()) this.zombieIndex.update(z.id, z.position.x, z.position.z)
  }

  private removeZombie(id: EntityId): void {
    this.zombies.delete(id)
    this.zombieIndex.remove(id)
    this.aiScheduler.remove(id)
    this.pathQueue.cancel(id)
    this.dormantStep.delete(id)
    this.zombieBodies.delete(id)
    this.vision.forget(id)
    this.events.queue('zombie:removed', { id })
  }

  /**
   * Horde migration (external director): every few minutes one zone's group is pushed to another
   * zone. Idle/wandering members start walking there at once (MIGRATE); hunting members keep
   * hunting and wander in the new zone afterwards. Seeded by (world seed, attempt counter).
   */
  private stepHorde(dt: number): void {
    const zones = this.map.zombieZones
    if (!zones || zones.length < 2) return
    this.hordeTimer -= dt
    if (this.hordeTimer > 0) return
    const rng = createRng(hashSeed(this.world.seed, `horde:${this.hordeCounter}`))
    this.hordeCounter += 1
    const plan = planMigration(Array.from(this.zombies.values(), (z) => ({ id: z.id, zoneId: z.zoneId, ai: z.ai })), zones, rng)
    if (!plan) {
      this.hordeTimer = GAME_CONFIG.horde.retryDelay
      return
    }
    this.hordeTimer = migrationInterval(rng)
    const moving: EntityId[] = []
    for (const id of plan.ids) {
      const zombie = this.zombies.get(id)!
      zombie.zoneId = plan.to
      if (!UNAWARE_STATES.has(zombie.ai)) continue
      const point = this.pickWanderPoint(zombie)
      if (!point) continue
      zombie.moveTarget = point
      zombie.moveTimer = 0
      zombie.path = []
      zombie.pathIndex = 0
      zombie.pathGoal = null
      if (zombie.ai !== 'MIGRATE') this.events.queue('zombie:stateChanged', { id, from: zombie.ai, to: 'MIGRATE' })
      zombie.ai = 'MIGRATE'
      moving.push(id)
    }
    this.events.queue('horde:migrated', { from: plan.from, to: plan.to, ids: plan.ids, moving })
  }

  /**
   * Random reachable wander destination inside the zombie's zone (or around its spawn point when
   * the map has no zones): walkable, same connected region (never behind a closed door) and not
   * inside a building unless the zombie is already in that building. Deterministic per zombie.
   */
  pickWanderPoint(zombie: ZombieState): Vec3 | null {
    const cfg = GAME_CONFIG.zombie
    const zone = zombie.zoneId ? this.map.zombieZones?.find((z) => z.id === zombie.zoneId) : undefined
    const anchor = zone?.center ?? zombie.home
    const radius = zone?.radius ?? cfg.wanderRadius
    const rng = createRng(hashSeed(this.world.seed, `wander:${zombie.id}:${zombie.wanderCount++}`))
    const region = this.nav.componentAt(zombie.position.x, zombie.position.z)
    const building = this.buildingAt(zombie.position)
    const half = zone?.halfSize
    for (let i = 0; i < 8; i++) {
      let x: number
      let z: number
      if (half) {
        // Rectangle zone (map editor M4): uniform inside it, same two draws as the circle.
        x = anchor.x + (rng() * 2 - 1) * half.x
        z = anchor.z + (rng() * 2 - 1) * half.z
      } else {
        const angle = rng() * Math.PI * 2
        const r = radius * Math.sqrt(rng())
        x = anchor.x + Math.cos(angle) * r
        z = anchor.z + Math.sin(angle) * r
      }
      const cell = this.nav.nearestWalkableCell(x, z, 2)
      if (!cell) continue
      const point = this.nav.cellToWorld(cell.cx, cell.cz)
      if (region < 0 || this.nav.componentAt(point.x, point.z) !== region) continue
      if (this.buildingAt(point) !== building) continue
      if (planar(point, zombie.position) < cfg.wanderMinStep) continue
      return point
    }
    return null
  }

  /** First building (map order) whose footprint grown by `margin` contains the point; spatial query (R1). */
  buildingAt(p: { x: number; z: number }, margin = 0): string | null {
    for (const b of this.buildingIndex.queryAABB(p.x - margin, p.z - margin, p.x + margin, p.z + margin)) {
      if (isInsideBuilding(b, p.x, p.z, margin)) return b.id
    }
    return null
  }

  /** Keep or claim one of the two contact slots on a door side; null when both are taken. */
  private claimDoorSlot(zombie: ZombieState, doorId: string, side: number): Vec3 | null {
    const portal = this.nav.portals.get(doorId)
    if (!portal || (side !== 0 && side !== 1)) return null
    const key = `${doorId}:${side}`
    const holders = this.doorSlots.get(key) ?? portal.slots[side].map(() => null)
    this.doorSlots.set(key, holders)
    let index = holders.indexOf(zombie.id)
    if (index < 0) {
      // Take the free slot nearest to us.
      let best = -1
      for (let i = 0; i < holders.length; i++) {
        if (holders[i] !== null) continue
        if (best < 0 || planar(portal.slots[side][i], zombie.position) < planar(portal.slots[side][best], zombie.position)) best = i
      }
      if (best < 0) return null
      holders[best] = zombie.id
      index = best
    }
    return portal.slots[side][index]
  }

  /** Free slots whose holder died, left the siege or targets another door. */
  private releaseDoorSlots(): void {
    for (const [key, holders] of this.doorSlots) {
      const [doorId, side] = [key.slice(0, key.lastIndexOf(':')), Number(key.slice(key.lastIndexOf(':') + 1))]
      for (let i = 0; i < holders.length; i++) {
        const z = holders[i] ? this.zombies.get(holders[i]!) : undefined
        if (!z || (z.ai !== 'APPROACH_STRUCTURE' && z.ai !== 'ATTACK_STRUCTURE') || z.structureTargetId !== doorId || z.structureSide !== side) holders[i] = null
      }
    }
  }

  /**
   * Door hits from zombies (plan §10.4). Re-validated here: the zombie is alive, the door is still
   * closed and in reach, so opening the door during the windup or a knockback cancels the hit.
   * HP reaching 0 destroys the leaf: collider, nav and events follow `setDoorState`.
   */
  private stepStructureHits(hits: PendingStructureHit[]): void {
    const cfg = GAME_CONFIG.structure
    for (const hit of hits) {
      const zombie = this.zombies.get(hit.sourceId)
      const door = this.world.doors.get(hit.doorId)
      const portal = this.nav.portals.get(hit.doorId)
      if (!zombie || zombie.ai === 'DEAD' || !door || !portal || door.state !== 'closed') continue
      if (planar(zombie.position, portal.center) > cfg.reach * 1.25) continue
      door.hp = Math.max(0, door.hp - cfg.damage)
      this.events.queue('door:damaged', { id: door.id, hp: door.hp, maxHp: DOOR_MAX_HP, sourceId: zombie.id })
      // A timed action aimed at this door (barricade/repair, S6) is interrupted by the hit.
      if (this.action?.worldTargetId === door.id) this.cancelAction('target-damaged')
      if (door.hp <= 0) {
        this.setDoorState(door.id, 'destroyed')
        this.events.queue('door:destroyed', { id: door.id, sourceId: zombie.id })
      }
    }
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
    // Walking away interrupts a craft/repair; nothing is consumed (plan §7.1 step 4).
    if (moving && this.action) this.cancelAction('moved')
    const { speed, running } = resolvePlayerSpeed(player, this.input.isDown('run'), moving, dt)
    // Footsteps (P2-S5): a fixed hearing radius for walking/running; standing still is silent.
    const hearing = GAME_CONFIG.hearing
    this.playerNoise = player.alive && speed > 0 ? (running ? hearing.runRadius : hearing.walkRadius) : 0
    this.advanceFootsteps(this.playerNoise > 0 ? speed : 0, running, dt)

    // Khi đang vung gậy, giữ hướng nhìn về con trỏ; chuyển động không xoay nhân vật.
    if (moving && player.alive && player.attackTimer < 0) {
      player.facing = dampAngle(player.facing, Math.atan2(dir.x, dir.z), FACING_SMOOTHING, dt)
    }

    if (body) {
      const v = body.linvel()
      body.setLinvel({ x: dir.x * speed, y: v.y, z: dir.z * speed }, true)
    }
  }

  /**
   * Gait cadence from the intended speed (not the physics body, which only moves on fixed physics
   * steps): one footstep every half stride while the player makes noise, the first one as soon as
   * they start moving, so the sound is an exact cue of "zombies can hear me now".
   */
  private advanceFootsteps(speed: number, running: boolean, dt: number): void {
    const p = this.player
    const wasMoving = p.moveSpeed > 0
    p.moveSpeed = speed
    if (speed <= 0) return
    const cfg = GAME_CONFIG.player
    if (!wasMoving) {
      p.stridePhase = (Math.round(p.stridePhase / Math.PI) * Math.PI) % (Math.PI * 2)
      this.events.queue('player:footstep', { running })
    }
    const before = Math.floor(p.stridePhase / Math.PI)
    const after = p.stridePhase + (speed * dt / (running ? cfg.runStride : cfg.walkStride)) * Math.PI * 2
    if (Math.floor(after / Math.PI) > before) this.events.queue('player:footstep', { running })
    p.stridePhase = after % (Math.PI * 2)
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
    // R1: only the interactables around the player (same order as the full list), not the whole map.
    const nearby = this.interactableIndex.queryRadius(player.position.x, player.position.z, INTERACT_RANGE + this.maxInteractRadius)
    const target = selectInteractable(player.position, player.facing, nearby, (item) => {
      this.perf.count('otherRaycasts')
      return this.isBlocked(from, item.position, [item.id])
    })
    this.currentInteractable = target
    this.interactPrompt = target ? this.describeInteraction(target) : null

    if (target && this.input.wasPressed('interact')) this.interact(target)
  }

  private describeInteraction(target: Interactable): string {
    if (target.kind === 'light') {
      const on = this.world.lamps.get(target.id) === true
      const lamp = mapRooms(this.map).find((r) => r.lamp?.id === target.id)?.lamp
      const noPower = lamp?.requiresElectricity && !this.world.electricity ? ' (mất điện)' : ''
      return `${on ? 'Tắt' : 'Bật'} ${target.name}${noPower}`
    }
    if (target.kind === 'window') return `${this.world.curtains.get(target.id) ? 'Mở rèm' : 'Kéo rèm'} ${target.name}`
    if (target.kind === 'door') {
      const door = this.world.doors.get(target.id)
      if (door?.state === 'destroyed') return `${target.name} đã vỡ`
      const damaged = door && door.hp < DOOR_MAX_HP ? ` (độ bền ${door.hp}/${DOOR_MAX_HP})` : ''
      return `${door?.state === 'open' ? 'Đóng' : 'Mở'} ${target.name}${damaged}`
    }
    if (this.openContainerId === target.id) return `Đóng ${target.name}`
    const container = this.world.containers.get(target.id)
    return `${container?.opened ? 'Xem' : 'Mở'} ${target.name}`
  }

  /** Thực hiện tương tác với đối tượng; có thể gọi từ test mà không cần input. */
  interact(target: Interactable): void {
    if (target.kind === 'light') {
      this.setLamp(target.id, !this.world.lamps.get(target.id))
      this.interactPrompt = this.describeInteraction(target)
      return
    }
    if (target.kind === 'window') {
      this.setCurtain(target.id, !this.world.curtains.get(target.id))
      this.interactPrompt = this.describeInteraction(target)
      return
    }
    if (target.kind === 'door') {
      const door = this.world.doors.get(target.id)
      if (!door || door.state === 'destroyed') return
      this.setDoorState(door.id, door.state === 'open' ? 'closed' : 'open')
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

  /** Door state change from the player, zombies (destroyed at 0 HP) or the lab; collider/nav follow. */
  setDoorState(id: string, state: DoorStatus): void {
    const door = this.world.doors.get(id)
    if (!door || door.state === state) return
    door.state = state
    door.hp = state === 'destroyed' ? 0 : door.hp || DOOR_MAX_HP
    this.nav.setDoorState(id, state)
    this.lighting.markDoorDirty(id)
    if (state !== 'destroyed') this.events.queue('door:toggled', { id, open: state === 'open' })
    this.events.queue('door:changed', { id, state })
  }

  /** Lamp switch (the switch still clicks without power; the lamp just stays dark). */
  setLamp(id: string, on: boolean): void {
    if (!this.world.lamps.has(id) || this.world.lamps.get(id) === on) return
    this.world.lamps.set(id, on)
    this.lighting.markLampDirty(id)
    this.events.queue('light:changed', { id, on })
  }

  /** Curtain: lets less daylight in (lighting) and blocks the player's sight (vision), separately. */
  setCurtain(id: string, closed: boolean): void {
    if (!this.world.curtains.has(id) || this.world.curtains.get(id) === closed) return
    this.world.curtains.set(id, closed)
    this.lighting.markWindowDirty(id)
    this.events.queue('curtain:changed', { id, closed })
  }

  /** Grid power for lamps that need it (no shutoff schedule yet; generator later). */
  setElectricity(on: boolean): void {
    if (this.world.electricity === on) return
    this.world.electricity = on
    this.lighting.markAllDirty()
    this.events.queue('power:changed', { on })
  }

  equipItem(id: string | null): boolean {
    if (!this.player.alive || this.player.attackTimer >= 0) return false
    if (!equipWeapon(this.player.inventory, this.player.equipment, id)) return false
    const item = id === null ? null : this.player.inventory.slots.find((i) => i?.id === id) ?? null
    this.events.queue('item:equipped', { id, itemId: item?.itemId ?? null })
    this.queueInventoryChanged()
    return true
  }

  activateItem(slot: number): void {
    const item = this.player.inventory.slots[slot]
    if (item?.kind === 'weapon') this.equipItem(this.player.equipment.weaponInstanceId === item.id ? null : item.id)
    else this.consumeItem(slot)
  }

  dropItem(slot: number): boolean {
    const item = this.player.inventory.slots[slot]
    if (!item || !this.player.alive || this.player.attackTimer >= 0) return false
    if (this.isReserved(slot, item.quantity)) return false
    const id = `drop:${item.id}`
    // Reuse a previously emptied bag at this ID; never overwrite owned items.
    if (this.world.containers.get(id)?.items.slots.some(Boolean)) return false
    const items = createInventory(1, id)
    items.slots[0] = item
    this.player.inventory.slots[slot] = null
    reconcileEquipment(this.player.inventory, this.player.equipment)
    const position = { ...this.player.position, y: 0 }
    this.world.containers.set(id, { id, opened: false, items, position })
    this.registerDropInteractable(id, position)
    this.events.queue('drops:changed', {})
    this.queueInventoryChanged()
    return true
  }

  private registerDropInteractable(id: string, position: Vec3): void {
    const item: Interactable = { id, kind: 'container', name: 'Túi đồ rơi', position: { ...position, y: 0.25 }, radius: 0.25 }
    this.interactables = this.interactables.filter((i) => i.id !== id)
    this.interactables.push(item)
    this.indexInteractable(item)
  }

  private indexInteractable(item: Interactable): void {
    this.interactableById.set(item.id, item)
    // Re-inserting moves it last, like the list push above.
    this.interactableIndex.insert(item.id, item, item.position.x, item.position.z)
    this.maxInteractRadius = Math.max(this.maxInteractRadius, item.radius)
  }

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
    const item = this.player.inventory.slots[slot]
    if (item && this.isReserved(slot, 1)) return { ok: false, reason: 'not-usable', itemId: item.itemId }
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
    const quantity = this.player.inventory.slots[slot]?.quantity ?? 0
    if (this.player.attackTimer >= 0 || this.isReserved(slot, quantity)) return { moved: 0, remainder: quantity }
    const r = transferSlot(this.player.inventory, slot, c.items)
    reconcileEquipment(this.player.inventory, this.player.equipment)
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

  // ----- Timed actions: craft/repair (plan §7). Started from UI, advanced and committed in tick -----

  startCraft(id: RecipeId): ActionStartResult {
    return this.startRecipe(RECIPES[id], null)
  }

  /** Repair one weapon instance with the recipe of its group (wood/metal). */
  startRepair(targetId: string): ActionStartResult {
    const target = this.player.inventory.slots.find((i) => i?.id === targetId)
    const recipe = target ? repairRecipeFor(target.itemId) : null
    if (!recipe) return this.rejectAction('Sửa', target ? 'not-repairable' : 'no-target')
    return this.startRecipe(recipe, targetId)
  }

  /**
   * Validate (alive, idle, not mid-swing, inputs/tools/space) and reserve; nothing is consumed
   * until `completeAction`. Public so tests can run ad-hoc recipes (e.g. with tool wear).
   */
  startRecipe(recipe: Recipe, targetId: string | null): ActionStartResult {
    const label = this.actionLabel(recipe, targetId)
    if (!this.player.alive) return this.rejectAction(label, 'dead')
    if (this.action || this.player.attackTimer >= 0) return this.rejectAction(label, 'busy')
    const check = checkRecipe(this.player.inventory, recipe, targetId)
    if (!check.ok) return this.rejectAction(label, check.failure!)
    const toolIds = check.tools.map((t) => t.instanceId!)
    const id = this.nextActionId++
    this.action = { id, recipe, targetId, worldTargetId: null, toolIds, label, duration: recipe.duration, elapsed: 0, reservation: reservationFor(recipe, targetId, check) }
    this.events.queue('action:started', { id, kind: recipe.kind, label, duration: recipe.duration })
    this.queueInventoryChanged()
    return { ok: true, id }
  }

  /** Cancel releases the reservation; no input, fuel or tool condition is spent. */
  cancelAction(reason: ActionCancelReason = 'cancelled'): boolean {
    const action = this.action
    if (!action) return false
    this.action = null
    this.events.queue('action:cancelled', { id: action.id, label: action.label, reason })
    this.queueInventoryChanged()
    return true
  }

  /**
   * Commit action `id` once it has run its full duration. The action is cleared before the
   * commit, so a repeated or stale completion is a no-op; the commit re-checks everything and
   * changes the bag in one step inside the tick (snapshots only happen between ticks).
   */
  completeAction(id: number): boolean {
    const action = this.action
    if (!action || action.id !== id || action.elapsed < action.duration) return false
    this.action = null
    const { recipe, label } = action
    const result = commitRecipe(this.player.inventory, recipe, action.targetId, action.toolIds)
    if (!result.ok) {
      this.events.queue('action:failed', { id, label, reason: result.failure })
      this.queueInventoryChanged()
      return false
    }
    reconcileEquipment(this.player.inventory, this.player.equipment)
    for (const wear of result.toolWear) {
      this.events.queue('weapon:worn', { id: wear.id, itemId: wear.itemId, condition: wear.condition })
      if (wear.broke) this.events.queue('weapon:broken', { id: wear.id, itemId: wear.itemId, name: getItemDef(wear.itemId).name })
    }
    this.events.queue('action:completed', {
      id,
      kind: recipe.kind,
      recipeId: recipe.id,
      label,
      outputItemId: recipe.kind === 'craft' ? recipe.output.itemId : null,
      outputId: result.outputId,
      repair: result.repair,
    })
    this.queueInventoryChanged()
    return true
  }

  private stepAction(dt: number): void {
    const action = this.action
    if (!action) return
    if (!this.player.alive) {
      this.cancelAction('dead')
      return
    }
    if (this.input.wasPressed('cancelAction')) {
      this.cancelAction('cancelled')
      return
    }
    if (advanceAction(action, dt)) this.completeAction(action.id)
  }

  private rejectAction(label: string, reason: ActionStartFailure): ActionStartResult {
    this.events.queue('action:rejected', { label, reason })
    return { ok: false, reason }
  }

  private actionLabel(recipe: Recipe, targetId: string | null): string {
    if (recipe.kind === 'craft') return `Chế tạo ${getItemDef(recipe.output.itemId).name}`
    const target = this.player.inventory.slots.find((i) => i?.id === targetId)
    return target ? `Sửa ${getItemDef(target.itemId).name}` : recipe.name
  }

  /** Reserved materials/instances of the running action cannot leave the bag. */
  private isReserved(slot: number, quantity: number): boolean {
    if (!reservationBlocks(this.player.inventory, this.action?.reservation ?? null, slot, quantity)) return false
    const item = this.player.inventory.slots[slot]!
    this.events.queue('item:reserved', { itemId: item.itemId, name: getItemDef(item.itemId).name, label: this.action!.label })
    return true
  }

  private syncUiOpen(): void {
    this.uiOpen = this.inventoryOpen || this.openContainerId !== null
  }

  private queueInventoryChanged(): void {
    this.events.queue('inventory:changed', { inventoryOpen: this.inventoryOpen, containerId: this.openContainerId })
  }

  /**
   * R2 zombie pass: levels → scheduled AI decisions (`AIScheduler`: critical zombies every tick, the
   * rest at their level's rate, each with the time since its previous decision) → queued A* within the
   * budget → movement of every ACTIVE/NEAR zombie (and of DORMANT ones that just decided) by the
   * simulation, with collision; ACTIVE bodies then follow. Attacks and door hits keep map order.
   */
  private stepZombies(dt: number): { attacks: PendingAttack[]; structureHits: PendingStructureHit[] } {
    const attacks: PendingAttack[] = []
    const structureHits: PendingStructureHit[] = []
    const target = this.player.position
    const cfg = GAME_CONFIG.zombie
    this.releaseDoorSlots()
    this.syncZombieIndex()
    this.aiScheduler.updateLevels(this.zombies.values(), target, dt, (z, from) => {
      this.events.queue('zombie:levelChanged', { id: z.id, from, to: z.simLevel })
    })
    const updates = this.aiScheduler.plan(this.zombies, target, dt, this.aiUpdates)
    this.dormantStep.clear()
    for (const { zombie, dt: aiDt } of updates) {
      const result = stepZombie(zombie, target, this.player.alive, aiDt, cfg, this.zombieAIContext)
      this.perf.count('aiUpdates')
      zombie.velocity.x = result.velocity.x
      zombie.velocity.z = result.velocity.z
      if (zombie.simLevel === 'DORMANT') this.dormantStep.set(zombie.id, aiDt)

      if (result.transition) {
        this.events.queue('zombie:stateChanged', { id: zombie.id, ...result.transition })
        if (result.transition.to === 'DEAD') this.onZombieDied(zombie, 'unknown')
      }
      if (result.attack) {
        attacks.push({ sourceId: zombie.id, damage: cfg.damage })
      }
      if (result.structureHit) structureHits.push({ sourceId: zombie.id, doorId: result.structureHit })
    }

    let t = this.perf.begin()
    this.stepPathQueue()
    this.perf.end('nav', t)
    t = this.perf.begin()
    this.moveZombies(dt)
    this.perf.end('movement', t)
    return { attacks, structureHits }
  }

  /** Serve queued A* requests within `GAME_CONFIG.pathfinding` (count and time), ACTIVE first. */
  private stepPathQueue(): void {
    this.pathQueue.process(this.pathBudget, (req) => {
      const z = this.zombies.get(req.id)
      if (!z || z.ai === 'DEAD') return false
      this.perf.count('pathsComputed')
      z.path = this.nav.findPath(z.position, req.goal) ?? []
      z.pathIndex = 0
      z.pathPending = false
      return true
    })
    // R3b: spare time goes to the nav tile graph (edges of long routes); never changes a result.
    if (this.pathQueue.size === 0) this.nav.tiles.warm(this.pathBudget.warmMs)
  }

  /**
   * Integrate the velocity each zombie's AI chose, plus the soft separation, with collision against
   * static boxes, the player and (hard) other zombies. ACTIVE/NEAR move every tick; DORMANT ones move
   * only on their AI tick, by that update's time step (sub-stepped). ACTIVE bodies follow.
   */
  private moveZombies(dt: number): void {
    const cfg = GAME_CONFIG.zombie
    const env = this.moveEnv
    const p = this.player.position
    const player: Circle = { x: p.x, z: p.z, r: GAME_CONFIG.player.radius }
    const other: Circle = { x: 0, z: 0, r: cfg.radius }
    for (const z of this.zombies.values()) {
      if (z.ai === 'DEAD') continue
      const dormant = z.simLevel === 'DORMANT'
      const stepDt = dormant ? (this.dormantStep.get(z.id) ?? 0) : dt
      if (stepDt <= 0) continue
      const sep = dormant ? null : this.separation(z)
      moveZombie(z.position, z.velocity.x + (sep?.x ?? 0), z.velocity.z + (sep?.z ?? 0), stepDt, env, player)
      if (!dormant) {
        // Zombies do not overlap: each resolves half of an overlap with a neighbour, then the walls win.
        const neighbours = this.neighbourScratch
        neighbours.length = 0
        this.zombieIndex.queryRadius(z.position.x, z.position.z, cfg.radius * 2, neighbours)
        let pushed = false
        for (const n of neighbours) {
          if (n === z || n.ai === 'DEAD') continue
          other.x = n.position.x
          other.z = n.position.z
          pushed = pushOutOfCircle(z.position, cfg.radius, other, 0.5) || pushed
        }
        if (pushed) resolveStatic(z.position, env)
      }
      this.zombieIndex.update(z.id, z.position.x, z.position.z)
      const body = this.zombieBodies.get(z.id)
      if (body) body.setNextKinematicTranslation({ x: z.position.x, y: cfg.height / 2, z: z.position.z })
    }
  }

  /** Đẩy nhẹ zombie ra khỏi các zombie còn sống khác để không chồng lên một điểm. */
  private separation(zombie: ZombieState): { x: number; z: number } {
    const cfg = GAME_CONFIG.zombie
    let x = 0
    let z = 0
    // R1: neighbours from the spatial index (same order as the old loop over every zombie).
    const neighbours = this.neighbourScratch
    neighbours.length = 0
    this.zombieIndex.queryRadius(zombie.position.x, zombie.position.z, cfg.separationRadius, neighbours)
    this.perf.count('separationChecks', neighbours.length - 1)
    for (const other of neighbours) {
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
      // Attacking or shoving interrupts a craft/repair (the swing itself still happens).
      if (this.action && (this.input.wasPressed('attack') || this.input.wasPressed('push'))) this.cancelAction('attacked')
      if (this.input.wasPressed('attack')) {
        const weapon = equippedWeapon(player.inventory, player.equipment)
        if (!weapon) this.events.queue('player:unarmed', {})
        else if (startAttack(player, meleeStats(weapon.itemId), GAME_CONFIG.player, weapon.id)) {
          if (this.cursorWorld) player.facing = facingTowards(player.position, this.cursorWorld)
        }
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

  /** Zombies that can be within `range` (edge distance) of the player: spatial query (R1), map order. */
  private meleeTargets(range: number): MeleeTarget[] {
    const r = GAME_CONFIG.zombie.radius
    const list: MeleeTarget[] = []
    const p = this.player.position
    for (const z of this.zombieIndex.queryRadius(p.x, p.z, range + r)) list.push({ id: z.id, position: z.position, radius: r, alive: z.ai !== 'DEAD' })
    return list
  }

  private isTargetBlocked(target: MeleeTarget): boolean {
    this.perf.count('otherRaycasts')
    return this.isBlocked(atHeight(this.player.position, SWING_HEIGHT), atHeight(target.position, SWING_HEIGHT), [])
  }

  /**
   * Hit window of the current swing. Damage uses the weapon's condition at this moment (1 still
   * deals full damage); wear is applied afterwards, once per attackId however many targets were hit.
   */
  private resolvePlayerMelee(): void {
    const cfg = GAME_CONFIG.melee
    const player = this.player
    const found = player.inventory.slots.find((i) => i?.id === player.attackWeaponId)
    const weapon = found?.kind === 'weapon' ? found : null
    if (!weapon) {
      this.events.queue('player:attacked', { hitIds: [], damage: 0, weaponId: null })
      return
    }
    const stats = meleeStats(weapon.itemId)
    const damage = weaponHitDamage(weapon.itemId, weapon.condition)
    const hits = resolveConeHits(player.position, player.facing, this.meleeTargets(stats.range), { range: stats.range, halfAngleDeg: cfg.halfAngleDeg }, (t) => this.isTargetBlocked(t))
    const hitIds: EntityId[] = []
    for (const hit of hits) {
      const zombie = this.zombies.get(hit.id)
      if (!zombie) continue
      hitIds.push(zombie.id)
      const from = zombie.ai
      const died = damageZombie(zombie, damage)
      this.events.queue('zombie:damaged', { id: zombie.id, amount: damage, health: zombie.health })
      if (died) {
        this.events.queue('zombie:stateChanged', { id: zombie.id, from, to: 'DEAD' })
        this.onZombieDied(zombie, 'player')
      } else {
        applyKnockback(zombie, this.player.position, cfg.knockback, cfg.stagger)
      }
    }
    this.events.queue('player:attacked', { hitIds, damage, weaponId: weapon.id })
    if (hitIds.length === 0) return
    const wear = applyWeaponWear(weapon, player.attackId, player)
    if (wear.worn === 0) return
    const name = getItemDef(weapon.itemId).name
    this.events.queue('weapon:worn', { id: weapon.id, itemId: weapon.itemId, condition: weapon.condition })
    if (wear.broke) this.events.queue('weapon:broken', { id: weapon.id, itemId: weapon.itemId, name })
    else if (wear.becameLow) this.events.queue('weapon:lowCondition', { id: weapon.id, itemId: weapon.itemId, name })
  }

  private resolvePlayerPush(): void {
    const cfg = GAME_CONFIG.push
    const hits = resolveConeHits(this.player.position, this.player.facing, this.meleeTargets(cfg.range), cfg, (t) => this.isTargetBlocked(t))
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
    // The view unmounts the kinematic body of a dead zombie; disable it at once so it stops blocking.
    this.zombieBodies.get(zombie.id)?.setEnabled?.(false)
    zombie.velocity.x = 0
    zombie.velocity.z = 0
    this.pathQueue.cancel(zombie.id)
    this.events.queue('zombie:died', { id: zombie.id, sourceId })
  }

  private stepSurvival(dt: number): void {
    this.player.hurtTimer = Math.max(0, this.player.hurtTimer - dt)
    regenStamina(this.player, dt)
    const starvation = tickSurvival(this.player, dt)
    if (starvation > 0) this.applyPlayerDamage(starvation, 'starvation')
  }

  private applyPlayerDamage(amount: number, sourceId: EntityId): void {
    if (!this.player.alive) return
    const died = damagePlayer(this.player, amount)
    if (sourceId !== 'starvation') {
      this.player.hurtTimer = PLAYER_HURT_TIME
      // Taking a blow interrupts work; slow starvation damage does not.
      this.cancelAction('hit')
    }
    this.events.queue('player:damaged', { amount, health: this.player.health, sourceId })
    if (died) this.events.queue('player:died', { sourceId })
  }
}

function atHeight(p: Vec3, y: number): Vec3 {
  return { x: p.x, y, z: p.z }
}

function planar(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function maxZombieNumber(zombies: Map<EntityId, ZombieState>): number {
  let max = 0
  for (const id of zombies.keys()) {
    const n = Number(id.replace('zombie-', ''))
    if (Number.isFinite(n) && n > max) max = n
  }
  return max
}

/** Stand right at a window to draw its curtain (a wide reach stole prompts from nearby furniture). */
const CURTAIN_REACH = 0.3

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
  // Lamp switches on the inner wall, curtains just inside each window (blocked from outside).
  for (const room of mapRooms(map)) {
    if (!room.lamp) continue
    list.push({ id: room.lamp.id, kind: 'light', name: room.lamp.name, position: { x: room.lamp.switchAt.x, y: 1.3, z: room.lamp.switchAt.z }, radius: 0.25 })
  }
  for (const w of mapWindows(map)) {
    list.push({ id: w.id, kind: 'window', name: w.name, position: { x: w.center.x + w.inward.x * 0.35, y: 1.3, z: w.center.z + w.inward.z * 0.35 }, radius: CURTAIN_REACH })
  }
  return list
}

/**
 * Editor playtest first (its page sets the map before loading the game, dev and editor build);
 * dev labs pick another map; the production game folds this to the neighbourhood.
 */
function initialMap(): MapData {
  const playtest = playtestSession()
  if (playtest) return playtest.map
  if (!import.meta.env.DEV) return NEIGHBORHOOD_MAP
  if (DOOR_LAB_ENABLED) return DOOR_LAB_MAP
  if (STRESS_TILES) return buildStressMap(STRESS_TILES)
  return DEV_WORLD_ID ? loadDevWorld(DEV_WORLD_ID) : NEIGHBORHOOD_MAP
}

/** Singleton runtime cho ứng dụng. Test tạo instance riêng bằng `new GameRuntime()`. */
export const runtime = new GameRuntime(initialMap())
