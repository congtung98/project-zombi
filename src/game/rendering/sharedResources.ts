import { BoxGeometry, MeshStandardMaterial, PlaneGeometry, type Material, type MeshStandardMaterialParameters } from 'three'

/**
 * R1: shared materials and geometries for static world objects (walls, containers, roads, floors,
 * roofs, window panes). Objects with the same look reuse one material instead of one
 * `MeshStandardMaterial` each (the stress map had ~800 walls in 10 colours). They live for the whole
 * app: meshes using them are mounted with `dispose={null}` so a scene remount does not free them.
 *
 * Shared materials are never mutated per object. The occlusion fader swaps a shared material for its
 * faded twin (`fadedVariant`) instead of changing its opacity (which would fade every wall of that
 * colour).
 */

const materials = new Map<string, MeshStandardMaterial>()
const boxes = new Map<string, BoxGeometry>()
const planes = new Map<string, PlaneGeometry>()
const faded = new WeakMap<Material, Material>()

export function sharedStandardMaterial(color: string, params: Omit<MeshStandardMaterialParameters, 'color'> = {}): MeshStandardMaterial {
  const key = `${color}|${JSON.stringify(params)}`
  let m = materials.get(key)
  if (!m) {
    m = new MeshStandardMaterial({ color, ...params })
    m.userData.shared = true
    materials.set(key, m)
  }
  return m
}

export function sharedBox(size: readonly [number, number, number]): BoxGeometry {
  const key = size.join(',')
  let g = boxes.get(key)
  if (!g) {
    g = new BoxGeometry(size[0], size[1], size[2])
    boxes.set(key, g)
  }
  return g
}

export function sharedPlane(width: number, height: number): PlaneGeometry {
  const key = `${width},${height}`
  let g = planes.get(key)
  if (!g) {
    g = new PlaneGeometry(width, height)
    planes.set(key, g)
  }
  return g
}

/** Transparent copy of a shared material for the occlusion fade (created once per material). */
export function fadedVariant(material: Material, opacity: number): Material {
  let m = faded.get(material)
  if (!m) {
    m = material.clone()
    m.transparent = true
    m.depthWrite = false
    m.userData.shared = true
    m.userData.fadedOf = material
    faded.set(material, m)
  }
  m.opacity = opacity
  return m
}

/** Counts for the perf audit. */
export function sharedResourceStats(): { materials: number; boxes: number; planes: number } {
  return { materials: materials.size, boxes: boxes.size, planes: planes.size }
}
