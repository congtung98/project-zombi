import { GAME_CONFIG } from '../core/config'
import { UNAWARE_STATES, type MemorySource, type ZombieState } from '../entities/zombie'
import type { DoorStatus } from '../world/doors'
import type { DoorRoute } from '../world/navigation'
import type { Vec2, Vec3, ZombieAIState } from '../../types'

export interface ZombieStepResult {
  /** Vận tốc mong muốn trên mặt phẳng XZ (đã gồm knockback). */
  velocity: Vec2
  /** true nếu zombie thực hiện một đòn đánh trong tick này. */
  attack: boolean
  /** Door hit this tick (damage frame of a bash); the runtime re-validates before applying it. */
  structureHit: string | null
  transition: { from: ZombieAIState; to: ZombieAIState } | null
}

export interface DoorInfo {
  state: DoorStatus
  center: Vec3
}

export interface ZombieAIContext {
  /**
   * Kiểm tra zombie có thể nhìn thấy mục tiêu (không bị tường, cửa đóng chắn).
   * Runtime cung cấp raycast physics; mặc định (test) luôn trả về true.
   */
  canReach: (zombie: ZombieState, target: Vec3) => boolean
  /** Tìm đường trên lưới điều hướng; null nếu không có đường. Mặc định: đi thẳng. */
  findPath?: (from: Vec3, to: Vec3) => Vec3[] | null
  /**
   * R2: asynchronous path request (takes precedence over `findPath`). 'none' = no route at all
   * (answered at once, like a null `findPath`), 'ready' = the path was written to the zombie now (a
   * trivial one), 'queued' = the pathfinding queue writes `zombie.path` later (after this AI pass).
   */
  requestPath?: (zombie: ZombieState, from: Vec3, to: Vec3) => 'none' | 'ready' | 'queued'
  /** Đoạn thẳng không cắt vật cản trên lưới. Mặc định: luôn đúng. */
  hasLineOfWalk?: (from: Vec3, to: Vec3) => boolean
  /** Phiên bản lưới điều hướng; đổi thì path cũ bị bỏ. */
  getNavVersion?: () => number
  /** Radius of the target's footstep noise this tick (0 = silent). Default: silent. */
  noiseRadius?: () => number
  /** Door to break when the target is unreachable (plan §10.2). Default: never bash. */
  findDoorRoute?: (from: Vec3, to: Vec3) => DoorRoute | null
  getDoor?: (id: string) => DoorInfo | null
  /** Keep or claim one of the contact slots at a door side; null when they are all taken. */
  claimDoorSlot?: (zombie: ZombieState, doorId: string, side: number) => Vec3 | null
  /** Random reachable wander destination for the zombie's zone; absent/null = stay put. */
  pickWanderPoint?: (zombie: ZombieState) => Vec3 | null
  /** Uniform [0, 1) for rest times; default 0.5 (deterministic tests). */
  random?: () => number
}

const DEFAULT_CONTEXT: ZombieAIContext = { canReach: () => true }

type ZombieCfg = typeof GAME_CONFIG.zombie
type NavCfg = typeof GAME_CONFIG.nav

interface StepCfg {
  zombie: ZombieCfg
  nav: NavCfg
  hearing: typeof GAME_CONFIG.hearing
  structure: typeof GAME_CONFIG.structure
}

/**
 * FSM (plan §10.3): IDLE ⇄ WANDER (MIGRATE is started by the horde director) → CHASE when the
 * player is seen, SEARCH when heard or lost; CHASE ⇄ ATTACK; CHASE/SEARCH → APPROACH_STRUCTURE →
 * ATTACK_STRUCTURE when a closed door blocks the only route to the remembered position; door
 * open/broken → SEARCH; memory or siege time over → IDLE; mọi trạng thái → DEAD. Hàm thuần: chỉ
 * thay đổi `zombie` và trả về vận tốc/đòn đánh mong muốn; physics bên ngoài giải quyết va chạm.
 */
