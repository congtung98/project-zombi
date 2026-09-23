import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CapsuleCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import type { Group } from 'three'
import { runtime } from '../core/runtime'

const CFG = runtime.config.player
const HALF_HEIGHT = (CFG.height - 2 * CFG.radius) / 2

/**
 * Player placeholder: capsule dynamic có khóa xoay; simulation điều khiển vận
 * tốc, physics giải quyết va chạm với tường. Mesh con xoay theo hướng nhìn.
 */
export function PlayerView() {
  const bodyRef = useRef<RapierRigidBody>(null)
  const visualRef = useRef<Group>(null)
  const spawn = runtime.map.playerSpawn

  useEffect(() => {
    runtime.registerPlayerBody(bodyRef.current)
    return () => runtime.registerPlayerBody(null)
  }, [])

  useFrame(() => {
    if (visualRef.current) visualRef.current.rotation.y = runtime.player.facing
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
      </group>
    </RigidBody>
  )
}
