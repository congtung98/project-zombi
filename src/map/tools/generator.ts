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
 * Offline town generator (map editor M6, layouts and trees M9). A producer of the same content
 * format as the editor:
 *
 *   seed → street grid (equal blocks, or varied block sizes with parks) → lots → prefab per lot
 *   (turned so its door faces the street) → props and loot piles → one rectangle zombie zone per
 *   block → trees (own random stream) → zombie spawns outdoors → player spawn on a crossing →
 *   validate.
 *
 * Deterministic: the same options, catalog and `GENERATOR_VERSION` give byte-identical files (own
 * PRNG, fixed iteration order, no time or `Math.random`). IDs are derived from the layout
 * (`lot-<i>-<j>-<k>`, `block-<i>-<j>`…) under the owner chunk. The output is an ordinary document:
 * open it in the editor, edit by hand, export. Regenerating never merges into edited content
 * (`scripts/map-tools/generate.ts` refuses to overwrite a hand-edited world).
 */

export const GENERATOR_NAME = 'town-grid'
/** Bump when the output for the same options changes (v2, M9: layouts, trees, rectangular play area). */
export const GENERATOR_VERSION = 2
/** Largest town: 16 × 16 blocks (about 500 × 500 m, ~290 chunks). */
export const MAX_BLOCKS = 16

export const LAYOUTS = ['grid', 'varied'] as const
export type Layout = (typeof LAYOUTS)[number]
/** Default tree density (street, yard and park trees). */
export const DEFAULT_TREES = 0.5

export interface GeneratorOptions {
  worldId: string
  name: string
  seed: number
  /** Blocks along X and Z (1..`MAX_BLOCKS`; M10 streaming made 16 × 16, ~500 m, playable). */
  blocksX: number
  blocksZ: number
  /**
   * `grid` (default): equal 28 m blocks, 2 × 2 lots each. `varied`: blocks of 22, 28 or 34 m,
   * 1–3 lots per street side of uneven width, about one block in five a park.
   */
  layout?: Layout
  /** Tree density 0..1 (default `DEFAULT_TREES`); 0 = no trees. */
  trees?: number
}

export interface Catalog {
  /** Label stored in `world.generator.catalog`, e.g. `neighborhood-50@1`. */
  id: string
  prefabs: { entry: PrefabEntry; doc: PrefabDocument }[]
}

