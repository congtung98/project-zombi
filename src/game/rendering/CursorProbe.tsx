import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import { runtime } from '../core/runtime'

/**
 * Chiếu con trỏ chuột từ camera xuống mặt đất (y = 0) mỗi frame và ghi vào
 * `runtime.cursorWorld` để combat quay nhân vật về phía con trỏ khi đánh/đẩy.
 */
export function CursorProbe() {
  const camera = useThree((s) => s.camera)
  const raycaster = useRef(new Raycaster())
  const ndc = useRef(new Vector2())
  const ground = useRef(new Plane(new Vector3(0, 1, 0), 0))
  const hit = useRef(new Vector3())

  useFrame(() => {
    const pointer = runtime.input.pointer
    if (!pointer.insideCanvas) {
      runtime.cursorWorld = null
      return
    }
    ndc.current.set(pointer.ndcX, pointer.ndcY)
    raycaster.current.setFromCamera(ndc.current, camera)
    if (raycaster.current.ray.intersectPlane(ground.current, hit.current)) {
      runtime.cursorWorld = { x: hit.current.x, y: 0, z: hit.current.z }
    } else {
      runtime.cursorWorld = null
    }
  })

  return null
}
