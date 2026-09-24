import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'
import type { BuildingDef } from '../world/buildings'
import { isInsideBuilding } from '../world/buildings'
import { runtime } from '../core/runtime'

const ROOF_THICKNESS = 0.2
const ROOF_OVERHANG = 0.3

interface BuildingViewProps {
  building: BuildingDef
}

/**
 * Phần không có collider của công trình: sàn và mái. Mái ẩn khi người chơi ở
 * trong nhà để nhìn thấy nội thất từ góc isometric. Tường do `Walls` dựng.
 */
export function BuildingView({ building }: BuildingViewProps) {
  const roofRef = useRef<Mesh>(null)
  const { w, d } = building.size
  const { x, z } = building.center

  useFrame(() => {
    const roof = roofRef.current
    if (!roof) return
    const p = runtime.player.position
    roof.visible = !isInsideBuilding(building, p.x, p.z, 0.4)
  })

  return (
    <group>
      <mesh receiveShadow rotation-x={-Math.PI / 2} position={[x, 0.02, z]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={building.floorColor} />
      </mesh>
      {/* Mái cũng là vật che: khi người chơi đứng ngoài, sát tường phía trên màn hình, mái nằm giữa camera và nhân vật. */}
      <mesh ref={roofRef} castShadow position={[x, building.height + ROOF_THICKNESS / 2, z]} userData={{ occluder: true }}>
        <boxGeometry args={[w + ROOF_OVERHANG * 2, ROOF_THICKNESS, d + ROOF_OVERHANG * 2]} />
        <meshStandardMaterial color={building.roofColor} />
      </mesh>
    </group>
  )
}
