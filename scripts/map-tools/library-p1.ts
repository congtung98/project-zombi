// Prefab library P1: library metadata of the prefab-library world (group, architecture style, tags)
// and one sample compound (a house in its garden with a pond), made with the editor's own commands,
// so the shared library shows both kinds of entries. Content afterwards: edit it in the editor.
// Usage: node scripts/map-tools/library-p1.ts [--dir content/maps/prefab-library]
// Refuses to run twice (the sample compound exists). Requires Node ≥ 22.18 (built-in TypeScript stripping).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { LOOT_TABLES } from '../../src/game/world/lootTables.ts'
import { formatJson } from '../../src/map/format.ts'
import { documentFiles, type MapDocument } from '../../src/map/editor/document.ts'
import { placeInstance, placeRecord, updateRecord, type CommandResult } from '../../src/map/editor/commands.ts'
import { updatePrefab } from '../../src/map/editor/prefabCommands.ts'
import { compoundPath, libraryFromDocument, saveCompound } from '../../src/map/editor/library.ts'
import { documentFromFiles } from '../../src/map/editor/pack.ts'
import type { LibraryInfo } from '../../src/map/schema.ts'

const args = process.argv.slice(2)
const i = args.indexOf('--dir')
const dir = i >= 0 ? args[i + 1] : 'content/maps/prefab-library'
const OPTS = { lootTables: new Set(Object.keys(LOOT_TABLES)) }
const SAMPLE = 'compound/garden-house'
if (existsSync(join(dir, compoundPath(SAMPLE)))) {
  console.log(`${dir}: ${SAMPLE} đã có (thư viện là nội dung: sửa trong editor)`)
  process.exit(1)
}

const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.json') ? [join(d, e.name)] : []))
const files = new Map(walk(dir).map((f) => [relative(dir, f).replace(/\\/g, '/'), JSON.parse(readFileSync(f, 'utf8')) as unknown]))
const opened = documentFromFiles(files, OPTS)
if (!opened.ok) throw new Error(opened.error)
let doc: MapDocument = opened.doc
const ok = (r: CommandResult, what: string): MapDocument => {
  if (!r.ok) throw new Error(`${what}: ${r.error}`)
  return r.doc
}

// 1. How the shared library lists each prefab (D7: mixed styles, Vietnamese first where it applies).
const CATALOG: Record<string, LibraryInfo> = {
  'building/house': { group: 'residential', architectureStyle: 'american', tags: ['1-tang', 'nha-nho'] },
  'building/safehouse': { group: 'residential', tags: ['1-tang', 'an-toan'] },
  'building/store': { group: 'commercial', tags: ['cua-hang', 'tap-hoa'] },
  'building/lab-house': { group: 'residential', architectureStyle: 'american', tags: ['1-tang'] },
  'building/lab-garage': { group: 'industrial', tags: ['garage'] },
  'building/two-storey': { group: 'residential', architectureStyle: 'american', tags: ['2-tang'] },
  'library/corner-shop': { group: 'commercial', architectureStyle: 'vietnamese', tags: ['cua-hang', 'nha-pho'] },
  'library/warehouse': { group: 'industrial', tags: ['kho'] },
  'library/clinic': { group: 'public', tags: ['y-te'] },
  'library/tube-house': { group: 'residential', architectureStyle: 'vietnamese', tags: ['nha-ong', '1-tang'] },
}
for (const [id, catalog] of Object.entries(CATALOG)) doc = ok(updatePrefab(doc, id, { catalog }), id)

// 2. A sample compound east of the showroom street: the house in a lawn, a path to the pavement,
// a pond (water: blocks walking and navigation), a back fence and two trees.
doc = ok(placeInstance(doc, 'building/house', { x: 50, z: 12 }, 0), 'house')
const house = doc.chunks.get('c1_0')!.instances.at(-1)!.instanceId
doc = ok(placeRecord(doc, 'ground/lawn', { x: 50, z: 14 }), 'lawn')
doc = ok(updateRecord(doc, 'c1_0/objects/lawn-1', { size: [20, 14] }), 'lawn size')
doc = ok(placeRecord(doc, 'ground/path', { x: 48, z: 6.5 }), 'path')
doc = ok(updateRecord(doc, 'c1_0/objects/path-1', { size: [1.5, 4] }), 'path size')
doc = ok(placeRecord(doc, 'ground/pond', { x: 56, z: 18.5 }), 'pond')
doc = ok(updateRecord(doc, 'c1_0/objects/pond-1', { size: [8, 4.5] }), 'pond size')
doc = ok(placeRecord(doc, 'object/fence', { x: 50, z: 21 }), 'fence')
doc = ok(updateRecord(doc, 'c1_0/objects/fence-1', { size: [20, 1, 0.15] }), 'fence size')
doc = ok(placeRecord(doc, 'object/tree', { x: 42, z: 18 }), 'tree')
doc = ok(placeRecord(doc, 'object/pine', { x: 43, z: 10 }), 'pine')
const members = [house, 'c1_0/objects/lawn-1', 'c1_0/objects/path-1', 'c1_0/objects/pond-1', 'c1_0/objects/fence-1', 'c1_0/objects/tree-1', 'c1_0/objects/pine-1']
doc = ok(saveCompound(doc, members, { compoundId: SAMPLE, name: 'Nhà vườn có ao (mẫu)', catalog: { group: 'residential', tags: ['mau', 'nha-vuon'] } }), SAMPLE)

const lib = libraryFromDocument(doc, OPTS)
if (lib.issues.length) throw new Error(lib.issues.map((x) => x.message).join('; '))
let written = 0
for (const [path, value] of documentFiles(doc)) {
  const file = join(dir, path)
  if (existsSync(file) && isDeepStrictEqual(JSON.parse(readFileSync(file, 'utf8')), value)) continue
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, formatJson(value))
  written++
}
console.log(`${dir}: ${written} file(s) written; ${lib.prefabs.size} prefabs, ${lib.compounds.size} compound(s)`)
