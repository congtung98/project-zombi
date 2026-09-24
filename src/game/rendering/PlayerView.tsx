import { useEffect, useMemo, useRef } from 'react'
import { CapsuleCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import type { Group } from 'three'
import { runtime } from '../core/runtime'
import { equippedWeapon } from '../systems/equipment'
import { useSettingsStore } from '../../stores/settingsStore'
import { computePose, createPose } from './character/pose'
import { registerAnimator } from './character/animators'
import { applyPose, buildCharacter, playerLook, shadowDetail } from './character/rig'
import { buildWeaponModel, type WeaponModel } from './character/weaponModels'
import { smoothSpeed } from './character/gait'

const CFG = runtime.config.player
const MELEE = runtime.config.melee
const PUSH = runtime.config.push
const HALF_HEIGHT = (CFG.height - 2 * CFG.radius) / 2
const SHOVE_TIME = 0.4
const HURT_TIME = 0.3
const DEATH_TIME = 0.6

/**
 * Player: dynamic capsule with locked rotation (unchanged collider for every preset); the rigged
 * model is purely visual, built once per session from the saved appearance and posed each frame
 * from runtime state. Damage timing stays in combat; the pose only mirrors `attackTimer`.
 */
export function PlayerView() {
  const bodyRef = useRef<RapierRigidBody>(null)
  const visualRef = useRef<Group>(null)
  const shadows = useSettingsStore((s) => s.shadows)
  // Scene remounts per session, so the appearance read here is the one of this game/save.
  const rig = useMemo(() => buildCharacter(playerLook(runtime.player.appearance), shadowDetail(shadows)), [shadows])
  const weapon = useRef<{ key: string; model: WeaponModel | null }>({ key: '', model: null })
  const pose = useRef(createPose())
  const speed = useRef(0)
  const clock = useRef(0)
  const deadTime = useRef(-1)
  const spawn = runtime.player.position

  useEffect(() => {
    runtime.registerPlayerBody(bodyRef.current)
    return () => runtime.registerPlayerBody(null)
  }, [])

  useEffect(() => {
    const held = weapon.current
    return () => {
      held.model?.dispose()
      held.model = null
      held.key = ''
      rig.dispose()
    }
  }, [rig])

  // Posed after the tick by CharacterAnimator (same state as the simulation this frame).
  useEffect(() => registerAnimator((delta) => {
    const p = runtime.player
    const visual = visualRef.current
    if (!visual) return
    visual.rotation.y = p.facing
    clock.current += delta

    // Gait phase and speed come from the simulation (intended movement, advanced every tick), not
    // from the body position that only changes on fixed physics steps: smooth at any frame rate,
    // and the legs stay in step with the footstep sounds. Speed eases in/out over ~0.1 s.
    speed.current = smoothSpeed(speed.current, p.alive ? p.moveSpeed : 0, delta)

    const held = equippedWeapon(p.inventory, p.equipment)
    const key = held ? `${held.itemId}:${held.condition <= 0}` : ''
    if (key !== weapon.current.key) {
      weapon.current.model?.group.removeFromParent()
      weapon.current.model?.dispose()
      const model = held ? buildWeaponModel(held.itemId, held.condition <= 0, shadows === 'high') : null
      if (model) rig.weaponSocket.add(model.group)
      weapon.current = { key, model }
    }

    deadTime.current = p.alive ? -1 : Math.max(0, deadTime.current) + delta
    const shoveElapsed = PUSH.cooldown - p.pushCooldown
    computePose(
      {
        kind: 'player',
        time: clock.current,
        gaitPhase: p.stridePhase,
        speed: speed.current,
        swing: p.attackTimer >= 0 ? p.attackTimer / MELEE.swingDuration : -1,
        hitAt: MELEE.hitDelay / MELEE.swingDuration,
        shove: p.pushCooldown > 0 && shoveElapsed < SHOVE_TIME ? shoveElapsed / SHOVE_TIME : -1,
        attack: -1,
        hurt: p.hurtTimer / HURT_TIME,
        dead: deadTime.current >= 0 ? Math.min(1, deadTime.current / DEATH_TIME) : -1,
        armed: held !== null,
        work: runtime.action && p.alive ? runtime.action.elapsed : -1,
      },
      pose.current,
    )
    applyPose(rig, pose.current)
  }), [rig, shadows])

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
      {/* Feet on the ground: the body origin is the capsule centre. */}
      <group ref={visualRef}>
        <group position={[0, -CFG.height / 2, 0]}>
          <primitive object={rig.root} />
        </group>
      </group>
    </RigidBody>
  )
}
