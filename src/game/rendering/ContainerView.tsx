import { RigidBody } from '@react-three/rapier'
import type { ContainerDef } from '../world/buildings'
import { useWorldStore } from '../../stores/worldStore'
import { blockerData } from './blockerData'
import { sharedBox, sharedStandardMaterial } from './sharedResources'

const INDICATOR_SIZE: [number, number, number] = [0.2, 0.12, 0.2]
const INDICATOR_OPENED = () => sharedStandardMaterial('#555555', { emissive: '#000000', emissiveIntensity: 0 })
const INDICATOR_NEW = () => sharedStandardMaterial('#f2c14e', { emissive: '#f2c14e', emissiveIntensity: 0.6 })

interface ContainerViewProps {
  container: ContainerDef
}

/** Container có ID ổn định; hiển thị dấu hiệu đã mở. Loot logic ở Sprint 4. */
export function ContainerView({ container }: ContainerViewProps) {
  const opened = useWorldStore((s) => s.containerOpened[container.id] ?? false)
  const h = container.size[1]

  return (
    <RigidBody
      type="fixed"
      colliders="cuboid"
      position={[container.position.x, container.position.y, container.position.z]}
      userData={blockerData(container.id)}
    >
      <mesh castShadow receiveShadow dispose={null} geometry={sharedBox(container.size)} material={sharedStandardMaterial(container.color)} />
      {/* Đèn báo trạng thái trên nóc: vàng = chưa mở, xám = đã mở. */}
      <mesh position={[0, h / 2 + 0.06, 0]} dispose={null} geometry={sharedBox(INDICATOR_SIZE)} material={opened ? INDICATOR_OPENED() : INDICATOR_NEW()} />
    </RigidBody>
  )
}
