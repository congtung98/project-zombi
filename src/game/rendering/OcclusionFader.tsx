import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Ray, Vector3 } from 'three'
import { runtime } from '../core/runtime'
import { occlusionRegistry, type Occluder } from './occlusionRegistry'

const RAY_LENGTH = 80
/**
 * Độ cao các tia so với tâm nhân vật: chân, thân, đầu. Một tia từ tâm đi lên
 * dốc theo hướng camera nên có thể vượt qua tường thấp hoặc mái ở gần; nhiều
 * tia bảo đảm bất kỳ khối nào che một phần nhân vật cũng được làm mờ.
 */
const RAY_OFFSETS = [-0.75, 0, 0.8]

/**
 * Làm mờ các khối cao (tường, cửa, mái) nằm giữa camera và nhân vật để nhân
 * vật không bị che ở góc nhìn isometric.
 *
 * R1: occluders register themselves instead of a `scene.traverse` every second, and each ray only
 * tests the occluders under its path: a camera ray climbs, so past the tallest occluder's height it
 * can hit nothing (the query box ends there).
 * R3b: occluders are boxes (every one of them is an axis-aligned box: walls, roofs, door leaves at
 * quarter turns), so a ray–box test replaces the mesh raycast and batched walls fade too.
 */
export function OcclusionFader() {
  const faded = useRef(new Set<Occluder>())
  const ray = useRef(new Ray())
  const candidates = useRef<Occluder[]>([])
  const direction = useRef(
    new Vector3(runtime.config.camera.offset.x, runtime.config.camera.offset.y, runtime.config.camera.offset.z).normalize(),
  )

  useFrame(() => {
    occlusionRegistry.refresh()
    const p = runtime.player.position
    const dir = direction.current
    const horizontal = Math.hypot(dir.x, dir.z)
    const nowFaded = new Set<Occluder>()
    const r = ray.current
    for (const offset of RAY_OFFSETS) {
      r.origin.set(p.x, p.y + offset, p.z)
      r.direction.copy(dir)
      // Ray length until it rises above every occluder (capped by the old fixed length).
      const t = dir.y > 0 ? Math.min(RAY_LENGTH, (occlusionRegistry.maxTop - r.origin.y) / dir.y) : RAY_LENGTH
      if (t <= 0) continue
      const ex = r.origin.x + dir.x * t
      const ez = r.origin.z + dir.z * t
      const list = candidates.current
      list.length = 0
      const pad = horizontal > 0 ? 0 : t
      occlusionRegistry.query(Math.min(r.origin.x, ex) - pad, Math.min(r.origin.z, ez) - pad, Math.max(r.origin.x, ex) + pad, Math.max(r.origin.z, ez) + pad, list)
      for (const o of list) {
        if (nowFaded.has(o) || !o.isVisible()) continue
        if (r.intersectsBox(o.box)) nowFaded.add(o)
      }
    }

    for (const o of faded.current) if (!nowFaded.has(o)) o.setFaded(false)
    for (const o of nowFaded) if (!faded.current.has(o)) o.setFaded(true)
    faded.current = nowFaded
  })

  return null
}