const CHUNK = 32
const BLOCK = 28
const ROAD = 4
/** Block sizes of the varied layout. */
const VARIED_BLOCKS = [22, 28, 34] as const
/** Narrowest lot of the varied layout (the smallest building plus 2 m). */
const MIN_LOT = 11
const PARK_CHANCE = 0.2
const TREE_COLORS = ['#3f6b35', '#4a7a3a', '#35602f', '#5b7f3a'] as const
const PINE_COLORS = ['#2f5a3a', '#28503a', '#355f40'] as const
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
  constructor(area: Rect) {
    for (const { cx, cz } of chunksOverlapping(area, CHUNK)) {
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
  if (!(Number.isInteger(opts.blocksX) && Number.isInteger(opts.blocksZ) && opts.blocksX >= 1 && opts.blocksZ >= 1 && opts.blocksX <= MAX_BLOCKS && opts.blocksZ <= MAX_BLOCKS)) {
    throw new Error(`generator: blocksX/blocksZ must be integers 1..${MAX_BLOCKS}`)
  }
  if (!Number.isInteger(opts.seed)) throw new Error('generator: seed must be an integer')
  const layout = opts.layout ?? 'grid'
  if (!LAYOUTS.includes(layout)) throw new Error(`generator: layout must be ${LAYOUTS.join(' or ')}`)
  const density = opts.trees ?? DEFAULT_TREES
  if (!(Number.isFinite(density) && density >= 0 && density <= 1)) throw new Error('generator: trees must be 0..1')
  const random = rng(opts.seed)
  // Trees draw from their own stream: the density never changes the rest of the town.
  const treeRandom = rng((opts.seed ^ 0x5bd1e995) >>> 0)
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]

  // 1. Street grid: block sizes per column/row (varied: 22, 28 or 34 m), a street along every edge.
  const widths = [...Array(opts.blocksX).keys()].map(() => (layout === 'varied' ? pick(VARIED_BLOCKS) : BLOCK))
  const depths = [...Array(opts.blocksZ).keys()].map(() => (layout === 'varied' ? pick(VARIED_BLOCKS) : BLOCK))
  const W = widths.reduce((a, c) => a + c, 0) + (opts.blocksX + 1) * ROAD
  const D = depths.reduce((a, c) => a + c, 0) + (opts.blocksZ + 1) * ROAD
  const x0 = -W / 2
  const z0 = -D / 2
  const area = { minX: x0, minZ: z0, maxX: -x0, maxZ: -z0 }
  const b = new Builder(area)
  const roadX = (k: number) => x0 + ROAD / 2 + widths.slice(0, k).reduce((a, c) => a + c, 0) + k * ROAD
  const roadZ = (j: number) => z0 + ROAD / 2 + depths.slice(0, j).reduce((a, c) => a + c, 0) + j * ROAD
  for (let k = 0; k <= opts.blocksX; k++) b.add('roads', `road-x-${k}`, { x: roadX(k), z: 0 }, (id, local) => ({ roadId: id, position: local, size: [ROAD, D], color: ROAD_COLOR }))
  for (let j = 0; j <= opts.blocksZ; j++) b.add('roads', `road-z-${j}`, { x: 0, z: roadZ(j) }, (id, local) => ({ roadId: id, position: local, size: [W, ROAD], color: ROAD_COLOR }))

  // Varied towns turn some blocks into parks (never all of them).
  const blocks = [...Array(opts.blocksZ).keys()].flatMap((j) => [...Array(opts.blocksX).keys()].map((i) => ({ i, j })))
  const parks = new Set<string>()
  if (layout === 'varied' && blocks.length > 1) {
    for (const { i, j } of blocks) if (random() < PARK_CHANCE) parks.add(`${i}-${j}`)
    if (parks.size === blocks.length) parks.delete(`${blocks[0].i}-${blocks[0].j}`)
  }

  // 2. Lots and buildings. Lots face the street on the north or south side of their block.
  const buildings = catalog.prefabs.filter((p) => p.doc.building && doorSide(p.doc))
  const weights = buildings.map((p) => (p.doc.prefabId.includes('house') ? 2 : 1))
  const footprints: Rect[] = []
  /** Low solids placed so far (props, containers) for the tree pass. */
  const solids: Rect[] = []
  const lotsByBlock = new Map<string, Rect[]>()
  const blockRect = (i: number, j: number): Rect => {
    const bx = roadX(i) + ROAD / 2
    const bz = roadZ(j) + ROAD / 2
    return { minX: bx, minZ: bz, maxX: bx + widths[i], maxZ: bz + depths[j] }
  }
  for (const { i, j } of blocks) {
    const block = blockRect(i, j)
    const bw = widths[i]
    const bd = depths[j]
    if (parks.has(`${i}-${j}`)) {
      // Park: benches along the paths; trees come in the tree pass.
      for (let n = 0; n < 4; n++) {
        const s = { x: block.minX + bw * (n % 2 ? 0.75 : 0.25), z: block.minZ + bd * (n < 2 ? 0.3 : 0.7) }
        if (random() < 0.6) {
          b.add('objects', `bench-${i}-${j}-${n + 1}`, s, (id, local) => prop(id, local, [1.6, 0.5, 0.5], '#6d5a44'))
          solids.push(rectAt(s, 1.6, 0.5))
        }
      }
    } else {
      for (const lot of lotsOfBlock(block, layout, random)) {
        lotsByBlock.set(`${i}-${j}`, [...(lotsByBlock.get(`${i}-${j}`) ?? []), lot.rect])
        const { rect, north, name: k } = lot
        const lotW = rect.maxX - rect.minX
        const lotD = rect.maxZ - rect.minZ
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
            if (w > lotW - 2 || d > lotD - FRONT - 1) continue
            const cx = (rect.minX + rect.maxX) / 2
            const cz = north ? rect.minZ + FRONT + d / 2 : rect.maxZ - FRONT - d / 2
            const at = { x: quantize(cx - (r.minX + r.maxX) / 2), z: quantize(cz - (r.minZ + r.maxZ) / 2) }
            b.add('instances', `lot-${name}`, at, (id, local) => ({ instanceId: id, prefabId: p.prefabId, position: { x: local.x, y: 0, z: local.z }, quarterTurns: q }))
            footprint = { minX: at.x + r.minX, minZ: at.z + r.minZ, maxX: at.x + r.maxX, maxZ: at.z + r.maxZ }
            footprints.push(footprint)
          }
        }
        // 3. Props: a back fence on north lots, crates beside the house, sometimes a scrap pile.
        const back = north ? rect.maxZ - 0.6 : rect.minZ + 0.6
        if (north && random() < 0.6) {
          const s = { x: (rect.minX + rect.maxX) / 2, z: back }
          b.add('objects', `fence-${name}`, s, (id, local) => prop(id, local, [lotW - 2, 1, 0.15], '#7a6a55'))
          solids.push(rectAt(s, lotW - 2, 0.15))
        }
        const spots = [
          { x: rect.minX + 1, z: north ? rect.minZ + 1.2 : rect.maxZ - 1.2 },
          { x: rect.maxX - 1, z: north ? rect.minZ + 1.2 : rect.maxZ - 1.2 },
          { x: rect.minX + 1.2, z: back + (north ? -1.2 : 1.2) },
          { x: rect.maxX - 1.2, z: back + (north ? -1.2 : 1.2) },
        ]
        let crates = footprint ? Math.floor(random() * 3) : 2 + Math.floor(random() * 2)
        let m = 0
        for (const s of spots) {
          if (crates <= 0) break
          const box = rectAt(s, 1, 1)
          if (footprint && overlaps(box, footprint, 0.8)) continue
          if (random() < 0.5) continue
          b.add('objects', `crate-${name}-${++m}`, s, (id, local) => prop(id, local, [1, 1, 1], '#a67c52'))
          solids.push(box)
          crates--
        }
        if (random() < (footprint ? 0.25 : 0.6)) {
          const s = { x: (rect.minX + rect.maxX) / 2 + (random() < 0.5 ? -3 : 3), z: back + (north ? -1.5 : 1.5) }
          const box = rectAt(s, 1.4, 1)
          if (!footprint || !overlaps(box, footprint, 0.8)) {
            b.add('objects', `scrap-${name}`, s, (id, local) => ({ kind: 'container', objectId: id, name: 'Đống phế liệu', position: { x: local.x, y: 0.4, z: local.z }, size: [1.4, 0.8, 1], color: '#6b6f73', lootTableId: 'scrap-pile' }))
            solids.push(box)
          }
        }
      }
    }
    // 4. One zombie zone per block (parks too).
    b.add('zones', `block-${i}-${j}`, { x: (block.minX + block.maxX) / 2, z: (block.minZ + block.maxZ) / 2 }, (id, local) => ({
      zoneId: id,
      kind: 'zombiePopulation',
      name: parks.has(`${i}-${j}`) ? `Công viên ${i + 1}-${j + 1}` : `Khối ${i + 1}-${j + 1}`,
      shape: 'rect',
      center: local,
      size: [bw - 2, bd - 2],
    }))
  }
  // Parked cars on the street between two crossings (never on a crossing: the player starts there).
  for (let k = 0; k <= opts.blocksX; k++) {
    for (let j = 0; j < opts.blocksZ; j++) {
      if (random() >= 0.3) continue
      const side = random() < 0.5 ? -1 : 1
      b.add('objects', `car-x-${k}-${j}`, { x: roadX(k) + side, z: roadZ(j) + (depths[j] + ROAD) / 2 }, (id, local) => prop(id, local, [2, 1.4, 4], pick(['#7a3b3b', '#3b5a7a', '#5a5a52'])))
    }
  }

  // 5. Trees (own random stream): along the streets where no building is, behind houses, in parks.
  if (density > 0) {
    const planted: { x: number; z: number; r: number }[] = []
    const plant = (name: string, p: XZ, style: 'round' | 'pine', scale: number, small = false): boolean => {
      const canopy = quantize(small ? 1.1 + scale * 0.4 : style === 'pine' ? 1.4 + scale * 0.8 : 1.6 + scale * 1.2)
      const height = quantize(small ? 4.5 + scale * 1.5 : style === 'pine' ? 6 + scale * 4 : 5 + scale * 3)
      const trunk = small || style === 'pine' ? 0.2 : 0.25
      // The trunk must clear props and every tree stands apart; canopies stay off roofs.
      if (solids.some((s) => overlaps(rectAt(p, 2 * trunk, 2 * trunk), s, 0.6))) return false
      if (footprints.some((f) => overlaps(rectAt(p, 2 * canopy, 2 * canopy), f, 0.3))) return false
      if (planted.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < 0.7 * (t.r + canopy) + 1)) return false
      if (p.x - canopy < area.minX + 1 || p.x + canopy > area.maxX - 1 || p.z - canopy < area.minZ + 1 || p.z + canopy > area.maxZ - 1) return false
      const color = style === 'pine' ? PINE_COLORS[Math.floor(treeRandom() * PINE_COLORS.length)] : TREE_COLORS[Math.floor(treeRandom() * TREE_COLORS.length)]
      b.add('objects', name, p, (id, local) => ({ kind: 'tree', objectId: id, position: local, height, canopy, trunk, color, style }))
      planted.push({ x: p.x, z: p.z, r: canopy })
      return true
    }
    for (const { i, j } of blocks) {
      const block = blockRect(i, j)
      let n = 0
      const name = () => `tree-${i}-${j}-${++n}`
      if (parks.has(`${i}-${j}`)) {
        // Park: a jittered grid, denser with the density, a third of them pines.
        for (let z = block.minZ + 3; z <= block.maxZ - 3; z += 4.5) {
          for (let x = block.minX + 3; x <= block.maxX - 3; x += 4.5) {
            if (treeRandom() >= 0.35 + 0.6 * density) continue
            const p = { x: quantize(x + (treeRandom() - 0.5) * 2), z: quantize(z + (treeRandom() - 0.5) * 2) }
            plant(name(), p, treeRandom() < 0.33 ? 'pine' : 'round', treeRandom())
          }
        }
        continue
      }
      // Street trees: small, close to the kerb on both street sides of the block, every ~7 m, never
      // right in front of the middle of a building (where its door usually is).
      for (const z of [block.minZ + 0.7, block.maxZ - 0.7]) {
        for (let x = block.minX + 2.5; x <= block.maxX - 2.5; x += 7) {
          if (treeRandom() >= density) continue
          const p = { x: quantize(x + (treeRandom() - 0.5)), z }
          if (footprints.some((f) => Math.abs(p.x - (f.minX + f.maxX) / 2) < 2.2 && p.z > f.minZ - 4 && p.z < f.maxZ + 4)) continue
          plant(name(), p, 'round', treeRandom(), true)
        }
      }
      // Back yards: one tree in a back corner of a lot, now and then.
      for (const lot of lotsByBlock.get(`${i}-${j}`) ?? []) {
        if (treeRandom() >= 0.8 * density) continue
        const north = lot.minZ === block.minZ
        const x = treeRandom() < 0.5 ? lot.minX + 2 : lot.maxX - 2
        plant(name(), { x: quantize(x), z: quantize(north ? lot.maxZ - 2.2 : lot.minZ + 2.2) }, treeRandom() < 0.25 ? 'pine' : 'round', treeRandom() * 0.5)
      }
    }
  }

  // 6. Spawns, checked against the resolved colliders (trunks included) and building footprints.
  const player = [...Array(opts.blocksX + 1).keys()].flatMap((k) => [...Array(opts.blocksZ + 1).keys()].map((j) => ({ x: roadX(k), z: roadZ(j) }))).sort((a, c) => Math.hypot(a.x, a.z) - Math.hypot(c.x, c.z) || a.x - c.x || a.z - c.z)[0]
  const playerId = b.add('spawns', 'player-start', player, (id, local) => ({ spawnId: id, kind: 'player', position: local }))
  const draft = assemble(opts, layout, density, catalog, b, area, playerId)
  const lowSolid = lowSolids(resolvedRecords(draft))
  for (const { i, j } of blocks) {
    const block = blockRect(i, j)
    const bw = widths[i]
    const bd = depths[j]
    const candidates = [
      { x: block.minX + 1.5, z: block.minZ + bd / 2 },
      { x: block.maxX - 1.5, z: block.minZ + bd / 2 },
      { x: block.minX + bw / 2, z: block.minZ + bd / 2 },
      { x: block.minX + bw / 4, z: block.minZ + bd / 2 },
      { x: block.minX + (3 * bw) / 4, z: block.minZ + bd / 2 },
    ]
    let n = 0
    const start = Math.floor(random() * candidates.length)
    for (let c = 0; c < candidates.length && n < 2; c++) {
      const p = candidates[(start + c) % candidates.length]
      if (blockingSolid(lowSolid, p)) continue
      if (footprints.some((f) => p.x > f.minX - 0.5 && p.x < f.maxX + 0.5 && p.z > f.minZ - 0.5 && p.z < f.maxZ + 0.5)) continue
      b.add('spawns', `zombie-${i}-${j}-${++n}`, p, (id, local) => ({ spawnId: id, kind: 'zombie', position: local }))
    }
  }
  const doc = assemble(opts, layout, density, catalog, b, area, playerId)
  const files = new Map(documentFiles(doc))
  const checked = checkWorldDocuments((path) => files.get(path), validation)
  if (hasErrors(checked.issues)) {
    const e = checked.issues.filter((i) => i.severity === 'error').slice(0, 3)
    throw new Error(`generator produced invalid content: ${e.map((i) => `${i.code} ${i.path} ${i.message}`).join('; ')}`)
  }
  return doc
}

