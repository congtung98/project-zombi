import type { PlayerVisionConfig } from '../core/config'
import type { EntityId, Vec3 } from '../../types'

/**
 * Player vision: which entities the player character can see. It only feeds rendering (fade in/out,
 * debug); zombie AI never reads it and keeps running for hidden zombies. Zombie perception lives
 * in `systems/ai.ts` and is a separate system on purpose.
 *
 * Order per entity (spec §14/§18): distance → near radius → vision cone → LOS raycast. Only entities
 * that pass the cheap checks are raycast, and at most `maxRaycastsPerUpdate` per pass.
 */

export type VisionReason = 'VISIBLE' | 'NEAR_DETECTION' | 'OUTSIDE_FOV' | 'OUT_OF_RANGE' | 'BLOCKED_BY_OCCLUDER'

/** Where the character stands and faces. `facing` is the character's yaw (forward = sin, cos), never the camera's. */
export interface VisionObserver {
  position: Vec3
  facing: number
}

export interface VisionTarget {
  id: EntityId
  position: Vec3
}

export interface EntityVisibility {
  id: EntityId
  /** Render source of truth: seen in the last pass, or lost less than the grace period ago. */
  isVisibleToPlayer: boolean
  /** Why, as of the last pass (debug label). */
  reason: VisionReason
  /** Raw result of the last pass. */
  seen: boolean
  /** Seconds since `seen` was last true (grace period); Infinity = never seen. */
  unseenFor: number
  /** Opacity the renderer applies, eased towards `isVisibleToPlayer` over `visibilityFadeDuration`. */
  opacity: number
  /** Pass number of the last LOS raycast (stale ones are re-checked first); −1 = never. */
  losPass: number
  losClear: boolean
  /** Last point aimed at (zombie mid-body), for debug rays. */
  target: Vec3
  /** Pass in which the entity was last returned by `getNearbyEntities`. */
  evaluatedPass: number
}

export interface VisionDebugRay {
  from: Vec3
  to: Vec3
  clear: boolean
}

export interface VisionDeps {
  /**
   * Candidate entities around `center` (coarse filter is fine; exact distance is checked here).
   * Today a loop over all zombies; a spatial hash can replace it without touching this system.
   */
  getNearbyEntities(center: Vec3, radius: number): Iterable<VisionTarget>
  /** true when no vision occluder lies between the two points. */
  hasLineOfSight(from: Vec3, to: Vec3): boolean
}

export interface VisionStats {
  passes: number
  candidates: number
  raycasts: number
  visible: number
}

type BroadPhase = 'OUT_OF_RANGE' | 'NEAR_DETECTION' | 'OUTSIDE_FOV' | 'IN_CONE'

export function facingForward(facing: number): { x: number; z: number } {
  return { x: Math.sin(facing), z: Math.cos(facing) }
}

export function cosHalfFov(fieldOfViewDeg: number): number {
  return Math.cos(((fieldOfViewDeg / 2) * Math.PI) / 180)
}

/** Dot-product cone test on the ground plane (no acos). A target on the observer counts as inside. */
export function isInsideVisionCone(observer: VisionObserver, target: Vec3, cosHalf: number): boolean {
  const dx = target.x - observer.position.x
  const dz = target.z - observer.position.z
  const len = Math.hypot(dx, dz)
  if (len < 1e-6) return true
  const f = facingForward(observer.facing)
  return (f.x * dx + f.z * dz) / len >= cosHalf
}

/** Eye point above the observer's feet (M11b: `position.y` is the floor it stands on). */
export function eyePosition(observer: VisionObserver, cfg: PlayerVisionConfig, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  out.x = observer.position.x
  out.y = observer.position.y + cfg.playerEyeHeight
  out.z = observer.position.z
  return out
}

export function targetPoint(position: Vec3, cfg: PlayerVisionConfig, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  out.x = position.x
  out.y = position.y + cfg.zombieTargetHeight
  out.z = position.z
  return out
}

