import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { runtime } from '../core/runtime'
import { mapChunkSize } from '../world/mapData'
import { activeColliderKeys, groupColliders, type ColliderBox } from './chunkColliderData'

/**
 * R3b: Rapier colliders of walls, props, containers and window panes, one fixed body per chunk,
 * mounted only for the chunks around the player (`GAME_CONFIG.streaming.colliderChunkRadius`) plus
 * the boxes longer than a chunk. Same boxes as `runtime.staticColliders` (the simulation's own
 * collision and line of sight), so nothing else depends on which chunks Rapier has loaded.
 */
export function ChunkColliders() {
  const registry = runtime.staticColliders
  const subscribe = useCallback((listener: () => void) => registry.subscribe(listener), [registry])
  const version = useSyncExternalStore(subscribe, () => registry.version)
  const chunkSize = mapChunkSize(runtime.map)
  const radius = runtime.config.streaming.colliderChunkRadius
  const groups = useMemo(() => (version >= 0 ? groupColliders(registry, chunkSize) : new Map<string, ColliderBox[]>()), [registry, chunkSize, version])
  const keysAt = useCallback(() => activeColliderKeys(runtime.player.position.x, runtime.player.position.z, chunkSize, radius), [chunkSize, radius])
  const [active, setActive] = useState(keysAt)
  const signature = useRef(active.join('|'))

  useFrame(() => {
    const keys = keysAt()
    const sig = keys.join('|')
    if (sig === signature.current) return
    signature.current = sig
    setActive(keys)
  })

  return (
    <>
      {active.map((key) => {
        const boxes = groups.get(key)
        if (!boxes) return null
        return (
          <RigidBody key={`${key}@${version}`} type="fixed" colliders={false}>
            {boxes.map((b) => (
              <CuboidCollider key={b.id} position={b.center} args={b.half} />
            ))}
          </RigidBody>
        )
      })}
    </>
  )
}