export function stepZombie(
  zombie: ZombieState,
  target: Vec3,
  targetAlive: boolean,
  dt: number,
  cfg = GAME_CONFIG.zombie,
  ctx: ZombieAIContext = DEFAULT_CONTEXT,
  navCfg = GAME_CONFIG.nav,
): ZombieStepResult {
  const c: StepCfg = { zombie: cfg, nav: navCfg, hearing: GAME_CONFIG.hearing, structure: GAME_CONFIG.structure }
  const result: ZombieStepResult = { velocity: { x: 0, z: 0 }, attack: false, structureHit: null, transition: null }

  if (zombie.ai === 'DEAD') {
    zombie.deadTimer += dt
    zombie.hitFlashTimer = Math.max(0, zombie.hitFlashTimer - dt)
    return result
  }
  if (zombie.health <= 0) {
    result.transition = transition(zombie, 'DEAD')
    return result
  }

  zombie.attackCooldown = Math.max(0, zombie.attackCooldown - dt)
  zombie.hitFlashTimer = Math.max(0, zombie.hitFlashTimer - dt)
  zombie.repathTimer = Math.max(0, zombie.repathTimer - dt)
  decayKnockback(zombie, dt, cfg.knockbackDamping)
  if (zombie.lastKnownTarget) zombie.memoryAge += dt

  const dx = target.x - zombie.position.x
  const dz = target.z - zombie.position.z
  const dist = Math.hypot(dx, dz)

  zombie.detectTimer -= dt
  let percept: MemorySource | null = null
  if (zombie.detectTimer <= 0) {
    zombie.detectTimer = cfg.detectInterval
    percept = targetAlive ? perceive(zombie, target, dist, c, ctx) : null
    zombie.seesTarget = percept === 'sight'
    if (percept) remember(zombie, target, percept)
  }
  const sees = zombie.seesTarget

  // Bị khựng: chỉ trôi theo knockback, hủy đòn đang vung.
  if (zombie.staggerTimer > 0) {
    zombie.staggerTimer = Math.max(0, zombie.staggerTimer - dt)
    zombie.attackWindup = -1
    result.velocity = { x: zombie.knockback.x, z: zombie.knockback.z }
    return result
  }

  switch (zombie.ai) {
    case 'IDLE':
    case 'WANDER':
    case 'MIGRATE': {
      if (sees) {
        endRoaming(zombie)
        result.transition = transition(zombie, 'CHASE')
        break
      }
      if (zombie.lastKnownTarget) {
        // Heard footsteps (or got hit): go and look.
        endRoaming(zombie)
        zombie.loseTargetTimer = 0
        result.transition = transition(zombie, 'SEARCH')
        break
      }
      if (zombie.ai === 'IDLE') {
        if (!ctx.pickWanderPoint) break
        zombie.restTimer -= dt
        if (zombie.restTimer > 0) break
        const point = ctx.pickWanderPoint(zombie)
        if (!point) {
          zombie.restTimer = restTime(cfg, ctx)
          break
        }
        zombie.moveTarget = point
        zombie.moveTimer = 0
        result.transition = transition(zombie, 'WANDER')
        break
      }
      // WANDER / MIGRATE: walk to the destination, then rest.
      zombie.moveTarget ??= ctx.pickWanderPoint?.(zombie) ?? null
      const goal = zombie.moveTarget
      zombie.moveTimer += dt
      const timeout = zombie.ai === 'WANDER' ? cfg.wanderTimeout : cfg.migrateTimeout
      if (!goal || planarDistance(zombie.position, goal) <= cfg.arriveDistance || zombie.moveTimer >= timeout) {
        result.transition = rest(zombie, cfg, ctx)
        break
      }
      const move = moveTowards(zombie, goal, dt, zombie.ai === 'WANDER' ? cfg.wanderSpeed : cfg.migrateSpeed, ctx, navCfg)
      if (move.blocked) {
        result.transition = rest(zombie, cfg, ctx)
        break
      }
      result.velocity = move.velocity
      break
    }
    case 'CHASE': {
      if (!sees) {
        zombie.loseTargetTimer = 0
        result.transition = transition(zombie, 'SEARCH')
        break
      }
      if (dist <= cfg.attackRange) {
        clearPath(zombie)
        zombie.attackWindup = -1
        result.transition = transition(zombie, 'ATTACK')
        break
      }
      const move = moveTowards(zombie, target, dt, cfg.speed, ctx, navCfg)
      // Seen but unreachable (e.g. across a fence line): only bash a door that is on the route.
      if (move.blocked && startBreach(zombie, target, ctx) === 'door') {
        result.transition = transition(zombie, 'APPROACH_STRUCTURE')
        break
      }
      result.velocity = move.velocity
      break
    }
    case 'SEARCH': {
      if (sees) {
        zombie.loseTargetTimer = 0
        result.transition = transition(zombie, 'CHASE')
        break
      }
      if (percept === 'noise') zombie.loseTargetTimer = 0 // new footsteps: keep following them
      zombie.loseTargetTimer += dt
      const goal = zombie.lastKnownTarget
      const arrived = !goal || planarDistance(zombie.position, goal) <= cfg.arriveDistance
      if ((arrived && zombie.loseTargetTimer >= cfg.loseTargetDelay) || zombie.memoryAge >= cfg.memoryDuration) {
        result.transition = giveUp(zombie, cfg, ctx)
        break
      }
      if (goal && !arrived) {
        const move = moveTowards(zombie, goal, dt, cfg.speed, ctx, navCfg)
        if (move.blocked) {
          // Closed door between the zombie and the memory: bash it; no route at all: give up.
          const breach = startBreach(zombie, goal, ctx)
          if (breach === 'door') result.transition = transition(zombie, 'APPROACH_STRUCTURE')
          else if (breach === 'none') result.transition = giveUp(zombie, cfg, ctx)
          break
        }
        result.velocity = move.velocity
      }
      break
    }
    case 'APPROACH_STRUCTURE':
    case 'ATTACK_STRUCTURE': {
      const next = stepStructure(zombie, sees, percept, dt, c, ctx, result)
      if (next) result.transition = next
      break
    }
    case 'ATTACK': {
      if (!targetAlive) {
        zombie.attackWindup = -1
        result.transition = transition(zombie, 'IDLE')
        break
      }
      if (dist > cfg.attackRange * 1.15 || !sees) {
        zombie.attackWindup = -1
        result.transition = transition(zombie, 'CHASE')
        break
      }
      zombie.facing = Math.atan2(dx, dz)
      if (zombie.attackWindup < 0) {
        if (zombie.attackCooldown <= 0) zombie.attackWindup = cfg.attackWindup
      } else {
        zombie.attackWindup -= dt
        if (zombie.attackWindup <= 0) {
          zombie.attackWindup = -1
          zombie.attackCooldown = cfg.attackCooldown
          // Kiểm tra lại tường chắn đúng tại thời điểm gây sát thương, không dùng cache phát hiện.
          if (dist <= cfg.attackRange * 1.15 && ctx.canReach(zombie, target)) result.attack = true
        }
      }
      break
    }
  }

  result.velocity.x += zombie.knockback.x
  result.velocity.z += zombie.knockback.z
  return result
}

