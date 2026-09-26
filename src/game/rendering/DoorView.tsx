import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { RigidBody } from '@react-three/rapier'
import { Color, type Group, type Mesh, type MeshStandardMaterial } from 'three'
import type { DoorPlacement } from '../world/buildings'
import { useWorldStore } from '../../stores/worldStore'
import { runtime } from '../core/runtime'
import { occluderRef } from './occlusionRegistry'
import { doorLeafTransform, DOOR_LEAF_THICKNESS as LEAF_THICKNESS, DOOR_MAX_HP } from '../world/doors'
import { cutaway, pieceShow, type Box3Like } from './cutaway'

/** The doorway (closed leaf plane, a wall's thickness deep) as a box, for the cutaway rules. */
function doorwayBox(door: DoorPlacement): Box3Like {
  const alongX = door.hinge.x !== door.center.x
  const hw = door.width / 2
  const t = 0.15
  return {
    min: { x: door.center.x - (alongX ? hw : t), y: door.hinge.y, z: door.center.z - (alongX ? t : hw) },
    max: { x: door.center.x + (alongX ? hw : t), y: door.hinge.y + door.height, z: door.center.z + (alongX ? t : hw) },
  }
}

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
 * M11c-1A: the cutaway hides the leaf above the observed storey and cuts it down with its wall
 * (drawing only: the body and the collider stay).
 */
export function DoorView({ door }: DoorViewProps) {
  const state = useWorldStore((s) => s.doorStates[door.id] ?? 'closed')
  const shakeRef = useRef<Group>(null)
  const materialRef = useRef<MeshStandardMaterial>(null)
  const leafRef = useRef<Mesh>(null)
  const knobRef = useRef<Mesh>(null)
  const cutVersion = useRef(-1)
  const doorway = useMemo(() => doorwayBox(door), [door])
  // The leaf registers as an occluder and is re-limited by the cutaway whenever it (re)mounts.
  const leafCallback = useCallback((m: Mesh | null) => {
    leafRef.current = m
    cutVersion.current = -1
    return occluderRef(m)
  }, [])
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
    if (cutVersion.current !== cutaway.version && leafRef.current && knobRef.current) {
      cutVersion.current = cutaway.version
      const limit = cutaway.limit(door.buildingId, doorway, 'opening')
      const show = limit === Infinity ? 'full' : pieceShow(doorway, limit)
      leafRef.current.visible = show !== 'hidden'
      knobRef.current.visible = show === 'full'
      group.scale.y = show === 'cut' ? (limit - door.hinge.y) / door.height : 1
    }
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
      position={[door.hinge.x, door.hinge.y, door.hinge.z]}
      rotation={[0, angle, 0]}
    >
      <group ref={shakeRef}>
        <mesh castShadow position={[door.width / 2, door.height / 2, 0]} ref={leafCallback}>
          <boxGeometry args={[door.width, door.height, LEAF_THICKNESS]} />
          <meshStandardMaterial ref={materialRef} color={open ? '#8a6a45' : '#6b4a2e'} />
        </mesh>
        {/* Tay nắm cửa, phía xa bản lề. */}
        <mesh ref={knobRef} position={[door.width - 0.18, door.height / 2, LEAF_THICKNESS / 2 + 0.03]}>
          <boxGeometry args={[0.12, 0.06, 0.06]} />
          <meshStandardMaterial color="#d9c27a" />
        </mesh>
      </group>
    </RigidBody>
  )
}
