import type { ContainerDef, DoorPlacement, LampPlacement, WindowPlacement } from '../world/buildings'
import { mapRooms, mapWindows, type MapData } from '../world/mapData'
import { chunkKey } from './viewChunks'
import { chunkIndex } from '../../map/transform'

/**
 * M10: the map's interactive views by chunk (chunk of the door centre, container, window pane,
 * lamp fixture), so the scene mounts only those of the shown chunks. Built once per map.
 */
export interface ChunkEntities {
  doors: DoorPlacement[]
  containers: ContainerDef[]
  windows: WindowPlacement[]
  lamps: LampPlacement[]
}

export function indexChunkEntities(map: MapData, chunkSize: number): Map<string, ChunkEntities> {
  const index = new Map<string, ChunkEntities>()
  const at = (x: number, z: number): ChunkEntities => {
    const key = chunkKey(chunkIndex(x, chunkSize), chunkIndex(z, chunkSize))
    let e = index.get(key)
    if (!e) index.set(key, (e = { doors: [], containers: [], windows: [], lamps: [] }))
    return e
  }
  for (const d of map.doors) at(d.center.x, d.center.z).doors.push(d)
  for (const c of map.containers) at(c.position.x, c.position.z).containers.push(c)
  for (const w of mapWindows(map)) at(w.center.x, w.center.z).windows.push(w)
  for (const r of mapRooms(map)) if (r.lamp) at(r.lamp.position.x, r.lamp.position.z).lamps.push(r.lamp)
  return index
}
