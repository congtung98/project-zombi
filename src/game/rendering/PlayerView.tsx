import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { CapsuleCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import type { Group } from 'three'
import { runtime } from '../core/runtime'
import { equippedWeapon } from '../systems/equipment'
import type { ItemId } from '../entities/items'

const CFG = runtime.config.player
const MELEE = runtime.config.melee
const HALF_HEIGHT = (CFG.height - 2 * CFG.radius) / 2
/** Góc nghỉ và biên độ vung của gậy (radian quanh trục Y của vai). */
const BAT_REST_ANGLE = 0.9
const BAT_SWING_ARC = 2.4

interface HeldWeapon {
  itemId: ItemId
  broken: boolean
}

/** Placeholder meshes per weapon (P2-S2); the pivot is the right shoulder and the weapon points along +Z. */
function WeaponModel({ itemId, broken }: HeldWeapon) {
  // Broken weapons keep their shape but glow dull red so the state reads during combat.
  const tint = broken ? { emissive: '#7a0d0d', emissiveIntensity: 0.6 } : {}
  switch (itemId) {
    case 'metal_pipe':
      return (
        <mesh castShadow position={[0, 0, 0.5]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.035, 0.035, 1, 8]} />
          <meshStandardMaterial color="#8c9298" metalness={0.6} roughness={0.4} {...tint} />
        </mesh>
      )
    case 'crowbar':
      return (
        <group>
          <mesh castShadow position={[0, 0, 0.47]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 0.95, 6]} />
            <meshStandardMaterial color="#7a1f1f" metalness={0.5} roughness={0.5} {...tint} />
          </mesh>
          <mesh castShadow position={[0.06, 0, 0.95]} rotation={[0, 0, 0]}>
            <boxGeometry args={[0.14, 0.04, 0.05]} />
            <meshStandardMaterial color="#7a1f1f" metalness={0.5} roughness={0.5} {...tint} />
          </mesh>
        </group>
      )
    case 'hammer':
      return (
        <group>
          <mesh castShadow position={[0, 0, 0.3]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.025, 0.03, 0.6, 6]} />
            <meshStandardMaterial color="#8a6a44" {...tint} />
          </mesh>
          <mesh castShadow position={[0, 0, 0.6]}>
            <boxGeometry args={[0.24, 0.08, 0.08]} />
            <meshStandardMaterial color="#555a60" metalness={0.6} roughness={0.4} {...tint} />
          </mesh>
        </group>
      )
    default:
      return (
        <mesh castShadow position={[0, 0, 0.55]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.05, 0.035, 1.1, 8]} />
          <meshStandardMaterial color="#9a6b3c" {...tint} />
        </mesh>
      )
  }
}

/**
 * Player placeholder: capsule dynamic có khóa xoay; simulation điều khiển vận
 * tốc, physics giải quyết va chạm với tường. Mesh con xoay theo hướng nhìn;
 * gậy vung theo `attackTimer` của runtime (không có state React).
 */
export function PlayerView() {
  const bodyRef = useRef<RapierRigidBody>(null)
  const visualRef = useRef<Group>(null)
  const batPivotRef = useRef<Group>(null)
  // Only the held weapon type/broken flag is React state; it changes rarely (equip, break, load).
  const [held, setHeld] = useState<HeldWeapon | null>(null)
  const heldKey = useRef('')
  // Vị trí ban đầu lấy từ runtime (spawn khi ván mới, vị trí đã lưu khi load); scene remount theo sessionId.
  const spawn = runtime.player.position

  useEffect(() => {
    runtime.registerPlayerBody(bodyRef.current)
    return () => runtime.registerPlayerBody(null)
  }, [])

  useFrame(() => {
    const p = runtime.player
    if (visualRef.current) visualRef.current.rotation.y = p.facing
    const weapon = equippedWeapon(p.inventory, p.equipment)
    const key = weapon ? `${weapon.itemId}:${weapon.condition <= 0}` : ''
    if (key !== heldKey.current) {
      heldKey.current = key
      setHeld(weapon ? { itemId: weapon.itemId, broken: weapon.condition <= 0 } : null)
    }
    const pivot = batPivotRef.current
    if (!pivot) return
    pivot.visible = weapon !== null
    if (p.attackTimer < 0) {
      pivot.rotation.y = BAT_REST_ANGLE
      pivot.rotation.x = 0
      return
    }
    // Vung từ phải sang trái quanh vai; ease-out để khung trúng đòn rơi ở giữa cú vung.
    const t = Math.min(1, p.attackTimer / MELEE.swingDuration)
    const eased = 1 - (1 - t) * (1 - t)
    pivot.rotation.y = BAT_REST_ANGLE - BAT_SWING_ARC * eased
    pivot.rotation.x = -0.35 * Math.sin(t * Math.PI)
  })

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
        <mesh castShadow>
          <capsuleGeometry args={[CFG.radius, CFG.height - 2 * CFG.radius, 4, 12]} />
          <meshStandardMaterial color="#4a90d9" />
        </mesh>
        {/* Khối nhỏ phía trước để thấy hướng nhân vật đang nhìn. */}
        <mesh position={[0, 0.45, CFG.radius + 0.05]}>
          <boxGeometry args={[0.25, 0.2, 0.25]} />
          <meshStandardMaterial color="#e8f0ff" />
        </mesh>
        {/* Vũ khí đang cầm: pivot ở vai phải, thân hướng ra trước; model theo equipment. */}
        <group ref={batPivotRef} position={[CFG.radius + 0.1, 0.25, 0]} rotation={[0, BAT_REST_ANGLE, 0]}>
          {held && <WeaponModel itemId={held.itemId} broken={held.broken} />}
        </group>
      </group>
    </RigidBody>
  )
}
