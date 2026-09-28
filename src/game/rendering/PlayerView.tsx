import { useEffect, useMemo, useRef } from 'react'
import { CapsuleCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import type { Group } from 'three'
import { runtime } from '../core/runtime'
import { equippedWeapon } from '../systems/equipment'
import { useSettingsStore } from '../../stores/settingsStore'
import { computePose, createPose, type FallKind } from './character/pose'
import { chooseFall, fallOrder, FALL_ROOM } from './character/death'
import { registerAnimator } from './character/animators'
import { applyPose, buildCharacter, playerLook, shadowDetail } from './character/rig'
import { buildWeaponModel, type WeaponModel } from './character/weaponModels'
import { buildBackpackModel, type BackpackModel } from './character/backpackModel'
import { findItem } from '../systems/inventory'
import { advancePlayerGait, createPlayerGait } from './character/locomotion'
import { angleDiff } from '../systems/stance'

const CFG = runtime.config.player
const MELEE = runtime.config.melee
const PUSH = runtime.config.push
const HALF_HEIGHT = (CFG.height - 2 * CFG.radius) / 2
const SHOVE_TIME = 0.4
const HURT_TIME = 0.3
const DEATH_TIME = 0.6
const STANCE = runtime.config.combatStance
const TORSO_LEAD = (STANCE.torsoLeadDeg * Math.PI) / 180
/** Easing of the chest lead (s): it follows the aim smoothly and fades out when the stance ends. */
const LEAD_TAU = 0.08
/** Same float as the simulation keeps (`runtime.ts` PLAYER_HOVER): the capsule never rests on a wall top. */
const HOVER = 0.02

/**
 * Player: dynamic capsule with locked rotation (unchanged collider for every preset). M11b: no
 * gravity: the simulation sets its height from the floor under it (ground, slab, stairs), the body
 * only slides along walls. The rigged
 * model is purely visual, built once per session from the saved appearance and posed each frame
 * from runtime state. Damage timing stays in combat; the pose only mirrors `attackTimer`.
 */
export function PlayerView() {
  const bodyRef = useRef<RapierRigidBody>(null)
  const visualRef = useRef<Group>(null)
  const shadows = useSettingsStore((s) => s.shadows)
  // Scene remounts per session, so the appearance read here is the one of this game/save.
  const look = useMemo(() => playerLook(runtime.player.appearance), [])
  const rig = useMemo(() => buildCharacter(look, shadowDetail(shadows)), [look, shadows])
  const weapon = useRef<{ key: string; model: WeaponModel | null }>({ key: '', model: null })
  // INV-LOOT S5: the worn bag, on the torso bone.
  const bag = useRef<{ key: string; model: BackpackModel | null }>({ key: '', model: null })
  const pose = useRef(createPose())
  const gait = useRef(createPlayerGait())
  const clock = useRef(0)
  const deadTime = useRef(-1)
  const fall = useRef<FallKind | null>(null)
  // CS1: raised-weapon blend and chest lead, eased here from the simulation's posture and aim.
  const ready = useRef(0)
  const lead = useRef(0)
  const spawn = runtime.player.position

  useEffect(() => {
    runtime.registerPlayerBody(bodyRef.current)
    return () => runtime.registerPlayerBody(null)
  }, [])

  useEffect(() => {
    const held = weapon.current
    const worn = bag.current
    return () => {
      held.model?.dispose()
      held.model = null
      held.key = ''
      worn.model?.dispose()
      worn.model = null
      worn.key = ''
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

    // C3: the legs follow the body's real motion (filtered, frame-rate independent): blocked by a
    // wall they stop instead of running in place; walking normally the phase locks onto the
    // simulation's stride so feet and footstep sounds stay together; backing off or strafing while
    // the facing stays on the cursor reverses the gait and turns the pelvis toward the path.
    advancePlayerGait(gait.current, {
      x: p.position.x,
      z: p.position.z,
      facing: p.facing,
      intendedSpeed: p.moveSpeed,
      stridePhase: p.stridePhase,
      stride: p.moveSpeed > CFG.walkSpeed + 0.01 ? CFG.runStride : CFG.walkStride,
      alive: p.alive,
    }, delta)

    const held = equippedWeapon(p.inventory, p.equipment)
    const key = held ? `${held.itemId}:${held.condition <= 0}` : ''
    if (key !== weapon.current.key) {
      weapon.current.model?.group.removeFromParent()
      weapon.current.model?.dispose()
      const model = held ? buildWeaponModel(held.itemId, held.condition <= 0, shadows === 'high') : null
      if (model) rig.weaponSocket.add(model.group)
      weapon.current = { key, model }
    }
    const backId = p.equipment.backInstanceId
    const wornBag = backId ? findItem(p.inventory, backId) : undefined
    const bagKey = wornBag?.itemId ?? ''
    if (bagKey !== bag.current.key) {
      bag.current.model?.group.removeFromParent()
      bag.current.model?.dispose()
      const model = wornBag ? buildBackpackModel(wornBag.itemId, look, shadows === 'high') : null
      if (model) rig.torso.add(model.group)
      bag.current = { key: bagKey, model }
    }

    deadTime.current = p.alive ? -1 : Math.max(0, deadTime.current) + delta
    if (p.alive) fall.current = null
    else if (fall.current === null) {
      // C4: no hit direction is kept for the player: on its back if there is room, never through a wall.
      const from = { x: p.position.x, y: p.position.y + 0.5, z: p.position.z }
      fall.current = chooseFall(['back', ...fallOrder('player', null).filter((k) => k !== 'back')], p.facing, (d) =>
        runtime.isBlocked(from, { x: from.x + d.x * FALL_ROOM, y: from.y, z: from.z + d.z * FALL_ROOM }, []))
    }
    // CS1: the pose follows the stance intent at once but blends over `poseBlend` (never read back).
    const posture = runtime.combatPosture
    ready.current = Math.min(1, Math.max(0, ready.current + (posture ? 1 : -1) * (delta / STANCE.poseBlend)))
    const leadTarget = runtime.stance.requested && p.alive && p.attackTimer < 0 ? Math.max(-TORSO_LEAD, Math.min(TORSO_LEAD, angleDiff(p.facing, runtime.stance.aimYaw))) : 0
    lead.current += (leadTarget - lead.current) * (1 - Math.exp(-delta / LEAD_TAU))

    const shoveElapsed = PUSH.cooldown - p.pushCooldown
    computePose(
      {
        kind: 'player',
        time: clock.current,
        gaitPhase: gait.current.phase,
        speed: gait.current.speed,
        hipTurn: gait.current.hipTurn,
        swing: p.attackTimer >= 0 ? p.attackTimer / MELEE.swingDuration : -1,
        hitAt: MELEE.hitDelay / MELEE.swingDuration,
        shove: p.pushCooldown > 0 && shoveElapsed < SHOVE_TIME ? shoveElapsed / SHOVE_TIME : -1,
        attack: -1,
        hurt: p.hurtTimer / HURT_TIME,
        dead: deadTime.current >= 0 ? Math.min(1, deadTime.current / DEATH_TIME) : -1,
        fall: fall.current ?? 'back',
        armed: held !== null,
        work: p.alive ? runtime.workElapsed : -1,
        ready: ready.current,
        aimLead: lead.current,
      },
      pose.current,
    )
    applyPose(rig, pose.current)
  }), [rig, look, shadows])

  return (
    <RigidBody
      ref={bodyRef}
      type="dynamic"
      colliders={false}
      lockRotations
      canSleep={false}
      linearDamping={0}
      gravityScale={0}
      position={[spawn.x, spawn.y + CFG.height / 2 + HOVER, spawn.z]}
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
