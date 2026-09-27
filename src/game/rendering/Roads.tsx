import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry } from 'three'
import { runtime } from '../core/runtime'
import { roadBatches, surfaceBatches, type RoadBatch } from './roadBatches'
import { packSurface, SURFACE_IDS, type SurfaceId } from './surfaces/catalog'
import { roadSurface } from './surfaces/surfaceRules'
import { surfaceMaterial } from './surfaces/surfaceMaterial'

/**
 * Mặt đường chỉ để định hướng bằng mắt; không có collider. G1: asphalt, concrete or dirt detail by
 * colour (`roadSurface`), in world coordinates so touching surfaces continue the same pattern.
 * WG5: merged into one mesh per 128 m cell and colour (`roadBatches`), disposed on unmount.
 */
function geometryOf(b: Pick<RoadBatch, 'positions' | 'normals' | 'uvs' | 'indices'>): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(b.positions, 3))
  g.setAttribute('normal', new BufferAttribute(b.normals, 3))
  g.setAttribute('uv', new BufferAttribute(b.uvs, 2))
  g.setIndex(new BufferAttribute(b.indices, 1))
  g.computeBoundingSphere()
  return g
}

/**
 * Prefab library P1: ground surfaces of prefabs and chunks (yards, lawns, paths, ponds), batched like
 * the roads by cell, surface and colour. Drawn only: a pond's barrier is a hidden wall.
 */
export function Surfaces() {
  const surfaces = runtime.map.surfaces
  const batches = useMemo(
    () =>
      surfaceBatches(surfaces ?? []).map((b) => {
        const id = ((SURFACE_IDS as readonly string[]).includes(b.surface) ? b.surface : 'concrete') as SurfaceId
        return { key: b.key, geometry: geometryOf(b), material: surfaceMaterial(packSurface({ a: id }), b.color) }
      }),
    [surfaces],
  )
  useEffect(() => () => batches.forEach((b) => b.geometry.dispose()), [batches])
  return (
    <>
      {batches.map((b) => (
        <mesh key={b.key} receiveShadow geometry={b.geometry} material={b.material} dispose={null} />
      ))}
    </>
  )
}

export function Roads() {
  const roads = runtime.map.roads
  const batches = useMemo(
    () =>
      roadBatches(roads).map((b) => ({ key: b.key, geometry: geometryOf(b), material: surfaceMaterial(packSurface({ a: roadSurface(b.color) }), b.color) })),
    [roads],
  )
  useEffect(() => () => batches.forEach((b) => b.geometry.dispose()), [batches])
  return (
    <>
      {batches.map((b) => (
        <mesh key={b.key} receiveShadow geometry={b.geometry} material={b.material} dispose={null} />
      ))}
    </>
  )
}
