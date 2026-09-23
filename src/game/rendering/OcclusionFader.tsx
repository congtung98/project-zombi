import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three'
import { runtime } from '../core/runtime'

const FADED_OPACITY = 0.28
const REFRESH_INTERVAL = 1
const RAY_LENGTH = 80

/**
 * Làm mờ các khối cao (tường, cửa) nằm giữa camera và nhân vật để nhân vật
 * không bị che ở góc nhìn isometric. Chỉ xét mesh có `userData.occluder`.
 */
export function OcclusionFader() {
  const scene = useThree((s) => s.scene)
  const occluders = useRef<Mesh[]>([])
  const faded = useRef(new Set<Mesh>())
  const refreshTimer = useRef(REFRESH_INTERVAL)
  const raycaster = useRef(new Raycaster())
  const origin = useRef(new Vector3())
  const direction = useRef(
    new Vector3(runtime.config.camera.offset.x, runtime.config.camera.offset.y, runtime.config.camera.offset.z).normalize(),
  )

  useFrame((_, delta) => {
    refreshTimer.current += delta
    if (refreshTimer.current >= REFRESH_INTERVAL) {
      refreshTimer.current = 0
      const list: Mesh[] = []
      scene.traverse((obj) => {
        if (obj instanceof Mesh && obj.userData.occluder === true) list.push(obj)
      })
      occluders.current = list
    }

    const p = runtime.player.position
    origin.current.set(p.x, p.y, p.z)
    raycaster.current.set(origin.current, direction.current)
    raycaster.current.far = RAY_LENGTH
    const hits = raycaster.current.intersectObjects(occluders.current, false)

    const nowFaded = new Set<Mesh>()
    for (const hit of hits) nowFaded.add(hit.object as Mesh)

    for (const mesh of faded.current) {
      if (!nowFaded.has(mesh)) setOpacity(mesh, 1)
    }
    for (const mesh of nowFaded) {
      if (!faded.current.has(mesh)) setOpacity(mesh, FADED_OPACITY)
    }
    faded.current = nowFaded
  })

  return null
}

function setOpacity(mesh: Mesh, opacity: number): void {
  const material = mesh.material
  if (!(material instanceof MeshStandardMaterial)) return
  const fade = opacity < 1
  material.transparent = fade
  material.opacity = opacity
  material.depthWrite = !fade
  material.needsUpdate = true
}
