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
import { attackReadyIn, canStartAttack, cancelSwing, facingTowards, resolveConeHits, startAttack, startPush, tickPlayerCombat, type MeleeTarget } from '../systems/combat'
import { canBenefit, damagePlayer, tickSurvival, type UseItemFailure } from '../systems/survival'
import { aimYawTowards, cancelStance, createStanceControl, setStanceMode, turnToward, updateStanceRequest, type StanceMode } from '../systems/stance'
import { INTERACT_RANGE, selectInteractable, type Interactable } from '../systems/interaction'
import { cloneInventory, findItem, previewTransfer, totalQuantity, transferItem, type Inventory } from '../systems/inventory'
import { containerIdOf, containerKey, emptySummary, isCarried, isEquipped, itemRefusal, type InventoryKey, type TransferLine, type TransferRefusal, type TransferOutcome, type TransferSkip, type TransferSummary } from '../systems/inventoryCommands'
import { bagInstanceIdOf, findUsable, usableInventories, wornBagContents } from '../systems/bags'
import { recoverSave, toStoredForm } from '../systems/recovery'
import { FloorStore } from '../systems/floor'
import { createRng, hashSeed, randomSeed } from '../systems/loot'
import { pickSpawnPoint, spawnInterval } from '../systems/spawn'
import { migrationInterval, nearestZone, planMigration } from '../systems/horde'
import { getItemDef } from '../entities/items'
import { applyWeaponWear, meleeStats, weaponHitDamage } from '../systems/weapons'
import { equipWeapon, equippedWeapon, wearBag } from '../systems/equipment'
import { validateSaveGame } from '../systems/save'
import { checkRecipe, type CraftFailure, type CraftSources } from '../systems/crafting'
import type { ActionCancelReason, TimedAction } from '../systems/timedAction'
import { ReservationLedger, type JobView } from '../systems/actionQueue'
import { ActionSystem, type EnqueueResult } from '../actions/actionSystem'
import { ACTION, type ActionContext, type ActionJob, type ActionSource } from '../actions/types'
import type { ActionWorld } from '../actions/world'
import { CharacterStateMachine, interrupts, type CharacterState, type InterruptKind } from '../actions/characterState'
import { WorldObjectVersions } from '../actions/worldVersions'
import { prepareTransfer, recipeAction, recipeActionType, recipeData, transferData, USE_STATES, type RecipeData, type TransferData, type UseData } from '../actions/defs'
import { RECIPES, repairRecipeFor, type Recipe, type RecipeId } from '../entities/recipes'
import { DOOR_MAX_HP, type DoorStatus } from '../world/doors'
import { SAVE_SCHEMA_VERSION, type SaveGame } from '../../types/save'
import { NEIGHBORHOOD_MAP, type MapData } from '../world/mapData'
import type { NavGrid } from '../world/navigation'
import { NavWorld } from '../world/navLayers'
import { LEVEL_TOLERANCE, type FloorField } from '../world/floors'
import { isInsideBuilding, SWITCH_HEIGHT } from '../world/buildings'
import { createWorldState, type ContainerState, type WorldState } from '../world/worldState'
import type { EntityId, Vec3 } from '../../types'
import { DOOR_LAB_ENABLED, DOOR_LAB_MAP } from '../world/doorLab'
import { STRESS_TILES, buildStressMap } from '../world/stressMap'
import { startupWorld } from '../world/worldChoice'
import { playtestSession } from '../world/playtest'
import { buildVisionOccluders, type VisionOccluderSet } from '../world/visionOccluders'
import { InteriorVisibility, isSavedExploration } from '../systems/interiorVisibility'
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

/** `missing-carried`: the inputs are not all carried and free now (INV-LOOT Q3: never counts on items still moving). */
export type ActionStartFailure = CraftFailure | 'busy' | 'dead' | 'missing-carried' | 'already-queued' | 'queue-full' | 'duplicate'
/** AX2: a use request queued (its last job's ID), or why not (the `item:useFailed` toast already queued). */
export type UseStartResult = { ok: true; id: number; queued: boolean } | { ok: false; reason: UseItemFailure | 'duplicate' }
/** AX1: optional request data from the UI: one ID per gesture (a repeat runs once), where it came from. */
export interface RequestOptions {
  requestId?: string
  source?: ActionSource
}
/** `queued`: it waits behind the running action (one queue, run in order). */
export type ActionStartResult = { ok: true; id: number; queued: boolean } | { ok: false; reason: ActionStartFailure }
/** A queued transfer: its job ID (null when no line could be queued) and the lines refused at once, with why. */
export interface QueueResult {
  id: number | null
  refused: TransferSkip[]
}

/**
 * Obstruction query. R3b: the runtime answers it itself from `staticColliders` (the boxes Rapier
 * was given); tests may install a stand-in with `setLineOfSightOverride`.
 */
export interface LineOfSightQuery {
  /** true nếu có khối chặn (tường, cửa đóng...) giữa hai điểm, bỏ qua các ID trong `ignoreIds`. */
  isBlocked(from: Vec3, to: Vec3, ignoreIds: readonly string[]): boolean
}

