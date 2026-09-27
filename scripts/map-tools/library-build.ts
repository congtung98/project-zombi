// Prefab library P2–P5: add a sprint's prefabs and compounds to the library world (content/maps/
// prefab-library) and lay them out in a new showroom band south of what is there: building prefabs
// as instances, compounds as their groups (placed with the editor's own placeCompound), new chunks
// as needed and the play area fitted to them. Afterwards the library is content: edit it in the editor.
// Usage: node scripts/map-tools/library-build.ts <p2|p3|p4|p5> [--dir content/maps/prefab-library]
// Refuses when an entry of that sprint already exists. Requires Node ≥ 22.18 (TypeScript stripping).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { LOOT_TABLES } from '../../src/game/world/lootTables.ts'
import { formatJson } from '../../src/map/format.ts'
import { documentFiles, resolvedRecords, withExternalRefs, type MapDocument } from '../../src/map/editor/document.ts'
import { addChunk, fittedPlayArea, placeInstance, updateWorld, type CommandResult } from '../../src/map/editor/commands.ts'
import { uniquePrefabPath } from '../../src/map/editor/prefabCommands.ts'
import { compoundPath, libraryFromDocument, placeCompound } from '../../src/map/editor/library.ts'
import { documentFromFiles, validateDocument } from '../../src/map/editor/pack.ts'
import { chunkIndex } from '../../src/map/transform.ts'
import type { CompoundDocument, PrefabDocument, Rect } from '../../src/map/schema.ts'

const args = process.argv.slice(2)
const sprint = args.find((a) => /^p[2-5]$/.test(a))
if (!sprint) throw new Error('usage: library-build.ts <p2|p3|p4|p5> [--dir <world-dir>]')
const i = args.indexOf('--dir')
const dir = i >= 0 ? args[i + 1] : 'content/maps/prefab-library'
const OPTS = { lootTables: new Set(Object.keys(LOOT_TABLES)) }

const content: { prefabs: PrefabDocument[]; compounds: CompoundDocument[] } = await (async () => {
  switch (sprint) {
    case 'p2':
      return { prefabs: (await import('./library/p2-houses.ts')).p2(), compounds: [] }
    case 'p3':
      return (await import('./library/p3-services.ts')).p3()
    case 'p4':
      return (await import('./library/p4-public.ts')).p4()
    default:
      return (await import('./library/p5-landscape.ts')).p5()
  }
})()

const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.json') ? [join(d, e.name)] : []))
const files = new Map(walk(dir).map((f) => [relative(dir, f).replace(/\\/g, '/'), JSON.parse(readFileSync(f, 'utf8')) as unknown]))
const opened = documentFromFiles(files, OPTS)
if (!opened.ok) throw new Error(opened.error)
let doc: MapDocument = opened.doc
const ok = (r: CommandResult, what: string): MapDocument => {
  if (!r.ok) throw new Error(`${what}: ${r.error}`)
  return r.doc
}
for (const p of content.prefabs) if (doc.prefabs.has(p.prefabId)) throw new Error(`${dir}: ${p.prefabId} đã có (thư viện là nội dung: sửa trong editor)`)
for (const c of content.compounds) if (doc.extras.has(compoundPath(c.compoundId))) throw new Error(`${dir}: ${c.compoundId} đã có`)

// 1. The prefabs and compound files.
{
  let world = doc.world
  const prefabs = new Map(doc.prefabs)
  for (const p of content.prefabs) {
    world = { ...world, prefabs: [...world.prefabs, { prefabId: p.prefabId, contentVersion: p.contentVersion, path: uniquePrefabPath({ ...doc, world }, p.prefabId) }] }
    prefabs.set(p.prefabId, p)
  }
  const extras = new Map(doc.extras)
  for (const c of content.compounds) extras.set(compoundPath(c.compoundId), c)
  doc = withExternalRefs({ ...doc, world, prefabs, extras })
}

// 2. A showroom band south of everything: rows of entries 8 m apart, from x −100 to 150.
const bounds = (r: Rect, x: number, z: number): Rect => ({ minX: x + r.minX, minZ: z + r.minZ, maxX: x + r.maxX, maxZ: z + r.maxZ })
const all = resolvedRecords(doc)
let top = Math.max(...all.map((r) => r.bounds.maxZ)) + 10
const X0 = -100
const X1 = 150
const GAP = 8
type Entry = { kind: 'prefab' | 'compound'; id: string; area: Rect }
const lib = () => libraryFromDocument(doc, OPTS)
const entries: Entry[] = [
  ...content.prefabs.map((p) => ({ kind: 'prefab' as const, id: p.prefabId, area: p.footprint })),
  ...content.compounds.map((c) => ({ kind: 'compound' as const, id: c.compoundId, area: c.footprint })),
]
let x = X0
let rowDepth = 0
const ensureChunks = (r: Rect) => {
  const S = doc.world.chunkSize
  for (let cz = chunkIndex(r.minZ - 4, S); cz <= chunkIndex(r.maxZ + 4, S); cz++) {
    for (let cx = chunkIndex(r.minX - 4, S); cx <= chunkIndex(r.maxX + 4, S); cx++) {
      if (!doc.chunks.has(`c${cx}_${cz}`)) doc = ok(addChunk(doc, cx, cz), `chunk ${cx},${cz}`)
    }
  }
}
for (const e of entries) {
  const w = e.area.maxX - e.area.minX
  const d = e.area.maxZ - e.area.minZ
  if (x + w > X1 && x > X0) {
    top += rowDepth + GAP
    x = X0
    rowDepth = 0
  }
  // Snap the pivot to the 0.5 m navigation grid.
  const px = Math.round((x - e.area.minX) * 2) / 2
  const pz = Math.round((top - e.area.minZ) * 2) / 2
  ensureChunks(bounds(e.area, px, pz))
  doc = e.kind === 'prefab' ? ok(placeInstance(doc, e.id, { x: px, z: pz }, 0), e.id) : ok(placeCompound(doc, lib(), e.id, { x: px, z: pz }, 0), e.id)
  x += w + GAP
  rowDepth = Math.max(rowDepth, d)
}
// Fill the chunk rectangle (the play area covers it) and fit the play area.
{
  const b = doc.world.chunkBounds
  for (let cz = b.minCz; cz <= b.maxCz; cz++) for (let cx = b.minCx; cx <= b.maxCx; cx++) if (!doc.chunks.has(`c${cx}_${cz}`)) doc = ok(addChunk(doc, cx, cz), `chunk ${cx},${cz}`)
  doc = ok(updateWorld(doc, { playArea: fittedPlayArea(doc.world) }), 'play area')
}

const issues = validateDocument(doc, OPTS).filter((x) => x.severity === 'error')
if (issues.length) {
  for (const x of issues.slice(0, 20)) console.log(`  ERROR ${x.code} ${x.path}: ${x.message}`)
  throw new Error(`${issues.length} lỗi`)
}
const l = lib()
if (l.issues.length) throw new Error(l.issues.map((x) => `${x.path}: ${x.message}`).join('; '))
let written = 0
for (const [path, value] of documentFiles(doc)) {
  const file = join(dir, path)
  if (existsSync(file) && isDeepStrictEqual(JSON.parse(readFileSync(file, 'utf8')), value)) continue
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, formatJson(value))
  written++
}
console.log(`${dir}: ${sprint}: ${content.prefabs.length} prefab, ${content.compounds.length} compound; ${written} file(s) written; library ${l.prefabs.size} prefabs, ${l.compounds.size} compounds; ${doc.world.chunks.length} chunks`)