/**
 * Sight: LOS raycast within range; unaware zombies only see inside their view cone (or very close).
 * Hearing: the player's footsteps within a fixed radius, in any direction, halved through walls.
 * A player standing still behind a wall is neither seen nor heard (plan §10.1).
 */
function perceive(zombie: ZombieState, target: Vec3, dist: number, c: StepCfg, ctx: ZombieAIContext): MemorySource | null {
  const cfg = c.zombie
  const unaware = UNAWARE_STATES.has(zombie.ai)
  let clear: boolean | undefined
  if (dist <= (unaware ? cfg.detectRange : cfg.chaseRange) && (!unaware || dist <= cfg.closeSenseRange || inViewCone(zombie, target, dist, cfg))) {
    clear = ctx.canReach(zombie, target)
    if (clear) return 'sight'
  }
  const noise = ctx.noiseRadius?.() ?? 0
  if (noise > 0 && dist <= noise) {
    if (dist <= noise * c.hearing.wallFactor) return 'noise'
    clear ??= ctx.canReach(zombie, target)
    if (clear) return 'noise'
  }
  return null
}

function inViewCone(zombie: ZombieState, target: Vec3, dist: number, cfg: ZombieCfg): boolean {
  if (dist < 1e-4) return true
  const dot = (Math.sin(zombie.facing) * (target.x - zombie.position.x) + Math.cos(zombie.facing) * (target.z - zombie.position.z)) / dist
  return dot >= Math.cos((cfg.viewHalfAngleDeg * Math.PI) / 180)
}

