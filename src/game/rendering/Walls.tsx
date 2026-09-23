import { RigidBody } from '@react-three/rapier'
import { runtime } from '../core/runtime'
import { blockerData } from './blockerData'

/** Khối cao hơn ngưỡng này mới được làm mờ khi che nhân vật. */
const OCCLUDER_MIN_HEIGHT = 1.5

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
          userData={blockerData(wall.id)}
        >
          <mesh castShadow receiveShadow userData={{ occluder: wall.size[1] >= OCCLUDER_MIN_HEIGHT }}>
            <boxGeometry args={wall.size} />
            <meshStandardMaterial color={wall.color ?? '#5a5650'} />
          </mesh>
        </RigidBody>
      ))}
    </>
  )
}
