import {
  MAP_SCHEMA_VERSION,
  RECORD_NAMESPACES,
  type ChunkDocument,
  type PrefabDocument,
  type PrefabEntry,
  type QuarterTurns,
  type Rect,
  type WorldDocument,
  type XZ,
} from '../schema.ts'
import { chunkIdOf, chunkIndex, chunkOrigin, chunksOverlapping, quantize, rotateRect, rotateXZ } from '../transform.ts'
import { blockingSolid, checkWorldDocuments, hasErrors, lowSolids, type ValidationOptions } from '../validate.ts'
import { documentFiles, resolvedRecords, withExternalRefs, type MapDocument } from '../editor/document.ts'

/**
 * Offline town generator (map editor M6). A producer of the same content format as the editor:
 *
 *   seed → street grid → lots → prefab per lot (turned so its door faces the street) → props and
 *   loot piles → one rectangle zombie zone per block → zombie spawns outdoors → player spawn on a
 *   crossing → validate.
 *
 * Deterministic: the same options, catalog and `GENERATOR_VERSION` give byte-identical files (own
 * PRNG, fixed iteration order, no time or `Math.random`). IDs are derived from the layout
 * (`lot-<i>-<j>-<k>`, `block-<i>-<j>`…) under the owner chunk. The output is an ordinary document:
 * open it in the editor, edit by hand, export. Regenerating never merges into edited content
 * (`scripts/map-tools/generate.ts` refuses to overwrite a hand-edited world).
 */

export const GENERATOR_NAME = 'town-grid'
/** Bump when the output for the same options changes. */
export const GENERATOR_VERSION = 1

export interface GeneratorOptions {
  worldId: string
  name: string
  seed: number
  /** Blocks along X and Z (1..4). */
  blocksX: number
  blocksZ: number
}

export interface Catalog {
  /** Label stored in `world.generator.catalog`, e.g. `neighborhood-50@1`. */
  id: string
  prefabs: { entry: PrefabEntry; doc: PrefabDocument }[]
}

const CHUNK = 32
const BLOCK = 28
const ROAD = 4
const LOT = BLOCK / 2
/** Front yard between the street edge and the building. */
const FRONT = 2.5
const ROAD_COLOR = '#3a3a3f'

/** mulberry32: small, fast, deterministic across platforms. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Side = 'N' | 'S' | 'E' | 'W'
const SIDE_VEC: Record<Side, XZ> = { N: { x: 0, z: -1 }, S: { x: 0, z: 1 }, E: { x: 1, z: 0 }, W: { x: -1, z: 0 } }

/** The footprint side a prefab's first door sits on (null = no door: not a lot building). */
export function doorSide(p: PrefabDocument): Side | null {
  const door = p.objects.find((o) => o.kind === 'door')
  if (!door) return null
  const f = p.footprint
  const dx = (door.position.x - (f.minX + f.maxX) / 2) / ((f.maxX - f.minX) / 2)
  const dz = (door.position.z - (f.minZ + f.maxZ) / 2) / ((f.maxZ - f.minZ) / 2)
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? 'E' : 'W'
  return dz >= 0 ? 'S' : 'N'
}

/** Quarter turns that bring side `from` to side `to`. */
function turnsBetween(from: Side, to: Side): QuarterTurns {
  const v = SIDE_VEC[from]
  const w = SIDE_VEC[to]
  for (let q = 0; q < 4; q++) {
    const [x, z] = rotateXZ(v.x, v.z, q)
    if (x === w.x && z === w.z) return q as QuarterTurns
  }
  return 0
}

type AnyRecord = Record<string, unknown>
type Category = 'instances' | 'objects' | 'roads' | 'zones' | 'spawns'

class Builder {
  readonly chunks = new Map<string, ChunkDocument>()
  constructor(half: number) {
    for (const { cx, cz } of chunksOverlapping({ minX: -half, minZ: -half, maxX: half, maxZ: half }, CHUNK)) {
      const chunkId = chunkIdOf(cx, cz)
      this.chunks.set(chunkId, { schemaVersion: MAP_SCHEMA_VERSION, contentVersion: 1, chunkId, cx, cz, instances: [], objects: [], roads: [], zones: [], spawns: [], externalRefs: [] })
    }
  }

