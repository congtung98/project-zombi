/**
 * G1 (graphics plan): the shared surface catalog. A surface is a semantic material ID ("brick",
 * "woodFloor") with a physical repeat size, a mapping rule and a detail texture; every textured mesh
 * of the game reads the same catalog, so one wall looks like every other wall of that surface.
 *
 * Textures are **detail maps**: they multiply the content colour (walls keep their `#b9a58c`), with
 * a gain so their average is 1 (a surface does not turn the scene darker or brighter; nothing is
 * fixed by exposure). Pure data: no three.js here (tests, the texture generator and the shader use it).
 *
 * `source` says where the pixels come from. Only `procedural` exists now (generated once, cached, from
 * a fixed seed: `textureGen.ts`); a file-based source can be added in the texture cache without any
 * gameplay change, because content and runtime only ever name the surface ID.
 */

/**
 * How texture coordinates are found: `world` = world position (roads, ground, walls, floors: pieces
 * next to each other continue the pattern), `local` = the object's own box from its lower corner, top
 * face along its longer side (furniture, doors: the grain turns and moves with the object),
 * `triplanar` = world position blended over the three axes (round shapes: trees).
 */
export type SurfaceMapping = 'world' | 'local' | 'triplanar'

export type SurfacePattern =
  | 'plain'
  | 'plaster'
  | 'brick'
  | 'planks'
  | 'grain'
  | 'tiles'
  | 'concrete'
  | 'asphalt'
  | 'dirt'
  | 'shingles'
  | 'grass'
  | 'bark'
  | 'foliage'
  | 'fabric'
  | 'metal'

export interface SurfaceDef {
  id: SurfaceId
  label: string
  /** Metres covered by one repeat of the texture along u and v (texel scale stays physical). */
  tile: readonly [number, number]
  mapping: SurfaceMapping
  /** PBR roughness (outdoors only: the room light indoors ignores it). No surface is metallic. */
  roughness: number
  /** 0 = flat (the content colour only), 1 = the full detail map. Tunes contrast without regenerating. */
  strength: number
  source: { kind: 'procedural'; pattern: SurfacePattern; seed: number }
}

/** Order = texture array layer; at most 16 (the per-instance code keeps 4 bits per surface). */
export const SURFACE_IDS = [
  'matte',
  'plaster',
  'brick',
  'woodFloor',
  'wood',
  'tile',
  'concrete',
  'asphalt',
  'dirt',
  'roof',
  'grass',
  'bark',
  'foliage',
  'fabric',
  'paintedMetal',
] as const
export type SurfaceId = (typeof SURFACE_IDS)[number]

export const SURFACE_LAYER_MAX = 16

const def = (id: SurfaceId, label: string, tile: [number, number], mapping: SurfaceMapping, roughness: number, strength: number, pattern: SurfacePattern, seed: number): SurfaceDef => ({
  id,
  label,
  tile,
  mapping,
  roughness,
  strength,
  source: { kind: 'procedural', pattern, seed },
})

/**
 * Stylised scale (plan §3): courses and planks readable at the gameplay zoom (28 px/m: a 0.25 m brick
 * course is 7 px), not photographic sizes that would shimmer.
 */
export const SURFACES: Record<SurfaceId, SurfaceDef> = {
  matte: def('matte', 'Sơn trơn', [2, 2], 'local', 0.85, 0.5, 'plain', 11),
  plaster: def('plaster', 'Vữa sơn', [2.4, 2.4], 'world', 0.92, 0.7, 'plaster', 23),
  brick: def('brick', 'Gạch', [1.5, 1.5], 'world', 0.9, 0.85, 'brick', 37),
  woodFloor: def('woodFloor', 'Sàn gỗ', [2.4, 2.4], 'world', 0.7, 0.85, 'planks', 41),
  wood: def('wood', 'Gỗ', [1, 1], 'local', 0.65, 0.8, 'grain', 53),
  tile: def('tile', 'Gạch lát', [1.6, 1.6], 'world', 0.45, 0.8, 'tiles', 61),
  concrete: def('concrete', 'Bê tông', [4, 4], 'world', 0.95, 0.8, 'concrete', 71),
  asphalt: def('asphalt', 'Nhựa đường', [4, 4], 'world', 0.97, 0.8, 'asphalt', 83),
  dirt: def('dirt', 'Đất', [4, 4], 'world', 1, 0.8, 'dirt', 97),
  roof: def('roof', 'Mái lợp', [2.4, 2.4], 'world', 0.85, 0.85, 'shingles', 101),
  grass: def('grass', 'Cỏ', [8, 8], 'world', 1, 0.8, 'grass', 113),
  bark: def('bark', 'Vỏ cây', [1.2, 1.2], 'triplanar', 1, 0.8, 'bark', 127),
  foliage: def('foliage', 'Tán lá', [2.5, 2.5], 'triplanar', 1, 0.8, 'foliage', 131),
  fabric: def('fabric', 'Vải', [0.8, 0.8], 'local', 1, 0.6, 'fabric', 139),
  paintedMetal: def('paintedMetal', 'Kim loại sơn', [2, 2], 'local', 0.55, 0.6, 'metal', 149),
}

export const surfaceIndex = (id: SurfaceId): number => SURFACE_IDS.indexOf(id)

/**
 * Faces of an axis-aligned box, as bits of the per-instance code (world axes: batch instances are
 * never rotated, a turned prefab swaps sizes instead).
 */
export const FACE = { px: 1, nx: 2, py: 4, ny: 8, pz: 16, nz: 32 } as const
export const ALL_FACES = 63

/**
 * One piece's surfaces: `a` everywhere, `b` on the faces in `faces` (an outer wall: brick outside,
 * plaster on the faces inside the building).
 */
export interface SurfaceSpec {
  a: SurfaceId
  b?: SurfaceId
  faces?: number
}

/**
 * Pack into one integer (exact in a float32): a | b << 4 | faces << 8 (< 2^14). It rides in the alpha
 * channel of the batch's per-instance colour, so the batch keeps one material and one draw call.
 */
export function packSurface(spec: SurfaceSpec): number {
  const a = surfaceIndex(spec.a)
  const b = surfaceIndex(spec.b ?? spec.a)
  if (a < 0 || b < 0) throw new Error(`unknown surface ${spec.a}/${spec.b}`)
  return a | (b << 4) | ((spec.faces ?? 0) << 8)
}

export function unpackSurface(code: number): { a: SurfaceId; b: SurfaceId; faces: number } {
  return { a: SURFACE_IDS[code & 15], b: SURFACE_IDS[(code >> 4) & 15], faces: code >> 8 }
}