function remember(zombie: ZombieState, point: Vec3, source: MemorySource): void {
  zombie.lastKnownTarget = { x: point.x, y: point.y, z: point.z }
  zombie.memoryAge = 0
  zombie.memorySource = source
  if (zombie.ai === 'ATTACK_STRUCTURE') zombie.siegeTimer = 0
}

function forget(zombie: ZombieState): void {
  zombie.lastKnownTarget = null
  zombie.memoryAge = 0
  zombie.memorySource = null
}

/**
 * Door siege. APPROACH: walk to a free contact slot on our side (or wait in a queue further out
 * when both are taken), ATTACK: face the door and hit it with the usual windup; the runtime
 * applies the hit only if the door is still closed and within reach. Seeing the player, the door
 * opening/breaking, memory (approach) or siege time (attack) running out end the siege.
 */
function stepStructure(
  zombie: ZombieState,
  sees: boolean,
  percept: MemorySource | null,
  dt: number,
  c: StepCfg,
  ctx: ZombieAIContext,
  result: ZombieStepResult,
): { from: ZombieAIState; to: ZombieAIState } | null {
  const cfg = c.zombie
  const doorId = zombie.structureTargetId
  const door = doorId ? ctx.getDoor?.(doorId) ?? null : null
  if (sees) {
    leaveStructure(zombie)
    return transition(zombie, 'CHASE')
  }
  if (!door || door.state !== 'closed') {
    // Opened or broken (plan §10.2 step 5): search the remembered spot; only CHASE if seen again.
    leaveStructure(zombie)
    zombie.memoryAge = 0
    zombie.loseTargetTimer = 0
    if (!zombie.lastKnownTarget) return giveUp(zombie, cfg, ctx)
    return transition(zombie, 'SEARCH')
  }
  const slot = ctx.claimDoorSlot?.(zombie, doorId!, zombie.structureSide) ?? null
  zombie.structureSlot = slot
  const toDoor = planarDistance(zombie.position, door.center)

  if (zombie.ai === 'APPROACH_STRUCTURE') {
    if (zombie.memoryAge >= cfg.memoryDuration) {
      leaveStructure(zombie)
      return giveUp(zombie, cfg, ctx)
    }
    if (slot && (planarDistance(zombie.position, slot) <= cfg.arriveDistance * 0.6 || toDoor <= c.structure.reach * 0.9)) {
      clearPath(zombie)
      zombie.attackWindup = -1
      zombie.siegeTimer = 0
      return transition(zombie, 'ATTACK_STRUCTURE')
    }
    // No free slot: wait in line at the queue distance, never hit from behind other zombies.
    if (!slot && toDoor <= c.structure.queueDistance) {
      zombie.facing = Math.atan2(door.center.x - zombie.position.x, door.center.z - zombie.position.z)
      return null
    }
    const move = moveTowards(zombie, slot ?? zombie.structureApproach ?? door.center, dt, cfg.speed, ctx, c.nav)
    if (move.blocked) {
      // Our side of the door became unreachable (topology changed): replan from the memory.
      leaveStructure(zombie)
      zombie.loseTargetTimer = 0
      return transition(zombie, 'SEARCH')
    }
    result.velocity = move.velocity
    return null
  }

  // ATTACK_STRUCTURE
  if (percept) zombie.siegeTimer = 0 // new information about the player keeps the siege going
  zombie.siegeTimer += dt
  if (zombie.siegeTimer >= c.structure.siegeHold) {
    leaveStructure(zombie)
    return giveUp(zombie, cfg, ctx)
  }
  if (!slot || toDoor > c.structure.reach * 1.25) {
    // Knocked back or lost the slot: walk back in.
    zombie.attackWindup = -1
    return transition(zombie, 'APPROACH_STRUCTURE')
  }
  zombie.facing = Math.atan2(door.center.x - zombie.position.x, door.center.z - zombie.position.z)
  if (zombie.attackWindup < 0) {
    if (zombie.attackCooldown <= 0) zombie.attackWindup = cfg.attackWindup
  } else {
    zombie.attackWindup -= dt
    if (zombie.attackWindup <= 0) {
      zombie.attackWindup = -1
      zombie.attackCooldown = c.structure.cooldown
      result.structureHit = doorId
    }
  }
  return null
}

