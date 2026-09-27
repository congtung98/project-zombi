// The default world `neighborhood-50` grown into a small town of 16 × 16 chunks (512 m) around the
// old 50 m neighbourhood, which stays exactly as it was (every ID, so old saves still load through a
// content migration). A hand-drawn street plan (not a plain grid: avenues meeting a ring road round
// the old quarter, staggered junctions, T-junctions, dead-end alleys, dirt tracks into the woods),
// land use and the sites of the library's compounds are written as local-metre GeoJSON and fed to the
// world generator (the same pipeline as the editor's "Mới → Từ GeoJSON"); the generator plans the lots
// and puts the library's buildings, trees, fences, cars and streetlights on them; every library prefab
// missing after that is placed on a lot it fits; the compounds (police station, hospital, high school,
// university, prison, cemetery, park, ponds) are placed on their sites; a forest closes the edges.
// Usage: node scripts/map-tools/town-build.ts [--dir content/maps/neighborhood-50] [--seed 2026]
// Requires Node ≥ 22.18 (built-in TypeScript stripping).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { LOOT_TABLES } from '../../src/game/world/lootTables.ts'
import { formatJson } from '../../src/map/format.ts'
import { documentFiles, resolvedRecords, withExternalRefs, type MapDocument } from '../../src/map/editor/document.ts'
import { addChunk, deleteRecords, fittedPlayArea, moveRecords, updateRecord, type CommandResult } from '../../src/map/editor/commands.ts'
import { documentFromFiles, validateDocument } from '../../src/map/editor/pack.ts'
import { libraryFromFiles, placeCompound, prefabHash, LIBRARY_WORLD } from '../../src/map/editor/library.ts'
import { libraryCatalog } from '../../src/map/editor/generator.ts'
import { writeContentMigration } from '../../src/map/editor/migration.ts'
import { importGeoJsonLayout } from '../../src/map/layout/importer.ts'
import { planLayout, PROFILES } from '../../src/map/layout/plan.ts'
import { placeBuildings, setParcelPrefab } from '../../src/map/layout/buildings.ts'
import { createLayoutWorld } from '../../src/map/layout/worldSync.ts'
import { chunkIdOf, chunkOrigin, quantize, rotateRect } from '../../src/map/transform.ts'
import type { ChunkDocument, QuarterTurns, Rect, XZ } from '../../src/map/schema.ts'

const args = process.argv.slice(2)
const opt = (name: string, d: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : d
}
const DIR = opt('dir', 'content/maps/neighborhood-50')
const SEED = Number(opt('seed', '2026'))
const OPTS = { lootTables: new Set(Object.keys(LOOT_TABLES)) }
const NAME = 'Thị trấn Ngã Tư'
const ok = (r: CommandResult, what: string): MapDocument => {
  if (!r.ok) throw new Error(`${what}: ${r.error}`)
  return r.doc
}
const readDir = (dir: string) => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.json') ? [join(d, e.name)] : []))
  return new Map(walk(dir).map((f) => [relative(dir, f).replace(/\\/g, '/'), JSON.parse(readFileSync(f, 'utf8')) as unknown]))
}

// ---- 1. The plan (world metres: x east, z south) ----

type Tag = 'primary' | 'secondary' | 'tertiary' | 'residential' | 'service' | 'track'
const roads: { tag: Tag; pts: [number, number][] }[] = []
const road = (tag: Tag, ...pts: [number, number][]) => roads.push({ tag, pts })