  /** Add a record anchored at world point `p`; returns its stable ID. */
  add(category: Category, name: string, p: XZ, make: (id: string, local: XZ) => AnyRecord): string {
    const cx = chunkIndex(p.x, CHUNK)
    const cz = chunkIndex(p.z, CHUNK)
    const chunk = this.chunks.get(chunkIdOf(cx, cz))
    if (!chunk) throw new Error(`generator: ${name} at (${p.x}, ${p.z}) is outside the play area`)
    const o = chunkOrigin(cx, cz, CHUNK)
    const local = { x: quantize(p.x - o.x), z: quantize(p.z - o.z) }
    const id = category === 'instances' ? `${chunk.chunkId}/${name}` : `${chunk.chunkId}/${RECORD_NAMESPACES[category]}/${name}`
    ;(chunk[category] as unknown as AnyRecord[]).push(make(id, local))
    return id
  }
}

const prop = (id: string, local: XZ, size: [number, number, number], color: string): AnyRecord => ({ kind: 'prop', objectId: id, position: { x: local.x, y: size[1] / 2, z: local.z }, size, color })

function overlaps(a: Rect, b: Rect, margin = 0): boolean {
  return a.minX < b.maxX + margin && b.minX < a.maxX + margin && a.minZ < b.maxZ + margin && b.minZ < a.maxZ + margin
}

