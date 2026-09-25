import { useCallback, useSyncExternalStore } from 'react'
import { RigidBody } from '@react-three/rapier'
import { runtime } from '../core/runtime'
import { blockerData } from './blockerData'
import { occluderRef } from './occlusionRegistry'
import { sharedBox, sharedStandardMaterial } from './sharedResources'

/** Khối cao hơn ngưỡng này mới được làm mờ khi che nhân vật. */
const OCCLUDER_MIN_HEIGHT = 1.5
const DEFAULT_WALL_COLOR = '#5a5650'
/** Box sizes come back from min/max: round away float noise so equal walls share one geometry. */
const round = (v: number) => Math.round(v * 1e6) / 1e6

/**
 * Tường/vật cản tĩnh: mesh và collider Rapier dựng từ `runtime.staticColliders` (R2), cùng nguồn với
 * va chạm của zombie trong simulation. Registering or unregistering a wall there (chunk load/unload
 * in R3) mounts or removes it here; nothing is hard-wired to the map in the scene.
 * R1: walls of one colour share a material and walls of one size a geometry (`dispose={null}`: they
 * outlive a scene remount); tall ones register with the occlusion fader.
 */
export function Walls() {
  const registry = runtime.staticColliders
  const subscribe = useCallback((listener: () => void) => registry.subscribe(listener), [registry])
  const version = useSyncExternalStore(subscribe, () => registry.version)
  const walls = registry.list('wall')

  return (
    <group userData={{ collidersVersion: version }}>
      {walls.map((wall) => {
        const size: [number, number, number] = [round(wall.max.x - wall.min.x), round(wall.max.y - wall.min.y), round(wall.max.z - wall.min.z)]
        return (
          <RigidBody
            key={wall.id}
            type="fixed"
            colliders="cuboid"
            position={[(wall.min.x + wall.max.x) / 2, (wall.min.y + wall.max.y) / 2, (wall.min.z + wall.max.z) / 2]}
            userData={blockerData(wall.id)}
          >
            <mesh
              castShadow
              receiveShadow
              dispose={null}
              geometry={sharedBox(size)}
              material={sharedStandardMaterial(wall.color ?? DEFAULT_WALL_COLOR)}
              ref={size[1] >= OCCLUDER_MIN_HEIGHT ? occluderRef : undefined}
            />
          </RigidBody>
        )
      })}
    </group>
  )
}