// The old quarter keeps its narrow crossroads; a ring road goes round it and four avenues leave it.
road('secondary', [-32, -32], [32, -32], [32, 32], [-32, 32], [-32, -32])
road('primary', [-1, -32], [-1, -222])
road('primary', [-1, 32], [-1, 222])
road('primary', [-32, -1], [-222, -1])
road('primary', [32, -1], [222, -1])
for (const t of [[[-1, -222], [-1, -232]], [[-1, 222], [-1, 232]], [[-222, -1], [-232, -1]], [[222, -1], [232, -1]]] as [number, number][][]) road('track', ...t)
// North-west: houses, the police station by the west avenue, the cemetery by the woods.
road('secondary', [-1, -90], [-200, -90])
road('residential', [-80, -1], [-80, -160])
road('residential', [-150, -1], [-150, -200])
road('residential', [-200, -160], [-1, -160])
road('service', [-115, -90], [-115, -120])
road('service', [-40, -160], [-40, -130])
road('service', [-190, -1], [-190, -30])
road('service', [-115, -160], [-115, -190])
// North-east: the hospital and the park on the east avenue, the high school, the university.
road('secondary', [-1, -70], [205, -70])
road('residential', [60, -1], [60, -200])
road('secondary', [150, -1], [150, -150])
road('residential', [60, -150], [205, -150])
road('service', [190, -70], [190, -40])
road('service', [60, -175], [30, -175])
// South-east: downtown shops, the industrial estate, the prison, the lake.
road('secondary', [90, -1], [90, 200])
road('residential', [-1, 60], [180, 60])
road('residential', [90, 110], [210, 110])
road('secondary', [160, 60], [160, 210])
road('track', [160, 170], [215, 170])
road('service', [60, -1], [60, 35])
road('service', [90, 140], [60, 140])
road('service', [130, 60], [130, 85])
// South-west: Vietnamese-style streets, the pond, a garden house.
road('secondary', [-1, 80], [-210, 80])
road('residential', [-70, -1], [-70, 200])
road('residential', [-140, 80], [-140, 200])
road('residential', [-210, 150], [-1, 150])
road('service', [-105, 80], [-105, 45])
road('service', [-175, 150], [-175, 185])
road('service', [-1, 115], [-35, 115])

const rect = (x0: number, z0: number, x1: number, z1: number): Rect => ({ minX: x0, minZ: z0, maxX: x1, maxZ: z1 })
const zones: { tag: Record<string, string>; r: Rect; hole?: Rect }[] = [
  // A forest ring closes the town: from 205 m out to past the play area.
  { tag: { landuse: 'forest' }, r: rect(-262, -262, 262, 262), hole: rect(-205, -205, 205, 205) },
  // Downtown shops (narrow Vietnamese lots), and shop strips along the north and west avenues.
  { tag: { landuse: 'commercial' }, r: rect(37, 5, 205, 105) },
  { tag: { landuse: 'commercial' }, r: rect(-30, -205, 30, -37) },
  { tag: { landuse: 'commercial' }, r: rect(-205, -25, -37, 25) },
  // Service blocks by the ring (bank, bookstore, apartments on big lots).
  { tag: { landuse: 'civic' }, r: rect(37, 5, 86, 56) },
  { tag: { landuse: 'civic' }, r: rect(-76, 5, -37, 76) },
  // Industrial estate in the south-east.
  { tag: { landuse: 'industrial' }, r: rect(96, 105, 205, 205) },
]

// Compounds and their sites (south = front; the prison turned to face the east street).
const compounds: { id: string; at: XZ; q: QuarterTurns }[] = [
  { id: 'compound/police-station', at: { x: -56, z: -28 }, q: 0 },
  { id: 'compound/cemetery', at: { x: -175, z: -178 }, q: 0 },
  { id: 'compound/hospital', at: { x: 90, z: -32 }, q: 0 },
  { id: 'compound/park', at: { x: 128, z: -30 }, q: 0 },
  { id: 'compound/high-school', at: { x: 104.5, z: -110.5 }, q: 0 },
  { id: 'compound/university', at: { x: 150, z: -192 }, q: 0 },
  { id: 'compound/lake', at: { x: 40, z: 165 }, q: 0 },
  { id: 'compound/prison', at: { x: 127, z: 148.5 }, q: 1 },
  { id: 'compound/pond', at: { x: -105, z: 115 }, q: 0 },
  { id: 'compound/garden-house', at: { x: -172, z: 115 }, q: 0 },
]
const OLD_QUARTER = rect(-27, -27, 27, 27)

const libFiles = readDir(join('content/maps', LIBRARY_WORLD))
const lib = libraryFromFiles(libFiles, OPTS)!
const catalog = libraryCatalog(libFiles)!
const sites = compounds.map((c) => {
  const f = rotateRect(lib.compounds.get(c.id)!.footprint, c.q)
  return rect(quantize(c.at.x + f.minX - 2), quantize(c.at.z + f.minZ - 2), quantize(c.at.x + f.maxX + 2), quantize(c.at.z + f.maxZ + 2))
})

// ---- 2. GeoJSON: junctions as shared vertices ----

