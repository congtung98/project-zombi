import { RigidBody } from '@react-three/rapier'
import { runtime } from '../core/runtime'

/** Tường/vật cản tĩnh: geometry hiển thị và collider được tạo từ cùng dữ liệu map. */
export function Walls() {
  return (
    <>
      {runtime.map.walls.map((wall) => (
        <RigidBody
          key={wall.id}
          type="fixed"
          colliders="cuboid"
          position={[wall.position.x, wall.position.y, wall.position.z]}
        >
          <mesh castShadow receiveShadow>
            <boxGeometry args={wall.size} />
            <meshStandardMaterial color={wall.color ?? '#5a5650'} />
          </mesh>
        </RigidBody>
      ))}
    </>
  )
}
