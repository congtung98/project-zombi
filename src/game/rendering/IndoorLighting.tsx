import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { runtime } from '../core/runtime'
import { hexToRgb } from '../lighting/buildingLighting'
import type { RoomPlacement } from '../world/buildings'
import { INDOOR_MAX_ROOMS, indoorUniforms, installIndoorShading } from './indoorShading'

const CFG = runtime.config.buildingLighting
/** Room shade eases towards its new value (lamp switch, door) in about 0.15 s instead of snapping. */
const EASE = 12

// Every MeshStandardMaterial created from now on compiles with the indoor patch (no scene traversal).
installIndoorShading()

/** Distance from a point to a room rectangle on the ground (0 inside). */
function roomDistance(r: RoomPlacement, x: number, z: number): number {
  const dx = Math.max(r.bounds.minX - x, 0, x - r.bounds.maxX)
  const dz = Math.max(r.bounds.minZ - z, 0, z - r.bounds.maxZ)
  return Math.hypot(dx, dz)
}

/**
 * Applies building lighting to the scene: uploads room rectangles and shade uniforms when
 * `runtime.lighting.revision` changes. It reads lighting state only; the day/night lights
 * (`Lights.tsx`) are not touched and outdoor fragments render exactly as before. Player vision plays
 * no part in it. Materials get the shader patch when they are created (`installIndoorShading`).
 *
 * The shader handles `maxShaderRooms` rooms. A map with more rooms uploads the ones nearest to the
 * player's position, re-picked after the player moved `shaderRoomRepickDistance` (R1; the stress map
 * has 64 rooms). A room entering the subset starts at its current value (no fade from another room).
 */
export function IndoorLighting() {
  const target = useRef<Float32Array>(new Float32Array(INDOOR_MAX_ROOMS * 3))
  const state = useRef({
    revision: -1,
    primed: false,
    slots: [] as RoomPlacement[],
    pickedAt: null as { x: number; z: number } | null,
  })

  useEffect(() => {
    const s = state.current
    s.primed = false
    s.revision = -1
    s.slots = []
    s.pickedAt = null
    return () => {
      indoorUniforms.uRoomCount.value = 0
    }
  }, [])

  useFrame((_, delta) => {
    const s = state.current
    const rooms = runtime.lighting.roomsList()
    const p = runtime.player.position
    let snap = !s.primed
    // Pick the rooms the shader gets: all of them when they fit (map order), else the nearest ones.
    const repick = s.pickedAt === null || (rooms.length > INDOOR_MAX_ROOMS && Math.hypot(p.x - s.pickedAt.x, p.z - s.pickedAt.z) >= CFG.shaderRoomRepickDistance)
    if (repick) {
      const chosen = rooms.length <= INDOOR_MAX_ROOMS
        ? rooms.slice()
        : rooms.map((r) => ({ r, d: roomDistance(r, p.x, p.z) })).sort((a, b) => a.d - b.d).slice(0, INDOOR_MAX_ROOMS).map((e) => e.r)
      const changed = chosen.length !== s.slots.length || chosen.some((r, i) => s.slots[i] !== r)
      s.pickedAt = { x: p.x, z: p.z }
      if (changed) {
        s.slots = chosen
        indoorUniforms.uRoomCount.value = chosen.length
        chosen.forEach((r, i) => {
          indoorUniforms.uRoomRect.value[i].set(r.bounds.minX, r.bounds.maxX, r.bounds.minZ, r.bounds.maxZ)
          indoorUniforms.uRoomShade.value[i].w = r.height
        })
        s.revision = -1
        snap = true
      }
    }

    const count = s.slots.length
    if (runtime.lighting.revision !== s.revision) {
      s.revision = runtime.lighting.revision
      for (let i = 0; i < count; i++) {
        const light = runtime.lighting.getRoomLight(s.slots[i].id)
        const level = light?.finalLightLevel ?? CFG.minIndoorLight
        const shade = CFG.indoorShadeMin + (CFG.indoorShadeMax - CFG.indoorShadeMin) * level
        const color = light?.color ?? hexToRgb(CFG.daylightColor)
        for (let c = 0; c < 3; c++) target.current[i * 3 + c] = shade * color[c]
      }
    }
    const k = snap ? 1 : 1 - Math.exp(-EASE * Math.min(delta, 0.1))
    s.primed = true
    for (let i = 0; i < count; i++) {
      const v = indoorUniforms.uRoomShade.value[i]
      v.x += (target.current[i * 3] - v.x) * k
      v.y += (target.current[i * 3 + 1] - v.y) * k
      v.z += (target.current[i * 3 + 2] - v.z) * k
    }
  })

  return null
}
