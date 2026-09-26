import { runtime } from '../core/runtime'
import { roadY } from '../world/mapData'
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
          position={[road.position.x, roadY(road), road.position.z]}
          dispose={null}
          geometry={sharedPlane(road.size[0], road.size[1])}
          material={sharedStandardMaterial(road.color)}
        />
      ))}
    </>
  )
}