const FACING_SMOOTHING = 14
const DEG = Math.PI / 180
/** Duration of the player's hit-reaction pose (view only). */
const PLAYER_HURT_TIME = 0.3
/** Độ cao raycast tầm nhìn zombie (trên chân): nhìn qua được hàng rào/thùng thấp, không qua tường/cửa. */
const EYE_HEIGHT = 1.5
/** Độ cao raycast kiểm tra tường chắn đòn gậy (trên chân). */
const SWING_HEIGHT = 1.2
/** Height above the feet the player reaches for interactables from (body centre). */
const BODY_HEIGHT = 0.9
/** Interactables further than this above/below the reach height are on another storey (M11b). */
const INTERACT_VERTICAL = 1.4
/** INV-LOOT: how often the reachable containers and floor items are refreshed (s). */
const NEARBY_INTERVAL = 0.125
/** Reach to an item lying on the floor, from the player's feet to the item (m). */
const FLOOR_REACH = INTERACT_RANGE + 0.6
/** A drop lands this far ahead of the feet when nothing is in the way (m). */
const DROP_AHEAD = 0.35
/** The player's capsule floats this far above its floor (never rests on a wall top it walks over). */
const PLAYER_HOVER = 0.02
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
  /** Ground nav grid (layer 0 of `navWorld`): the whole play area at floor 0. */
  readonly nav: NavGrid
  /** M11b: every storey's nav grid joined through flights; the AI routes through it. */
  readonly navWorld: NavWorld
  /** M11b: ground, upper floor slabs and stairs: the height every body stands at. */
  readonly floors: FloorField
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
  /**
   * An inventory/loot window is open (derived from the fields below). INV-LOOT S5: the windows no
   * longer hold the combat input: presses count only on the canvas, so a right press on the world
   * enters the stance (the windows collapse, UI side) and the left button swings in it.
   */
  uiOpen = false
  /** Túi đồ đang mở (phím I hoặc tự mở khi mở container). */
  inventoryOpen = false
  /** Container đang hiện panel; null khi không có. */
  openContainerId: string | null = null
  /** INV-LOOT: the loot window is open, showing `openContainerId` or, when that is null, the floor. */
  lootOpen = false
  /** Containers (IDs) the player can reach now, by name then ID, refreshed ~8 times a second. */
  nearbyContainerIds: string[] = []
  /** Floor items (instance IDs) the player can reach now, each checked at its own position. */
  nearbyFloorIds: string[] = []
  /** The loot window's container is within reach (else shown "Ngoài tầm" and nothing moves). */
  lootInReach = true
  private nextNearbyAt = 0
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
  /**
   * INV-LOOT S4: every timed action (transfer, craft, repair) in one queue, run in order; the first is
   * running. Never saved: a save holds the state before the running step, a load clears the queue.
   */
  get jobs(): readonly ActionJob[] {
    return this.actions.jobs
  }
  /** The one reservation ledger: what the running job holds (released on every path). */
  readonly ledger = new ReservationLedger()
  /** AX1: what action definitions see of the simulation. */
  private readonly actionWorld: ActionWorld = this.createActionWorld()
  /** AX1: the one executor of timed actions (queue, reservations, commit as one transaction). */
  readonly actions = new ActionSystem(this.actionWorld)
  /** AX1: the character's state (FB §4), derived once per tick from the simulation. */
  readonly character = new CharacterStateMachine()
  /** AX1: per world object, a counter that grows with each state change (runtime only). */
  readonly worldVersions = new WorldObjectVersions()
  /**
   * CS1 combat stance: right-button intent and the desired aim (runtime only, never saved). The
   * simulation owns the heading: `player.facing` turns toward `stance.aimYaw` at a limited speed.
   */
  readonly stance = createStanceControl()
  /** The stance request turned on this tick (a left click just before it may still count). */
  private stanceStarted = false
  /** Hold mode and the right button not waiting for a release, as the tick began. */
  private chordAllowed = false
  /**
   * CS1b: at most one click queued near the end of the recovery (its aim snapshot and expiry in
   * `simTime`). Dropped when the stance ends, on Esc, a panel, an input reset or death.
   */
  pendingAttack: { yaw: number; expiresAt: number } | null = null
  /** Seconds of simulation since the runtime was built (input grace windows). */
  simTime = 0
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
  /** M11c-1B: interior cells seen now and explored (render-facing, saved as memory). */
  readonly interior: InteriorVisibility
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
    this.navWorld = new NavWorld(map, { ...GAME_CONFIG.nav, initialWarmMs: GAME_CONFIG.pathfinding.initialWarmMs, warmFrom: map.playerSpawn })
    this.nav = this.navWorld.ground
    this.floors = this.navWorld.floorField
    this.interactables = buildInteractables(map)
    this.interactableById = new Map(this.interactables.map((i) => [i.id, i]))
    for (const b of map.buildings) this.buildingIndex.insert(b.id, b, b.center.x, b.center.z, b.size.w / 2, b.size.d / 2)
    registerMapColliders(this.staticColliders, map, (id) => this.world.doors.get(id)?.state)
    this.moveEnv = {
      colliders: this.staticColliders,
      radius: GAME_CONFIG.zombie.radius,
      height: GAME_CONFIG.zombie.height,
      substep: GAME_CONFIG.simulation.movementSubstep,
      ...(this.floors.flat ? {} : { surface: (x: number, z: number, y: number) => this.floors.surfaceAt(x, z, y) }),
    }
    this.player = createPlayerState(map.playerSpawn)
    // Placeholder until `newGame()` below: never rolls loot (that happens once, in newGame).
    this.world = createWorldState(map, 0, { generateLoot: false })
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
    this.interior = new InteriorVisibility(mapRooms(map), GAME_CONFIG.interiorVisibility, GAME_CONFIG.playerVision)
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
        return !this.isBlocked(above(zombie.position, EYE_HEIGHT), above(target, EYE_HEIGHT), [])
      },
      // R2: the AI files path requests; A* runs in `stepPathQueue` after the AI pass (budgeted).
      requestPath: (zombie, from, to) => {
        const t = this.perf.begin()
        this.perf.count('pathRequests')
        const kind = this.navWorld.routeKind(from, to)
        let result: 'none' | 'ready' | 'queued' = 'queued'
        if (kind === 'none') {
          this.pathQueue.cancel(zombie.id)
          zombie.pathPending = false
          result = 'none'
        } else if (kind === 'direct') {
          this.pathQueue.cancel(zombie.id)
          zombie.path = this.navWorld.findPath(from, to) ?? []
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
      hasLineOfWalk: (from, to) => this.navWorld.hasLineOfWalk(from, to),
      getNavVersion: () => this.navWorld.version,
      noiseRadius: () => this.playerNoise,
      findDoorRoute: (from, to) => {
        const t = this.perf.begin()
        this.perf.count('doorRoutes')
        const route = this.navWorld.findDoorRoute(from, to)
        this.perf.end('nav', t)
        return route
      },
      getDoor: (id) => {
        const door = this.world.doors.get(id)
        const portal = this.navWorld.portals.get(id)
        return door && portal ? { state: door.state, center: portal.center } : null
      },
      claimDoorSlot: (zombie, doorId, side) => this.claimDoorSlot(zombie, doorId, side),
      pickWanderPoint: (zombie) => this.pickWanderPoint(zombie),
      random: () => this.aiRng(),
    }

    // Blur, pause, pointer cancel, New Game: held buttons are gone, so is every combat intent.
    this.input.onClear(() => this.resetCombatIntent())
    this.newGame()
  }

  /**
   * Ván mới với seed loot; loot mọi container được sinh ngay tại đây, một lần cho cả ván.
   * `profile` comes from character creation (cosmetic only); omitted = default look.
   */
  newGame(seed: number = randomSeed(), profile?: CharacterProfile, options: { generateLoot?: boolean } = {}): void {
    this.sessionId += 1
    this.clock.reset()
    this.events.clear()
    this.input.clear()
    this.cameraZoom = GAME_CONFIG.camera.zoomDefault
    // P2-S2: New Game starts unarmed (shove still works); melee is looted from containers.
    // Only the v1 save migration grants the Phase 1 bat.
    this.player = createPlayerState(this.map.playerSpawn, profile && { name: normalizeName(profile.name), appearance: profile.appearance })
    this.world = createWorldState(this.map, seed, { generateLoot: options.generateLoot ?? true })
    this.interactables = buildInteractables(this.map)
    this.interactableById.clear()
    this.interactableIndex.clear()
    this.maxInteractRadius = 0
    for (const item of this.interactables) this.indexInteractable(item)
    this.navWorld.resetDoors()
    this.currentInteractable = null
    this.interactPrompt = null
    this.cursorWorld = null
    this.inventoryOpen = false
    this.openContainerId = null
    this.lootOpen = false
    this.nearbyContainerIds = []
    this.nearbyFloorIds = []
    this.lootInReach = true
    this.nextNearbyAt = 0
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
    this.actions.clear()
    this.character.reset()
    this.worldVersions.clear()
    this.playerNoise = 0
    this.hordeTimer = GAME_CONFIG.horde.intervalMin
    this.hordeCounter = 0
    this.doorSlots.clear()
    this.vision.clear()
    this.interior.clear()
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
    // Recovered unknown items are written back in the form they were loaded from (INV-LOOT S5).
    return toStoredForm(this.snapshotState())
  }

  private snapshotState(): SaveGame {
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
    const exploration = this.interior.serialize()
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
      containers: Array.from(this.world.containers.values()).map((c) => ({ id: c.id, opened: c.opened, items: cloneInventory(c.items) })),
      floor: this.world.floor.serialize(),
      bags: Array.from(this.world.bags.values(), cloneInventory),
      lootPatches: [...this.world.lootPatches],
      zombies,
      spawn: { nextZombieId: this.nextZombieId, timer: this.spawnTimer, counter: this.spawnCounter },
      horde: { timer: this.hordeTimer, counter: this.hordeCounter },
      lighting: {
        curtains: Array.from(this.world.curtains, ([id, closed]) => ({ id, closed })),
        lamps: Array.from(this.world.lamps, ([id, on]) => ({ id, on })),
        electricity: this.world.electricity,
      },
      cameraZoom: this.cameraZoom,
      ...(exploration ? { exploration } : {}),
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
    // INV-LOOT S5: items this version does not know are kept as recovery items (never dropped).
    const recovery = recoverSave(validation.save)
    save = recovery.save
    // Containers come from the save: the generator must not run (no second roll, INV-LOOT T16).
    this.newGame(save.worldSeed, { name: save.player.name, appearance: save.player.appearance }, { generateLoot: false })
    this.zombies.clear()
    this.zombieIndex.clear()
    this.aiScheduler.clear()
    this.pathQueue.clear()
    this.clock.restore(save.clock.elapsed, save.clock.timeOfDay, save.clock.day)
    this.cameraZoom = Math.min(GAME_CONFIG.camera.zoomMax, Math.max(GAME_CONFIG.camera.zoomMin, save.cameraZoom))

    const p = this.player
    const lim = GAME_CONFIG.player
    p.position = { ...save.player.position }
    this.navWorld.prioritizeWarm(p.position)
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
      this.navWorld.setDoorState(door.id, door.state)
    }
    // Lighting inputs (derived room light is recomputed, never saved).
    for (const c of save.lighting.curtains) if (this.world.curtains.has(c.id)) this.world.curtains.set(c.id, c.closed)
    for (const l of save.lighting.lamps) if (this.world.lamps.has(l.id)) this.world.lamps.set(l.id, l.on)
    this.world.electricity = save.lighting.electricity
    this.lighting.markAllDirty()
    // M11c-1B: the interior memory (a malformed one is dropped: it is only a view).
    this.interior.restore(isSavedExploration(save.exploration) ? save.exploration : undefined)
    for (const c of save.containers) {
      const container = this.world.containers.get(c.id)!
      container.opened = c.opened
      container.items = cloneInventory(c.items)
    }
    this.world.bags = new Map(save.bags.map((b) => [bagInstanceIdOf(b.id), cloneInventory(b)]))
    this.world.lootPatches = [...save.lootPatches]
    this.world.floor = FloorStore.restore(save.floor)

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
      const portal = z.structureTargetId ? this.navWorld.portals.get(z.structureTargetId) : undefined
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
    if (recovery.report.itemIds.length > 0) this.events.queue('items:recovered', recovery.report)
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

    this.simTime += dt
    this.stepControls()
    this.stepPlayerMovement(dt)
    this.stepInteraction()
    let t = perf.begin()
    const { attacks, structureHits } = this.stepZombies(dt)
    perf.end('ai', t)
    t = perf.begin()
    this.stepCombat(attacks, dt)
    this.stepStructureHits(structureHits)
    perf.end('combat', t)
    this.stepQueue(dt)
    this.stepSurvival(dt)
    this.updateCharacterState()
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
    // M11c-1B: interior cells seen (throttled), after the player moved; `inside` rules out peeks.
    if (GAME_CONFIG.interiorVisibility.enabled) this.interior.step(dt, this.player, this.visionOccluders, this.buildingAt(this.player.position, -0.2), this.lighting.revision)
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
    const playerEye = above(this.player.position, EYE_HEIGHT)
    const point = pickSpawnPoint(
      this.map.zombieSpawns,
      {
        playerPos: this.player.position,
        aliveZombies,
        isHiddenFromPlayer: (pt) => {
          this.perf.count('otherRaycasts')
          return this.isBlocked(playerEye, above(pt, EYE_HEIGHT), [])
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
   * M11b: a zombie on an upper storey wanders on that storey (anywhere over the building).
   */
  pickWanderPoint(zombie: ZombieState): Vec3 | null {
    const cfg = GAME_CONFIG.zombie
    const zone = zombie.zoneId ? this.map.zombieZones?.find((z) => z.id === zombie.zoneId) : undefined
    const layer = this.navWorld.layerOf(zombie.position)
    const nav = layer.grid
    const storey = layer.bounds
    const anchor = storey ? { x: (storey.minX + storey.maxX) / 2, y: layer.elevation, z: (storey.minZ + storey.maxZ) / 2 } : (zone?.center ?? zombie.home)
    const radius = zone?.radius ?? cfg.wanderRadius
    const rng = createRng(hashSeed(this.world.seed, `wander:${zombie.id}:${zombie.wanderCount++}`))
    const region = nav.componentAt(zombie.position.x, zombie.position.z)
    const building = this.buildingAt(zombie.position)
    const half = storey ? { x: (storey.maxX - storey.minX) / 2, z: (storey.maxZ - storey.minZ) / 2 } : zone?.halfSize
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
      const cell = nav.nearestWalkableCell(x, z, 2)
      if (!cell) continue
      const point = nav.cellToWorld(cell.cx, cell.cz)
      if (region < 0 || nav.componentAt(point.x, point.z) !== region) continue
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
    const portal = this.navWorld.portals.get(doorId)
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
      const portal = this.navWorld.portals.get(hit.doorId)
      if (!zombie || zombie.ai === 'DEAD' || !door || !portal || door.state !== 'closed') continue
      if (planar(zombie.position, portal.center) > cfg.reach * 1.25 || Math.abs(zombie.position.y - portal.center.y) > LEVEL_TOLERANCE) continue
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

  /** CS1: combat posture in effect: the stance is asked for, or a swing is still finishing. */
  get combatPosture(): boolean {
    return this.player.alive && (this.stance.requested || this.player.attackTimer >= 0)
  }

  /** Settings: Hold/Toggle. Switching drops any held or latched request (never a stuck stance). */
  setStanceMode(mode: StanceMode): void {
    if (this.stance.mode === mode) return
    setStanceMode(this.stance, mode, this.input.isDown('stance'))
    this.syncStanceEvent(false)
  }

  /**
   * Leave the stance (Esc, E, an opened panel). A swing already running finishes by its own rules;
   * a held right button asks again only after it is released. Returns whether it was active.
   */
  cancelStance(): boolean {
    const was = this.stance.requested
    cancelStance(this.stance, this.input.isDown('stance'))
    this.pendingAttack = null
    this.syncStanceEvent(was)
    return was
  }

  /** Input reset (blur, pause, pointer cancel, New Game/load): no stance and no queued click. */
  private resetCombatIntent(): void {
    const was = this.stance.requested
    cancelStance(this.stance, false)
    this.stanceStarted = false
    this.pendingAttack = null
    this.syncStanceEvent(was)
  }

  private syncStanceEvent(was: boolean): void {
    if (was !== this.stance.requested) this.events.queue('player:stance', { active: this.stance.requested })
  }

  /**
   * First step of a tick: the stance request from the right button (not while dead; an open
   * inventory window does not block it, INV-LOOT S5) and the desired aim from the cursor point. A cursor on the player's feet or off
   * the canvas keeps the previous aim.
   */
  private stepControls(): void {
    const s = this.stance
    const was = s.requested
    this.chordAllowed = s.mode === 'hold' && !s.suppressed
    updateStanceRequest(s, this.input.isDown('stance'), this.input.wasPressed('stance'), this.player.alive)
    this.stanceStarted = s.requested && !was
    if (this.stanceStarted) this.interruptAction('stance', 'stance')
    // A queued click lives only while the stance is asked for (release, panel, death drop it).
    if (!s.requested) this.pendingAttack = null
    if (this.stanceStarted && !s.hasAim) s.aimYaw = this.player.facing
    const aim = aimYawTowards(this.player.position, this.cursorWorld)
    if (aim !== null) {
      s.aimYaw = aim
      s.hasAim = true
    }
    // A left click outside the stance that no right press followed within the grace: hint once.
    if (s.clickOutsideAt > -Infinity && !s.requested && this.simTime - s.clickOutsideAt > GAME_CONFIG.combatStance.simultaneousGrace) {
      s.clickOutsideAt = -Infinity
      this.events.queue('player:attackNeedsStance', {})
    }
    this.syncStanceEvent(was)
  }

  private stepPlayerMovement(dt: number): void {
    const body = this.playerBody
    const player = this.player
    const fromX = player.position.x
    const fromZ = player.position.z
    if (body) {
      const t = body.translation()
      player.position.x = t.x
      player.position.z = t.z
    }
    // M11b: the simulation owns the player's height (feet on the ground, a slab or a flight); the
    // body only resolves walls sideways and floats just above that floor (no gravity). M11c-1B: along
    // the way the body went, so a slow frame's long move still climbs a flight.
    player.position.y = this.floors.follow(fromX, fromZ, player.position.x, player.position.z, player.position.y)
    if (body) {
      const t = body.translation()
      const y = player.position.y + GAME_CONFIG.player.height / 2 + PLAYER_HOVER
      if (Math.abs(t.y - y) > 1e-4) body.setTranslation({ x: t.x, y, z: t.z }, true)
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
    // Walking away interrupts the running action if its policy says so (every one so far): nothing
    // is consumed (plan §7.1 step 4), the whole queue stops.
    if (moving) this.interruptAction('move', 'moved')
    // CS1: the stance (and a swing finishing after it) walks slower and cannot run; the factor is
    // applied once, to the walking speed (no other movement modifiers exist yet).
    const posture = this.combatPosture
    const resolved = resolvePlayerSpeed(player, this.input.isDown('run') && !posture, moving, dt)
    const running = resolved.running
    const speed = posture ? resolved.speed * GAME_CONFIG.combatStance.speedFactor : resolved.speed
    // Footsteps (P2-S5): a fixed hearing radius for walking/running; standing still is silent.
    const hearing = GAME_CONFIG.hearing
    this.playerNoise = player.alive && speed > 0 ? (running ? hearing.runRadius : hearing.walkRadius) : 0
    this.advanceFootsteps(this.playerNoise > 0 ? speed : 0, running, dt)

    // Heading (CS1): the simulation owns it and turns at a limited speed, the short way. A swing turns
    // the body toward its own direction (the click's aim) until a little after its hit; then, or with
    // no swing, the stance turns it toward the aim (strafing/backing off never turns it); otherwise
    // it turns toward the walk. The cursor itself never sets it.
    if (player.alive) {
      const cs = GAME_CONFIG.combatStance
      const turn = cs.turnSpeedDeg * DEG * dt
      const swinging = player.attackTimer >= 0
      const released = swinging && player.attackCommitted && player.attackTimer >= GAME_CONFIG.melee.hitDelay + cs.turnReleaseAfterHit
      if (swinging && !released) {
        player.facing = turnToward(player.facing, player.attackYaw, turn, this.stance)
      } else if (this.stance.requested) {
        const target = this.stance.hasAim ? this.stance.aimYaw : player.facing
        player.facing = turnToward(player.facing, target, turn, this.stance)
      } else if (moving && !swinging) {
        player.facing = dampAngle(player.facing, Math.atan2(dir.x, dir.z), FACING_SMOOTHING, dt)
      }
    }

    if (body) body.setLinvel({ x: dir.x * speed, y: 0, z: dir.z * speed }, true)
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

    // INV-LOOT: what is in reach (containers, floor items) ~8 times a second, never a raycast per frame.
    if (this.simTime >= this.nextNearbyAt) {
      this.nextNearbyAt = this.simTime + NEARBY_INTERVAL
      this.refreshNearby()
    }

    const from: Vec3 = above(player.position, BODY_HEIGHT)
    // R1: only the interactables around the player (same order as the full list), not the whole map.
    // M11b: and on the player's storey.
    const nearby = this.interactableIndex.queryRadius(player.position.x, player.position.z, INTERACT_RANGE + this.maxInteractRadius).filter((i) => this.withinReachHeight(i))
    // CS1c: the object under the cursor first (the cursor ray taken at the object's height), then the
    // nearest one ahead; the current target stays unless another is clearly better.
    const cursor = this.cursorWorld
    const cam = GAME_CONFIG.camera.offset
    const pointerDistance = cursor
      ? (item: Interactable) => {
          const k = (item.position.y - cursor.y) / cam.y
          return Math.hypot(cursor.x + cam.x * k - item.position.x, cursor.z + cam.z * k - item.position.z)
        }
      : undefined
    const target = selectInteractable(player.position, player.facing, nearby, (item) => {
      this.perf.count('otherRaycasts')
      return this.isBlocked(from, item.position, [item.id])
    }, INTERACT_RANGE, { pointerDistance, current: this.currentInteractable?.id ?? null })
    this.currentInteractable = target
    this.interactPrompt = target ? this.describeInteraction(target) : this.nearbyFloorIds.length > 0 && !(this.lootOpen && this.openContainerId === null) ? 'Xem đồ dưới đất' : null

    // E with nothing targeted: the floor around the player (INV-LOOT §5).
    if (!target && this.nearbyFloorIds.length > 0 && this.input.wasPressed('interact') && player.attackTimer < 0) {
      this.cancelStance()
      if (this.lootOpen && this.openContainerId === null) this.closeContainer()
      else this.openLoot(null, true)
    }
    if (target && this.input.wasPressed('interact')) {
      // CS1: no world action in the middle of a swing (never queued either: the press is dropped).
      // From the ready stance, E leaves it first (a held right button must be pressed again).
      // A left click in the stance this same frame counts as the swing already (consistent order).
      const swingRequested = this.stance.requested && this.input.wasPressed('attack')
      if (player.attackTimer >= 0 || swingRequested) {
        this.events.queue('player:interactBlocked', {})
      } else {
        this.cancelStance()
        this.interact(target)
      }
    }
  }

  /** M11b: an interactable at the player's storey (not the floor above or below). */
  private withinReachHeight(item: Interactable): boolean {
    return Math.abs(item.position.y - this.player.position.y - BODY_HEIGHT) <= INTERACT_VERTICAL
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
    if (this.lootOpen && this.openContainerId === target.id) return `Đóng ${target.name}`
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
    if (this.lootOpen && this.openContainerId === container.id) {
      // Nhấn E lần nữa ở cùng container: đóng panel.
      this.closeContainer()
      this.interactPrompt = this.describeInteraction(target)
      return
    }
    this.openLoot(container.id, true)
    this.interactPrompt = this.describeInteraction(target)
  }

  /**
   * Show a container (or the floor, `null`) in the loot window. Looking into a container is opening
   * it (its recorded `opened` flag, the backpack patch relies on it); loot is never rolled here.
   * `withInventory`: E also opens the inventory window (a tab click in the loot window does not).
   */
  openLoot(containerId: string | null, withInventory = false): boolean {
    if (containerId !== null) {
      const container = this.world.containers.get(containerId)
      const target = this.interactableById.get(containerId)
      if (!container || !target) return false
      const firstTime = !container.opened
      container.opened = true
      if (firstTime) this.worldVersions.bump(container.id)
      this.events.queue('container:opened', { id: container.id, name: target.name, firstTime })
    }
    const previous = this.openContainerId
    this.openContainerId = containerId
    this.lootOpen = true
    this.lootInReach = containerId === null || this.canReachContainer(containerId)
    if (withInventory) this.inventoryOpen = true
    // Opening a window leaves the stance (a held right button must be pressed again to aim).
    this.cancelStance()
    if (previous && previous !== containerId) this.events.queue('container:closed', { id: previous })
    this.syncUiOpen()
    this.queueInventoryChanged()
    return true
  }

  /** Reach of an interactable: in range (plus `slack` for one already open), same storey, no wall between. */
  private canReachInteractable(item: Interactable, slack = 0): boolean {
    const p = this.player.position
    if (Math.hypot(item.position.x - p.x, item.position.z - p.z) > INTERACT_RANGE + item.radius + slack) return false
    return this.withinReachHeight(item) && !this.isBlocked(above(p, BODY_HEIGHT), item.position, [item.id])
  }

  private canReachContainer(id: string): boolean {
    const item = this.interactableById.get(id)
    return !!item && item.kind === 'container' && this.canReachInteractable(item, id === this.openContainerId ? GAME_CONFIG.inventory.closeDistanceSlack : 0)
  }

  /** Reach of a point on the floor (an item's own position): same storey, close, no wall between. */
  private canReachFloor(position: Vec3): boolean {
    const p = this.player.position
    if (Math.abs(position.y - p.y) > 0.5 || Math.hypot(position.x - p.x, position.z - p.z) > FLOOR_REACH) return false
    return !this.isBlocked(above(p, BODY_HEIGHT), above(position, 0.3), [])
  }

  private refreshNearby(): void {
    const p = this.player.position
    const containers = this.interactableIndex.queryRadius(p.x, p.z, INTERACT_RANGE + this.maxInteractRadius)
      .filter((i) => i.kind === 'container' && this.canReachInteractable(i))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((i) => i.id)
    const floor = this.world.floor.near(p, FLOOR_REACH, p.y).filter((e) => this.canReachFloor(e.position)).map((e) => e.item.id).sort()
    const inReach = this.openContainerId === null || this.canReachContainer(this.openContainerId)
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
    if (same(containers, this.nearbyContainerIds) && same(floor, this.nearbyFloorIds) && inReach === this.lootInReach) return
    this.nearbyContainerIds = containers
    this.nearbyFloorIds = floor
    this.lootInReach = inReach
    // INV-LOOT §7.2: a container that left reach cancels the jobs that use it (the others go on).
    for (const job of [...this.jobs]) {
      const transfer = transferData(job)
      if (!transfer) continue
      const gone = [transfer.source, transfer.destination].some((k) => {
        const id = containerIdOf(k)
        return id !== null && !this.canReachContainer(id)
      })
      if (gone) this.cancelJob(job.id, 'unreachable')
    }
    this.queueInventoryChanged()
  }

  /** Where a drop lands: a little ahead of the feet when nothing is in the way, else at the feet. */
  private dropPosition(): Vec3 {
    const p = this.player.position
    const ahead = { x: p.x + Math.sin(this.player.facing) * DROP_AHEAD, y: p.y, z: p.z + Math.cos(this.player.facing) * DROP_AHEAD }
    return this.isBlocked(above(p, 0.3), above(ahead, 0.3), []) ? { ...p } : ahead
  }

  // ----- Inventory / container: gọi từ UI (ngoài tick) hoặc test -----

  /** Door state change from the player, zombies (destroyed at 0 HP) or the lab; collider/nav follow. */
  setDoorState(id: string, state: DoorStatus): void {
    const door = this.world.doors.get(id)
    if (!door || door.state === state) return
    door.state = state
    door.hp = state === 'destroyed' ? 0 : door.hp || DOOR_MAX_HP
    this.worldVersions.bump(id)
    this.navWorld.setDoorState(id, state)
    this.lighting.markDoorDirty(id)
    if (state !== 'destroyed') this.events.queue('door:toggled', { id, open: state === 'open' })
    this.events.queue('door:changed', { id, state })
  }

  /** Lamp switch (the switch still clicks without power; the lamp just stays dark). */
  setLamp(id: string, on: boolean): void {
    if (!this.world.lamps.has(id) || this.world.lamps.get(id) === on) return
    this.world.lamps.set(id, on)
    this.worldVersions.bump(id)
    this.lighting.markLampDirty(id)
    this.events.queue('light:changed', { id, on })
  }

  /** Curtain: lets less daylight in (lighting) and blocks the player's sight (vision), separately. */
  setCurtain(id: string, closed: boolean): void {
    if (!this.world.curtains.has(id) || this.world.curtains.get(id) === closed) return
    this.world.curtains.set(id, closed)
    this.worldVersions.bump(id)
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
    // An item a transfer step is moving is in use (a craft's target may be equipped, S4 keeps P2-S4's rule).
    if (id !== null && this.ledger.heldByTransfer(id)) return false
    if (!equipWeapon(this.player.inventory, this.player.equipment, id)) return false
    const item = id === null ? null : findItem(this.player.inventory, id) ?? null
    this.events.queue('item:equipped', { id, itemId: item?.itemId ?? null })
    this.queueInventoryChanged()
    return true
  }

  /** Wear a bag from the main inventory (or take it off with `null`); the bag keeps its slot. */
  wearBag(id: string | null): boolean {
    if (!this.player.alive) return false
    // INV-LOOT Q2: a worn bag holding reserved items stays on until the action ends or is cancelled.
    const worn = this.player.equipment.backInstanceId
    if (worn && worn !== id && this.bagHeld(worn)) {
      this.events.queue('item:reserved', { itemId: 'backpack', name: getItemDef('backpack').name, label: this.jobs[0]?.label ?? '' })
      return false
    }
    if (!wearBag(this.player.inventory, this.player.equipment, id)) return false
    const item = id === null ? null : findItem(this.player.inventory, id) ?? null
    this.events.queue('bag:worn', { id, itemId: item?.itemId ?? null })
    this.queueInventoryChanged()
    return true
  }

  /** Drop a whole carried item (main or worn bag) on the floor; equipped, favorite and reserved items stay. */
  dropItem(instanceId: string): boolean {
    const source: InventoryKey = findItem(this.player.inventory, instanceId) ? 'main' : 'worn'
    return this.transferItems(source, 'floor', [{ instanceId }]).moved > 0
  }

  private indexInteractable(item: Interactable): void {
    this.interactableById.set(item.id, item)
    // Re-inserting moves it last, like the list push above.
    this.interactableIndex.insert(item.id, item, item.position.x, item.position.z)
    this.maxInteractRadius = Math.max(this.maxInteractRadius, item.radius)
  }

  /** Phím I: mở/đóng cửa sổ túi đồ (cửa sổ Loot độc lập, đóng bằng E hoặc nút đóng của nó). */
  toggleInventory(): void {
    this.setInventoryOpen(!this.inventoryOpen)
  }

  /** INV-LOOT: the inventory window only; the loot window (open container) stays as it is. */
  setInventoryOpen(open: boolean): void {
    if (this.inventoryOpen === open) return
    this.inventoryOpen = open
    if (open) this.cancelStance()
    this.syncUiOpen()
    this.queueInventoryChanged()
  }

  /** Close the loot window (container or floor). */
  closeContainer(): void {
    if (!this.lootOpen && !this.openContainerId) return
    const id = this.openContainerId
    this.openContainerId = null
    this.lootOpen = false
    this.syncUiOpen()
    if (id) this.events.queue('container:closed', { id })
    this.queueInventoryChanged()
  }

  closeAllUi(): void {
    if (!this.inventoryOpen && !this.lootOpen && !this.openContainerId) return
    this.inventoryOpen = false
    if (this.lootOpen || this.openContainerId) {
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

  /** Inventories the player may use directly: main, then the worn bag (INV-LOOT Q2). */
  get usableInventories(): Inventory[] {
    return usableInventories(this.player.inventory, this.player.equipment, this.world.bags)
  }

  /**
   * AX2 (CAS §6, FB §6): use an item where it is, as timed actions of one request. From a container
   * or the floor it is taken into the main inventory first; a sealed one is opened first (`open`
   * only opens it). Each later job works on what the earlier one produced, and leaves without running
   * when the earlier one did not do its part. Nothing is used up before the end of the last job.
   */
  useItem(source: InventoryKey, instanceId: string, opts: RequestOptions & { open?: boolean } = {}): UseStartResult {
    const refused = this.actions.refusal(opts.requestId)
    if (refused === 'DUPLICATE') return { ok: false, reason: 'duplicate' }
    const onFloor = source === 'floor' ? this.world.floor.find(instanceId) : null
    const inv = source === 'floor' ? (onFloor && this.canReachFloor(onFloor.position) ? onFloor.cell.items : null) : this.inventoryFor(source)
    const item = inv ? findItem(inv, instanceId) : undefined
    if (!inv || !item) return { ok: false, reason: onFloor || (source !== 'floor' && !inv) ? 'unreachable' : 'empty' }
    const def = getItemDef(item.itemId)
    const refuse = (reason: UseItemFailure): UseStartResult => {
      this.events.queue('item:useFailed', { itemId: def.id, name: def.name, reason })
      return { ok: false, reason }
    }
    if (item.kind === 'unknown') return refuse('not-usable')
    const sealed = def.sealed
    const use = sealed ? getItemDef(sealed.opensTo) : def
    const open = sealed !== undefined
    const consume = !opts.open && use.consumable !== undefined
    if ((opts.open && !open) || (!opts.open && !consume)) return refuse('not-usable')
    if (!this.player.alive) return refuse('dead')
    if (this.player.attackTimer >= 0) return refuse('busy')
    if (consume && !canBenefit(this.player, use.effect)) return refuse('no-effect')
    if (item.quantity - this.ledger.reserved(item.id) - this.actions.claimed(item.id) < 1) return refuse('reserved')
    const carried = isCarried(source)
    const steps = (carried ? 0 : 1) + (open ? 1 : 0) + (consume ? 1 : 0)
    if (refused === 'QUEUE_FULL' || this.jobs.length + steps > GAME_CONFIG.actions.queueLimit) return refuse('queue-full')
    if (!carried && previewTransfer(inv, item.id, this.player.inventory, 1).quantity < 1) return refuse('full')

    const chain = { broken: false }
    const from = opts.source ?? 'system'
    const target = { kind: 'item' as const, instanceId: item.id, inventory: source }
    let requestId: string | null = opts.requestId ?? null
    let last: EnqueueResult | null = null
    const add = <Data>(ctx: ActionContext, data: Data, label: string): boolean => {
      last = this.actions.enqueue(ctx.type, ctx, data, label, { requestId, chain })
      requestId = null
      return last.ok && last.state !== 'not-started'
    }
    if (!carried) {
      const prepared = prepareTransfer(this.actionWorld, source, 'main', [{ instanceId: item.id, quantity: 1 }], false)
      if (prepared.accepted.length === 0) return refuse(prepared.refused[0]?.reason === 'unreachable' ? 'unreachable' : 'reserved')
      const data: TransferData = { source, destination: 'main', lines: prepared.accepted, index: 0, total: 1, summary: { moved: 0, movedLines: 0, skipped: [] }, dropAt: null }
      if (!add({ actorId: 'player', type: ACTION.TRANSFER, target: { kind: 'inventory', key: 'main' }, source: from }, data, prepared.label)) {
        this.queueInventoryChanged()
        return { ok: false, reason: 'unreachable' }
      }
    }
    if (open) {
      const data: UseData = { itemId: item.itemId, instanceId: carried ? item.id : null, follow: !carried, resolved: null, done: false }
      // Could not even start (no room for the opened tin...): its own toast said why, nothing follows.
      if (!add({ actorId: 'player', type: ACTION.OPEN_ITEM, target, source: from }, data, `Mở ${def.name}`) && consume) {
        this.queueInventoryChanged()
        return { ok: false, reason: 'empty' }
      }
    }
    if (consume) {
      const action = use.consumable!.action
      const data: UseData = { itemId: use.id, instanceId: open || !carried ? null : item.id, follow: open || !carried, resolved: null, done: false }
      // Bandages and first aid are applied to the player (the item is what it is done with).
      const ctx: ActionContext = action === 'HEAL'
        ? { actorId: 'player', type: action, target: { kind: 'self' }, item: { instanceId: item.id, inventory: source }, source: from }
        : { actorId: 'player', type: action, target, source: from }
      add(ctx, data, `${USE_STATES[action].verb} ${use.name}`)
    }
    this.queueInventoryChanged()
    const result = last as EnqueueResult | null
    if (!result || !result.ok || result.state === 'not-started') return { ok: false, reason: 'empty' }
    return { ok: true, id: result.job.id, queued: result.state === 'queued' }
  }

  /**
   * The inventory behind a key, or null when the player cannot reach it now: the main inventory, the
   * worn bag's contents, or the open container (S3 widens this to nearby containers and the floor).
   */
  inventoryFor(key: InventoryKey): Inventory | null {
    if (key === 'main') return this.player.inventory
    if (key === 'worn') return wornBagContents(this.player.inventory, this.player.equipment, this.world.bags)
    const id = containerIdOf(key)
    return id !== null && this.canReachContainer(id) ? (this.world.containers.get(id)?.items ?? null) : null
  }

  /**
   * INV-LOOT: the one command that moves items between inventories (UI, bot and tests). Lines are
   * instance IDs with optional quantities, handled in the given order; each is checked against the
   * current state (equipped, favorite leaving what the player carries, reserved by an action, room),
   * then moved with `transferItem`, which never loses or duplicates a unit. One summary per call.
   * S2 moves at once; S4 turns each line into timed steps with the same rules.
   */
  transferItems(sourceKey: InventoryKey, destinationKey: InventoryKey, lines: readonly TransferLine[]): TransferSummary {
    const summary = emptySummary()
    const skip = (instanceId: string, itemId: TransferSkip['itemId'], reason: TransferRefusal) => summary.skipped.push({ instanceId, itemId, reason })
    const fromFixed = sourceKey === 'floor' ? null : this.inventoryFor(sourceKey)
    const dropAt = destinationKey === 'floor' ? this.dropPosition() : null
    const toFixed = destinationKey === 'floor' ? null : this.inventoryFor(destinationKey)
    let floorChanged = false
    for (const line of lines) {
      // Floor items are checked at their own position (never the middle of the pile or the list).
      const onFloor = sourceKey === 'floor' ? this.world.floor.find(line.instanceId) : null
      const from = sourceKey === 'floor' ? (onFloor && this.canReachFloor(onFloor.position) ? onFloor.cell.items : null) : fromFixed
      const dropCell = dropAt ? this.world.floor.cellAt(dropAt) : null
      const to = dropCell ? dropCell.items : toFixed
      const item = from ? findItem(from, line.instanceId) : undefined
      const itemId = item?.itemId ?? null
      if (!this.player.alive) skip(line.instanceId, itemId, 'dead')
      else if (this.player.attackTimer >= 0) skip(line.instanceId, itemId, 'busy')
      else if (!from || !to) skip(line.instanceId, itemId, 'unreachable')
      else if (sourceKey === destinationKey || from === to) skip(line.instanceId, itemId, 'same-inventory')
      else if (!item) skip(line.instanceId, null, 'missing')
      else {
        const leaving = isCarried(sourceKey) && !isCarried(destinationKey)
        const held = this.ledger.reserved(item.id)
        const reserved = (held > 0 && (line.quantity ?? item.quantity) > item.quantity - held) || this.bagHeld(item.id)
        const refusal = itemRefusal(item, this.player.equipment, leaving, reserved)
        if (refusal) {
          if (refusal === 'reserved') this.events.queue('item:reserved', { itemId: item.itemId, name: getItemDef(item.itemId).name, label: this.jobs[0]?.label ?? '' })
          skip(item.id, item.itemId, refusal)
        } else {
          const want = line.quantity === undefined ? item.quantity : line.quantity
          const r = transferItem(from, item.id, to, line.quantity)
          if (r.moved > 0) {
            summary.moved += r.moved
            summary.movedLines += 1
            if (onFloor || dropCell) floorChanged = true
          }
          if (r.moved < Math.floor(want) || r.moved === 0) skip(item.id, item.itemId, r.reason ?? 'full')
        }
      }
      if (onFloor) this.world.floor.sync(onFloor.cell)
      if (dropCell && dropAt) this.world.floor.sync(dropCell, dropAt)
    }
    if (floorChanged) {
      this.events.queue('drops:changed', {})
      this.nextNearbyAt = 0
    }
    if (summary.moved > 0) this.queueInventoryChanged()
    if (lines.length > 0) this.events.queue('inventory:transferred', { source: sourceKey, destination: destinationKey, moved: summary.moved, movedLines: summary.movedLines, skipped: summary.skipped.map((x) => x.reason) })
    return summary
  }

  /** Favorite (or not) an item the player carries; a favorite never merges and never leaves by a batch. */
  setFavorite(instanceId: string, favorite: boolean): boolean {
    const found = findUsable(this.player.inventory, this.player.equipment, this.world.bags, instanceId)
    if (!found) return false
    if (favorite) found.item.favorite = true
    else delete found.item.favorite
    this.queueInventoryChanged()
    return true
  }

  /** Lấy `quantity` (mặc định cả instance) từ container đang mở vào túi; phần không vừa ở lại container. */
  takeFromContainer(instanceId: string, quantity?: number): TransferOutcome {
    return this.legacyResult(this.openContainerId ? containerKey(this.openContainerId) : null, 'main', instanceId, quantity)
  }

  /** Cất `quantity` (mặc định cả instance) từ túi vào container đang mở (đồ đang trang bị/yêu thích: không). */
  putIntoContainer(instanceId: string, quantity?: number): TransferOutcome {
    return this.legacyResult('main', this.openContainerId ? containerKey(this.openContainerId) : null, instanceId, quantity)
  }

  /** Lấy tất cả có thể (bỏ qua mọi bộ lọc của UI); hết chỗ thì đồ còn lại vẫn ở container. */
  takeAll(): TransferOutcome {
    const c = this.openContainer
    if (!c) return { moved: 0, remainder: 0, reason: 'missing' }
    const r = this.transferItems(containerKey(c.id), 'main', c.items.items.map((i) => ({ instanceId: i.id })))
    return { moved: r.moved, remainder: totalQuantity(c.items), reason: r.skipped[0]?.reason ?? null }
  }

  private legacyResult(sourceKey: InventoryKey | null, destinationKey: InventoryKey | null, instanceId: string, quantity?: number): TransferOutcome {
    if (!sourceKey || !destinationKey) return { moved: 0, remainder: 0, reason: 'missing' }
    const r = this.transferItems(sourceKey, destinationKey, [{ instanceId, quantity }])
    const left = this.inventoryFor(sourceKey)
    return { moved: r.moved, remainder: (left && findItem(left, instanceId)?.quantity) ?? 0, reason: r.skipped[0]?.reason ?? null }
  }

  // ----- Timed actions: craft/repair (plan §7). Started from UI, advanced and committed in tick -----

  /** The running craft or repair (the first job once it started), or null. */
  get action(): TimedAction | null {
    return recipeAction(this.actions.head)
  }

  /** The running job as the HUD and the inventory window show it, or null. */
  get runningJob(): JobView | null {
    return this.actions.view()
  }

  /** AX1: the character's state this tick (FB §4). */
  get characterState(): CharacterState {
    return this.character.state
  }

  /** Seconds into the running step (the work pose), -1 when idle. */
  get workElapsed(): number {
    return this.actions.head?.step?.elapsed ?? -1
  }

  startCraft(id: RecipeId, opts: RequestOptions = {}): ActionStartResult {
    return this.startRecipe(RECIPES[id], null, opts)
  }

  /** Repair one weapon instance (main inventory or worn bag) with the recipe of its group. */
  startRepair(targetId: string, opts: RequestOptions = {}): ActionStartResult {
    const target = findUsable(this.player.inventory, this.player.equipment, this.world.bags, targetId)?.item
    const recipe = target ? repairRecipeFor(target.itemId) : null
    if (!recipe) return this.rejectAction('Sửa', target ? 'not-repairable' : 'no-target')
    return this.startRecipe(recipe, targetId, opts)
  }

  /**
   * Queue a craft or repair (INV-LOOT Q3) through the Action System. Accepted only if what is carried
   * and free now covers it (inputs from the main inventory then the worn bag, favorites and equipped
   * items never consumed); it starts at once when nothing runs, else waits its turn, is checked again
   * and reserved then. Public so tests can run ad-hoc recipes (e.g. with tool wear).
   */
  startRecipe(recipe: Recipe, targetId: string | null, opts: RequestOptions = {}): ActionStartResult {
    const refused = this.actions.refusal(opts.requestId)
    // A repeated request was already handled: nothing to say (one gesture, one execution).
    if (refused === 'DUPLICATE') return { ok: false, reason: 'duplicate' }
    const label = this.actionLabel(recipe, targetId)
    if (refused === 'QUEUE_FULL') return this.rejectAction(label, 'queue-full')
    if (!this.player.alive) return this.rejectAction(label, 'dead')
    if (this.player.attackTimer >= 0) return this.rejectAction(label, 'busy')
    // One repair of an item at a time in the queue (a spammed button never queues ten repairs).
    if (targetId !== null && this.jobs.some((j) => recipeData(j)?.targetId === targetId)) return this.rejectAction(label, 'already-queued')
    const check = checkRecipe(this.craftSources(undefined, true), recipe, targetId)
    if (!check.ok) return this.rejectAction(label, check.failure === 'missing-input' && this.jobs.length > 0 ? 'missing-carried' : check.failure!)
    const type = recipeActionType(recipe)
    const ctx: ActionContext = { actorId: 'player', type, target: targetId ? { kind: 'item', instanceId: targetId, inventory: null } : { kind: 'self' }, source: opts.source ?? 'system' }
    const data: RecipeData = { recipe, targetId, action: null, claims: check.plan ?? [] }
    const r = this.actions.enqueue(type, ctx, data, label, { requestId: opts.requestId })
    if (!r.ok) return { ok: false, reason: 'queue-full' }
    if (r.state === 'not-started') return { ok: false, reason: check.failure ?? 'missing-input' }
    this.queueInventoryChanged()
    return { ok: true, id: r.job.id, queued: r.state === 'queued' }
  }

  /**
   * Queue a timed transfer of instances (INV-LOOT §8) through the Action System: each line is checked
   * now and gets a fixed number of units; the job then moves them in timed steps, each checked again
   * when it starts and when it commits.
   */
  queueTransfer(source: InventoryKey, destination: InventoryKey, lines: readonly TransferLine[], opts: RequestOptions = {}): QueueResult {
    const refused = this.actions.refusal(opts.requestId)
    if (refused === 'DUPLICATE') return { id: null, refused: [] }
    if (refused === 'QUEUE_FULL') {
      const skipped = lines.map((l) => ({ instanceId: l.instanceId, itemId: null, reason: 'queue-full' as const }))
      this.events.queue('inventory:transferred', { source, destination, moved: 0, movedLines: 0, skipped: skipped.map((r) => r.reason) })
      return { id: null, refused: skipped }
    }
    const prepared = prepareTransfer(this.actionWorld, source, destination, lines, this.player.attackTimer >= 0)
    if (prepared.accepted.length === 0) {
      this.events.queue('inventory:transferred', { source, destination, moved: 0, movedLines: 0, skipped: prepared.refused.map((r) => r.reason) })
      return { id: null, refused: prepared.refused }
    }
    const data: TransferData = {
      source, destination, lines: prepared.accepted, index: 0, total: prepared.accepted.reduce((n, l) => n + l.left, 0),
      summary: { moved: 0, movedLines: 0, skipped: [...prepared.refused] }, dropAt: destination === 'floor' ? this.dropPosition() : null,
    }
    const ctx: ActionContext = { actorId: 'player', type: ACTION.TRANSFER, target: { kind: 'inventory', key: destination }, source: opts.source ?? 'system' }
    const r = this.actions.enqueue(ACTION.TRANSFER, ctx, data, prepared.label, { requestId: opts.requestId })
    this.queueInventoryChanged()
    return { id: r.ok ? r.job.id : null, refused: prepared.refused }
  }

  /** Cancel every job (the running step moves nothing; committed steps stay). Returns false when idle. */
  cancelAction(reason: ActionCancelReason = 'cancelled'): boolean {
    return this.actions.cancelAll(reason)
  }

  /** Cancel one job: the running one (the next starts on the next tick) or a waiting one. */
  cancelJob(id: number, reason: ActionCancelReason = 'cancelled'): boolean {
    return this.actions.cancel(id, reason)
  }

  /**
   * Commit the running job `id` once it has run its full duration. It leaves the queue with the
   * commit, so a repeated or stale completion is a no-op; the change is one transaction inside the
   * tick (snapshots only happen between ticks).
   */
  completeAction(id: number): boolean {
    return this.actions.complete(id)
  }

  /**
   * AX1: an interruption of the running action, decided by its definition's policy (the state
   * machine's rule); `cancel` stops the whole queue, as moving, a blow or a swing always did.
   */
  private interruptAction(kind: InterruptKind, reason: ActionCancelReason): void {
    const head = this.actions.head
    if (head && interrupts(kind, head.def.interrupt)) this.cancelAction(reason)
  }

  /** Advance the queue by simulation time (stops with the game's pause). */
  private stepQueue(dt: number): void {
    if (this.jobs.length === 0) return
    if (!this.player.alive) {
      this.cancelAction('dead')
      return
    }
    if (this.input.wasPressed('cancelAction')) {
      this.cancelAction('cancelled')
      return
    }
    this.actions.tick(dt)
  }

  /** What the character is doing this tick (FB §4), from the simulation's own state. */
  private updateCharacterState(): void {
    const p = this.player
    const head = this.actions.head
    this.character.update({
      alive: p.alive,
      moving: p.moveSpeed > 0,
      approaching: false,
      stance: this.stance.requested,
      swinging: p.attackTimer >= 0,
      action: head && head.status === 'running' ? head.def.characterState : null,
    })
  }

  /**
   * Craft sources: main inventory then the worn bag; favorites and equipped items never consumed.
   * `queueing`: also leave the units that queued work already counts on (claims), for a new action.
   */
  private craftSources(exceptAction?: number, queueing = false): CraftSources {
    const eq = this.player.equipment
    return {
      inventories: this.usableInventories,
      protect: (i) => !!i.favorite || isEquipped(i, eq),
      available: (i) => i.quantity - this.ledger.reserved(i.id, exceptAction) - (queueing ? this.actions.claimed(i.id) : 0),
    }
  }

  /** AX1: what action definitions may read and ask of the simulation (never the runtime itself). */
  private createActionWorld(): ActionWorld {
    const w: Omit<ActionWorld, 'player' | 'world'> = {
      ledger: this.ledger,
      events: this.events,
      inventoryFor: (key) => this.inventoryFor(key),
      canReachFloor: (position) => this.canReachFloor(position),
      bagHeld: (id) => this.bagHeld(id),
      craftSources: (exceptAction, queueing) => this.craftSources(exceptAction, queueing),
      claimed: (id) => this.actions.claimed(id),
      inventoryChanged: () => this.queueInventoryChanged(),
      floorChanged: () => {
        this.events.queue('drops:changed', {})
        this.nextNearbyAt = 0
      },
    }
    // New Game and load replace the player and the world: read them live.
    return Object.defineProperties(w, {
      player: { get: () => this.player, enumerable: true },
      world: { get: () => this.world, enumerable: true },
    }) as ActionWorld
  }

  /** A bag whose contents hold a reservation (it may not be taken off, moved or dropped). */
  private bagHeld(instanceId: string): boolean {
    return this.world.bags.get(instanceId)?.items.some((i) => this.ledger.reserved(i.id) > 0) ?? false
  }

  private rejectAction(label: string, reason: Exclude<ActionStartFailure, 'duplicate'>): ActionStartResult {
    this.events.queue('action:rejected', { label, reason })
    return { ok: false, reason }
  }

  private actionLabel(recipe: Recipe, targetId: string | null): string {
    if (recipe.kind === 'craft') return `Chế tạo ${getItemDef(recipe.output.itemId).name}`
    const target = targetId ? findUsable(this.player.inventory, this.player.equipment, this.world.bags, targetId)?.item : undefined
    return target ? `Sửa ${getItemDef(target.itemId).name}` : recipe.name
  }

  private syncUiOpen(): void {
    this.uiOpen = this.inventoryOpen || this.lootOpen || this.openContainerId !== null
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

  /**
   * M10: work for frames without a tick (menu, pause): warm the nav tile graph of a big world so the
   * game does not pay for it later. Returns whether anything was left to do.
   */
  idleWork(budgetMs = GAME_CONFIG.pathfinding.idleWarmMs): boolean {
    if (this.navWorld.warmed) return false
    this.navWorld.warm(budgetMs)
    return true
  }

  /** Serve queued A* requests within `GAME_CONFIG.pathfinding` (count and time), ACTIVE first. */
  private stepPathQueue(): void {
    this.pathQueue.process(this.pathBudget, (req) => {
      const z = this.zombies.get(req.id)
      if (!z || z.ai === 'DEAD') return false
      this.perf.count('pathsComputed')
      z.path = this.navWorld.findPath(z.position, req.goal) ?? []
      z.pathIndex = 0
      z.pathPending = false
      return true
    })
    // R3b: spare time goes to the nav tile graph (edges of long routes); never changes a result.
    if (this.pathQueue.size === 0) this.navWorld.warm(this.pathBudget.warmMs)
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
      // M11b: bodies on different storeys never push each other.
      moveZombie(z.position, z.velocity.x + (sep?.x ?? 0), z.velocity.z + (sep?.z ?? 0), stepDt, env, sameFloor(z.position, p) ? player : null)
      if (!dormant) {
        // Zombies do not overlap: each resolves half of an overlap with a neighbour, then the walls win.
        const neighbours = this.neighbourScratch
        neighbours.length = 0
        this.zombieIndex.queryRadius(z.position.x, z.position.z, cfg.radius * 2, neighbours)
        let pushed = false
        for (const n of neighbours) {
          if (n === z || n.ai === 'DEAD' || !sameFloor(n.position, z.position)) continue
          other.x = n.position.x
          other.z = n.position.z
          pushed = pushOutOfCircle(z.position, cfg.radius, other, 0.5) || pushed
        }
        if (pushed) resolveStatic(z.position, env)
      }
      this.zombieIndex.update(z.id, z.position.x, z.position.z)
      const body = this.zombieBodies.get(z.id)
      if (body) body.setNextKinematicTranslation({ x: z.position.x, y: z.position.y + cfg.height / 2, z: z.position.z })
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
      if (other === zombie || other.ai === 'DEAD' || !sameFloor(other.position, zombie.position)) continue
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
    if (player.alive) {
      // CS1: a left click swings only in the combat stance (or in the grace just before it started);
      // outside it the click does nothing in the world (a rare hint points to the right button).
      const s = this.stance
      let attack = false
      if (this.input.wasPressed('attack')) {
        // Hold: a click made while the right button was down counts even if it was let go in the same
        // frame (not when that button is waiting for a release after Esc/E/a panel).
        const chord = this.chordAllowed && this.input.wasPressedWhileHeld('attack', 'stance')
        if (s.requested || chord) attack = true
        else s.clickOutsideAt = this.simTime
      } else if (this.stanceStarted && this.simTime - s.clickOutsideAt <= GAME_CONFIG.combatStance.simultaneousGrace) {
        attack = true
      }
      if (attack) s.clickOutsideAt = -Infinity
      // Attacking or shoving interrupts the running action (the swing itself still happens).
      if (attack || this.input.wasPressed('push')) this.interruptAction('attack', 'attacked')
      const weapon = equippedWeapon(player.inventory, player.equipment)
      const cs = GAME_CONFIG.combatStance
      if (attack) {
        // CS1b: the swing's direction is the aim at the click (no auto-aim); the body turns toward it
        // during the wind-up (never set at once). Too early in the recovery: dropped; near its end:
        // queued (one only, the newest click wins).
        const yaw = s.hasAim ? s.aimYaw : player.facing
        if (!weapon) this.events.queue('player:unarmed', {})
        else if (!this.tryStartAttack(yaw)) {
          // Only a timing wait is buffered (not missing stamina: that click just does nothing).
          const wait = attackReadyIn(player)
          if (wait > 0 && wait <= cs.bufferWindow) this.pendingAttack = { yaw, expiresAt: this.simTime + cs.bufferWindow }
        }
      } else if (this.pendingAttack) {
        const pending = this.pendingAttack
        if (this.simTime > pending.expiresAt || !weapon) this.pendingAttack = null
        else if (canStartAttack(player, meleeStats(weapon.itemId))) {
          this.pendingAttack = null
          this.tryStartAttack(pending.yaw)
        }
      }
      if (this.input.wasPressed('push') && startPush(player)) {
        if (this.cursorWorld) player.facing = facingTowards(player.position, this.cursorWorld)
        this.resolvePlayerPush()
      }
    } else {
      this.pendingAttack = null
    }
    // Death interrupts a swing: its hit never lands (the cost stays paid).
    if (!player.alive && cancelSwing(player)) this.events.queue('player:attackCancelled', { reason: 'dead' })
    const melee = tickPlayerCombat(player, dt)
    if (melee === 'hit') this.resolvePlayerMelee()
    else if (melee === 'cancelled') this.events.queue('player:attackCancelled', { reason: 'align-timeout' })

    // Chỉ zombie còn sống sau khi người chơi ra đòn mới gây sát thương.
    for (const attack of attacks) {
      const zombie = this.zombies.get(attack.sourceId)
      if (!zombie || zombie.ai === 'DEAD') continue
      this.applyPlayerDamage(attack.damage, attack.sourceId)
    }
  }

  /** Start a swing with the equipped weapon toward `yaw` (its cost, cooldown and ID as before). */
  private tryStartAttack(yaw: number): boolean {
    const weapon = equippedWeapon(this.player.inventory, this.player.equipment)
    return weapon !== null && startAttack(this.player, meleeStats(weapon.itemId), GAME_CONFIG.player, weapon.id, yaw)
  }

  /** Zombies that can be within `range` (edge distance) of the player: spatial query (R1), map order. */
  private meleeTargets(range: number): MeleeTarget[] {
    const r = GAME_CONFIG.zombie.radius
    const list: MeleeTarget[] = []
    const p = this.player.position
    for (const z of this.zombieIndex.queryRadius(p.x, p.z, range + r)) {
      if (sameFloor(z.position, p)) list.push({ id: z.id, position: z.position, radius: r, alive: z.ai !== 'DEAD' })
    }
    return list
  }

  private isTargetBlocked(target: MeleeTarget): boolean {
    this.perf.count('otherRaycasts')
    return this.isBlocked(above(this.player.position, SWING_HEIGHT), above(target.position, SWING_HEIGHT), [])
  }

  /**
   * Hit window of the current swing. Damage uses the weapon's condition at this moment (1 still
   * deals full damage); wear is applied afterwards, once per attackId however many targets were hit.
   */
  private resolvePlayerMelee(): void {
    const cfg = GAME_CONFIG.melee
    const player = this.player
    const found = player.attackWeaponId ? findItem(player.inventory, player.attackWeaponId) : undefined
    const weapon = found?.kind === 'weapon' ? found : null
    if (!weapon) {
      this.events.queue('player:attacked', { hitIds: [], damage: 0, weaponId: null })
      return
    }
    const stats = meleeStats(weapon.itemId)
    const damage = weaponHitDamage(weapon.itemId, weapon.condition)
    // CS1b: the committed swing direction (the pose swings the same way), from where the player is now.
    const hits = resolveConeHits(player.position, player.attackYaw, this.meleeTargets(stats.range), { range: stats.range, halfAngleDeg: cfg.halfAngleDeg }, (t) => this.isTargetBlocked(t))
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
      this.interruptAction('hit', 'hit')
    }
    this.events.queue('player:damaged', { amount, health: this.player.health, sourceId })
    if (died) this.events.queue('player:died', { sourceId })
  }
}

/** The point `h` above a body's feet (M11b: heights are relative to the storey it stands on). */
function above(p: Vec3, h: number): Vec3 {
  return { x: p.x, y: p.y + h, z: p.z }
}

/** M11b: two bodies on the same floor (sight/reach/pushing between storeys never happens). */
function sameFloor(a: Vec3, b: Vec3): boolean {
  return Math.abs(a.y - b.y) <= LEVEL_TOLERANCE
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
      position: { x: door.center.x, y: door.center.y + 1, z: door.center.z },
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
    list.push({ id: room.lamp.id, kind: 'light', name: room.lamp.name, position: { x: room.lamp.switchAt.x, y: (room.floorY ?? 0) + SWITCH_HEIGHT, z: room.lamp.switchAt.z }, radius: 0.25 })
  }
  for (const w of mapWindows(map)) {
    const floor = w.center.y - (w.sill + w.head) / 2
    list.push({ id: w.id, kind: 'window', name: w.name, position: { x: w.center.x + w.inward.x * 0.35, y: floor + 1.3, z: w.center.z + w.inward.z * 0.35 }, radius: CURTAIN_REACH })
  }
  return list
}

/**
 * Editor playtest first (its page sets the map before loading the game, dev and editor build);
 * dev labs next; then the world picked in the menu or `?world=` (`worldChoice`), else the neighbourhood.
 */
function initialMap(): MapData {
  const playtest = playtestSession()
  if (playtest) return playtest.map
  if (import.meta.env.DEV && DOOR_LAB_ENABLED) return DOOR_LAB_MAP
  if (import.meta.env.DEV && STRESS_TILES) return buildStressMap(STRESS_TILES)
  return startupWorld(() => NEIGHBORHOOD_MAP)
}

/** Singleton runtime cho ứng dụng. Test tạo instance riêng bằng `new GameRuntime()`. */
export const runtime = new GameRuntime(initialMap())
