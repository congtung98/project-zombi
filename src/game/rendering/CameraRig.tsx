import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrthographicCamera } from '@react-three/drei'
import { Vector3, type OrthographicCamera as OrthographicCameraImpl } from 'three'
import { runtime } from '../core/runtime'

const CAM = runtime.config.camera

/**
 * Camera orthographic nghiêng isometric, theo nhân vật có làm mượt và zoom
 * bằng con lăn trong giới hạn min/max. Hướng nhìn cố định nên không giật.
 */
export function CameraRig() {
  const cameraRef = useRef<OrthographicCameraImpl>(null)
  const target = useRef(new Vector3(runtime.player.position.x, 0, runtime.player.position.z))
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    const el = gl.domElement
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      runtime.adjustZoom(e.deltaY > 0 ? -1 : 1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [gl])

  useFrame((_, delta) => {
    const cam = cameraRef.current
    if (!cam) return
    const p = runtime.player.position
    const t = 1 - Math.exp(-CAM.followSmoothing * Math.min(delta, 0.1))
    target.current.x += (p.x - target.current.x) * t
    target.current.z += (p.z - target.current.z) * t

    cam.position.set(target.current.x + CAM.offset.x, CAM.offset.y, target.current.z + CAM.offset.z)
    cam.lookAt(target.current)

    if (cam.zoom !== runtime.cameraZoom) {
      cam.zoom = runtime.cameraZoom
      cam.updateProjectionMatrix()
    }
  })

  return (
    <OrthographicCamera
      ref={cameraRef}
      makeDefault
      position={[CAM.offset.x, CAM.offset.y, CAM.offset.z]}
      zoom={CAM.zoomDefault}
      near={0.1}
      far={200}
    />
  )
}