function broadPhase(observer: VisionObserver, target: Vec3, cfg: PlayerVisionConfig, cosHalf: number): BroadPhase {
  const d = Math.hypot(target.x - observer.position.x, target.z - observer.position.z)
  if (d > cfg.visionDistance) return 'OUT_OF_RANGE'
  if (d <= cfg.nearDetectionRadius) return 'NEAR_DETECTION'
  return isInsideVisionCone(observer, target, cosHalf) ? 'IN_CONE' : 'OUTSIDE_FOV'
}

/**
 * Single-entity check with the same rules as a pass (no budget, no grace): the reference
 * `canPlayerSeeZombie` of the spec. The near radius skips the cone but still needs LOS unless
 * `nearDetectionThroughWalls`.
 */
export function classifyVisibility(
  observer: VisionObserver,
  position: Vec3,
  cfg: PlayerVisionConfig,
  hasLineOfSight: (from: Vec3, to: Vec3) => boolean,
): VisionReason {
  const phase = broadPhase(observer, position, cfg, cosHalfFov(cfg.fieldOfView))
  if (phase === 'OUT_OF_RANGE' || phase === 'OUTSIDE_FOV') return phase
  if (phase === 'NEAR_DETECTION' && cfg.nearDetectionThroughWalls) return 'NEAR_DETECTION'
  if (!hasLineOfSight(eyePosition(observer, cfg), targetPoint(position, cfg))) return 'BLOCKED_BY_OCCLUDER'
  return phase === 'NEAR_DETECTION' ? 'NEAR_DETECTION' : 'VISIBLE'
}

export class PlayerVisionSystem {
  readonly states = new Map<EntityId, EntityVisibility>()
  readonly stats: VisionStats = { passes: 0, candidates: 0, raycasts: 0, visible: 0 }
  /** LOS rays of the last pass; filled only while `debug` is on (no allocations otherwise). */
  readonly debugRays: VisionDebugRay[] = []
  debug = false
  private readonly cfg: PlayerVisionConfig
  private readonly deps: VisionDeps
  private readonly cosHalf: number
  /** Milliseconds since the last pass; starts due so the first tick evaluates at once. */
  private sinceUpdate = Infinity
  private pass = 0
  private readonly eye: Vec3 = { x: 0, y: 0, z: 0 }
  private readonly needLos: { state: EntityVisibility; phase: 'NEAR_DETECTION' | 'IN_CONE' }[] = []

  constructor(cfg: PlayerVisionConfig, deps: VisionDeps) {
    this.cfg = cfg
    this.deps = deps
    this.cosHalf = cosHalfFov(cfg.fieldOfView)
  }

  /** Once per simulation tick: a visibility pass when due, then grace/fade with the real dt. */
  update(dt: number, observer: VisionObserver): void {
    const interval = this.cfg.visionUpdateInterval
    this.sinceUpdate += dt * 1000
    if (this.sinceUpdate >= interval) {
      // Keep the remainder: a steady 20 passes/s at 30, 60 or 144 Hz, never more than one per tick.
      this.sinceUpdate = Number.isFinite(this.sinceUpdate) ? (this.sinceUpdate - interval) % interval : 0
      this.updateVisibility(observer)
    }
    this.updateVisibilityFade(dt)
  }

  /** Forces a pass on the next `update` (e.g. after a teleport or load). */
  invalidate(): void {
    this.sinceUpdate = Infinity
  }

  get(id: EntityId): EntityVisibility | undefined {
    return this.states.get(id)
  }

  isVisible(id: EntityId): boolean {
    return this.states.get(id)?.isVisibleToPlayer ?? false
  }

  /** 0 for unknown entities: a zombie that just spawned fades in instead of popping. */
  opacity(id: EntityId): number {
    return this.states.get(id)?.opacity ?? 0
  }

  forget(id: EntityId): void {
    this.states.delete(id)
  }