/** Build a town. Throws if the result does not validate (a generator bug, never silently shipped). */
export function generateTown(opts: GeneratorOptions, catalog: Catalog, validation: ValidationOptions = {}): MapDocument {
  if (!(Number.isInteger(opts.blocksX) && Number.isInteger(opts.blocksZ) && opts.blocksX >= 1 && opts.blocksZ >= 1 && opts.blocksX <= 4 && opts.blocksZ <= 4)) {
    throw new Error('generator: blocksX/blocksZ must be integers 1..4')
  }
  if (!Number.isInteger(opts.seed)) throw new Error('generator: seed must be an integer')
  const random = rng(opts.seed)
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]
  const W = opts.blocksX * BLOCK + (opts.blocksX + 1) * ROAD
  const D = opts.blocksZ * BLOCK + (opts.blocksZ + 1) * ROAD
  const size = Math.max(W, D)
  const x0 = -W / 2
  const z0 = -D / 2
  const b = new Builder(size / 2)

  // 1. Streets: one along every block edge; crossings are shared (same colour, no flicker).
  const roadX = (k: number) => x0 + ROAD / 2 + k * (BLOCK + ROAD)
  const roadZ = (j: number) => z0 + ROAD / 2 + j * (BLOCK + ROAD)
  for (let k = 0; k <= opts.blocksX; k++) b.add('roads', `road-x-${k}`, { x: roadX(k), z: 0 }, (id, local) => ({ roadId: id, position: local, size: [ROAD, D], color: ROAD_COLOR }))
  for (let j = 0; j <= opts.blocksZ; j++) b.add('roads', `road-z-${j}`, { x: 0, z: roadZ(j) }, (id, local) => ({ roadId: id, position: local, size: [W, ROAD], color: ROAD_COLOR }))

  // 2. Lots: 2 × 2 per block; north lots face the street north of the block, south lots the one south.
  const buildings = catalog.prefabs.filter((p) => p.doc.building && doorSide(p.doc))
  const weights = buildings.map((p) => (p.doc.prefabId.includes('house') ? 2 : 1))
  const footprints: Rect[] = []
  for (let j = 0; j < opts.blocksZ; j++) {
    for (let i = 0; i < opts.blocksX; i++) {
      const bx = x0 + ROAD + i * (BLOCK + ROAD)
      const bz = z0 + ROAD + j * (BLOCK + ROAD)
      for (let k = 0; k < 4; k++) {
        const lot = { minX: bx + (k % 2) * LOT, minZ: bz + Math.floor(k / 2) * LOT, maxX: bx + (k % 2 + 1) * LOT, maxZ: bz + (Math.floor(k / 2) + 1) * LOT }
        const north = k < 2
        const face: Side = north ? 'N' : 'S'
        const name = `${i}-${j}-${k}`
        let footprint: Rect | null = null
        if (random() >= 0.15 && buildings.length) {
          // Weighted choice, then the first that fits in catalog order (deterministic fallback).
          let roll = random() * weights.reduce((a, c) => a + c, 0)
          let first = 0
          for (let n = 0; n < weights.length; n++) {
            roll -= weights[n]
            if (roll <= 0) {
              first = n
              break
            }
          }
          for (let n = 0; n < buildings.length && !footprint; n++) {
            const p = buildings[(first + n) % buildings.length].doc
            const q = turnsBetween(doorSide(p)!, face)
            const f = p.footprint
            const r = rotateRect({ minX: f.minX - p.pivot.x, minZ: f.minZ - p.pivot.z, maxX: f.maxX - p.pivot.x, maxZ: f.maxZ - p.pivot.z }, q)
            const w = r.maxX - r.minX
            const d = r.maxZ - r.minZ
            if (w > LOT - 2 || d > LOT - FRONT - 1) continue
            const cx = (lot.minX + lot.maxX) / 2
            const cz = north ? lot.minZ + FRONT + d / 2 : lot.maxZ - FRONT - d / 2
            const at = { x: quantize(cx - (r.minX + r.maxX) / 2), z: quantize(cz - (r.minZ + r.maxZ) / 2) }
            b.add('instances', `lot-${name}`, at, (id, local) => ({ instanceId: id, prefabId: p.prefabId, position: { x: local.x, y: 0, z: local.z }, quarterTurns: q }))
            footprint = { minX: at.x + r.minX, minZ: at.z + r.minZ, maxX: at.x + r.maxX, maxZ: at.z + r.maxZ }
            footprints.push(footprint)
          }
        }
        // 3. Props: a back fence on north lots, crates beside the house, sometimes a scrap pile.
        const back = north ? lot.maxZ - 0.6 : lot.minZ + 0.6
        if (north && random() < 0.6) b.add('objects', `fence-${name}`, { x: (lot.minX + lot.maxX) / 2, z: back }, (id, local) => prop(id, local, [LOT - 2, 1, 0.15], '#7a6a55'))
        const spots = [
          { x: lot.minX + 1, z: north ? lot.minZ + 1.2 : lot.maxZ - 1.2 },
          { x: lot.maxX - 1, z: north ? lot.minZ + 1.2 : lot.maxZ - 1.2 },
          { x: lot.minX + 1.2, z: back + (north ? -1.2 : 1.2) },
          { x: lot.maxX - 1.2, z: back + (north ? -1.2 : 1.2) },
        ]
        let crates = footprint ? Math.floor(random() * 3) : 2 + Math.floor(random() * 2)
        let m = 0
        for (const s of spots) {
          if (crates <= 0) break
          const box = { minX: s.x - 0.5, minZ: s.z - 0.5, maxX: s.x + 0.5, maxZ: s.z + 0.5 }
          if (footprint && overlaps(box, footprint, 0.8)) continue
          if (random() < 0.5) continue
          b.add('objects', `crate-${name}-${++m}`, s, (id, local) => prop(id, local, [1, 1, 1], '#a67c52'))
          crates--
        }
        if (random() < (footprint ? 0.25 : 0.6)) {
          const s = { x: (lot.minX + lot.maxX) / 2 + (random() < 0.5 ? -3 : 3), z: back + (north ? -1.5 : 1.5) }
          const box = { minX: s.x - 0.7, minZ: s.z - 0.5, maxX: s.x + 0.7, maxZ: s.z + 0.5 }
          if (!footprint || !overlaps(box, footprint, 0.8)) {
            b.add('objects', `scrap-${name}`, s, (id, local) => ({ kind: 'container', objectId: id, name: 'Đống phế liệu', position: { x: local.x, y: 0.4, z: local.z }, size: [1.4, 0.8, 1], color: '#6b6f73', lootTableId: 'scrap-pile' }))
          }
        }
      }
      // 4. One zombie zone per block.
      b.add('zones', `block-${i}-${j}`, { x: bx + BLOCK / 2, z: bz + BLOCK / 2 }, (id, local) => ({ zoneId: id, kind: 'zombiePopulation', name: `Khối ${i + 1}-${j + 1}`, shape: 'rect', center: local, size: [BLOCK - 2, BLOCK - 2] }))
    }
  }
  // Parked cars on the street between two crossings (never on a crossing: the player starts there).
  for (let k = 0; k <= opts.blocksX; k++) {
    for (let j = 0; j < opts.blocksZ; j++) {
      if (random() >= 0.3) continue
      const side = random() < 0.5 ? -1 : 1
      b.add('objects', `car-x-${k}-${j}`, { x: roadX(k) + side, z: roadZ(j) + (BLOCK + ROAD) / 2 }, (id, local) => prop(id, local, [2, 1.4, 4], pick(['#7a3b3b', '#3b5a7a', '#5a5a52'])))
    }
  }

  // 5. Spawns, checked against the resolved colliders and building footprints.
  const player = [...Array(opts.blocksX + 1).keys()].flatMap((k) => [...Array(opts.blocksZ + 1).keys()].map((j) => ({ x: roadX(k), z: roadZ(j) }))).sort((a, c) => Math.hypot(a.x, a.z) - Math.hypot(c.x, c.z) || a.x - c.x || a.z - c.z)[0]
  const playerId = b.add('spawns', 'player-start', player, (id, local) => ({ spawnId: id, kind: 'player', position: local }))
  const draft = assemble(opts, catalog, b, size, playerId)
  const solids = lowSolids(resolvedRecords(draft))
  for (let j = 0; j < opts.blocksZ; j++) {
    for (let i = 0; i < opts.blocksX; i++) {
      const bx = x0 + ROAD + i * (BLOCK + ROAD)
      const bz = z0 + ROAD + j * (BLOCK + ROAD)
      const candidates = [
        { x: bx + 1.5, z: bz + BLOCK / 2 },
        { x: bx + BLOCK - 1.5, z: bz + BLOCK / 2 },
        { x: bx + BLOCK / 2, z: bz + BLOCK / 2 },
        { x: bx + LOT / 2, z: bz + BLOCK / 2 },
        { x: bx + LOT + LOT / 2, z: bz + BLOCK / 2 },
      ]
      let n = 0
      const start = Math.floor(random() * candidates.length)
      for (let c = 0; c < candidates.length && n < 2; c++) {
        const p = candidates[(start + c) % candidates.length]
        if (blockingSolid(solids, p)) continue
        if (footprints.some((f) => p.x > f.minX - 0.5 && p.x < f.maxX + 0.5 && p.z > f.minZ - 0.5 && p.z < f.maxZ + 0.5)) continue
        b.add('spawns', `zombie-${i}-${j}-${++n}`, p, (id, local) => ({ spawnId: id, kind: 'zombie', position: local }))
      }
    }
  }
  const doc = assemble(opts, catalog, b, size, playerId)
  const files = new Map(documentFiles(doc))
  const checked = checkWorldDocuments((path) => files.get(path), validation)
  if (hasErrors(checked.issues)) {
    const e = checked.issues.filter((i) => i.severity === 'error').slice(0, 3)
    throw new Error(`generator produced invalid content: ${e.map((i) => `${i.code} ${i.path} ${i.message}`).join('; ')}`)
  }
  return doc
}

