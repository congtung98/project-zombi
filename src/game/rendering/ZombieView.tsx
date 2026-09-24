import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CapsuleCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { Color, type Group, type Mesh, type MeshStandardMaterial } from 'three'
import { runtime } from '../core/runtime'
import type { EntityId } from '../../types'

const CFG = runtime.config.zombie
const HALF_HEIGHT = (CFG.height - 2 * CFG.radius) / 2
const FALL_DURATION = 0.45
const HIT_FLASH = new Color('#ffffff')
const NO_EMISSIVE = new Color('#000000')

const STATE_COLORS: Record<string, string> = {
  IDLE: '#6d8f3f',
  CHASE: '#c9a227',
  SEARCH: '#8f8a3f',
  ATTACK: '#c93a2f',
  DEAD: '#3a3a3a',
}

interface ZombieViewProps {
  id: EntityId
}

/**
 * Zombie placeholder. Trạng thái đọc trực tiếp từ runtime trong useFrame:
 * màu theo FSM, nhấp nháy khi trúng đòn, thanh máu khi bị thương, ngã xuống
 * khi chết (runtime đã tắt body để xác không chặn đường).
 */
export function ZombieView({ id }: ZombieViewProps) {
  const bodyRef = useRef<RapierRigidBody>(null)
  const visualRef = useRef<Group>(null)
  const materialRef = useRef<MeshStandardMaterial>(null)
  const healthBarRef = useRef<Group>(null)
  const healthFillRef = useRef<Mesh>(null)
  const zombie = runtime.zombies.get(id)

  useEffect(() => {
    runtime.registerZombieBody(id, bodyRef.current)
    return () => runtime.registerZombieBody(id, null)
  }, [id])

  useFrame(() => {
    const z = runtime.zombies.get(id)
    const visual = visualRef.current
    if (!z || !visual) return
    visual.rotation.y = z.facing

    if (z.ai === 'DEAD') {
      const t = Math.min(1, z.deadTimer / FALL_DURATION)
      visual.rotation.x = (-Math.PI / 2) * t
      visual.position.y = -(CFG.height / 2 - CFG.radius) * t
    } else {
      visual.rotation.x = 0
      visual.position.y = 0
    }

    const mat = materialRef.current
    if (mat) {
      mat.color.set(STATE_COLORS[z.ai] ?? STATE_COLORS.IDLE)
      mat.emissive.copy(z.hitFlashTimer > 0 ? HIT_FLASH : NO_EMISSIVE)
      mat.emissiveIntensity = z.hitFlashTimer > 0 ? 0.8 : 0
    }

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
