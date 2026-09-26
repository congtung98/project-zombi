import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { runtime } from '../core/runtime'
import { mapBounds } from '../world/mapData'

const GRID_COLOR = '#3c4d33'

export function Ground() {
  const r = mapBounds(runtime.map)
  const w = r.maxX - r.minX
  const d = r.maxZ - r.minZ
  const cx = (r.minX + r.maxX) / 2
  const cz = (r.minZ + r.maxZ) / 2
  const square = w === d && Number.isInteger(w)
  // Rectangular / off-centre play area (M7): lines on whole metres inside the area.
  const lines = useMemo(() => {
    if (square) return null
    const pts: number[] = []
    for (let x = Math.ceil(r.minX); x <= r.maxX; x++) pts.push(x, 0.01, r.minZ, x, 0.01, r.maxZ)
    for (let z = Math.ceil(r.minZ); z <= r.maxZ; z++) pts.push(r.minX, 0.01, z, r.maxX, 0.01, z)
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(pts, 3))
    return g
  }, [square, r.minX, r.maxX, r.minZ, r.maxZ])
  return (
    <RigidBody type="fixed" colliders={false}>
      <mesh receiveShadow rotation-x={-Math.PI / 2} position={[cx, 0, cz]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#4a5f3c" />
      </mesh>
      {lines ? (
        <lineSegments geometry={lines}>
          <lineBasicMaterial color={GRID_COLOR} />
        </lineSegments>
      ) : (
        <gridHelper args={[w, w, '#2f3d28', GRID_COLOR]} position={[cx, 0.01, cz]} />
      )}
      <CuboidCollider args={[w / 2, 0.5, d / 2]} position={[cx, -0.5, cz]} friction={1} />
    </RigidBody>
  )
}
