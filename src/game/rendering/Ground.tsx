import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { runtime } from '../core/runtime'
import { mapBounds } from '../world/mapData'
import { packSurface } from './surfaces/catalog'
import { PIECE_SURFACES } from './surfaces/surfaceRules'
import { surfaceMaterial } from './surfaces/surfaceMaterial'
import { sharedPlane } from './sharedResources'

const GROUND_COLOR = '#4a5f3c'

/**
 * Ground plane of the play area. G1: grass detail in world coordinates (the 1 m debug grid that
 * used to cover it, brighter than the ground at night, is gone; the physics debug view still shows
 * colliders).
 */
export function Ground() {
  const r = mapBounds(runtime.map)
  const w = r.maxX - r.minX
  const d = r.maxZ - r.minZ
  const cx = (r.minX + r.maxX) / 2
  const cz = (r.minZ + r.maxZ) / 2
  return (
    <RigidBody type="fixed" colliders={false}>
      {/* Shared plane and material (dispose={null}): a new game reuses them. */}
      <mesh receiveShadow rotation-x={-Math.PI / 2} position={[cx, 0, cz]} geometry={sharedPlane(w, d)} material={surfaceMaterial(packSurface(PIECE_SURFACES.ground), GROUND_COLOR)} dispose={null} />
      <CuboidCollider args={[w / 2, 0.5, d / 2]} position={[cx, -0.5, cz]} friction={1} />
    </RigidBody>
  )
}
