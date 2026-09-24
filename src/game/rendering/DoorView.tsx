import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { RigidBody } from '@react-three/rapier'
import { Color, type Group, type MeshStandardMaterial } from 'three'
import type { DoorPlacement } from '../world/buildings'
import { useWorldStore } from '../../stores/worldStore'
import { runtime } from '../core/runtime'
import { blockerData } from './blockerData'
import { doorLeafTransform, DOOR_LEAF_THICKNESS as LEAF_THICKNESS, DOOR_MAX_HP } from '../world/doors'

interface DoorViewProps {
  door: DoorPlacement
}

const SHAKE_TIME = 0.18
const DAMAGED_COLOR = new Color('#2e2118')

/**
 * Cánh cửa: body tĩnh quay quanh bản lề. Đổi trạng thái mở/đóng thì tạo lại
 * body (key) để collider khớp vị trí mới; cửa đóng chặn đường đi và raycast.
 * P2-S5: the leaf darkens as its HP drops and jolts on each zombie hit (visual only: the
 * collider was built from the rest pose and does not move).
 */
export function DoorView({ door }: DoorViewProps) {
  const state = useWorldStore((s) => s.doorStates[door.id] ?? 'closed')
  const shakeRef = useRef<Group>(null)
  const materialRef = useRef<MeshStandardMaterial>(null)
  const shake = useRef(0)
  const leaf = doorLeafTransform(door, state)
  const open = state === 'open'
  const baseColor = useMemo(() => new Color(open ? '#8a6a45' : '#6b4a2e'), [open])

  useEffect(() => runtime.events.on('door:damaged', (e) => {
    if (e.id === door.id) shake.current = SHAKE_TIME
  }), [door.id])

  useFrame((_, delta) => {
    const group = shakeRef.current
    const material = materialRef.current
    if (!group || !material) return
    const hp = runtime.world.doors.get(door.id)?.hp ?? DOOR_MAX_HP
    material.color.copy(baseColor).lerp(DAMAGED_COLOR, 0.75 * (1 - hp / DOOR_MAX_HP))
    shake.current = Math.max(0, shake.current - delta)
    const k = shake.current / SHAKE_TIME
    group.rotation.y = Math.sin(shake.current * 90) * 0.05 * k
    group.position.z = -0.04 * k
  })

  if (!leaf) return null
  const angle = leaf.angle

  return (
    <RigidBody
      key={`${door.id}-${open ? 'open' : 'closed'}`}
      type="fixed"
      colliders="cuboid"
      position={[door.hinge.x, 0, door.hinge.z]}
      rotation={[0, angle, 0]}
      userData={blockerData(door.id)}
    >
      <group ref={shakeRef}>
        <mesh castShadow position={[door.width / 2, door.height / 2, 0]} userData={{ occluder: true }}>
          <boxGeometry args={[door.width, door.height, LEAF_THICKNESS]} />
          <meshStandardMaterial ref={materialRef} color={open ? '#8a6a45' : '#6b4a2e'} />
        </mesh>
        {/* Tay nắm cửa, phía xa bản lề. */}
        <mesh position={[door.width - 0.18, door.height / 2, LEAF_THICKNESS / 2 + 0.03]}>
          <boxGeometry args={[0.12, 0.06, 0.06]} />
          <meshStandardMaterial color="#d9c27a" />
        </mesh>
      </group>
    </RigidBody>
  )
}
