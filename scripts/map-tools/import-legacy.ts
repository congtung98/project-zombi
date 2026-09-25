// Import a legacy resolved map (MapData JSON) into prefab + chunk documents.
// Usage: node scripts/map-tools/import-legacy.ts <legacy-map.json> <world-dir> --world-id <id> --name <name> [--chunk-size 32] [--legacy-save-version 7]
// Writes world.json, prefabs/*.json, chunks/*.json and migrations/legacy-v<N>-ids.json; refuses to
// overwrite an existing world.json unless --force.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { formatJson } from '../../src/map/format.ts'
import { importLegacyMap, type LegacyMap } from '../../src/map/tools/importLegacy.ts'

const args = process.argv.slice(2)
const flag = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`)
  if (i >= 0) return args[i + 1]
  if (fallback === undefined) throw new Error(`--${name} is required`)
  return fallback
}
const [source, out] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
if (!source || !out) throw new Error('usage: import-legacy.ts <legacy-map.json> <world-dir> --world-id <id> --name <name>')
if (existsSync(join(out, 'world.json')) && !args.includes('--force')) throw new Error(`${out}/world.json exists (use --force)`)

const legacySaveVersion = Number(flag('legacy-save-version', '7'))
const imported = importLegacyMap(JSON.parse(readFileSync(source, 'utf8')) as LegacyMap, {
  worldId: flag('world-id'),
  name: flag('name'),
  chunkSize: Number(flag('chunk-size', '32')),
  legacySaveVersion,
})
const write = (path: string, value: unknown) => {
  mkdirSync(dirname(join(out, path)), { recursive: true })
  writeFileSync(join(out, path), formatJson(value))
}
write('world.json', imported.world)
for (const p of imported.prefabs) write(imported.world.prefabs.find((e) => e.prefabId === p.prefabId)!.path, p)
for (const c of imported.chunks) write(imported.world.chunks.find((e) => e.chunkId === c.chunkId)!.path, c)
write(`migrations/legacy-v${legacySaveVersion}-ids.json`, imported.ids)
console.log(`imported ${imported.prefabs.length} prefabs, ${imported.chunks.length} chunks into ${out}`)
