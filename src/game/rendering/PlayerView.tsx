import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CapsuleCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import type { Group } from 'three'
import { runtime } from '../core/runtime'
import { equippedWeapon } from '../systems/equipment'

const CFG = runtime.config.player
const MELEE = runtime.config.melee
const HALF_HEIGHT = (CFG.height - 2 * CFG.radius) / 2
const BAT_LENGTH = 1.1
/** Góc nghỉ và biên độ vung của gậy (radian quanh trục Y của vai). */
const BAT_REST_ANGLE = 0.9
const BAT_SWING_ARC = 2.4

/**
 * Player placeholder: capsule dynamic có khóa xoay; simulation điều khiển vận
 * tốc, physics giải quyết va chạm với tường. Mesh con xoay theo hướng nhìn;
 * gậy vung theo `attackTimer` của runtime (không có state React).
 */
export function PlayerView() {
  const bodyRef = useRef<RapierRigidBody>(null)
  const visualRef = useRef<Group>(null)
  const batPivotRef = useRef<Group>(null)
  // Vị trí ban đầu lấy từ runtime (spawn khi ván mới, vị trí đã lưu khi load); scene remount theo sessionId.
  const spawn = runtime.player.position

  useEffect(() => {
    runtime.registerPlayerBody(bodyRef.current)
    return () => runtime.registerPlayerBody(null)
  }, [])

  useFrame(() => {
    const p = runtime.player
    if (visualRef.current) visualRef.current.rotation.y = p.facing
    const pivot = batPivotRef.current
    if (!pivot) return
    pivot.visible = equippedWeapon(p.inventory, p.equipment) !== null
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
        {/* Gậy: pivot ở vai phải, thân gậy hướng ra trước. */}
        <group ref={batPivotRef} position={[CFG.radius + 0.1, 0.25, 0]} rotation={[0, BAT_REST_ANGLE, 0]}>
          <mesh castShadow position={[0, 0, BAT_LENGTH / 2]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.05, 0.035, BAT_LENGTH, 8]} />
            <meshStandardMaterial color="#9a6b3c" />
          </mesh>
        </group>
      </group>
    </RigidBody>
  )
}
