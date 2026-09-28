import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type BufferGeometry } from 'three'
import type { ItemId } from '../../entities/items'
import { BODY_FRAMES } from './body'
import type { CharacterLook } from './rig'

/**
 * INV-LOOT S5: the worn bag on the player's back, built from boxes like the weapon placeholders and
 * hung on the torso bone, so it leans, twists and falls with the chest. Sizes are in the torso
 * bone's space (+Y up the spine from the waist, +Z forward); the bag's back rests on the top's
 * back surface (wider presets and jackets push it out) and its straps come over the shoulders.
 */
export interface BackpackModel {
  group: Group
  dispose: () => void
}

/** Rest depth of the top at the shoulder blades (balanced preset, `torsoRings` at 0.27 m). */
const BACK_HALF_DEPTH = 0.115
/** A jacket sits this much over the body on each side (half its `grow`). */
const JACKET_GROW = 0.015

const BAG = { w: 0.3, h: 0.4, d: 0.15, y: 0.22 }
const COLORS = { canvas: '#4f5a3a', flap: '#434d31', pocket: '#5b6745', strap: '#2c3026' }

interface Part {
  geometry: BufferGeometry
  color: keyof typeof COLORS
  position: [number, number, number]
  rotation?: [number, number, number]
}

const GEOMETRY = {
  body: new BoxGeometry(BAG.w, BAG.h, BAG.d),
  flap: new BoxGeometry(BAG.w + 0.02, 0.05, BAG.d + 0.02),
  pocket: new BoxGeometry(0.22, 0.15, 0.05),
  strapBack: new BoxGeometry(0.045, 0.3, 0.012),
  strapTop: new BoxGeometry(0.045, 0.018, 0.2),
  strapFront: new BoxGeometry(0.045, 0.26, 0.014),
}

/** Bag item → model; only the backpack exists today (a future bag adds a builder here). */
const MODELS: Partial<Record<ItemId, true>> = { backpack: true }

export function hasBackpackModel(itemId: ItemId): boolean {
  return MODELS[itemId] === true
}

export function buildBackpackModel(itemId: ItemId, look: Pick<CharacterLook, 'preset' | 'outfit'>, castShadow: boolean): BackpackModel | null {
  if (!hasBackpackModel(itemId)) return null
  const frame = BODY_FRAMES[look.preset]
  const back = BACK_HALF_DEPTH * frame.depth + (look.outfit === 'jacket' ? JACKET_GROW : 0)
  const front = back + 0.012
  const zBag = -(back + BAG.d / 2 + 0.004)
  const strapX = 0.1 * frame.bulk
  const parts: Part[] = [
    { geometry: GEOMETRY.body, color: 'canvas', position: [0, BAG.y, zBag] },
    // Top flap folded over, a little proud of the body.
    { geometry: GEOMETRY.flap, color: 'flap', position: [0, BAG.y + BAG.h / 2 - 0.02, zBag - 0.005], rotation: [-0.08, 0, 0] },
    { geometry: GEOMETRY.pocket, color: 'pocket', position: [0, BAG.y - 0.08, zBag - BAG.d / 2 - 0.022] },
  ]
  for (const x of [strapX, -strapX]) {
    parts.push(
      // Between the bag and the back, over the shoulder, then down the chest.
      { geometry: GEOMETRY.strapBack, color: 'strap', position: [x, BAG.y + 0.05, -back - 0.004] },
      { geometry: GEOMETRY.strapTop, color: 'strap', position: [x, 0.458, -0.005] },
      { geometry: GEOMETRY.strapFront, color: 'strap', position: [x * 0.9, 0.31, front], rotation: [0.1, 0, 0] },
    )
  }
  const group = new Group()
  group.name = `bag:${itemId}`
  const materials = new Map<keyof typeof COLORS, MeshStandardMaterial>()
  for (const spec of parts) {
    let material = materials.get(spec.color)
    if (!material) {
      material = new MeshStandardMaterial({ color: COLORS[spec.color], roughness: 0.92, metalness: 0 })
      materials.set(spec.color, material)
    }
    const mesh = new Mesh(spec.geometry, material)
    mesh.position.set(...spec.position)
    if (spec.rotation) mesh.rotation.set(...spec.rotation)
    mesh.castShadow = castShadow
    group.add(mesh)
  }
  return { group, dispose: () => materials.forEach((m) => m.dispose()) }
}
