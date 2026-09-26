import { useEffect, useMemo, useRef } from 'react'
import { CapsuleCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import type { Group, Mesh } from 'three'
import { runtime } from '../core/runtime'
import { cutaway } from './cutaway'
import { useSettingsStore } from '../../stores/settingsStore'
import { computePose, createPose } from './character/pose'
import { registerAnimator } from './character/animators'
import { applyPose, buildCharacter, setCharacterGlow, setCharacterOpacity, shadowDetail, zombieLook } from './character/rig'
import { advanceMeasuredGait, createMeasuredGait } from './character/gait'
import { dampAngle } from '../systems/movement'
import type { EntityId } from '../../types'

const CFG = runtime.config.zombie
const HALF_HEIGHT = (CFG.height - 2 * CFG.radius) / 2
const FALL_DURATION = 0.45
/** Metres per gait cycle: a slow shamble (chase 2.3 m/s ≈ 1.4 cycles/s, wander ≈ 0.55). */
const STRIDE = 1.6
/** Visual turn rate: path corners and retargets no longer snap the body around. */
const TURN_SMOOTHING = 10
/** Longest stagger (push) used to normalise the hit-reaction pose. */
const MAX_STAGGER = Math.max(runtime.config.melee.stagger, runtime.config.push.stagger)
/** Keep the slam pose briefly after the damage frame so the hit reads on screen (visual only). */
const STRIKE_HOLD = 0.18

interface ZombieViewProps {
  id: EntityId
}

/**
 * Zombie visual (R2: rendering only). The rigged model (variant from the zombie ID) is placed and
 * posed from simulation state after each tick; it owns no AI state, position, path, health or
 * target, and unmounting it (DORMANT zombies are not drawn) changes nothing in the simulation. Eyes
 * glow while chasing/attacking, the model flashes on hits, the health bar shows once damaged and the
 * body falls when dead. Drawn only as the player vision allows (`runtime.vision` opacity: fade in/out,
 * hidden = not drawn, no shadow). The physics body is `ZombieBody`, mounted only while ACTIVE.
 */
export function ZombieView({ id }: ZombieViewProps) {
  const rootRef = useRef<Group>(null)
  const visualRef = useRef<Group>(null)
  const healthBarRef = useRef<Group>(null)
  const healthFillRef = useRef<Mesh>(null)
  const shadows = useSettingsStore((s) => s.shadows)
  const rig = useMemo(() => buildCharacter(zombieLook(id), shadowDetail(shadows)), [id, shadows])
  const pose = useRef(createPose())
  const zombie = runtime.zombies.get(id)
  const anim = useRef({ gait: createMeasuredGait(), time: (zombie?.id.length ?? 0) * 0.37, strike: 0, windup: -1, facing: zombie?.facing ?? 0 })

  useEffect(() => () => rig.dispose(), [rig])

  // Posed after the tick by CharacterAnimator (same state as the simulation this frame).
  useEffect(() => registerAnimator((delta) => {
    const z = runtime.zombies.get(id)
    const visual = visualRef.current
    const root = rootRef.current
    if (!z || !visual || !root) return
    // The simulation owns the position (R2); the view just follows it.
    root.position.set(z.position.x, z.position.y, z.position.z)
    const a = anim.current
    a.time += delta
    a.facing = dampAngle(a.facing, z.facing, TURN_SMOOTHING, delta)
    visual.rotation.y = a.facing
    // Filtered speed + integrated phase: steady legs at 60, 144 or 240 Hz (physics steps at 60 Hz).
    advanceMeasuredGait(a.gait, z.position.x, z.position.z, delta, STRIDE, z.ai !== 'DEAD')

    // attackWindup counts down to the damage frame, then resets to −1: hold the slam briefly.
    let attack = z.attackWindup >= 0 ? 1 - z.attackWindup / CFG.attackWindup : -1
    if (z.attackWindup < 0 && a.windup >= 0 && a.windup < 0.12 && z.staggerTimer <= 0) a.strike = STRIKE_HOLD
    a.windup = z.attackWindup
    if (attack < 0 && a.strike > 0) {
      a.strike = Math.max(0, a.strike - delta)
      attack = 1
    }

    // Player vision decides what is drawn; a hidden zombie skips posing (gait/timers above keep going).
    // M11c-1A: never on a storey the cutaway hides (above the one the player looks at).
    const opacity = runtime.vision.opacity(id)
    visual.visible = opacity > 0.01 && !cutaway.hidesPoint(z.position)
    if (!visual.visible) return
    setCharacterOpacity(rig, opacity)

    computePose(
      {
        kind: 'zombie',
        time: a.time,
        gaitPhase: a.gait.phase,
        speed: a.gait.speed,
        swing: -1,
        hitAt: 1,
        shove: -1,
        attack: z.ai === 'DEAD' ? -1 : attack,
        hurt: z.ai === 'DEAD' ? 0 : z.staggerTimer / MAX_STAGGER,
        dead: z.ai === 'DEAD' ? Math.min(1, z.deadTimer / FALL_DURATION) : -1,
        armed: false,
        work: -1,
      },
      pose.current,
    )
    applyPose(rig, pose.current)

    // Red eyes while hunting the player or besieging a door (not while wandering/searching).
    setCharacterGlow(rig, z.hitFlashTimer > 0, z.ai === 'CHASE' || z.ai === 'ATTACK' || z.ai === 'APPROACH_STRUCTURE' || z.ai === 'ATTACK_STRUCTURE')

    const bar = healthBarRef.current
    if (bar) {
      bar.visible = z.ai !== 'DEAD' && z.health < CFG.health && opacity > 0.5
      // Thanh máu luôn quay về camera isometric (bỏ xoay của mesh cha).
      bar.rotation.y = -a.facing
      const fill = healthFillRef.current
      if (fill) {
        const ratio = Math.max(0, z.health / CFG.health)
        fill.scale.x = ratio
        fill.position.x = -(1 - ratio) * 0.45
      }
    }
  }), [rig, id])

  if (!zombie) return null
  const spawn = zombie.position

  return (
    <group ref={rootRef} position={[spawn.x, spawn.y, spawn.z]}>
      <group ref={visualRef} visible={false}>
        {/* Same hierarchy as before R2 (rig → group → visual), which debug tools and scripts rely on. */}
        <group>
          <primitive object={rig.root} />
        </group>
        <group ref={healthBarRef} position={[0, CFG.height + 0.35, 0]} visible={false}>
          <mesh>
            <boxGeometry args={[0.94, 0.1, 0.06]} />
            <meshBasicMaterial color="#1a1a1a" />
          </mesh>
          <mesh ref={healthFillRef} position={[0, 0, 0.01]}>
            <boxGeometry args={[0.9, 0.07, 0.06]} />
            <meshBasicMaterial color="#d9453d" />
          </mesh>
        </group>
      </group>
    </group>
  )
}

/**
 * R2: physics representation of an ACTIVE zombie: a kinematic capsule the simulation moves every
 * tick (`runtime.registerZombieBody` → `setNextKinematicTranslation`). It blocks and pushes the
 * player; it never feeds a position back. NEAR/DORMANT/dead zombies have none.
 */
export function ZombieBody({ id }: ZombieViewProps) {
  const bodyRef = useRef<RapierRigidBody>(null)

  useEffect(() => {
    runtime.registerZombieBody(id, bodyRef.current)
    return () => runtime.registerZombieBody(id, null)
  }, [id])

  const zombie = runtime.zombies.get(id)
  if (!zombie) return null
  return (
    <RigidBody ref={bodyRef} type="kinematicPosition" colliders={false} position={[zombie.position.x, zombie.position.y + CFG.height / 2, zombie.position.z]}>
      <CapsuleCollider args={[HALF_HEIGHT, CFG.radius]} friction={0} />
    </RigidBody>
  )
}
