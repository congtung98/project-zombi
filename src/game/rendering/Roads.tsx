import { runtime } from '../core/runtime'

/** Mặt đường chỉ để định hướng bằng mắt; không có collider. */
export function Roads() {
  return (
    <>
      {runtime.map.roads.map((road) => (
        <mesh key={road.id} receiveShadow rotation-x={-Math.PI / 2} position={[road.position.x, 0.015, road.position.z]}>
          <planeGeometry args={road.size} />
          <meshStandardMaterial color={road.color} />
        </mesh>
      ))}
    </>
  )
}
