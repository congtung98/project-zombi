// Write an editor content pack (Export → *.mappack.json) into a world folder the game bundles.
// Usage: node scripts/map-tools/unpack.ts <pack.json> [--out content/maps/<worldId>] [--force]
//                                          [--world-id <new-id> [--name <name>]]
// The pack is validated first (same validator as the game); nothing is written if it has errors.
// --world-id writes the pack as a new world (same as the editor's "Lưu thành…": contentVersion 1,
// without the source world's save migrations); --name renames it. Overwriting an existing world needs --force. Files whose data did not change are left untouched
// (keeps frozen migration files byte for byte); files on disk that the pack no longer lists are
// reported, never deleted. Requires Node ≥ 22.18 (built-in TypeScript stripping).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { LOOT_TABLES } from '../../src/game/world/lootTables.ts'
import { formatJson } from '../../src/map/format.ts'
import { documentFiles, forkDocument } from '../../src/map/editor/document.ts'
import { SLUG } from '../../src/map/transform.ts'
import { parsePack } from '../../src/map/editor/pack.ts'

const args = process.argv.slice(2)
const VALUE_FLAGS = ['--out', '--world-id', '--name']
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const source = args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(args[i - 1]))
if (!source) throw new Error('usage: unpack.ts <pack.json> [--out <world-dir>] [--force] [--world-id <new-id> [--name <name>]]')
const newId = flag('--world-id')
if (newId !== undefined && !SLUG.test(newId)) throw new Error(`--world-id ${newId}: lowercase letters, digits and hyphens`)
if (flag('--name') !== undefined && newId === undefined) throw new Error('--name needs --world-id')

const result = parsePack(readFileSync(source, 'utf8'), { lootTables: new Set(Object.keys(LOOT_TABLES)) })
if (!result.ok) {
  console.log(`${source}: ${result.error}`)
  for (const i of result.issues) console.log(`  ${i.severity.toUpperCase()} ${i.code} ${i.path}${i.entityId ? ` [${i.entityId}]` : ''}: ${i.message}`)
  process.exit(1)
}
const doc = newId === undefined ? result.doc : forkDocument(result.doc, newId, flag('--name') ?? result.doc.world.name)
if (newId !== undefined) console.log(`${source}: world ${result.doc.world.worldId} → new world ${newId} (content v1, save migrations of the source dropped)`)
const out = flag('--out') ?? join('content/maps', doc.world.worldId)
if (existsSync(join(out, 'world.json')) && !args.includes('--force')) throw new Error(`${out}/world.json exists (use --force to overwrite)`)

let written = 0
let unchanged = 0
const listed = new Set<string>()
for (const [path, value] of documentFiles(doc)) {
  listed.add(path)
  const file = join(out, path)
  if (existsSync(file) && isDeepStrictEqual(JSON.parse(readFileSync(file, 'utf8')), value)) {
    unchanged++
    continue
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, formatJson(value))
  written++
}
const onDisk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? onDisk(join(dir, e.name)) : e.name.endsWith('.json') ? [join(dir, e.name)] : []))
const stale = onDisk(out).map((f) => relative(out, f).replace(/\\/g, '/')).filter((p) => !listed.has(p))
console.log(`${out}: ${written} file(s) written, ${unchanged} unchanged (world ${doc.world.worldId}, content v${doc.world.contentVersion})`)
for (const i of result.issues) console.log(`  ${i.severity.toUpperCase()} ${i.code} ${i.path}: ${i.message}`)
if (stale.length) console.log(`  not in the pack (left in place, the game ignores files the manifest does not list): ${stale.join(', ')}`)
