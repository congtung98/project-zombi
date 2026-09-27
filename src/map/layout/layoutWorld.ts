import { MAP_SCHEMA_VERSION, RECORD_NAMESPACES, type ChunkDocument, type PlayArea, type RoadRecord, type SpawnRecord, type WorldDocument, type XZ } from '../schema.ts'
import { chunkIdOf, chunkIndex, chunkOrigin, chunksOverlapping, quantize } from '../transform.ts'
import { checkWorldDocuments, hasErrors, type ValidationOptions } from '../validate.ts'
import { documentFiles, withExternalRefs, type MapDocument } from '../editor/document.ts'
import { PLAN_VERSION } from './plan.ts'
import { rectCentre } from './rects.ts'
import type { LayoutPlan, SurfaceKind, WorldLayout } from './schema.ts'

/**
 * WorldSerializer, layout-only mode (world generator WG2): a plan becomes ordinary map content —
 * street surfaces as `RoadRecord`s, the play area, a fence and a player spawn on a junction — that the
 * editor opens and the game plays like any world (Export pack → `map:unpack`). Parcels and land use
 * stay in the layout (the game has no use for them); buildings come with WG3.
 */

export const LAYOUT_WORLD_GENERATOR = 'world-layout'

/** Colour (read by the game's surface rules: dark = asphalt, brown = dirt, light = concrete) and draw layer. */
export const SURFACE_STYLE: Record<SurfaceKind, { color: string; layer: number }> = {
  asphalt: { color: '#3a3a3f', layer: 2 },
  dirt: { color: '#8a6a45', layer: 1 },
  sidewalk: { color: '#a19d94', layer: 0 },
}

const CHUNK = 32

export interface LayoutWorldOptions {
  worldId: string
  name: string
  validation?: ValidationOptions
}

export function buildLayoutWorld(layout: WorldLayout, plan: LayoutPlan, opts: LayoutWorldOptions): MapDocument {
  const net = layout.normalized
  if (!net) throw new Error('layout chưa có mạng đường đã nắn')
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

  // Player start: the junction nearest the centre of the area (on the carriageway, never on a collider).
  const centre = rectCentre(area)
  const kinds = new Map(layout.network.nodes.map((n) => [n.id, n.kind]))
  const candidates = [...net.nodes].sort((a, b) => {
    const ja = kinds.get(a.id) === 'junction' ? 0 : 1
    const jb = kinds.get(b.id) === 'junction' ? 0 : 1
    return ja - jb || Math.hypot(a.position.x - centre.x, a.position.z - centre.z) - Math.hypot(b.position.x - centre.x, b.position.z - centre.z) || (a.id < b.id ? -1 : 1)
  })
  const start = candidates[0].position
  const s = owner(start)
  const spawn: SpawnRecord = { spawnId: `${s.chunk.chunkId}/${RECORD_NAMESPACES.spawns}/player-start`, kind: 'player', position: s.local }
  s.chunk.spawns.push(spawn)

  const list = [...chunks.values()].sort((a, b) => a.cz - b.cz || a.cx - b.cx)
  const w = quantize(area.maxX - area.minX)
  const d = quantize(area.maxZ - area.minZ)
  const playArea: PlayArea = { size: w }
  if (d !== w) playArea.depth = d
  if (centre.x !== 0 || centre.z !== 0) playArea.center = { x: quantize(centre.x), z: quantize(centre.z) }
  const params: Record<string, string | number> = { layout: layout.layoutId, mode: 'layout-only', profile: plan.params.profile, source: layout.source.hash }
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
    prefabs: [],
    playerSpawn: spawn.spawnId,
    generator: { name: LAYOUT_WORLD_GENERATOR, version: PLAN_VERSION, seed: plan.params.seed, params, catalog: 'none' },
  }
  const doc = withExternalRefs({ world, prefabs: new Map(), chunks: new Map(list.map((c) => [c.chunkId, c])), extras: new Map() })
  const files = new Map(documentFiles(doc))
  const checked = checkWorldDocuments((path) => files.get(path), opts.validation)
  if (hasErrors(checked.issues)) {
    const e = checked.issues.filter((i) => i.severity === 'error').slice(0, 3)
    throw new Error(`world sinh từ layout không hợp lệ: ${e.map((i) => `${i.code} ${i.path} ${i.message}`).join('; ')}`)
  }
  return doc
}
