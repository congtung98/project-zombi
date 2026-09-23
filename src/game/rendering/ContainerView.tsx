import { RigidBody } from '@react-three/rapier'
import type { ContainerDef } from '../world/buildings'
import { useWorldStore } from '../../stores/worldStore'
import { blockerData } from './blockerData'

interface ContainerViewProps {
  container: ContainerDef
}

/** Container có ID ổn định; hiển thị dấu hiệu đã mở. Loot logic ở Sprint 4. */
export function ContainerView({ container }: ContainerViewProps) {
  const opened = useWorldStore((s) => s.containerOpened[container.id] ?? false)
  const [w, h, d] = container.size

  return (
    <RigidBody
      type="fixed"
      colliders="cuboid"
      position={[container.position.x, container.position.y, container.position.z]}
      userData={blockerData(container.id)}
    >
      <mesh castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={container.color} />
      </mesh>
      {/* Đèn báo trạng thái trên nóc: vàng = chưa mở, xám = đã mở. */}
      <mesh position={[0, h / 2 + 0.06, 0]}>
        <boxGeometry args={[0.2, 0.12, 0.2]} />
        <meshStandardMaterial
          color={opened ? '#555555' : '#f2c14e'}
          emissive={opened ? '#000000' : '#f2c14e'}
          emissiveIntensity={opened ? 0 : 0.6}
        />
      </mesh>
    </RigidBody>
  )
}
