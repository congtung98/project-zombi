// Bundle a world folder into one content pack the editor can Import.
// Usage: node scripts/map-tools/pack.ts <world-dir> [out.mappack.json]   (default: <worldId>.mappack.json)
// Requires Node ≥ 22.18 (built-in TypeScript stripping).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { LOOT_TABLES } from '../../src/game/world/lootTables.ts'
import { documentFromFiles, exportPack } from '../../src/map/editor/pack.ts'

const [dir, target] = process.argv.slice(2)
if (!dir) throw new Error('usage: pack.ts <world-dir> [out.mappack.json]')
const list = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? list(join(d, e.name)) : e.name.endsWith('.json') ? [join(d, e.name)] : []))
const files = new Map(list(dir).sort().map((f) => [relative(dir, f).replace(/\\/g, '/'), JSON.parse(readFileSync(f, 'utf8')) as unknown]))
const result = documentFromFiles(files, { lootTables: new Set(Object.keys(LOOT_TABLES)) })
if (!result.ok) {
  console.log(`${dir}: ${result.error}`)
  for (const i of result.issues) console.log(`  ${i.severity.toUpperCase()} ${i.code} ${i.path}: ${i.message}`)
  process.exit(1)
}
const out = target ?? `${result.doc.world.worldId}.mappack.json`
writeFileSync(out, exportPack(result.doc))
console.log(`${out}: ${files.size} files from ${dir}`)