/**
 * The goal is unreachable: pick the door to break on the way (plan §10.2). 'door' = the zombie now
 * has a structure target; 'none' = not even through doors; 'open' = a route exists after all.
 */
function startBreach(zombie: ZombieState, goal: Vec3, ctx: ZombieAIContext): 'door' | 'none' | 'open' | 'unsupported' {
  if (!ctx.findDoorRoute) return 'unsupported'
  const route = ctx.findDoorRoute(zombie.position, goal)
  if (!route) return 'none'
  if (route.doorId === null) return 'open'
  clearPath(zombie)
  zombie.structureTargetId = route.doorId
  zombie.structureSide = route.side
  zombie.structureApproach = { ...route.approach }
  zombie.structureSlot = null
  zombie.siegeTimer = 0
  zombie.attackWindup = -1
  return 'door'
}

function leaveStructure(zombie: ZombieState): void {
  zombie.structureTargetId = null
  zombie.structureApproach = null
  zombie.structureSlot = null
  zombie.siegeTimer = 0
  zombie.attackWindup = -1
  clearPath(zombie)
}

function endRoaming(zombie: ZombieState): void {
  zombie.moveTarget = null
  zombie.moveTimer = 0
  clearPath(zombie)
}

/** Forget the player and go back to wandering after a short rest. */
function giveUp(zombie: ZombieState, cfg: ZombieCfg, ctx: ZombieAIContext): { from: ZombieAIState; to: ZombieAIState } {
  zombie.loseTargetTimer = 0
  forget(zombie)
  clearPath(zombie)
  zombie.restTimer = restTime(cfg, ctx)
  return transition(zombie, 'IDLE')
}

function rest(zombie: ZombieState, cfg: ZombieCfg, ctx: ZombieAIContext): { from: ZombieAIState; to: ZombieAIState } {
  endRoaming(zombie)
  zombie.restTimer = restTime(cfg, ctx)
  return transition(zombie, 'IDLE')
}

function restTime(cfg: ZombieCfg, ctx: ZombieAIContext): number {
  return cfg.wanderRestMin + (cfg.wanderRestMax - cfg.wanderRestMin) * (ctx.random?.() ?? 0.5)
}

/**
 * Đẩy lùi zombie khỏi `from` một quãng `distance` và làm khựng `stagger` giây. An unaware zombie
 * that gets hit or shoved notices where it came from (it will SEARCH there).
 */
export function applyKnockback(zombie: ZombieState, from: Vec3, distance: number, stagger: number, cfg = GAME_CONFIG.zombie): void {
  if (zombie.ai === 'DEAD') return
  let dx = zombie.position.x - from.x
  let dz = zombie.position.z - from.z
  const len = Math.hypot(dx, dz)
  if (len < 1e-4) {
    dx = Math.sin(zombie.facing) * -1
    dz = Math.cos(zombie.facing) * -1
  } else {
    dx /= len
    dz /= len
  }
  const speed = distance * cfg.knockbackDamping
  zombie.knockback.x = dx * speed
  zombie.knockback.z = dz * speed
  zombie.staggerTimer = Math.max(zombie.staggerTimer, stagger)
  zombie.attackWindup = -1
  zombie.hitFlashTimer = 0.15
  if (UNAWARE_STATES.has(zombie.ai)) remember(zombie, from, 'noise')
}

/** Gây sát thương; trả về true nếu zombie vừa chết trong lần gọi này. */
export function damageZombie(zombie: ZombieState, amount: number): boolean {
  if (zombie.ai === 'DEAD' || amount <= 0) return false
  zombie.health = Math.max(0, zombie.health - amount)
  zombie.hitFlashTimer = 0.15
  if (zombie.health <= 0) {
    zombie.ai = 'DEAD'
    zombie.attackWindup = -1
    zombie.knockback.x = 0
    zombie.knockback.z = 0
    zombie.structureTargetId = null
    zombie.structureSlot = null
    clearPath(zombie)
    return true
  }
  return false
}

function decayKnockback(zombie: ZombieState, dt: number, damping: number): void {
  const k = zombie.knockback
  if (k.x === 0 && k.z === 0) return
  const f = Math.exp(-damping * dt)
  k.x *= f
  k.z *= f
  if (Math.hypot(k.x, k.z) < 0.05) {
    k.x = 0
    k.z = 0
  }
}

