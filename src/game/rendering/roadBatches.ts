import { roadY, surfaceY, type RoadDef, type SurfaceDef } from '../world/mapData'

/**
 * Road surfaces merged into a few meshes (world generator WG5, §15): one geometry per 128 m cell and
 * per colour (a colour is one surface material), instead of one mesh per road record. The surface
 * shader samples its detail in world coordinates, so merged quads look exactly like separate ones;
 * each quad keeps its own height (`roadY`: draw layer), so overlaps resolve as before. A 500 m
 * generated town has ~1650 road records and ~50 batches; frustum culling works per batch.
 */

export const ROAD_BATCH_CELL = 128

export interface RoadBatch {
  key: string
  color: string
  /** xyz per vertex, 4 vertices per road. */
  positions: Float32Array
  normals: Float32Array
  /** World xz per vertex (the shader does not need it; kept for materials that might). */
  uvs: Float32Array
  indices: Uint32Array
  roads: number
}

export function roadBatches(roads: readonly RoadDef[], cell = ROAD_BATCH_CELL): RoadBatch[] {
  const groups = new Map<string, RoadDef[]>()
  for (const r of roads) {
    const key = `${Math.floor(r.position.x / cell)},${Math.floor(r.position.z / cell)}|${r.color.toLowerCase()}`
    const list = groups.get(key)
    if (list) list.push(r)
    else groups.set(key, [r])
  }
  const out: RoadBatch[] = []
  for (const key of [...groups.keys()].sort()) {
    const list = groups.get(key)!
    const positions = new Float32Array(list.length * 12)
    const normals = new Float32Array(list.length * 12)
    const uvs = new Float32Array(list.length * 8)
    const indices = new Uint32Array(list.length * 6)
    list.forEach((r, i) => {
      const x0 = r.position.x - r.size[0] / 2
      const x1 = r.position.x + r.size[0] / 2
      const z0 = r.position.z - r.size[1] / 2
      const z1 = r.position.z + r.size[1] / 2
      const y = roadY(r)
      positions.set([x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0], i * 12)
      normals.set([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], i * 12)
      uvs.set([x0, z0, x0, z1, x1, z1, x1, z0], i * 8)
      const v = i * 4
      // Counter-clockwise seen from above: the face looks up (+Y) like the rotated planes did.
      indices.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6)
    })
    out.push({ key, color: list[0].color, positions, normals, uvs, indices, roads: list.length })
  }
  return out
}

/** Segments of an ellipse surface (a 24 m pond: edges of about 2.4 m). */
export const ELLIPSE_SEGMENTS = 32

export interface SurfaceBatch extends Omit<RoadBatch, 'roads'> {
  /** Catalog surface of the batch (`grass`, `water` …). */
  surface: string
  surfaces: number
}

/**
 * Prefab library P1: ground surfaces merged like roads, one geometry per 128 m cell, surface and
 * colour. A rectangle is a quad, an ellipse a fan of `ELLIPSE_SEGMENTS` triangles; each keeps its own
 * height (`surfaceY`: its layer, half a millimetre over a road of the same layer).
 */
export function surfaceBatches(surfaces: readonly SurfaceDef[], cell = ROAD_BATCH_CELL): SurfaceBatch[] {
  const groups = new Map<string, SurfaceDef[]>()
  for (const s of surfaces) {
    const key = `${Math.floor(s.position.x / cell)},${Math.floor(s.position.z / cell)}|${s.surface}|${s.color.toLowerCase()}`
    const list = groups.get(key)
    if (list) list.push(s)
    else groups.set(key, [s])
  }
  const out: SurfaceBatch[] = []
  for (const key of [...groups.keys()].sort()) {
    const list = groups.get(key)!
    const positions: number[] = []
    const uvs: number[] = []
    const indices: number[] = []
    for (const s of list) {
      const y = surfaceY(s)
      const hx = s.size[0] / 2
      const hz = s.size[1] / 2
      const v = positions.length / 3
      if (s.shape === 'ellipse') {
        positions.push(s.position.x, y, s.position.z)
        uvs.push(s.position.x, s.position.z)
        for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
          const a = (i / ELLIPSE_SEGMENTS) * Math.PI * 2
          const x = s.position.x + Math.cos(a) * hx
          const z = s.position.z + Math.sin(a) * hz
          positions.push(x, y, z)
          uvs.push(x, z)
          // Counter-clockwise seen from above (+Y up, +Z towards the viewer of the top view).
          indices.push(v, v + 1 + ((i + 1) % ELLIPSE_SEGMENTS), v + 1 + i)
        }
      } else {
        const x0 = s.position.x - hx
        const x1 = s.position.x + hx
        const z0 = s.position.z - hz
        const z1 = s.position.z + hz
        positions.push(x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0)
        uvs.push(x0, z0, x0, z1, x1, z1, x1, z0)
        indices.push(v, v + 1, v + 2, v, v + 2, v + 3)
      }
    }
    const normals = new Float32Array(positions.length)
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1
    out.push({ key, color: list[0].color, surface: list[0].surface, positions: new Float32Array(positions), normals, uvs: new Float32Array(uvs), indices: new Uint32Array(indices), surfaces: list.length })
  }
  return out
}
