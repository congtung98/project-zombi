// Check that the game build (dist/, from `npm run build`) contains no map editor or generator code,
// and (M10) that every world except the default one is its own lazily loaded chunk.
// Usage: node scripts/check-game-bundle.mjs [dist-dir]
// Markers are strings only those modules contain (object keys and literals survive minification).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? 'dist'
const MARKERS = [
  ['editor drafts database', 'zombie-outbreak-editor'],
  ['editor content pack', 'zombie-outbreak/map-pack'],
  ['editor history', 'selectionBefore'],
  ['editor UI', 'Map Editor'],
  ['editor palette presets (M4)', 'surface/asphalt'],
  ['editor layers (M4)', 'Tường / vật cản'],
  ['prefab editor presets (M5)', 'structure/wall-run'],
  ['playtest page (M6)', 'zombie-outbreak/playtest'],
  // Not 'town-grid': generated worlds carry it in world.json provenance (data, in the main bundle).
  ['town generator (M6)', 'blocksX/blocksZ must be integers'],
  ['deep checks (M6)', 'interaction-unreachable'],
  ['tile generator', 'extraZombieSpawns'],
  ['legacy importer', 'is not a quarter turn'],
  ['frozen test content', 'src/test/fixtures'],
]
const files = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]))
const list = files(dir).filter((f) => /\.(js|html|css)$/.test(f))
let bad = 0
for (const f of list) {
  const text = readFileSync(f, 'utf8')
  for (const [what, marker] of MARKERS) {
    if (text.includes(marker)) {
      console.log(`FOUND ${what} ("${marker}") in ${f}`)
      bad++
    }
  }
}
// M10: worlds other than the default one load on demand, one chunk each, never from the entry.
const DEFAULT_WORLD = 'neighborhood-50'
const lazyWorlds = existsSync('content/maps')
  ? readdirSync('content/maps', { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== DEFAULT_WORLD && readdirSync(join('content/maps', e.name)).some((f) => f !== 'world.json')).map((e) => e.name)
  : []
const assets = list.map((f) => f.replace(/\\/g, '/'))
for (const world of lazyWorlds) {
  if (!assets.some((f) => f.includes(`/world-${world}-`) && f.endsWith('.js'))) {
    console.log(`MISSING chunk world-${world}-*.js (the world would be in the main bundle)`)
    bad++
  }
}
for (const f of list) {
  if (/[\\/]world-[^\\/]+\.js$/.test(f)) continue
  const text = readFileSync(f, 'utf8')
  if (/from\s*["']\.\/world-|<link[^>]+world-|<script[^>]+world-/.test(text)) {
    console.log(`STATIC world chunk import in ${f}`)
    bad++
  }
}
console.log(bad ? `${dir}: ${bad} problem(s)` : `${dir}: OK — ${list.length} files, no editor/generator code, ${lazyWorlds.length} world(s) loaded on demand`)
process.exit(bad ? 1 : 0)