function clearPath(zombie: ZombieState): void {
  zombie.path = []
  zombie.pathIndex = 0
  zombie.pathGoal = null
  zombie.stuckTimer = 0
}

function planarDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

/**
 * Chọn hướng đi tới `goal`: đi thẳng nếu lưới cho phép, nếu không thì bám theo
 * path A*. Tìm đường lại khi đích dời xa, lưới đổi (cửa), hết path hoặc kẹt.
 * `blocked` = a fresh path query just found no route (never walk through the blocker).
 */
function moveTowards(
  zombie: ZombieState,
  goal: Vec3,
  dt: number,
  speed: number,
  ctx: ZombieAIContext,
  navCfg: NavCfg,
): { velocity: Vec2; blocked: boolean } {
  const pos = zombie.position
  let waypoint: Vec3 = goal

  if ((ctx.requestPath || ctx.findPath) && !(ctx.hasLineOfWalk?.(pos, goal) ?? true)) {
    const goalMoved = !zombie.pathGoal || Math.hypot(goal.x - zombie.pathGoal.x, goal.z - zombie.pathGoal.z) > navCfg.repathTargetDelta
    const navVersion = ctx.getNavVersion?.() ?? -1
    const navChanged = navVersion !== zombie.pathNavVersion
    const exhausted = zombie.pathIndex >= zombie.path.length
    const stuck = zombie.stuckTimer >= navCfg.stuckTime
    // Re-plan only when the target moved enough, the path is invalid/finished, the doors changed or
    // the zombie is stuck, and not more often than `repathInterval` (plan: no request every frame).
    if ((goalMoved || navChanged || exhausted || stuck) && (zombie.repathTimer <= 0 || navChanged)) {
      zombie.pathGoal = { ...goal }
      zombie.pathNavVersion = navVersion
      zombie.repathTimer = navCfg.repathInterval
      zombie.stuckTimer = 0
      if (ctx.requestPath) {
        // A path from before a door change may cross a door that is now closed: drop it and wait.
        if (navChanged) {
          zombie.path = []
          zombie.pathIndex = 0
        }
        const r = ctx.requestPath(zombie, pos, goal)
        if (r === 'none') {
          zombie.path = []
          zombie.pathIndex = 0
          return { velocity: { x: 0, z: 0 }, blocked: true }
        }
      } else {
        const path = ctx.findPath!(pos, goal)
        zombie.path = path ?? []
        zombie.pathIndex = 0
        if (!path) return { velocity: { x: 0, z: 0 }, blocked: true }
      }
    }
    while (
      zombie.pathIndex < zombie.path.length - 1 &&
      Math.hypot(zombie.path[zombie.pathIndex].x - pos.x, zombie.path[zombie.pathIndex].z - pos.z) <= navCfg.waypointReachDist
    ) {
      zombie.pathIndex += 1
    }
    if (zombie.pathIndex < zombie.path.length) waypoint = zombie.path[zombie.pathIndex]
    // No route yet (queued) or none: wait for the queue / topology / perception, never walk through the blocker.
    else return { velocity: { x: 0, z: 0 }, blocked: false }
  } else {
    clearPath(zombie)
  }

  // Phát hiện kẹt: gần như không dịch chuyển dù muốn đi.
  const moved = Math.hypot(pos.x - zombie.lastPosition.x, pos.z - zombie.lastPosition.z)
  zombie.stuckTimer = moved < speed * dt * 0.25 ? zombie.stuckTimer + dt : 0
  zombie.lastPosition.x = pos.x
  zombie.lastPosition.z = pos.z

  const dx = waypoint.x - pos.x
  const dz = waypoint.z - pos.z
  const d = Math.hypot(dx, dz)
  if (d < 1e-4) return { velocity: { x: 0, z: 0 }, blocked: false }
  zombie.facing = Math.atan2(dx, dz)
  return { velocity: { x: (dx / d) * speed, z: (dz / d) * speed }, blocked: false }
}

function transition(zombie: ZombieState, to: ZombieAIState): { from: ZombieAIState; to: ZombieAIState } {
  const from = zombie.ai
  zombie.ai = to
  return { from, to }
}