/**
 * Lots of a block, north row first (west to east), then south. Grid: 2 × 2 equal lots (v1).
 * Varied: each row is cut into 1–3 lots at least `MIN_LOT` wide, with jittered widths.
 */
function lotsOfBlock(block: Rect, layout: Layout, random: () => number): { rect: Rect; north: boolean; name: number }[] {
  const bw = block.maxX - block.minX
  const half = (block.maxZ - block.minZ) / 2
  const out: { rect: Rect; north: boolean; name: number }[] = []
  let k = 0
  for (const north of [true, false]) {
    const z0 = north ? block.minZ : block.minZ + half
    let cuts: number[]
    if (layout === 'grid') cuts = [bw / 2, bw / 2]
    else {
      const most = Math.max(1, Math.floor(bw / MIN_LOT))
      const n = 1 + Math.floor(random() * most)
      const raw = [...Array(n).keys()].map(() => 0.8 + random() * 0.4)
      const total = raw.reduce((a, c) => a + c, 0)
      cuts = raw.map((r) => Math.max(MIN_LOT, (r / total) * bw))
      // Snap to half metres; the last lot takes the rest so the row fills the block exactly.
      cuts = cuts.map((c) => Math.round(c * 2) / 2)
      cuts[cuts.length - 1] = bw - cuts.slice(0, -1).reduce((a, c) => a + c, 0)
      if (cuts[cuts.length - 1] < MIN_LOT) cuts = [bw]
    }
    let x = block.minX
    for (const w of cuts) {
      out.push({ rect: { minX: x, minZ: z0, maxX: x + w, maxZ: z0 + half }, north, name: k++ })
      x += w
    }
  }
  return out
}

