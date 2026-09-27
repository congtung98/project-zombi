import { roadY, type RoadDef } from '../world/mapData'

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
