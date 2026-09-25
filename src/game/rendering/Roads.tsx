import { runtime } from '../core/runtime'
import { sharedPlane, sharedStandardMaterial } from './sharedResources'

/** Mặt đường chỉ để định hướng bằng mắt; không có collider. */
export function Roads() {
  return (
    <>
      {runtime.map.roads.map((road) => (
        <mesh
          key={road.id}
          receiveShadow
          rotation-x={-Math.PI / 2}
          position={[road.position.x, 0.015, road.position.z]}
          dispose={null}
          geometry={sharedPlane(road.size[0], road.size[1])}
          material={sharedStandardMaterial(road.color)}
        />
      ))}
    </>
  )
}
