// Offline town generator (map editor M6) → content folder or content pack.
// Usage:
//   node scripts/map-tools/generate.ts --seed 42 --blocks 2x2 --world-id gen-42 [--name "…"]
//        [--layout grid|varied] [--trees 0..1]
//        [--catalog content/maps/neighborhood-50] [--out content/maps/<world-id>] [--pack file.mappack.json]
//        [--force] [--dry]
// Same seed + blocks + layout + trees + catalog + generator version → byte-identical files. An existing folder is
// never overwritten without --force, and never if it was edited by hand: the tool regenerates the
// world from its recorded `generator` metadata and refuses unless the files on disk still match.
// Requires Node ≥ 22.18 (built-in TypeScript stripping).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { LOOT_TABLES } from '../../src/game/world/lootTables.ts'
import { formatJson } from '../../src/map/format.ts'
import { documentFiles } from '../../src/map/editor/document.ts'
import { exportPack } from '../../src/map/editor/pack.ts'
import { DEFAULT_TREES, GENERATOR_NAME, GENERATOR_VERSION, generateTown, type Catalog, type Layout } from '../../src/map/tools/generator.ts'
import type { PrefabEntry, WorldDocument } from '../../src/map/schema.ts'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const seed = Number(opt('seed') ?? 1)
const [blocksX, blocksZ] = (opt('blocks') ?? '2x2').split('x').map(Number)
const layout = (opt('layout') ?? 'grid') as Layout
const trees = Number(opt('trees') ?? DEFAULT_TREES)
const worldId = opt('world-id') ?? `gen-${seed}`
const name = opt('name') ?? `Thị trấn sinh tự động (seed ${seed})`
const catalogDir = opt('catalog') ?? 'content/maps/neighborhood-50'
const out = opt('out') ?? `content/maps/${worldId}`
const lootTables = new Set(Object.keys(LOOT_TABLES))

function readCatalog(dir: string): Catalog {
  const world = JSON.parse(readFileSync(join(dir, 'world.json'), 'utf8')) as WorldDocument
  return {
    id: `${world.worldId}@${world.contentVersion}`,
    prefabs: world.prefabs.map((entry: PrefabEntry) => ({ entry, doc: JSON.parse(readFileSync(join(dir, entry.path), 'utf8')) })),
  }
}

const catalog = readCatalog(catalogDir)
const t0 = performance.now()
const doc = generateTown({ worldId, name, seed, blocksX, blocksZ, layout, trees }, catalog, { lootTables })
const ms = performance.now() - t0
const counts = [...doc.chunks.values()].reduce(
  (n, c) => ({ instances: n.instances + c.instances.length, trees: n.trees + c.objects.filter((o) => o.kind === 'tree').length, objects: n.objects + c.objects.filter((o) => o.kind !== 'tree').length, spawns: n.spawns + c.spawns.length, parks: n.parks + c.zones.filter((z) => z.name.startsWith('Công viên')).length }),
  { instances: 0, trees: 0, objects: 0, spawns: 0, parks: 0 },
)
const area = doc.world.playArea
console.log(
  `${worldId}: seed ${seed}, ${blocksX}×${blocksZ} blocks (${layout}${counts.parks ? `, ${counts.parks} park(s)` : ''}), play area ${area.size} × ${area.depth ?? area.size} m, ${doc.world.chunks.length} chunks, ${counts.instances} buildings, ${counts.trees} trees, ${counts.objects} other objects, ${counts.spawns} spawns (${ms.toFixed(0)} ms)`,
)
if (flag('dry')) process.exit(0)

const pack = opt('pack')
if (pack) {
  writeFileSync(pack, exportPack(doc))
  console.log(`${pack}: content pack (open it in the editor with Import…)`)
  process.exit(0)
}

/** Files of a world folder on disk, by relative path. */
function filesOn(dir: string): Map<string, string> {
  const list = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? list(join(d, e.name)) : e.name.endsWith('.json') ? [join(d, e.name)] : []))
  return new Map(list(dir).map((f) => [relative(dir, f).replace(/\\/g, '/'), readFileSync(f, 'utf8').replace(/\r\n/g, '\n')]))
}

if (existsSync(join(out, 'world.json'))) {
  if (!flag('force')) {
    console.log(`${out} exists: pass --force to replace a generated, unedited world`)
    process.exit(1)
  }
  const existing = JSON.parse(readFileSync(join(out, 'world.json'), 'utf8')) as WorldDocument
  const g = existing.generator
  if (!g || g.name !== GENERATOR_NAME || g.version !== GENERATOR_VERSION) {
    console.log(`${out}: not produced by ${GENERATOR_NAME} v${GENERATOR_VERSION}; refusing to overwrite (hand-made or another generator version)`)
    process.exit(1)
  }
  const again = generateTown(
    { worldId: existing.worldId, name: existing.name, seed: g.seed, blocksX: Number(g.params.blocksX), blocksZ: Number(g.params.blocksZ), layout: g.params.layout as Layout, trees: Number(g.params.trees) },
    catalog,
    { lootTables },
  )
  const want = new Map(documentFiles(again).map(([p, v]) => [p, formatJson(v)]))
  const have = filesOn(out)
  const edited = [...new Set([...want.keys(), ...have.keys()])].filter((p) => want.get(p) !== have.get(p))
  if (edited.length) {
    console.log(`${out}: edited since it was generated (${edited.slice(0, 5).join(', ')}${edited.length > 5 ? ' …' : ''}); refusing to overwrite. Generate into another folder.`)
    process.exit(1)
  }
}

for (const [path, value] of documentFiles(doc)) {
  const file = join(out, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, formatJson(value))
}
console.log(`${out}: ${documentFiles(doc).length} files written — npm run map:check, then play with /?world=${worldId} (dev) or open in the editor`)