function withJunctions(): [number, number][][] {
  const segs = roads.map((r) => r.pts)
  const onSeg = (p: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] === b[0] && p[0] === a[0] && p[1] > Math.min(a[1], b[1]) && p[1] < Math.max(a[1], b[1])) || (a[1] === b[1] && p[1] === a[1] && p[0] > Math.min(a[0], b[0]) && p[0] < Math.max(a[0], b[0]))
  return segs.map((pts, i) => {
    const out: [number, number][] = []
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k]
      const b = pts[k + 1]
      const extra: [number, number][] = []
      segs.forEach((other, j) => {
        if (j === i) return
        for (const p of other) if (onSeg(p, a, b)) extra.push(p)
        for (let m = 0; m + 1 < other.length; m++) {
          const c = other[m]
          const d = other[m + 1]
          // A vertical and a horizontal segment crossing inside both.
          const [v1, v2, h1, h2] = a[0] === b[0] && c[1] === d[1] ? [a, b, c, d] : a[1] === b[1] && c[0] === d[0] ? [c, d, a, b] : [null, null, null, null]
          if (!v1 || !v2 || !h1 || !h2) continue
          const x = v1[0]
          const z = h1[1]
          if (x > Math.min(h1[0], h2[0]) && x < Math.max(h1[0], h2[0]) && z > Math.min(v1[1], v2[1]) && z < Math.max(v1[1], v2[1])) extra.push([x, z])
        }
      })
      const along = (p: [number, number]) => Math.abs(p[0] - a[0]) + Math.abs(p[1] - a[1])
      out.push(a, ...[...new Map(extra.map((p) => [`${p[0]},${p[1]}`, p])).values()].sort((p, q) => along(p) - along(q)))
    }
    out.push(pts[pts.length - 1])
    return out
  })
}

const ring = (r: Rect): [number, number][] => [
  [r.minX, -r.minZ],
  [r.maxX, -r.minZ],
  [r.maxX, -r.maxZ],
  [r.minX, -r.maxZ],
  [r.minX, -r.minZ],
]
const features: unknown[] = []
withJunctions().forEach((pts, i) => features.push({ type: 'Feature', properties: { highway: roads[i].tag, name: `road-${i}` }, geometry: { type: 'LineString', coordinates: pts.map(([x, z]) => [x, -z]) } }))
for (const z of zones) features.push({ type: 'Feature', properties: z.tag, geometry: { type: 'Polygon', coordinates: z.hole ? [ring(z.r), ring(z.hole).reverse()] : [ring(z.r)] } })
for (const s of [OLD_QUARTER, ...sites]) features.push({ type: 'Feature', properties: { 'worldgen:restricted': 'no-build' }, geometry: { type: 'Polygon', coordinates: [ring(s)] } })
const geojson = JSON.stringify({ type: 'FeatureCollection', 'worldgen:crs': 'local-metres', features })

// ---- 3. The generator ----

const layout = importGeoJsonLayout(geojson, { layoutId: 'neighborhood-50', name: NAME, origin: { x: 0, y: 0 }, normalize: { alignment: 0, offset: { x: 0, z: 0 } } })
const errors = [...layout.issues, ...(layout.normalized?.issues ?? [])].filter((i) => i.severity === 'error')
if (errors.length || !layout.normalized?.valid) throw new Error(`layout: ${errors.map((e) => e.message).join('; ')}`)
let plan = planLayout(layout, { seed: SEED, profile: 'default', zones: { commercial: PROFILES['vn-urban'].commercial } })
plan = placeBuildings(plan, catalog).plan
// Every library prefab at least once: on the lot it fits best (its own zone first), never taking the
// only copy of another prefab.
{
  const count = () => {
    const m = new Map<string, number>()
    for (const q of plan.parcels) if (q.build?.prefabId) m.set(q.build.prefabId, (m.get(q.build.prefabId) ?? 0) + 1)
    return m
  }
  for (const p of catalog.prefabs) {
    const c = count()
    if (c.get(p.entry.prefabId)) continue
    const lots = plan.parcels.filter((q) => q.kind === 'lot' && q.access && (!q.build?.prefabId || (c.get(q.build.prefabId) ?? 0) > 2))
    lots.sort((a, b) => Number(!p.placement.allowedZones.includes(a.zone)) - Number(!p.placement.allowedZones.includes(b.zone)) || (a.id < b.id ? -1 : 1))
    let placed = false
    for (const q of lots) {
      const r = setParcelPrefab(plan, catalog, q.id, p.entry.prefabId)
      if (r.issues.some((i) => i.severity === 'error')) continue
      plan = r.plan
      placed = true
      break
    }
    console.log(`${placed ? 'placed' : 'NO LOT for'} ${p.entry.prefabId}`)
  }
}
let doc = createLayoutWorld({ ...layout, plan }, { worldId: 'neighborhood-50', name: NAME, mode: 'full', catalog, validation: OPTS, validate: false })

