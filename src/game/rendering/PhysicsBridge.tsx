import { useEffect } from 'react'
import { useRapier } from '@react-three/rapier'
import { runtime, type PhysicsQuery } from '../core/runtime'
import type { BlockerUserData } from './blockerData'

/**
 * Cầu nối giữa simulation và Rapier: cung cấp truy vấn raycast cho runtime.
 * Chỉ các body có `userData.blocksInteraction` (tường, cửa, container) được
 * coi là vật chắn; body động (player, zombie) không chắn.
 */
export function PhysicsBridge() {
  const { world, rapier } = useRapier()

  useEffect(() => {
    const query: PhysicsQuery = {
      isBlocked(from, to, ignoreIds) {
        const dx = to.x - from.x
        const dy = to.y - from.y
        const dz = to.z - from.z
        const len = Math.hypot(dx, dy, dz)
        if (len < 1e-4) return false
        const ray = new rapier.Ray({ x: from.x, y: from.y, z: from.z }, { x: dx / len, y: dy / len, z: dz / len })
        const hit = world.castRay(ray, len, true, undefined, undefined, undefined, undefined, (collider) => {
          const ud = collider.parent()?.userData as Partial<BlockerUserData> | undefined
          return !!ud?.blocksInteraction && !ignoreIds.includes(ud.id ?? '')
        })
        return hit !== null
      },
    }
    runtime.registerPhysicsQuery(query)
    return () => runtime.registerPhysicsQuery(null)
  }, [world, rapier])

  return null
}
