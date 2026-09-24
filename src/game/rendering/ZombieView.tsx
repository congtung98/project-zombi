import { useEffect, useMemo, useRef } from 'react'
import { CapsuleCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import type { Group, Mesh } from 'three'
import { runtime } from '../core/runtime'
import { useSettingsStore } from '../../stores/settingsStore'
import { computePose, createPose } from './character/pose'
import { registerAnimator } from './character/animators'
import { applyPose, buildCharacter, setCharacterGlow, shadowDetail, zombieLook } from './character/rig'
import type { EntityId } from '../../types'

const CFG = runtime.config.zombie
const HALF_HEIGHT = (CFG.height - 2 * CFG.radius) / 2
const FALL_DURATION = 0.45
const STRIDE = 1.3
/** Longest stagger (push) used to normalise the hit-reaction pose. */
const MAX_STAGGER = Math.max(runtime.config.melee.stagger, runtime.config.push.stagger)
/** Keep the slam pose briefly after the damage frame so the hit reads on screen (visual only). */
const STRIKE_HOLD = 0.18

interface ZombieViewProps {
  id: EntityId
}

/**
 * Zombie: same capsule collider as before; the rigged model (variant from the zombie ID) is
 * posed from runtime state. Eyes glow while chasing/attacking, the model flashes on hits, the
 * health bar shows once damaged and the body falls when dead (runtime already disabled it).
 */
export function ZombieView({ id }: ZombieViewProps) {
  const bodyRef = useRef<RapierRigidBody>(null)
  const visualRef = useRef<Group>(null)
  const healthBarRef = useRef<Group>(null)
  const healthFillRef = useRef<Mesh>(null)
  const shadows = useSettingsStore((s) => s.shadows)
  const rig = useMemo(() => buildCharacter(zombieLook(id), shadowDetail(shadows)), [id, shadows])
  const pose = useRef(createPose())
  const zombie = runtime.zombies.get(id)
  const anim = useRef({ gait: 0, time: (zombie?.id.length ?? 0) * 0.37, last: zombie ? { x: zombie.position.x, z: zombie.position.z } : { x: 0, z: 0 }, strike: 0, windup: -1 })

  useEffect(() => {
    runtime.registerZombieBody(id, bodyRef.current)
    return () => runtime.registerZombieBody(id, null)
  }, [id])

  useEffect(() => () => rig.dispose(), [rig])

  // Posed after the tick by CharacterAnimator (same state as the simulation this frame).
  useEffect(() => registerAnimator((delta) => {
    const z = runtime.zombies.get(id)
    const visual = visualRef.current
    if (!z || !visual) return
    visual.rotation.y = z.facing
    const a = anim.current
    a.time += delta

    const dist = Math.hypot(z.position.x - a.last.x, z.position.z - a.last.z)
    a.last = { x: z.position.x, z: z.position.z }
    const step = dist < 1 && z.ai !== 'DEAD' ? dist : 0
    a.gait = (a.gait + (step / STRIDE) * Math.PI * 2) % (Math.PI * 2)

    // attackWindup counts down to the damage frame, then resets to −1: hold the slam briefly.
    let attack = z.attackWindup >= 0 ? 1 - z.attackWindup / CFG.attackWindup : -1
    if (z.attackWindup < 0 && a.windup >= 0 && a.windup < 0.12 && z.staggerTimer <= 0) a.strike = STRIKE_HOLD
    a.windup = z.attackWindup
    if (attack < 0 && a.strike > 0) {
      a.strike = Math.max(0, a.strike - delta)
      attack = 1
    }

    computePose(
      {
        kind: 'zombie',
        time: a.time,
        gaitPhase: a.gait,
        speed: delta > 0 ? step / delta : 0,
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

    setCharacterGlow(rig, z.hitFlashTimer > 0, z.ai === 'CHASE' || z.ai === 'ATTACK')

    const bar = healthBarRef.current
    if (bar) {
      bar.visible = z.ai !== 'DEAD' && z.health < CFG.health
      // Thanh máu luôn quay về camera isometric (bỏ xoay của mesh cha).
      bar.rotation.y = -z.facing
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
    <RigidBody
      ref={bodyRef}
      type="dynamic"
      colliders={false}
      lockRotations
      canSleep={false}
      linearDamping={0}
      position={[spawn.x, CFG.height / 2, spawn.z]}
    >
      <CapsuleCollider args={[HALF_HEIGHT, CFG.radius]} friction={0} mass={CFG.mass} />
      <group ref={visualRef}>
        <group position={[0, -CFG.height / 2, 0]}>
          <primitive object={rig.root} />
        </group>
        <group ref={healthBarRef} position={[0, CFG.height / 2 + 0.35, 0]} visible={false}>
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
    </RigidBody>
  )
}