// ---- 4. The old quarter, as it was ----

const oldFiles = readDir(DIR)
const opened = documentFromFiles(oldFiles, OPTS)
if (!opened.ok) throw new Error(`old world: ${opened.error}`)
const old = opened.doc
if (old.world.contentVersion !== 1) throw new Error(`${DIR} is already the town (content v${old.world.contentVersion}): restore the 50 m neighbourhood first`)
{
  const chunks = new Map(doc.chunks)
  // The generator's player start goes (the old quarter's stays); layout files stay out of the world.
  for (const [id, c] of chunks) chunks.set(id, { ...c, spawns: c.spawns.filter((s) => s.kind !== 'player') })
  for (const [id, oc] of old.chunks) {
    const c = chunks.get(id)!
    chunks.set(id, { ...c, instances: [...c.instances, ...oc.instances], objects: [...c.objects, ...oc.objects], roads: [...c.roads, ...oc.roads], zones: [...c.zones, ...oc.zones], spawns: [...c.spawns, ...oc.spawns] })
  }
  // The old narrow streets reach the ring road's carriageway (they ended at ±25 m).
  const link = (name: string, cx: number, cz: number, size: [number, number]) => {
    const S = doc.world.chunkSize
    const chunkId = chunkIdOf(Math.floor(cx / S), Math.floor(cz / S))
    const o = chunkOrigin(Math.floor(cx / S), Math.floor(cz / S), S)
    const c = chunks.get(chunkId)!
    chunks.set(chunkId, { ...c, roads: [...c.roads, { roadId: `${chunkId}/roads/${name}`, position: { x: quantize(cx - o.x), z: quantize(cz - o.z) }, size, color: '#3a3a3f', layer: 3 }] })
  }
  link('old-north-link', -1, -26.9, [4, 3.8])
  link('old-south-link', -1, 26.9, [4, 3.8])
  link('old-west-link', -26.9, -1, [3.8, 4])
  link('old-east-link', 26.9, -1, [3.8, 4])
  const prefabs = new Map(doc.prefabs)
  let world = doc.world
  for (const e of old.world.prefabs) {
    if (!prefabs.has(e.prefabId)) {
      prefabs.set(e.prefabId, old.prefabs.get(e.prefabId)!)
      world = { ...world, prefabs: [...world.prefabs, { ...e }] }
    }
  }
  const extras = new Map([...old.extras].filter(([p]) => p.startsWith('migrations/')))
  world = { ...world, name: NAME, playerSpawn: old.world.playerSpawn, boundary: { height: 2, thickness: 1 } }
  delete world.generator
  doc = withExternalRefs({ world, prefabs, chunks, extras })
}

// ---- 5. Compounds on their sites ----

for (const c of compounds) doc = ok(placeCompound(doc, lib, c.id, c.at, c.q), c.id)

// A block's zombie zone whose centre fell on a building moves along its rectangle to open ground
// (a zone needs walkable ground near its centre).
{
  const solid = resolvedRecords(doc).filter((r) => r.category === 'instances').map((r) => r.bounds)
  const inside = (p: XZ) => solid.some((b) => p.x > b.minX - 2 && p.x < b.maxX + 2 && p.z > b.minZ - 2 && p.z < b.maxZ + 2)
  for (const c of [...doc.chunks.values()]) {
    for (const z of c.zones) {
      if (z.shape !== 'rect' || !z.zoneId.includes('/zones/block-')) continue
      const o = chunkOrigin(c.cx, c.cz, doc.world.chunkSize)
      const at = { x: o.x + z.center.x, z: o.z + z.center.z }
      if (!inside(at)) continue
      const alongX = z.size[0] >= z.size[1]
      const half = (alongX ? z.size[0] : z.size[1]) / 2
      for (let d = 2; d < half; d += 2) {
        const hit = [d, -d].map((s) => (alongX ? { x: at.x + s, z: at.z } : { x: at.x, z: at.z + s })).find((p) => !inside(p))
        if (!hit) continue
        doc = ok(moveRecords(doc, [z.zoneId], { x: quantize(hit.x - at.x), z: quantize(hit.z - at.z) }), z.zoneId)
        break
      }
    }
  }
}

// ---- 6. The whole 16 × 16 chunk square, the play area, provenance ----

