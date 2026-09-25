// Check that the game build (dist/, from `npm run build`) contains no map editor or generator code.
// Usage: node scripts/check-game-bundle.mjs [dist-dir]
// Markers are strings only those modules contain (object keys and literals survive minification).
import { readdirSync, readFileSync } from 'node:fs'
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
  ['tile generator', 'extraZombieSpawns'],
  ['legacy importer', 'is not a quarter turn'],
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
console.log(bad ? `${dir}: ${bad} editor/generator marker(s) found` : `${dir}: OK — ${list.length} files, no editor/generator code`)
process.exit(bad ? 1 : 0)
