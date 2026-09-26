import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'
import type { ContainerDef } from '../world/buildings'
import { cutaway } from './cutaway'
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
 * yet, grey = opened). M11c-1A: hidden with its container on a storey the cutaway hides.
 */
export function ContainerView({ container }: ContainerViewProps) {
  const opened = useWorldStore((s) => s.containerOpened[container.id] ?? false)
  const p = container.position
  const ref = useRef<Mesh>(null)
  const version = useRef(-1)

  useFrame(() => {
    if (!ref.current || version.current === cutaway.version) return
    version.current = cutaway.version
    ref.current.visible = !cutaway.hidesPoint({ x: p.x, y: p.y - container.size[1] / 2, z: p.z })
  })

  return (
    <mesh ref={ref} position={[p.x, p.y + container.size[1] / 2 + 0.06, p.z]} dispose={null} geometry={sharedBox(INDICATOR_SIZE)} material={opened ? INDICATOR_OPENED() : INDICATOR_NEW()} />
  )
}