  clear(): void {
    this.states.clear()
    this.debugRays.length = 0
    this.sinceUpdate = Infinity
  }

  /** One pass: classify every candidate, raycast the ones that need it within the budget. */
  updateVisibility(observer: VisionObserver): void {
    const cfg = this.cfg
    const pass = ++this.pass
    const eye = eyePosition(observer, cfg, this.eye)
    const needLos = this.needLos
    needLos.length = 0
    let candidates = 0

    for (const t of this.deps.getNearbyEntities(observer.position, cfg.visionDistance)) {
      candidates += 1
      const state = this.stateFor(t.id)
      state.evaluatedPass = pass
      targetPoint(t.position, cfg, state.target)
      const phase = broadPhase(observer, t.position, cfg, this.cosHalf)
      if (phase === 'OUT_OF_RANGE' || phase === 'OUTSIDE_FOV') {
        state.seen = false
        state.reason = phase
      } else if (phase === 'NEAR_DETECTION' && cfg.nearDetectionThroughWalls) {
        state.seen = true
        state.reason = 'NEAR_DETECTION'
      } else {
        needLos.push({ state, phase })
      }
    }

    // Tracked entities the nearby query did not return are out of range.
    for (const state of this.states.values()) {
      if (state.evaluatedPass === pass) continue
      state.seen = false
      state.reason = 'OUT_OF_RANGE'
    }

    // Budget: with more candidates than raycasts, the stalest results are refreshed first (never
    // checked = −1 goes first, so a zombie entering the cone is raycast in its first pass).
    if (needLos.length > cfg.maxRaycastsPerUpdate) needLos.sort((a, b) => a.state.losPass - b.state.losPass)
    if (this.debug) this.debugRays.length = 0
    let raycasts = 0
    for (const entry of needLos) {
      const s = entry.state
      if (raycasts < cfg.maxRaycastsPerUpdate) {
        raycasts += 1
        s.losClear = this.deps.hasLineOfSight(eye, s.target)
        s.losPass = pass
        if (this.debug) this.debugRays.push({ from: { ...eye }, to: { ...s.target }, clear: s.losClear })
      }
      // Not raycast this pass: keep the previous result (never raycast = not seen yet).
      const clear = s.losPass >= 0 && s.losClear
      s.seen = clear
      s.reason = clear ? (entry.phase === 'NEAR_DETECTION' ? 'NEAR_DETECTION' : 'VISIBLE') : 'BLOCKED_BY_OCCLUDER'
    }

    this.stats.passes = pass
    this.stats.candidates = candidates
    this.stats.raycasts = raycasts
  }

  /** Grace period (visual smoothing, not memory) and opacity easing; runs every tick. */
  updateVisibilityFade(dt: number): void {
    const cfg = this.cfg
    const step = cfg.visibilityFadeDuration > 0 ? dt / cfg.visibilityFadeDuration : 1
    let visible = 0
    for (const s of this.states.values()) {
      if (s.seen) s.unseenFor = 0
      else s.unseenFor += dt
      s.isVisibleToPlayer = s.seen || s.unseenFor < cfg.visibilityGracePeriod
      const goal = s.isVisibleToPlayer ? 1 : 0
      s.opacity = s.opacity < goal ? Math.min(goal, s.opacity + step) : Math.max(goal, s.opacity - step)
      if (s.isVisibleToPlayer) visible += 1
    }
    this.stats.visible = visible
  }

  private stateFor(id: EntityId): EntityVisibility {
    let s = this.states.get(id)
    if (!s) {
      s = {
        id,
        isVisibleToPlayer: false,
        reason: 'OUT_OF_RANGE',
        seen: false,
        unseenFor: Infinity,
        opacity: 0,
        losPass: -1,
        losClear: false,
        target: { x: 0, y: 0, z: 0 },
        evaluatedPass: -1,
      }
      this.states.set(id, s)
    }
    return s
  }
}
