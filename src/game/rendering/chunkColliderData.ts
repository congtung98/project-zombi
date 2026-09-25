import { chunkIndex } from '../../map/transform'
import type { StaticCollider, StaticColliderRegistry } from '../world/staticColliders'

/**
 * R3b: which static boxes Rapier holds. After obstruction queries moved into the simulation,
 * Rapier only collides the player's body with the world, so only the chunks around the player need
 * colliders: boxes are grouped by the chunk of their centre, and boxes longer than a chunk (the map
 * boundary) stay loaded always. Door leaves keep their own bodies (`DoorView`).
 */

export interface ColliderBox {
  id: string
  center: [number, number, number]
  half: [number, number, number]
}

/** Group key of the always-loaded boxes. */
export const WIDE_GROUP = 'wide'

const KINDS = ['wall', 'container', 'window'] as const

function toBox(c: StaticCollider): ColliderBox {
  return {
    id: c.id,
    center: [(c.min.x + c.max.x) / 2, (c.min.y + c.max.y) / 2, (c.min.z + c.max.z) / 2],
    half: [(c.max.x - c.min.x) / 2, (c.max.y - c.min.y) / 2, (c.max.z - c.min.z) / 2],
  }
}

/** Boxes per chunk key `cx,cz`, plus `WIDE_GROUP` for boxes spanning more than one chunk edge. */
export function groupColliders(registry: StaticColliderRegistry, chunkSize: number): Map<string, ColliderBox[]> {
  const groups = new Map<string, ColliderBox[]>()
  for (const kind of KINDS) {
    for (const c of registry.list(kind)) {
      const wide = c.max.x - c.min.x > chunkSize || c.max.z - c.min.z > chunkSize
      const key = wide ? WIDE_GROUP : `${chunkIndex((c.min.x + c.max.x) / 2, chunkSize)},${chunkIndex((c.min.z + c.max.z) / 2, chunkSize)}`
      const list = groups.get(key)
      if (list) list.push(toBox(c))
      else groups.set(key, [toBox(c)])
    }
  }
  return groups
}

/** Chunk keys within `radius` chunks of a point (square ring), plus the wide group; sorted, stable. */
export function activeColliderKeys(x: number, z: number, chunkSize: number, radius: number): string[] {
  const cx = chunkIndex(x, chunkSize)
  const cz = chunkIndex(z, chunkSize)
  const keys = [WIDE_GROUP]
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) keys.push(`${cx + dx},${cz + dz}`)
  return keys
}
