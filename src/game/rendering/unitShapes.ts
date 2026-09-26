import { BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, Float32BufferAttribute, PlaneGeometry, SphereGeometry, Vector3 } from 'three'
import type { HipShape, Shape, StaticItem } from './staticBatchData'

/**
 * Unit shapes of the static batches (R3b, M9 trees, G2 roofs), scaled per instance: each spans −0.5…0.5
 * on every axis (the floor lies flat at y 0). Shared by the batches and their fade overlays, created
 * once per key and never disposed (like the shared materials).
 */

const BASIC: Record<Exclude<Shape, 'hip'>, BufferGeometry> = {
  box: new BoxGeometry(1, 1, 1),
  floor: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  trunk: new CylinderGeometry(0.5, 0.5, 1, 8),
  crown: new SphereGeometry(0.5, 9, 6),
  cone: new ConeGeometry(0.5, 1, 10),
}

const hips = new Map<string, BufferGeometry>()

/**
 * Hipped roof on the unit square: eaves at y −0.5, ridge at +0.5 along `axis` from −ridge to +ridge,
 * closed underneath. Flat-shaded, indexed, with the same attributes as the other unit shapes
 * (position, normal, uv), as a `BatchedMesh` requires.
 */
export function hipGeometry(hip: HipShape): BufferGeometry {
  const r = hip.ridge
  // Built along X, then X and Z swapped for a ridge along Z.
  const p = (x: number, y: number, z: number) => (hip.axis === 'x' ? new Vector3(x, y, z) : new Vector3(z, y, x))
  const faces: Vector3[][] = [
    [p(-0.5, -0.5, 0.5), p(0.5, -0.5, 0.5), p(r, 0.5, 0), p(-r, 0.5, 0)],
    [p(0.5, -0.5, -0.5), p(-0.5, -0.5, -0.5), p(-r, 0.5, 0), p(r, 0.5, 0)],
    [p(0.5, -0.5, 0.5), p(0.5, -0.5, -0.5), p(r, 0.5, 0)],
    [p(-0.5, -0.5, -0.5), p(-0.5, -0.5, 0.5), p(-r, 0.5, 0)],
    [p(-0.5, -0.5, -0.5), p(0.5, -0.5, -0.5), p(0.5, -0.5, 0.5), p(-0.5, -0.5, 0.5)],
  ]
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const index: number[] = []
  for (let face of faces) {
    const centroid = face.reduce((c, v) => c.add(v), new Vector3()).divideScalar(face.length)
    // Normal from the first non-degenerate corner (a pyramid's end faces repeat the apex).
    let normal = new Vector3()
    for (let i = 1; i + 1 < face.length && normal.lengthSq() < 1e-12; i++) normal = new Vector3().subVectors(face[i], face[0]).cross(new Vector3().subVectors(face[i + 1], face[0]))
    // The shape is convex around the origin: an outward normal points away from it.
    if (normal.dot(centroid) < 0) {
      face = [...face].reverse()
      normal.negate()
    }
    normal.normalize()
    const base = positions.length / 3
    for (const v of face) {
      positions.push(v.x, v.y, v.z)
      normals.push(normal.x, normal.y, normal.z)
      uvs.push(0, 0)
    }
    for (let i = 1; i + 1 < face.length; i++) index.push(base, base + i, base + i + 1)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(positions, 3))
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  g.setIndex(index)
  return g
}

/** Key of an item's unit geometry (items with equal keys share one geometry in a batch). */
export function geometryKey(item: Pick<StaticItem, 'shape' | 'hip'>): string {
  return item.shape === 'hip' ? `hip:${item.hip?.axis ?? 'x'}:${item.hip?.ridge ?? 0}` : item.shape
}

/** An item's unit geometry (cached). */
export function unitGeometry(item: Pick<StaticItem, 'shape' | 'hip'>): BufferGeometry {
  if (item.shape !== 'hip') return BASIC[item.shape]
  const key = geometryKey(item)
  let g = hips.get(key)
  if (!g) {
    g = hipGeometry(item.hip ?? { axis: 'x', ridge: 0 })
    hips.set(key, g)
  }
  return g
}

export function unitBox(): BufferGeometry {
  return BASIC.box
}
