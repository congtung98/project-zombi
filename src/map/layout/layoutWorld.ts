import { MAP_SCHEMA_VERSION, RECORD_NAMESPACES, type ChunkDocument, type LandUseZone, type PlayArea, type PrefabDocument, type Rect, type RoadRecord, type SpawnRecord, type WorldDocument, type XZ } from '../schema.ts'
import { chunkIdOf, chunkIndex, chunkOrigin, chunksOverlapping, quantize } from '../transform.ts'
import { checkWorldDocuments, hasErrors, lowSolids, SPAWN_CLEARANCE, type ValidationOptions } from '../validate.ts'
import { documentFiles, resolvedRecords, withExternalRefs, type MapDocument } from '../editor/document.ts'
import type { PrefabCatalog } from './buildings.ts'
import { DEFAULT_ENVIRONMENT, environmentItems, type PlacedPrefab } from './environment.ts'
import { hashSeed, rng } from './parcels.ts'
import { PLAN_VERSION } from './plan.ts'
import { rectArea, rectCentre, RectIndex } from './rects.ts'
import type { LayoutPlan, SurfaceKind, WorldLayout, WorldMode } from './schema.ts'

/**
 * WorldSerializer (world generator WG2–WG3): a plan becomes ordinary map content that the editor
 * opens and the game plays like any world (Export pack → `map:unpack`).
 *
 * - `layout-only` (LAYOUT_ONLY): street surfaces as `RoadRecord`s, the play area, a fence and a
 *   player spawn on a junction. Parcels and land use stay in the layout.
 * - `full` (FULL_GENERATION): plus a prefab instance on every parcel that has a building (the used
 *   prefabs copied from the library), one zombie population zone per block and zombie spawns outdoors
 *   in it, clear of every low collider. Environment details come with WG5.
 * Instance IDs are `<chunk>/<parcel id>`, zone IDs `<chunk>/zones/<block id>`: stable while the plan is.
 */

export const LAYOUT_WORLD_GENERATOR = 'world-layout'
export type { WorldMode }

/** Colour (read by the game's surface rules: dark = asphalt, brown = dirt, light = concrete) and draw layer. */
export const SURFACE_STYLE: Record<SurfaceKind, { color: string; layer: number }> = {
  asphalt: { color: '#3a3a3f', layer: 2 },
  dirt: { color: '#8a6a45', layer: 1 },
  sidewalk: { color: '#a19d94', layer: 0 },
}

/** Zombie spawns per hectare of a block, by its main land use (1–6 per block). */
export const DEFAULT_ZOMBIES: Record<LandUseZone, number> = { residential: 8, commercial: 10, industrial: 6, public: 6, empty: 3, forest: 2, farmland: 2 }

const ZONE_NAME: Record<LandUseZone, string> = { residential: 'Khu dân cư', commercial: 'Khu thương mại', industrial: 'Khu công nghiệp', public: 'Khu công cộng', empty: 'Đất trống', forest: 'Rừng', farmland: 'Đồng ruộng' }

const CHUNK = 32

export interface LayoutWorldOptions {
  worldId: string
  name: string
  validation?: ValidationOptions
  /** Default `layout-only`; `full` needs the catalog the buildings were placed from. */
  mode?: WorldMode
  catalog?: PrefabCatalog
  zombies?: Partial<Record<LandUseZone, number>>
  /** Check the result like the runtime loader and throw on errors (default true; the editor's merge validates the merged document itself). */
  validate?: boolean
}

const grow = (r: Rect, m: number): Rect => ({ minX: r.minX - m, minZ: r.minZ - m, maxX: r.maxX + m, maxZ: r.maxZ + m })

/** Navigation cell and agent radius of the game (`GAME_CONFIG.nav`). */
const NAV_CELL = 0.5
const NAV_RADIUS = 0.4

/**
 * Cells of the area a body can walk to from `from` (4-connected), obstacles grown by the agent radius
 * (the navigation grid's rule). Returns a test for points.
 */
