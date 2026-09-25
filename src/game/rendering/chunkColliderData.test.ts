import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../core/runtime'
import { GAME_CONFIG } from '../core/config'
import { mapChunkSize } from '../world/mapData'
import { buildStressMap } from '../world/stressMap'
import { activeColliderKeys, groupColliders, WIDE_GROUP } from './chunkColliderData'

describe('chunk colliders for Rapier (R3b)', () => {
  const rt = new GameRuntime(buildStressMap(4))
  const size = mapChunkSize(rt.map)
  const groups = groupColliders(rt.staticColliders, size)
  const all = ['wall', 'container', 'window'].flatMap((k) => rt.staticColliders.list(k as 'wall'))

  it('puts every wall, container and window pane in exactly one group; map-long boxes stay loaded', () => {
    const ids = [...groups.values()].flat().map((b) => b.id)
    expect(ids.sort()).toEqual(all.map((c) => c.id).sort())
    expect(groups.get(WIDE_GROUP)!.map((b) => b.id).sort()).toEqual(['world/boundary-e', 'world/boundary-n', 'world/boundary-s', 'world/boundary-w'])
  })

  // Guarantee: the ring reaches radius·size past the player's chunk, and a non-wide box sticks out of
  // its centre's chunk by at most size/2, so every box within (radius − ½)·size of the player is loaded.
  it('anything within half a chunk of the player is loaded, wherever the player stands', () => {
    const radius = GAME_CONFIG.streaming.colliderChunkRadius
    for (const p of [{ x: -87, z: -88 }, { x: 0.01, z: -0.01 }, { x: 63.9, z: 31.9 }, { x: 99, z: 99 }]) {
      const keys = new Set(activeColliderKeys(p.x, p.z, size, radius))
      const loaded = new Set([...keys].flatMap((k) => groups.get(k) ?? []).map((b) => b.id))
      for (const c of all) {
        const dx = Math.max(c.min.x - p.x, 0, p.x - c.max.x)
        const dz = Math.max(c.min.z - p.z, 0, p.z - c.max.z)
        if (Math.hypot(dx, dz) < size * (radius - 0.5)) expect(loaded.has(c.id), `${c.id} near (${p.x}, ${p.z})`).toBe(true)
      }
      expect(loaded.size).toBeLessThan(all.length / 3)
    }
  })
})
