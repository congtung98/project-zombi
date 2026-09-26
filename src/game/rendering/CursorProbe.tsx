import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import { runtime } from '../core/runtime'

/**
 * Chiếu con trỏ chuột từ camera xuống mặt đất (y = 0) mỗi frame và ghi vào
 * `runtime.cursorWorld` để combat quay nhân vật về phía con trỏ khi đánh/đẩy.
 * M11b: the plane is the floor the player stands on (an upper storey aims on that storey).
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
    ground.current.constant = -runtime.player.position.y
    if (raycaster.current.ray.intersectPlane(ground.current, hit.current)) {
      runtime.cursorWorld = { x: hit.current.x, y: runtime.player.position.y, z: hit.current.z }
    } else {
      runtime.cursorWorld = null
    }
  })

  return null
}
