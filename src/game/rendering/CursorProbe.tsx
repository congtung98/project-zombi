import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import { runtime } from '../core/runtime'
import { GAME_CONFIG } from '../core/config'
import type { Vec3 } from '../../types'
import { cutaway } from './cutaway'

/**
 * AX4: what the player sees at a point on their storey: not on a storey the cutaway hides, and in a
 * room only where it was ever seen (WIS §6.4: nothing is picked through the dark; the lighting is
 * never touched for it).
 */
function shown(p: Vec3): boolean {
  if (cutaway.hidesPoint(p)) return false
  return !GAME_CONFIG.interiorVisibility.enabled || runtime.interior.exploredAt(p) !== false
}

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
  const gl = useThree((s) => s.gl)
  const cursor = useRef('')
  const canvas = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const el = gl.domElement
    canvas.current = el
    return () => {
      el.style.cursor = ''
      canvas.current = null
    }
  }, [gl])

  useFrame(() => {
    // CS1 cue: a crosshair while the combat stance is asked for or a swing is finishing; AX4: a hand
    // over an interactive object (left click runs its default action).
    const wanted = runtime.combatPosture ? 'crosshair' : runtime.hoverInteractable ? 'pointer' : ''
    if (wanted !== cursor.current && canvas.current) {
      cursor.current = wanted
      canvas.current.style.cursor = wanted
    }
    const pointer = runtime.input.pointer
    if (!pointer.insideCanvas) {
      runtime.cursorWorld = null
      runtime.updatePointerTarget(null)
      return
    }
    ndc.current.set(pointer.ndcX, pointer.ndcY)
    raycaster.current.setFromCamera(ndc.current, camera)
    runtime.updatePointerTarget(raycaster.current.ray.direction.lengthSq() > 0 ? { origin: raycaster.current.ray.origin, dir: raycaster.current.ray.direction } : null, shown)
    ground.current.constant = -runtime.player.position.y
    if (raycaster.current.ray.intersectPlane(ground.current, hit.current)) {
      runtime.cursorWorld = { x: hit.current.x, y: runtime.player.position.y, z: hit.current.z }
    } else {
      runtime.cursorWorld = null
    }
  })

  return null
}
