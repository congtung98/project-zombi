import {
  MAP_SCHEMA_VERSION,
  RECORD_CATEGORIES,
  RECORD_NAMESPACES,
  recordId,
  type ChunkDocument,
  type RecordCategory,
  type WorldDocument,
  type XZ,
} from '../schema.ts'
import { chunkIdOf, chunkIndex, chunkOrigin, chunksOverlapping, parseRecordId, quantize } from '../transform.ts'
import { computeExternalRefs, type WorldDocuments } from '../validate.ts'

/**
 * Offline-style generator: tile a world N × N (spacing = its play area), re-homing every record
 * into the chunk grid of the larger world. IDs get a `t<i>-<j>-` name prefix under the new owner
 * chunk; prefabs are shared. Only tile (0, 0) keeps the player spawn; `extraZombieSpawns`
 * (tile-centre coordinates) are added to every tile. Deterministic: same input → same output.
 */

export interface TileOptions {
  worldId: string
  name: string
  tiles: number
  extraZombieSpawns?: XZ[]
}

type AnyRecord = Record<string, unknown>

function anchorOf(category: RecordCategory, r: AnyRecord): XZ {
  return (category === 'zones' ? r.center : r.position) as XZ
}

export function tileWorld(base: WorldDocuments, opts: TileOptions): WorldDocuments {
  const n = opts.tiles
  const S = base.world.chunkSize
  const tile = base.world.playArea.size
  const size = tile * n
  const half = size / 2
  const grid = chunksOverlapping({ minX: -half, minZ: -half, maxX: half, maxZ: half }, S)
  const chunks = new Map<string, ChunkDocument>()
  for (const { cx, cz } of grid) {
    const chunkId = chunkIdOf(cx, cz)
    chunks.set(chunkId, { schemaVersion: MAP_SCHEMA_VERSION, contentVersion: 1, chunkId, cx, cz, instances: [], objects: [], roads: [], zones: [], spawns: [], externalRefs: [] })
  }
  const place = (p: XZ) => {
    const cx = chunkIndex(p.x, S)
    const cz = chunkIndex(p.z, S)
    const o = chunkOrigin(cx, cz, S)
    return { chunk: chunks.get(chunkIdOf(cx, cz))!, local: { x: quantize(p.x - o.x), z: quantize(p.z - o.z) } }
  }
  const idKey = { instances: 'instanceId', objects: 'objectId', roads: 'roadId', zones: 'zoneId', spawns: 'spawnId' } as const
  let playerSpawn = ''
  let zombies = 0

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const prefix = `t${i}-${j}-`
      const dx = (i - (n - 1) / 2) * tile
      const dz = (j - (n - 1) / 2) * tile
      for (const entry of base.world.chunks) {
        const src = base.chunks.get(entry.chunkId)!
        const origin = chunkOrigin(src.cx, src.cz, S)
        for (const category of RECORD_CATEGORIES) {
          for (const record of src[category] as unknown as AnyRecord[]) {
            if (category === 'spawns' && record.kind === 'player' && (i !== 0 || j !== 0)) continue
            const a = anchorOf(category, record)
            const { chunk, local } = place({ x: origin.x + a.x + dx, z: origin.z + a.z + dz })
            const namespace = category === 'instances' ? null : RECORD_NAMESPACES[category]
            const name = parseRecordId(recordId(category, record), namespace)!.name
            const id = namespace ? `${chunk.chunkId}/${namespace}/${prefix}${name}` : `${chunk.chunkId}/${prefix}${name}`
            const copy: AnyRecord = { ...structuredClone(record), [idKey[category]]: id }
            if (category === 'zones') copy.center = local
            else copy.position = category === 'instances' || category === 'objects' ? { ...(record.position as object), x: local.x, z: local.z } : local
            if (category === 'spawns') {
              if (record.kind === 'player') playerSpawn = id
              else zombies++
            }
            ;(chunk[category] as unknown as AnyRecord[]).push(copy)
          }
        }
      }
      ;(opts.extraZombieSpawns ?? []).forEach((p, k) => {
        const { chunk, local } = place({ x: p.x + dx, z: p.z + dz })
        chunk.spawns.push({ spawnId: `${chunk.chunkId}/spawns/${prefix}extra-${k + 1}`, kind: 'zombie', position: local })
        zombies++
      })
    }
  }

  const world: WorldDocument = {
    schemaVersion: MAP_SCHEMA_VERSION,
    worldId: opts.worldId,
    name: opts.name,
    contentVersion: 1,
    chunkSize: S,
    coordinateSystem: 'y-up-xz-meters',
    playArea: { size },
    boundary: base.world.boundary,
    chunkBounds: {
      minCx: Math.min(...grid.map((c) => c.cx)),
      maxCx: Math.max(...grid.map((c) => c.cx)),
      minCz: Math.min(...grid.map((c) => c.cz)),
      maxCz: Math.max(...grid.map((c) => c.cz)),
    },
    chunks: [...chunks.values()].map((c) => ({ chunkId: c.chunkId, cx: c.cx, cz: c.cz, path: `chunks/${c.chunkId}.json` })),
    prefabs: base.world.prefabs.map((p) => ({ ...p })),
    playerSpawn,
    gameplay: { maxActiveZombies: zombies },
  }
  const docs: WorldDocuments = { world, prefabs: base.prefabs, chunks }
  for (const [chunkId, refs] of computeExternalRefs(docs)) chunks.get(chunkId)!.externalRefs = refs
  return docs
}

/** In-memory reader over documents (for `loadWorldDocuments`). */
export function documentReader(docs: WorldDocuments): (path: string) => unknown {
  const files = new Map<string, unknown>([['world.json', docs.world]])
  for (const e of docs.world.prefabs) files.set(e.path, docs.prefabs.get(e.prefabId))
  for (const e of docs.world.chunks) files.set(e.path, docs.chunks.get(e.chunkId))
  return (path) => {
    if (!files.has(path)) throw new Error(`Missing ${path}`)
    return files.get(path)
  }
}