function reachableGrid(area: Rect, obstacles: readonly Rect[], from: XZ): (p: XZ) => boolean {
  const x0 = Math.floor(area.minX) - 1
  const z0 = Math.floor(area.minZ) - 1
  const cols = Math.ceil((area.maxX + 1 - x0) / NAV_CELL)
  const rows = Math.ceil((area.maxZ + 1 - z0) / NAV_CELL)
  const blocked = new Uint8Array(cols * rows)
  for (const o of obstacles) {
    const i0 = Math.max(0, Math.ceil((o.minX - NAV_RADIUS - x0) / NAV_CELL - 0.5))
    const i1 = Math.min(cols - 1, Math.floor((o.maxX + NAV_RADIUS - x0) / NAV_CELL - 0.5))
    const j0 = Math.max(0, Math.ceil((o.minZ - NAV_RADIUS - z0) / NAV_CELL - 0.5))
    const j1 = Math.min(rows - 1, Math.floor((o.maxZ + NAV_RADIUS - z0) / NAV_CELL - 0.5))
    for (let j = j0; j <= j1; j++) blocked.fill(1, j * cols + i0, j * cols + i1 + 1)
  }
  const cell = (p: XZ) => {
    const i = Math.floor((p.x - x0) / NAV_CELL)
    const j = Math.floor((p.z - z0) / NAV_CELL)
    return i < 0 || j < 0 || i >= cols || j >= rows ? -1 : j * cols + i
  }
  const seen = new Uint8Array(cols * rows)
  const s = cell(from)
  if (s >= 0 && !blocked[s]) {
    const stack = [s]
    seen[s] = 1
    while (stack.length) {
      const k = stack.pop()!
      const i = k % cols
      for (const n of [i > 0 ? k - 1 : -1, i < cols - 1 ? k + 1 : -1, k - cols, k + cols]) {
        if (n < 0 || n >= cols * rows || blocked[n] || seen[n]) continue
        seen[n] = 1
        stack.push(n)
      }
    }
  }
  return (p) => {
    const k = cell(p)
    return k >= 0 && seen[k] === 1
  }
}

