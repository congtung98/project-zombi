import { isInsideBuilding, type BuildingInfo } from '../../world/buildings'
import { FACE, type SurfaceId, type SurfaceSpec } from './catalog'

/**
 * G1: which surface each static piece gets, from what the content already says (role, building,
 * colour). Content has no per-object surface field yet (the optional `visual` field comes with the
 * furniture and editor sprints); until then these rules are the single place that decides, and they
 * never touch IDs, colliders or saves.
 */

/** A face this far past a wall is tested for being inside the building. */
const FACE_PROBE = 0.05

/**
 * A building wall piece: brick on the face outside the building, plaster on the face inside; a
 * partition (both faces inside) is plaster all over. Only the two broad faces are tested (across the
 * wall's thin axis); its end faces (house corners, the jambs of an opening) stay brick on an outer
 * wall. The top (seen when the cutaway lowers the wall) and bottom follow the inside.
 */
export function wallSurface(center: { x: number; z: number }, size: readonly [number, number, number], building: BuildingInfo): SurfaceSpec {
  const inside = (x: number, z: number) => isInsideBuilding(building, x, z)
  const thinX = size[0] <= size[2]
  const h = (thinX ? size[0] : size[2]) / 2 + FACE_PROBE
  const plus = thinX ? inside(center.x + h, center.z) : inside(center.x, center.z + h)
  const minus = thinX ? inside(center.x - h, center.z) : inside(center.x, center.z - h)
  if (plus && minus) return { a: 'plaster' }
  let faces = 0
  if (plus) faces |= thinX ? FACE.px : FACE.pz
  if (minus) faces |= thinX ? FACE.nx : FACE.nz
  if (faces) faces |= FACE.py | FACE.ny
  return { a: 'brick', b: 'plaster', faces }
}

/** Walls outside buildings: the world boundary is concrete, other loose blocks (fences, cars) plain. */
export function outdoorSurface(id: string): SurfaceSpec {
  return { a: id.startsWith('world/boundary') ? 'concrete' : 'matte' }
}

/** Upper floor slab: floorboards on top, plaster ceiling and edges. */
export const SLAB_SURFACE: SurfaceSpec = { a: 'plaster', b: 'woodFloor', faces: FACE.py }

/** G2: steps read as steps: floorboard treads, painted risers and sides. */
export const STAIR_SURFACE: SurfaceSpec = { a: 'plaster', b: 'woodFloor', faces: FACE.py }

export const PIECE_SURFACES = {
  floor: { a: 'woodFloor' },
  roof: { a: 'roof' },
  /** G2: the eaves board under a hipped roof (painted trim). */
  fascia: { a: 'matte' },
  furniture: { a: 'matte' },
  trunk: { a: 'bark' },
  canopy: { a: 'foliage' },
  ground: { a: 'grass' },
} as const satisfies Record<string, SurfaceSpec>

/**
 * Road surfaces only have a colour: dark grey is asphalt, warm brown is dirt, anything else light is
 * concrete (sidewalks, yards). A later `visual` field overrides this.
 */
export function roadSurface(color: string): SurfaceId {
  const hex = color.replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const light = (max + min) / 2
  const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * light - 1))
  const hue = max === min ? 0 : max === r ? (((g - b) / (max - min)) % 6) * 60 : max === g ? ((b - r) / (max - min) + 2) * 60 : ((r - g) / (max - min) + 4) * 60
  if (sat > 0.2 && hue >= 15 && hue <= 55) return 'dirt'
  return light < 0.45 ? 'asphalt' : 'concrete'
}