for (let cz = -8; cz <= 7; cz++) for (let cx = -8; cx <= 7; cx++) if (!doc.chunks.has(chunkIdOf(cx, cz))) doc = ok(addChunk(doc, cx, cz), `chunk ${cx},${cz}`)
doc = { ...doc, world: { ...doc.world, playArea: fittedPlayArea(doc.world) } }
// Trees and other objects of the forest edge reaching past the play area go (the fence stands there).
{
  const pa = doc.world.playArea
  const hx = pa.size / 2
  const hz = (pa.depth ?? pa.size) / 2
  const cx = pa.center?.x ?? 0
  const cz = pa.center?.z ?? 0
  const out = resolvedRecords(doc).filter((r) => r.category === 'objects' && (r.bounds.minX < cx - hx || r.bounds.maxX > cx + hx || r.bounds.minZ < cz - hz || r.bounds.maxZ > cz + hz)).map((r) => r.id)
  if (out.length) doc = ok(deleteRecords(doc, out), 'outside the play area')
  // Zombie zones of the outer forest blocks are cut to the play area.
  for (const c of [...doc.chunks.values()]) {
    for (const z of c.zones) {
      if (z.shape !== 'rect') continue
      const o = chunkOrigin(c.cx, c.cz, doc.world.chunkSize)
      const zc = { x: o.x + z.center.x, z: o.z + z.center.z }
      const r = rect(Math.max(zc.x - z.size[0] / 2, cx - hx + 1), Math.max(zc.z - z.size[1] / 2, cz - hz + 1), Math.min(zc.x + z.size[0] / 2, cx + hx - 1), Math.min(zc.z + z.size[1] / 2, cz + hz - 1))
      const size: [number, number] = [quantize(r.maxX - r.minX), quantize(r.maxZ - r.minZ)]
      if (size[0] === z.size[0] && size[1] === z.size[1]) continue
      doc = ok(updateRecord(doc, z.zoneId, { size }), z.zoneId)
      doc = ok(moveRecords(doc, [z.zoneId], { x: quantize((r.minX + r.maxX) / 2 - zc.x), z: quantize((r.minZ + r.maxZ) / 2 - zc.z) }), z.zoneId)
    }
  }
  // Deleting published nothing: these IDs never existed in a released world.
  doc = { ...doc, world: { ...doc.world, retiredIds: (doc.world.retiredIds ?? []).filter((id) => !out.includes(id)) } }
  if (!doc.world.retiredIds?.length) delete doc.world.retiredIds
}
// Prefabs holding a library prefab's content record where they came from (the library panel then tracks them).
{
  const prefabs = new Map(doc.prefabs)
  for (const [id, p] of prefabs) {
    const lp = lib.prefabs.get(id)
    if (lp && !p.source && prefabHash(p) === prefabHash(lp)) prefabs.set(id, { ...p, source: { library: lib.worldId, id, version: lp.contentVersion, hash: prefabHash(lp) } })
  }
  doc = { ...doc, prefabs }
}
// Old saves (content v1) load into the town through a content migration: no ID of the old
// neighbourhood changed, the town only adds.
doc = ok(writeContentMigration(doc, old, {}), 'content migration')

const issues = validateDocument(doc, OPTS)
const bad = issues.filter((i) => i.severity === 'error')
if (bad.length) {
  for (const i of bad.slice(0, 20)) console.log(`  ERROR ${i.code} ${i.path}: ${i.message}`)
  throw new Error(`${bad.length} errors`)
}
const warnings = issues.filter((i) => i.severity === 'warning')
const byCode = new Map<string, number>()
for (const w of warnings) byCode.set(w.code, (byCode.get(w.code) ?? 0) + 1)
console.log(`warnings: ${JSON.stringify(Object.fromEntries(byCode))}`)

rmSync(join(DIR, 'chunks'), { recursive: true, force: true })
let written = 0
for (const [path, value] of documentFiles(doc)) {
  const file = join(DIR, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, formatJson(value))
  written++
}
const counts = { chunks: doc.world.chunks.length, prefabs: doc.prefabs.size, instances: 0, objects: 0, roads: 0, spawns: 0 }
for (const c of doc.chunks.values() as Iterable<ChunkDocument>) {
  counts.instances += c.instances.length
  counts.objects += c.objects.length
  counts.roads += c.roads.length
  counts.spawns += c.spawns.length
}
console.log(`${DIR}: ${written} files; ${JSON.stringify(counts)}; content v${doc.world.contentVersion}`)
void existsSync