export function buildLayoutWorld(layout: WorldLayout, plan: LayoutPlan, opts: LayoutWorldOptions): MapDocument {
  const net = layout.normalized
  if (!net) throw new Error('layout chưa có mạng đường đã nắn')
  const mode = opts.mode ?? 'layout-only'
  if (mode === 'full' && !opts.catalog) throw new Error('chế độ full cần thư viện prefab')
  const area = plan.area
  const chunks = new Map<string, ChunkDocument>()
  for (const { cx, cz } of chunksOverlapping(area, CHUNK)) {
    const chunkId = chunkIdOf(cx, cz)
    chunks.set(chunkId, { schemaVersion: MAP_SCHEMA_VERSION, contentVersion: 1, chunkId, cx, cz, instances: [], objects: [], roads: [], zones: [], spawns: [], externalRefs: [] })
  }
  const owner = (p: XZ) => {
    const cx = chunkIndex(p.x, CHUNK)
    const cz = chunkIndex(p.z, CHUNK)
    const chunk = chunks.get(chunkIdOf(cx, cz))
    if (!chunk) throw new Error(`(${p.x}, ${p.z}) nằm ngoài vùng chơi`)
    const o = chunkOrigin(cx, cz, CHUNK)
    return { chunk, local: { x: quantize(p.x - o.x), z: quantize(p.z - o.z) } }
  }

  for (const s of plan.surfaces) {
    const { chunk, local } = owner(rectCentre(s.rect))
    const style = SURFACE_STYLE[s.kind]
    const road: RoadRecord = { roadId: `${chunk.chunkId}/${RECORD_NAMESPACES.roads}/${s.id}`, position: local, size: [quantize(s.rect.maxX - s.rect.minX), quantize(s.rect.maxZ - s.rect.minZ)], color: style.color }
    if (style.layer) road.layer = style.layer
    chunk.roads.push(road)
  }

  // Buildings (full): one instance per built parcel, anchored at the prefab pivot.
  const prefabs = new Map<string, { entry: WorldDocument['prefabs'][number]; doc: PrefabDocument }>()
  if (mode === 'full') {
    const lib = new Map(opts.catalog!.prefabs.map((p) => [p.entry.prefabId, p]))
    for (const q of plan.parcels) {
      const b = q.build
      if (!b || b.prefabId === null) continue
      const p = lib.get(b.prefabId)
      if (!p) throw new Error(`lô ${q.id}: prefab ${b.prefabId} không có trong thư viện ${opts.catalog!.id}`)
      prefabs.set(b.prefabId, { entry: { ...p.entry }, doc: p.doc })
      const { chunk, local } = owner(b.position)
      chunk.instances.push({ instanceId: `${chunk.chunkId}/${q.id}`, prefabId: b.prefabId, position: { x: local.x, y: 0, z: local.z }, quarterTurns: b.quarterTurns })
    }
  }

  // Environment (full, WG5): trees, planting, fences, bins, mailboxes, streetlights, cars, litter as plain objects.
  if (mode === 'full') {
    const lib = new Map(opts.catalog!.prefabs.map((p) => [p.entry.prefabId, p.doc]))
    const placed = new Map<string, PlacedPrefab>()
    for (const q of plan.parcels) if (q.build && q.build.prefabId !== null) placed.set(q.id, { doc: lib.get(q.build.prefabId)!, build: q.build })
    for (const it of environmentItems(plan, placed, plan.environment ?? DEFAULT_ENVIRONMENT)) {
      const { chunk, local } = owner(it.at)
      const objectId = `${chunk.chunkId}/${RECORD_NAMESPACES.objects}/${it.name}`
      if (it.kind === 'tree') chunk.objects.push({ kind: 'tree', objectId, position: local, height: it.height, canopy: it.canopy, trunk: it.trunk, color: it.color, style: it.style } as ChunkDocument['objects'][number])
      else if (it.kind === 'decor') chunk.objects.push({ kind: 'decor', objectId, assetId: it.assetId, position: { x: local.x, y: 0, z: local.z }, yaw: it.yaw } as ChunkDocument['objects'][number])
      else {
        const visual = it.facing === undefined ? { assetId: it.assetId } : { assetId: it.assetId, facing: it.facing }
        const base = { objectId, position: { x: local.x, y: quantize(it.size[1] / 2), z: local.z }, size: it.size, color: it.color }
        chunk.objects.push((it.kind === 'container' ? { kind: 'container', ...base, name: it.label ?? 'Thùng', lootTableId: it.loot, visual } : { kind: 'prop', ...base, visual }) as ChunkDocument['objects'][number])
      }
    }
  }

  // Player start: the junction nearest the centre of the area (on the carriageway, never on a collider).
  const centre = rectCentre(area)
  const kinds = new Map(layout.network.nodes.map((n) => [n.id, n.kind]))
  const candidates = [...net.nodes].sort((a, b) => {
    const ja = kinds.get(a.id) === 'junction' ? 0 : 1
    const jb = kinds.get(b.id) === 'junction' ? 0 : 1
    return ja - jb || Math.hypot(a.position.x - centre.x, a.position.z - centre.z) - Math.hypot(b.position.x - centre.x, b.position.z - centre.z) || (a.id < b.id ? -1 : 1)
  })
  const start = owner(candidates[0].position)
  const spawn: SpawnRecord = { spawnId: `${start.chunk.chunkId}/${RECORD_NAMESPACES.spawns}/player-start`, kind: 'player', position: start.local }
  start.chunk.spawns.push(spawn)

  const list = [...chunks.values()].sort((a, b) => a.cz - b.cz || a.cx - b.cx)
  const w = quantize(area.maxX - area.minX)
  const d = quantize(area.maxZ - area.minZ)
  const playArea: PlayArea = { size: w }
  if (d !== w) playArea.depth = d
  if (centre.x !== 0 || centre.z !== 0) playArea.center = { x: quantize(centre.x), z: quantize(centre.z) }
  const params: Record<string, string | number> = { layout: layout.layoutId, mode, profile: plan.params.profile, source: layout.source.hash }
  if (layout.source.attribution) params.attribution = layout.source.attribution
  const world: WorldDocument = {
    schemaVersion: MAP_SCHEMA_VERSION,
    worldId: opts.worldId,
    name: opts.name,
    contentVersion: 1,
    chunkSize: CHUNK,
    coordinateSystem: 'y-up-xz-meters',
    playArea,
    boundary: { height: 2, thickness: 1 },
    chunkBounds: {
      minCx: Math.min(...list.map((c) => c.cx)),
      maxCx: Math.max(...list.map((c) => c.cx)),
      minCz: Math.min(...list.map((c) => c.cz)),
      maxCz: Math.max(...list.map((c) => c.cz)),
    },
    chunks: list.map((c) => ({ chunkId: c.chunkId, cx: c.cx, cz: c.cz, path: `chunks/${c.chunkId}.json` })),
    prefabs: [...prefabs.values()].map((p) => p.entry).sort((a, b) => (a.prefabId < b.prefabId ? -1 : 1)),
    playerSpawn: spawn.spawnId,
    generator: { name: LAYOUT_WORLD_GENERATOR, version: PLAN_VERSION, seed: plan.params.seed, params, catalog: mode === 'full' ? opts.catalog!.id : 'none' },
  }
  const prefabDocs = new Map([...prefabs].map(([id, p]) => [id, p.doc]))
  // Fresh chunk objects each time: the resolver caches by chunk object, and spawns are still to be added.
  const snapshot = (): MapDocument => ({ world, prefabs: prefabDocs, chunks: new Map(list.map((c) => [c.chunkId, { ...c }])), extras: new Map() })

  // Zombie zones and spawns (full): one zone per block, on its largest rectangle, spawns outdoors in it.
  if (mode === 'full') {
    // Where a zombie may not stand: building footprints (+0.8 m) and low colliders (+ its radius), indexed.
    const blocked = new RectIndex()
    const solids = lowSolids(resolvedRecords(snapshot())).map((b) => ({ minX: b.position.x - b.size[0] / 2, minZ: b.position.z - b.size[2] / 2, maxX: b.position.x + b.size[0] / 2, maxZ: b.position.z + b.size[2] / 2 }))
    const footprints = plan.parcels.flatMap((q) => (q.build && q.build.prefabId !== null ? [q.build.footprint] : []))
    for (const f of footprints) blocked.add(grow(f, 0.8))
    for (const b of solids) blocked.add(grow(b, SPAWN_CLEARANCE))
    // P3: a spawn must be connected to the streets (a yard walled in by buildings and fences is not),
    // like the deep check: a 0.5 m grid, obstacles grown by the agent radius, flooded from the player start.
    const reached = reachableGrid(area, [...footprints, ...solids], candidates[0].position)
    const density = { ...DEFAULT_ZOMBIES, ...opts.zombies }
    const used = new Map<LandUseZone, number>()
    for (const block of plan.blocks) {
      const r = [...block.rects].sort((a, b) => rectArea(b) - rectArea(a))[0]
      if (rectArea(r) < 150 || Math.min(r.maxX - r.minX, r.maxZ - r.minZ) < 8) continue
      // Main land use of the block: by parcel area.
      const byZone = new Map<LandUseZone, number>()
      for (const q of plan.parcels) if (q.block === block.id) byZone.set(q.zone, (byZone.get(q.zone) ?? 0) + q.area)
      const zone = [...byZone].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? layout.defaults.zone
      used.set(zone, (used.get(zone) ?? 0) + 1)
      const inner = { minX: r.minX + 1, minZ: r.minZ + 1, maxX: r.maxX - 1, maxZ: r.maxZ - 1 }
      const c = owner(rectCentre(inner))
      c.chunk.zones.push({ zoneId: `${c.chunk.chunkId}/${RECORD_NAMESPACES.zones}/${block.id}`, kind: 'zombiePopulation', name: `${ZONE_NAME[zone]} ${used.get(zone)}`, shape: 'rect', center: c.local, size: [quantize(inner.maxX - inner.minX), quantize(inner.maxZ - inner.minZ)] })
      const n = Math.max(1, Math.min(6, Math.round((rectArea(inner) / 10000) * density[zone])))
      const spots: XZ[] = []
      for (let z = inner.minZ + 1.5; z <= inner.maxZ - 1.5; z += 4)
        for (let x = inner.minX + 1.5; x <= inner.maxX - 1.5; x += 4) {
          const p = { x: quantize(x), z: quantize(z) }
          if (blocked.overlaps({ minX: p.x - 1e-3, minZ: p.z - 1e-3, maxX: p.x + 1e-3, maxZ: p.z + 1e-3 })) continue
          if (!reached(p)) continue
          spots.push(p)
        }
      const random = rng(hashSeed(plan.params.seed, `zombies:${block.id}`))
      for (let k = 0; k < n && spots.length; k++) {
        const [p] = spots.splice(Math.floor(random() * spots.length), 1)
        const o = owner(p)
        o.chunk.spawns.push({ spawnId: `${o.chunk.chunkId}/${RECORD_NAMESPACES.spawns}/zombie-${block.id.slice(6)}-${k + 1}`, kind: 'zombie', position: o.local })
      }
    }
  }

  const doc = withExternalRefs({ world, prefabs: prefabDocs, chunks: new Map(list.map((c) => [c.chunkId, c])), extras: new Map() })
  if (opts.validate === false) return doc
  const files = new Map(documentFiles(doc))
  const checked = checkWorldDocuments((path) => files.get(path), opts.validation)
  if (hasErrors(checked.issues)) {
    const e = checked.issues.filter((i) => i.severity === 'error').slice(0, 3)
    throw new Error(`world sinh từ layout không hợp lệ: ${e.map((i) => `${i.code} ${i.path} ${i.message}`).join('; ')}`)
  }
  return doc
}

