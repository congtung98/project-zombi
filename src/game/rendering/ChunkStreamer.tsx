import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { runtime } from '../core/runtime'
import { mapChunkSize } from '../world/mapData'
import { chunksAround, nextViewChunks, viewGroundRect, type ViewRay } from './viewChunks'
import { publishViewChunks, setStreamAll, streamAll, viewChunkKeys } from './viewChunkStore'

const STREAM_OFF = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('stream') === 'off'
const NDC_CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const

/**
 * M10: recomputes the shown chunks every frame from the camera frustum (its corner rays cut at the
 * ground and at `streaming.viewTop`), plus the player's physics neighbourhood, and publishes them
 * when the set changes. `?stream=off` (or `streaming.view: false`) mounts every chunk instead.
 */
export function ChunkStreamer() {
  const camera = useThree((s) => s.camera)
  const cfg = runtime.config.streaming
  const chunkSize = mapChunkSize(runtime.map)
  const scratch = useRef({
    near: new Vector3(),
    dir: new Vector3(),
    rays: NDC_CORNERS.map(() => ({ origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: 0 } })) as ViewRay[],
  })

  useEffect(() => {
    setStreamAll(STREAM_OFF || !cfg.view)
    // Before the first frame: the player's neighbourhood, so the scene is never empty.
    const p = runtime.player.position
    publishViewChunks(chunksAround(p.x, p.z, chunkSize, Math.max(1, cfg.colliderChunkRadius)))
    if (import.meta.env.DEV) (window as unknown as { __viewChunks: () => readonly string[] }).__viewChunks = viewChunkKeys
    return () => publishViewChunks([])
  }, [cfg, chunkSize])

  useFrame(() => {
    if (streamAll()) return
    const s = scratch.current
    camera.updateMatrixWorld()
    camera.getWorldDirection(s.dir)
    NDC_CORNERS.forEach(([x, y], i) => {
      s.near.set(x, y, -1).unproject(camera)
      const r = s.rays[i]
      r.origin.x = s.near.x
      r.origin.y = s.near.y
      r.origin.z = s.near.z
      r.dir.x = s.dir.x
      r.dir.y = s.dir.y
      r.dir.z = s.dir.z
    })
    const p = runtime.player.position
    const rect = viewGroundRect(s.rays, cfg.viewTop)
    const always = chunksAround(p.x, p.z, chunkSize, cfg.colliderChunkRadius)
    publishViewChunks(nextViewChunks(new Set(viewChunkKeys()), rect, always, { chunkSize, margin: cfg.viewMargin, keep: cfg.viewKeep }))
  })

  return null
}
