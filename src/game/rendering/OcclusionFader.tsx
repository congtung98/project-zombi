import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { MeshStandardMaterial, Raycaster, Vector3, type Material, type Mesh } from 'three'
import { runtime } from '../core/runtime'
import { occlusionRegistry } from './occlusionRegistry'
import { fadedVariant } from './sharedResources'

const FADED_OPACITY = 0.28
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
 * R1: occluders register themselves (`occluderRef`) instead of a `scene.traverse` every second, and
 * each ray only tests the occluders under its path: a camera ray climbs, so past the tallest
 * occluder's height it can hit nothing (the query box ends there). A shared material is swapped for
 * its faded twin rather than changed in place.
 */
export function OcclusionFader() {
  const faded = useRef(new Set<Mesh>())
  const raycaster = useRef(new Raycaster())
  const origin = useRef(new Vector3())
  const candidates = useRef<Mesh[]>([])
  const direction = useRef(
    new Vector3(runtime.config.camera.offset.x, runtime.config.camera.offset.y, runtime.config.camera.offset.z).normalize(),
  )

  useFrame(() => {
    occlusionRegistry.refresh()
    const p = runtime.player.position
    const dir = direction.current
    const horizontal = Math.hypot(dir.x, dir.z)
    const nowFaded = new Set<Mesh>()
    for (const offset of RAY_OFFSETS) {
      origin.current.set(p.x, p.y + offset, p.z)
      // Ray length until it rises above every occluder (capped by the old fixed length).
      const t = dir.y > 0 ? Math.min(RAY_LENGTH, (occlusionRegistry.maxTop - origin.current.y) / dir.y) : RAY_LENGTH
      if (t <= 0) continue
      const ex = origin.current.x + dir.x * t
      const ez = origin.current.z + dir.z * t
      const list = candidates.current
      list.length = 0
      const pad = horizontal > 0 ? 0 : t
      occlusionRegistry.query(Math.min(origin.current.x, ex) - pad, Math.min(origin.current.z, ez) - pad, Math.max(origin.current.x, ex) + pad, Math.max(origin.current.z, ez) + pad, list)
      if (list.length === 0) continue
      raycaster.current.set(origin.current, dir)
      raycaster.current.far = RAY_LENGTH
      const hits = raycaster.current.intersectObjects(list, false)
      for (const hit of hits) {
        const mesh = hit.object as Mesh
        if (mesh.visible) nowFaded.add(mesh)
      }
    }

    for (const mesh of faded.current) {
      if (!nowFaded.has(mesh)) setFaded(mesh, false)
    }
    for (const mesh of nowFaded) {
      if (!faded.current.has(mesh)) setFaded(mesh, true)
    }
    faded.current = nowFaded
  })

  return null
}

function setFaded(mesh: Mesh, fade: boolean): void {
  const current = mesh.material as Material
  // Shared material (walls, roofs): swap to / back from its transparent twin.
  if (current.userData.shared) {
    if (fade && !current.userData.fadedOf) mesh.material = fadedVariant(current, FADED_OPACITY)
    else if (!fade && current.userData.fadedOf) mesh.material = current.userData.fadedOf as Material
    return
  }
  // Own material (door leaves): change it in place as before.
  if (!(current instanceof MeshStandardMaterial)) return
  current.transparent = fade
  current.opacity = fade ? FADED_OPACITY : 1
  current.depthWrite = !fade
  current.needsUpdate = true
}
