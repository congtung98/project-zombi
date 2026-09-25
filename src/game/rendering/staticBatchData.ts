import { Vector3 } from 'three'
import { chunkIndex } from '../../map/transform'
import type { MapData } from '../world/mapData'
import type { StaticColliderRegistry } from '../world/staticColliders'

/**
 * R3b: what `StaticBatches` draws, as plain data: every wall/prop box (from the collider registry),
 * container body, building floor and roof, and how they fall into chunks.
 */

/** Khối cao hơn ngưỡng này mới được làm mờ khi che nhân vật. */
const OCCLUDER_MIN_HEIGHT = 1.5
const DEFAULT_WALL_COLOR = '#5a5650'
const ROOF_THICKNESS = 0.2
const ROOF_OVERHANG = 0.3
/** Floors sit just above the ground plane. */
const FLOOR_Y = 0.02
/** Box sizes come back from min/max: round away float noise so equal pieces share one geometry. */
const round = (v: number) => Math.round(v * 1e6) / 1e6

export type Shape = 'box' | 'floor'

export interface StaticItem {
  shape: Shape
  center: Vector3
  /** Box size, or floor size with y ignored. */
  size: [number, number, number]
  color: string
  /** Tall wall or roof: fades when it hides the player. */
  occluder: boolean
  /** Roof of this building (hidden while the player is inside it). */
  roofOf?: string
}

/** Everything static to draw, from runtime data (colliders, containers, buildings). */
export function collectStaticItems(map: MapData, colliders: StaticColliderRegistry): StaticItem[] {
  const items: StaticItem[] = []
  for (const w of colliders.list('wall')) {
    const size: [number, number, number] = [round(w.max.x - w.min.x), round(w.max.y - w.min.y), round(w.max.z - w.min.z)]
    items.push({
      shape: 'box',
      center: new Vector3((w.min.x + w.max.x) / 2, (w.min.y + w.max.y) / 2, (w.min.z + w.max.z) / 2),
      size,
      color: w.color ?? DEFAULT_WALL_COLOR,
      occluder: size[1] >= OCCLUDER_MIN_HEIGHT,
    })
  }
  for (const c of map.containers) {
    items.push({ shape: 'box', center: new Vector3(c.position.x, c.position.y, c.position.z), size: [...c.size], color: c.color, occluder: false })
  }
  for (const b of map.buildings) {
    const { w, d } = b.size
    items.push({ shape: 'floor', center: new Vector3(b.center.x, FLOOR_Y, b.center.z), size: [w, 0, d], color: b.floorColor, occluder: false })
    items.push({
      shape: 'box',
      center: new Vector3(b.center.x, b.height + ROOF_THICKNESS / 2, b.center.z),
      size: [w + ROOF_OVERHANG * 2, ROOF_THICKNESS, d + ROOF_OVERHANG * 2],
      color: b.roofColor,
      // Mái cũng là vật che: khi người chơi đứng ngoài, sát tường phía trên màn hình, mái nằm giữa camera và nhân vật.
      occluder: true,
      roofOf: b.id,
    })
  }
  return items
}

/** Items per chunk key `cx,cz` (chunk of the item centre), in collection order. */
export function groupByChunk(items: StaticItem[], chunkSize: number): Map<string, StaticItem[]> {
  const byChunk = new Map<string, StaticItem[]>()
  for (const item of items) {
    const key = `${chunkIndex(item.center.x, chunkSize)},${chunkIndex(item.center.z, chunkSize)}`
    const list = byChunk.get(key)
    if (list) list.push(item)
    else byChunk.set(key, [item])
  }
  return byChunk
}
