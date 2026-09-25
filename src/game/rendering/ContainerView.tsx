import type { ContainerDef } from '../world/buildings'
import { useWorldStore } from '../../stores/worldStore'
import { sharedBox, sharedStandardMaterial } from './sharedResources'

const INDICATOR_SIZE: [number, number, number] = [0.2, 0.12, 0.2]
const INDICATOR_OPENED = () => sharedStandardMaterial('#555555', { emissive: '#000000', emissiveIntensity: 0 })
const INDICATOR_NEW = () => sharedStandardMaterial('#f2c14e', { emissive: '#f2c14e', emissiveIntensity: 0.6 })

interface ContainerViewProps {
  container: ContainerDef
}

/**
 * Container có ID ổn định; hiển thị dấu hiệu đã mở. R3b: the body is drawn by `StaticBatches` and its
 * collider comes from `ChunkColliders`; this is only the state light on top (yellow = not opened
 * yet, grey = opened).
 */
export function ContainerView({ container }: ContainerViewProps) {
  const opened = useWorldStore((s) => s.containerOpened[container.id] ?? false)
  const p = container.position

  return (
    <mesh position={[p.x, p.y + container.size[1] / 2 + 0.06, p.z]} dispose={null} geometry={sharedBox(INDICATOR_SIZE)} material={opened ? INDICATOR_OPENED() : INDICATOR_NEW()} />
  )
}
