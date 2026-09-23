import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { runtime } from '../core/runtime'

export function Ground() {
  const size = runtime.map.size
  const half = size / 2
  return (
    <RigidBody type="fixed" colliders={false}>
      <mesh receiveShadow rotation-x={-Math.PI / 2} position-y={0}>
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial color="#4a5f3c" />
      </mesh>
      <gridHelper args={[size, size, '#2f3d28', '#3c4d33']} position-y={0.01} />
      <CuboidCollider args={[half, 0.5, half]} position={[0, -0.5, 0]} friction={1} />
    </RigidBody>
  )
}
