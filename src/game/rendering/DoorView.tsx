import { RigidBody } from '@react-three/rapier'
import type { DoorPlacement } from '../world/buildings'
import { useWorldStore } from '../../stores/worldStore'
import { blockerData } from './blockerData'

const LEAF_THICKNESS = 0.12

interface DoorViewProps {
  door: DoorPlacement
}

/**
 * Cánh cửa: body tĩnh quay quanh bản lề. Đổi trạng thái mở/đóng thì tạo lại
 * body (key) để collider khớp vị trí mới; cửa đóng chặn đường đi và raycast.
 */
export function DoorView({ door }: DoorViewProps) {
  const open = useWorldStore((s) => s.doorOpen[door.id] ?? false)
  const angle = open ? door.openAngle : door.closedAngle

  return (
    <RigidBody
      key={`${door.id}-${open ? 'open' : 'closed'}`}
      type="fixed"
      colliders="cuboid"
      position={[door.hinge.x, 0, door.hinge.z]}
      rotation={[0, angle, 0]}
      userData={blockerData(door.id)}
    >
      <mesh castShadow position={[door.width / 2, door.height / 2, 0]} userData={{ occluder: true }}>
        <boxGeometry args={[door.width, door.height, LEAF_THICKNESS]} />
        <meshStandardMaterial color={open ? '#8a6a45' : '#6b4a2e'} />
      </mesh>
      {/* Tay nắm cửa, phía xa bản lề. */}
      <mesh position={[door.width - 0.18, door.height / 2, LEAF_THICKNESS / 2 + 0.03]}>
        <boxGeometry args={[0.12, 0.06, 0.06]} />
        <meshStandardMaterial color="#d9c27a" />
      </mesh>
    </RigidBody>
  )
}