function assemble(opts: GeneratorOptions, catalog: Catalog, b: Builder, size: number, playerSpawn: string): MapDocument {
  const chunks = [...b.chunks.values()].sort((a, c) => a.cz - c.cz || a.cx - c.cx)
  const world: WorldDocument = {
    schemaVersion: MAP_SCHEMA_VERSION,
    worldId: opts.worldId,
    name: opts.name,
    contentVersion: 1,
    chunkSize: CHUNK,
    coordinateSystem: 'y-up-xz-meters',
    playArea: { size },
    boundary: { height: 2, thickness: 1 },
    chunkBounds: {
      minCx: Math.min(...chunks.map((c) => c.cx)),
      maxCx: Math.max(...chunks.map((c) => c.cx)),
      minCz: Math.min(...chunks.map((c) => c.cz)),
      maxCz: Math.max(...chunks.map((c) => c.cz)),
    },
    chunks: chunks.map((c) => ({ chunkId: c.chunkId, cx: c.cx, cz: c.cz, path: `chunks/${c.chunkId}.json` })),
    prefabs: catalog.prefabs.map((p) => ({ ...p.entry })),
    playerSpawn,
    generator: { name: GENERATOR_NAME, version: GENERATOR_VERSION, seed: opts.seed, params: { blocksX: opts.blocksX, blocksZ: opts.blocksZ }, catalog: catalog.id },
  }
  const copy = new Map(chunks.map((c) => [c.chunkId, structuredClone(c)]))
  return withExternalRefs({ world, prefabs: new Map(catalog.prefabs.map((p) => [p.entry.prefabId, p.doc])), chunks: copy, extras: new Map() })
}
