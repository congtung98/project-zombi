import { runtime } from '../core/runtime'
import { roadY } from '../world/mapData'
import { sharedPlane } from './sharedResources'
import { packSurface } from './surfaces/catalog'
import { roadSurface } from './surfaces/surfaceRules'
import { surfaceMaterial } from './surfaces/surfaceMaterial'

/**
 * Mặt đường chỉ để định hướng bằng mắt; không có collider. G1: asphalt, concrete or dirt detail by
 * colour (`roadSurface`), in world coordinates so touching surfaces continue the same pattern.
 */
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
          material={surfaceMaterial(packSurface({ a: roadSurface(road.color) }), road.color)}
        />
      ))}
    </>
  )
}
