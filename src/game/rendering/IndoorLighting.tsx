import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Mesh } from 'three'
import { runtime } from '../core/runtime'
import { hexToRgb } from '../lighting/buildingLighting'
import { INDOOR_MAX_ROOMS, indoorUniforms, patchIndoorMaterial } from './indoorShading'

const CFG = runtime.config.buildingLighting
/** Room shade eases towards its new value (lamp switch, door) in about 0.15 s instead of snapping. */
const EASE = 12

/**
 * Applies building lighting to the scene: patches standard materials as meshes appear (views
 * mount/remount, zombies spawn) and uploads room shade uniforms when `runtime.lighting.revision`
 * changes. It reads lighting state only; the day/night lights (`Lights.tsx`) are not touched and
 * outdoor fragments render exactly as before. Player vision plays no part in it.
 */
export function IndoorLighting() {
  const scene = useThree((s) => s.scene)
  const target = useRef<Float32Array>(new Float32Array(INDOOR_MAX_ROOMS * 3))
  const revision = useRef(-1)
  const primed = useRef(false)

  useEffect(() => {
    const rooms = runtime.lighting.roomsList().slice(0, INDOOR_MAX_ROOMS)
    indoorUniforms.uRoomCount.value = rooms.length
    rooms.forEach((r, i) => {
      indoorUniforms.uRoomRect.value[i].set(r.bounds.minX, r.bounds.maxX, r.bounds.minZ, r.bounds.maxZ)
      indoorUniforms.uRoomShade.value[i].w = r.height
    })
    primed.current = false
    revision.current = -1
    return () => {
      indoorUniforms.uRoomCount.value = 0
    }
  }, [])

  useFrame((_, delta) => {
    // New meshes (door leaves recreated on toggle, spawned zombies, drops) get patched on their first frame.
    scene.traverse((o) => {
      if (!(o instanceof Mesh)) return
      const m = o.material
      if (Array.isArray(m)) m.forEach(patchIndoorMaterial)
      else patchIndoorMaterial(m)
    })

    const rooms = runtime.lighting.roomsList()
    const count = Math.min(rooms.length, INDOOR_MAX_ROOMS)
    if (runtime.lighting.revision !== revision.current) {
      revision.current = runtime.lighting.revision
      for (let i = 0; i < count; i++) {
        const light = runtime.lighting.getRoomLight(rooms[i].id)
        const level = light?.finalLightLevel ?? CFG.minIndoorLight
        const shade = CFG.indoorShadeMin + (CFG.indoorShadeMax - CFG.indoorShadeMin) * level
        const color = light?.color ?? hexToRgb(CFG.daylightColor)
        for (let c = 0; c < 3; c++) target.current[i * 3 + c] = shade * color[c]
      }
    }
    const k = primed.current ? 1 - Math.exp(-EASE * Math.min(delta, 0.1)) : 1
    primed.current = true
    for (let i = 0; i < count; i++) {
      const v = indoorUniforms.uRoomShade.value[i]
      v.x += (target.current[i * 3] - v.x) * k
      v.y += (target.current[i * 3 + 1] - v.y) * k
      v.z += (target.current[i * 3 + 2] - v.z) * k
    }
  })

  return null
}
