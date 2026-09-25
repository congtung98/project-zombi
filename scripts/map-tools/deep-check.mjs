// Deep map checks (map editor M6) from the command line: reachability with every door open,
// interaction reach + line of sight, collider overlaps, containers outside rooms, indoor spawns.
// They run the game's own NavGrid/interaction code, so this loads src/map/analysis.ts through
// Vite (module graph, import.meta.glob) instead of plain Node.
// Usage: node scripts/map-tools/deep-check.mjs [world-dir ...]   (npm run map:check -- --deep)
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'

const root = 'content/maps'
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(root).map((d) => join(root, d)).filter((d) => existsSync(join(d, 'world.json')))
const server = await createServer({ configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } })
let failed = false
try {
  const { deepCheck } = await server.ssrLoadModule('/src/map/analysis.ts')
  const { loadWorldDocuments } = await server.ssrLoadModule('/src/map/validate.ts')
  const { LOOT_TABLES } = await server.ssrLoadModule('/src/game/world/lootTables.ts')
  for (const dir of dirs) {
    let docs
    try {
      docs = loadWorldDocuments((path) => JSON.parse(readFileSync(join(dir, path), 'utf8')), { lootTables: new Set(Object.keys(LOOT_TABLES)) }).docs
    } catch (e) {
      failed = true
      console.log(`${dir}: FAILED validation (run npm run map:check first): ${e.message}`)
      continue
    }
    const r = deepCheck(docs)
    console.log(`${dir}: deep check ${r.issues.length ? `${r.issues.length} warning(s)` : 'OK'} (${r.ms.toFixed(0)} ms)`)
    for (const i of r.issues) console.log(`  WARNING ${i.code} ${i.path}${i.entityId ? ` [${i.entityId}]` : ''}: ${i.message}`)
  }
} finally {
  await server.close()
}
process.exit(failed ? 1 : 0)
