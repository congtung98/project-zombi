import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'
import type { BuildingInfo } from '../world/buildings'
import { runtime } from '../core/runtime'
import { occluderRef } from './occlusionRegistry'
import { sharedBox, sharedPlane, sharedStandardMaterial } from './sharedResources'

const ROOF_THICKNESS = 0.2
const ROOF_OVERHANG = 0.3
/** The roof hides once the player is this close inside the footprint (unchanged from before R1). */
const ROOF_HIDE_MARGIN = 0.4

/** Roof meshes by building ID; `RoofController` shows/hides them (R1: one query per frame, not one per building). */
const roofs = new Map<string, Mesh>()
let roofsVersion = 0

interface BuildingViewProps {
  building: BuildingInfo
}

/**
 * Phần không có collider của công trình: sàn và mái. Mái ẩn khi người chơi ở
 * trong nhà để nhìn thấy nội thất từ góc isometric. Tường do `Walls` dựng.
 */
export function BuildingView({ building }: BuildingViewProps) {
  const { w, d } = building.size
  const { x, z } = building.center

  return (
    <group>
      <mesh receiveShadow rotation-x={-Math.PI / 2} position={[x, 0.02, z]} dispose={null} geometry={sharedPlane(w, d)} material={sharedStandardMaterial(building.floorColor)} />
      {/* Mái cũng là vật che: khi người chơi đứng ngoài, sát tường phía trên màn hình, mái nằm giữa camera và nhân vật. */}
      <mesh
        ref={(mesh) => registerRoof(building.id, mesh)}
        castShadow
        position={[x, building.height + ROOF_THICKNESS / 2, z]}
        dispose={null}
        geometry={sharedBox([w + ROOF_OVERHANG * 2, ROOF_THICKNESS, d + ROOF_OVERHANG * 2])}
        material={sharedStandardMaterial(building.roofColor)}
      />
    </group>
  )
}

/** Callback ref of a roof: the roof controller and the occlusion fader both track it until unmount. */
function registerRoof(id: string, mesh: Mesh | null): (() => void) | undefined {
  if (!mesh) return undefined
  roofs.set(id, mesh)
  roofsVersion += 1
  const unregisterOccluder = occluderRef(mesh)
  return () => {
    if (roofs.get(id) === mesh) roofs.delete(id)
    roofsVersion += 1
    unregisterOccluder?.()
  }
}

/** Shows every roof except the one of the building the player stands in (one spatial query per frame). */
export function RoofController() {
  const last = useRef<{ hidden: string | null; version: number }>({ hidden: null, version: -1 })

  useFrame(() => {
    const hidden = runtime.buildingAt(runtime.player.position, ROOF_HIDE_MARGIN)
    const s = last.current
    if (hidden === s.hidden && roofsVersion === s.version) return
    if (roofsVersion !== s.version) {
      for (const [id, roof] of roofs) roof.visible = id !== hidden
    } else {
      const before = s.hidden ? roofs.get(s.hidden) : undefined
      if (before) before.visible = true
      const now = hidden ? roofs.get(hidden) : undefined
      if (now) now.visible = false
    }
    s.hidden = hidden
    s.version = roofsVersion
  })

  return null
}
