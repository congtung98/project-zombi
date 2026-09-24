import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, type BufferGeometry } from 'three'
import type { ItemId } from '../../entities/items'

/**
 * Placeholder melee models built from primitives. Each extends along +Z from its grip point at
 * the origin; `WEAPON_GRIPS` holds the per-weapon offset/rotation inside the hand socket, so a
 * future GLB only has to match the same grip convention.
 */
export type WeaponModelId = 'baseball_bat' | 'metal_pipe' | 'crowbar' | 'hammer'

export interface WeaponGrip {
  /** Offset of the model inside the socket (m); negative Z lets the handle end stick out below the fist. */
  position: [number, number, number]
  rotation: [number, number, number]
}

export const WEAPON_GRIPS: Record<WeaponModelId, WeaponGrip> = {
  baseball_bat: { position: [0, 0, -0.12], rotation: [0, 0, 0] },
  metal_pipe: { position: [0, 0, -0.1], rotation: [0, 0, 0] },
  crowbar: { position: [0, 0, -0.08], rotation: [0, 0, 0] },
  // Short handle: hold near the end so the head clears the fist.
  hammer: { position: [0, 0, -0.04], rotation: [0, 0, 0] },
}

interface PartSpec {
  geometry: BufferGeometry
  color: string
  metal?: boolean
  position: [number, number, number]
  rotation?: [number, number, number]
}

const ALONG_Z: [number, number, number] = [Math.PI / 2, 0, 0]
const GEOMETRY = {
  bat: new CylinderGeometry(0.05, 0.03, 1.05, 8),
  pipe: new CylinderGeometry(0.032, 0.032, 0.95, 8),
  crowbar: new CylinderGeometry(0.026, 0.026, 0.9, 6),
  crowbarHook: new BoxGeometry(0.14, 0.04, 0.05),
  hammerHandle: new CylinderGeometry(0.024, 0.03, 0.55, 6),
  hammerHead: new BoxGeometry(0.22, 0.08, 0.08),
}

const PARTS: Record<WeaponModelId, PartSpec[]> = {
  baseball_bat: [{ geometry: GEOMETRY.bat, color: '#9a6b3c', position: [0, 0, 0.525], rotation: ALONG_Z }],
  metal_pipe: [{ geometry: GEOMETRY.pipe, color: '#8c9298', metal: true, position: [0, 0, 0.475], rotation: ALONG_Z }],
  crowbar: [
    { geometry: GEOMETRY.crowbar, color: '#7a1f1f', metal: true, position: [0, 0, 0.45], rotation: ALONG_Z },
    { geometry: GEOMETRY.crowbarHook, color: '#7a1f1f', metal: true, position: [0.06, 0, 0.9] },
  ],
  hammer: [
    { geometry: GEOMETRY.hammerHandle, color: '#8a6a44', position: [0, 0, 0.275], rotation: ALONG_Z },
    { geometry: GEOMETRY.hammerHead, color: '#555a60', metal: true, position: [0, 0, 0.55] },
  ],
}

export interface WeaponModel {
  group: Group
  dispose: () => void
}

/** Broken weapons keep their shape but glow dull red so the state reads during combat. */
export function buildWeaponModel(itemId: ItemId, broken: boolean, castShadow: boolean): WeaponModel | null {
  if (!(itemId in PARTS)) return null
  const id = itemId as WeaponModelId
  const group = new Group()
  group.name = `weapon:${id}`
  const grip = WEAPON_GRIPS[id]
  group.position.set(...grip.position)
  group.rotation.set(...grip.rotation)
  const materials: MeshStandardMaterial[] = []
  for (const spec of PARTS[id]) {
    const material = new MeshStandardMaterial({
      color: spec.color,
      metalness: spec.metal ? 0.55 : 0,
      roughness: spec.metal ? 0.45 : 0.8,
      emissive: broken ? '#7a0d0d' : '#000000',
      emissiveIntensity: broken ? 0.6 : 0,
    })
    materials.push(material)
    const mesh = new Mesh(spec.geometry, material)
    mesh.position.set(...spec.position)
    if (spec.rotation) mesh.rotation.set(...spec.rotation)
    mesh.castShadow = castShadow
    group.add(mesh)
  }
  return { group, dispose: () => materials.forEach((m) => m.dispose()) }
}
