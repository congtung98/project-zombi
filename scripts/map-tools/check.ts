// Validate map content on disk (schema, IDs, ownership references, spawns, loot tables).
// Usage: node scripts/map-tools/check.ts [world-dir ...]   (default: every folder in content/maps)
// Exit code 1 when any world has errors. Requires Node ≥ 22.18 (built-in TypeScript stripping).
// `--deep` then runs the deep checks (M6, through Vite: scripts/map-tools/deep-check.mjs).
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOOT_TABLES } from '../../src/game/world/lootTables.ts'
import { loadWorldDocuments, MapContentError, type ValidationIssue } from '../../src/map/validate.ts'

const root = 'content/maps'
const deep = process.argv.includes('--deep')
const args = process.argv.slice(2).filter((a) => a !== '--deep')
const dirs = args.length ? args : readdirSync(root).map((d) => join(root, d)).filter((d) => existsSync(join(d, 'world.json')))
let failed = false
for (const dir of dirs) {
  let issues: ValidationIssue[]
  try {
    const loaded = loadWorldDocuments((path) => JSON.parse(readFileSync(join(dir, path), 'utf8')), { lootTables: new Set(Object.keys(LOOT_TABLES)) })
    const records = [...loaded.docs.chunks.values()].reduce((n, c) => n + c.instances.length + c.objects.length + c.roads.length + c.zones.length + c.spawns.length, 0)
    console.log(`${dir}: OK — ${loaded.docs.world.chunks.length} chunks, ${loaded.docs.prefabs.size} prefabs, ${records} records`)
    issues = loaded.issues
  } catch (e) {
    if (!(e instanceof MapContentError)) throw e
    failed = true
    console.log(`${dir}: FAILED`)
    issues = e.issues
  }
  for (const i of issues) console.log(`  ${i.severity.toUpperCase()} ${i.code} ${i.path}${i.entityId ? ` [${i.entityId}]` : ''}: ${i.message}`)
}
if (deep && !failed) {
  try {
    execFileSync(process.execPath, ['scripts/map-tools/deep-check.mjs', ...dirs], { stdio: 'inherit' })
  } catch {
    failed = true
  }
}
process.exit(failed ? 1 : 0)
