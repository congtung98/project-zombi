import { BoxGeometry, CylinderGeometry, Group, Mesh, type BufferGeometry } from 'three'
import { getItemDef, type ItemId, type ItemKind } from '../../entities/items'
import { sharedStandardMaterial } from '../sharedResources'

/**
 * AX3 (FB §7): what an item looks like in a hand while an action uses it (drinking, eating,
 * bandaging, opening). Built from primitives like the weapon placeholders, along the socket's +Z
 * grip axis, centred on the fist. Geometries and materials are shared (never disposed per prop), so
 * attaching and removing a prop every action allocates nothing but a Group and its meshes.
 * An item without its own shape gets a small box in its kind's colour: a missing model never stops
 * an action (CAS §7).
 */
export type PropShape = 'bottle' | 'can' | 'tin' | 'snack' | 'roll' | 'kit'

interface PartSpec {
  geometry: BufferGeometry
  color: string
  position: [number, number, number]
  rotation?: [number, number, number]
  metal?: boolean
}

const ALONG_Z: [number, number, number] = [Math.PI / 2, 0, 0]
const GEOMETRY = {
  bottle: new CylinderGeometry(0.034, 0.034, 0.2, 10),
  bottleNeck: new CylinderGeometry(0.014, 0.022, 0.05, 8),
  bottleCap: new CylinderGeometry(0.015, 0.015, 0.018, 8),
  can: new CylinderGeometry(0.03, 0.03, 0.11, 10),
  tin: new CylinderGeometry(0.038, 0.038, 0.075, 10),
  tinLabel: new CylinderGeometry(0.0395, 0.0395, 0.04, 10),
  snack: new BoxGeometry(0.12, 0.03, 0.16),
  roll: new CylinderGeometry(0.028, 0.028, 0.06, 10),
  kit: new BoxGeometry(0.16, 0.07, 0.12),
  kitCross: new BoxGeometry(0.06, 0.072, 0.018),
  fallback: new BoxGeometry(0.07, 0.07, 0.07),
}

const SHAPES: Record<PropShape, PartSpec[]> = {
  bottle: [
    { geometry: GEOMETRY.bottle, color: '#8cc6ef', position: [0, 0, 0], rotation: ALONG_Z },
    { geometry: GEOMETRY.bottleNeck, color: '#8cc6ef', position: [0, 0, 0.125], rotation: ALONG_Z },
    { geometry: GEOMETRY.bottleCap, color: '#2e6fb0', position: [0, 0, 0.158], rotation: ALONG_Z },
  ],
  can: [{ geometry: GEOMETRY.can, color: '#2f8f5a', position: [0, 0, 0], rotation: ALONG_Z, metal: true }],
  tin: [
    { geometry: GEOMETRY.tin, color: '#b9bec4', position: [0, 0, 0], rotation: ALONG_Z, metal: true },
    { geometry: GEOMETRY.tinLabel, color: '#c0463a', position: [0, 0, 0], rotation: ALONG_Z },
  ],
  snack: [{ geometry: GEOMETRY.snack, color: '#e8b93a', position: [0, 0, 0.03] }],
  roll: [{ geometry: GEOMETRY.roll, color: '#f3e3cf', position: [0, 0, 0] }],
  kit: [
    { geometry: GEOMETRY.kit, color: '#eef0f1', position: [0, 0, 0.02] },
    { geometry: GEOMETRY.kitCross, color: '#c9362c', position: [0, 0, 0.02] },
  ],
}

/** Item → shape. Data only: a new item picks a shape (or gets the fallback box). */
const ITEM_SHAPES: Partial<Record<ItemId, PropShape>> = {
  water: 'bottle',
  soda: 'can',
  canned_food: 'tin',
  canned_food_open: 'tin',
  chips: 'snack',
  bandage: 'roll',
  medkit: 'kit',
}

const KIND_COLORS: Record<ItemKind, string> = {
  food: '#c0463a', drink: '#8cc6ef', medical: '#eef0f1', weapon: '#8e979f', tool: '#8e979f', material: '#b98652', bag: '#4f5a3a', unknown: '#777777',
}

export function propShape(itemId: ItemId): PropShape | null {
  return ITEM_SHAPES[itemId] ?? null
}

/** The prop of an item: its own shape, else the fallback box in its kind's colour. */
export function buildItemProp(itemId: ItemId, castShadow: boolean): Group {
  const group = new Group()
  const shape = propShape(itemId)
  group.name = `prop:${itemId}`
  const parts: PartSpec[] = shape ? SHAPES[shape] : [{ geometry: GEOMETRY.fallback, color: KIND_COLORS[getItemDef(itemId).kind], position: [0, 0, 0] }]
  for (const spec of parts) {
    const material = sharedStandardMaterial(spec.color, { roughness: spec.metal ? 0.45 : 0.75, metalness: spec.metal ? 0.5 : 0 })
    const mesh = new Mesh(spec.geometry, material)
    mesh.position.set(...spec.position)
    if (spec.rotation) mesh.rotation.set(...spec.rotation)
    mesh.castShadow = castShadow
    group.add(mesh)
  }
  return group
}
