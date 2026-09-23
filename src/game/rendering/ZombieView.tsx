import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CapsuleCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import type { Group, MeshStandardMaterial } from 'three'
import { runtime } from '../core/runtime'
import type { EntityId } from '../../types'

const CFG = runtime.config.zombie
const HALF_HEIGHT = (CFG.height - 2 * CFG.radius) / 2

const STATE_COLORS: Record<string, string> = {
  IDLE: '#6d8f3f',
  CHASE: '#c9a227',
  ATTACK: '#c93a2f',
  DEAD: '#3a3a3a',
}

interface ZombieViewProps {
  id: EntityId
}

export function ZombieView({ id }: ZombieViewProps) {
  const bodyRef = useRef<RapierRigidBody>(null)
  const visualRef = useRef<Group>(null)
  const materialRef = useRef<MeshStandardMaterial>(null)
  const zombie = runtime.zombies.get(id)

  useEffect(() => {
    runtime.registerZombieBody(id, bodyRef.current)
    return () => runtime.registerZombieBody(id, null)
  }, [id])

  useFrame(() => {
    const z = runtime.zombies.get(id)
    if (!z) return
    if (visualRef.current) visualRef.current.rotation.y = z.facing
    if (materialRef.current) materialRef.current.color.set(STATE_COLORS[z.ai] ?? STATE_COLORS.IDLE)
  })

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
        <mesh castShadow>
          <capsuleGeometry args={[CFG.radius, CFG.height - 2 * CFG.radius, 4, 12]} />
          <meshStandardMaterial ref={materialRef} color={STATE_COLORS.IDLE} />
        </mesh>
        <mesh position={[0, 0.45, CFG.radius + 0.05]}>
          <boxGeometry args={[0.25, 0.2, 0.25]} />
          <meshStandardMaterial color="#2b2b2b" />
        </mesh>
      </group>
    </RigidBody>
  )
}