function rectAt(c: XZ, w: number, d: number): Rect {
  return { minX: c.x - w / 2, minZ: c.z - d / 2, maxX: c.x + w / 2, maxZ: c.z + d / 2 }
}

function assemble(opts: GeneratorOptions, layout: Layout, trees: number, catalog: Catalog, b: Builder, area: Rect, playerSpawn: string): MapDocument {
  const chunks = [...b.chunks.values()].sort((a, c) => a.cz - c.cz || a.cx - c.cx)
  const w = area.maxX - area.minX
  const d = area.maxZ - area.minZ
  const world: WorldDocument = {
    schemaVersion: MAP_SCHEMA_VERSION,
    worldId: opts.worldId,
    name: opts.name,
    contentVersion: 1,
    chunkSize: CHUNK,
    coordinateSystem: 'y-up-xz-meters',
    // The town's own rectangle (M7), centred on the origin.
    playArea: w === d ? { size: w } : { size: w, depth: d },
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
    generator: { name: GENERATOR_NAME, version: GENERATOR_VERSION, seed: opts.seed, params: { blocksX: opts.blocksX, blocksZ: opts.blocksZ, layout, trees }, catalog: catalog.id },
  }
  const copy = new Map(chunks.map((c) => [c.chunkId, structuredClone(c)]))
  return withExternalRefs({ world, prefabs: new Map(catalog.prefabs.map((p) => [p.entry.prefabId, p.doc])), chunks: copy, extras: new Map() })
}
