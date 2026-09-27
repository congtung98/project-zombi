// Streets, parcels and buildings from a WorldLayout (world generator WG2–WG3).
// Usage:
//   node scripts/map-tools/layout-plan.ts <file>.layout.json [--out <file>] [--svg <preview>.svg]
//     plan (WG2; runs when the layout has no plan, or when one of these is given):
//        [--seed 1] [--profile default|vn-urban] [--sidewalk <m>] [--margin 24] [--no-access]
//        [--blocks <block-id>,…] [--reset]
//     buildings (WG3; --mode full, from the prefab library):
//        [--mode layout-only|full] [--library content/maps/prefab-library]
//        [--regen-parcels <lot-id>,…] [--regen-chunks <chunk-id>,…] [--salt <n>]
//        [--set-prefab <lot-id>=<prefab-id>|none]…
//     world: [--pack <world>.mappack.json --world-id <id> [--name "…"]] (the pack holds the layout as
//        layout/world-layout.json: the editor's Generator tab regenerates it; the game never loads it)
// Writes the plan (with the buildings) into the layout (in place unless --out). An existing plan is
// only recomputed when a plan option is given; the replan keeps locked parcels and hand-chosen
// buildings (and, with --blocks, every parcel outside those blocks); --reset drops everything.
// Buildings are decided for parcels that have none yet; --regen-* decides the selected ones again
// (locked parcels never; --regen-chunks also skips hand-chosen buildings). --set-prefab chooses by hand.
// Same layout, library and options → byte-identical output. Exit code 1 on errors.
// Requires Node ≥ 22.18 (built-in TypeScript stripping).
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOOT_TABLES } from '../../src/game/world/lootTables.ts'
import { exportPack } from '../../src/map/editor/pack.ts'
import { checkBuildings, placeBuildings, prefabCatalog, setParcelPrefab } from '../../src/map/layout/buildings.ts'
import { LayoutImportError, parseWorldLayout, serializeWorldLayout } from '../../src/map/layout/importer.ts'
import type { WorldMode } from '../../src/map/layout/layoutWorld.ts'
import { createLayoutWorld } from '../../src/map/layout/worldSync.ts'
import { LayoutPlanError, planLayout, replan } from '../../src/map/layout/plan.ts'
import { layoutPreviewSvg } from '../../src/map/layout/preview.ts'
import type { LayoutIssue, PlanParams } from '../../src/map/layout/schema.ts'
import type { PrefabEntry, WorldDocument } from '../../src/map/schema.ts'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const all = (name: string) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]] : []))
const file = args[0]
if (!file || file.startsWith('--')) {
  console.log('usage: node scripts/map-tools/layout-plan.ts <file>.layout.json [--mode full] [--out …] [--svg …] [--pack … --world-id …] (xem đầu file)')
  process.exit(1)
}
const fail = (message: string): never => {
  console.log(`lỗi: ${message}`)
  process.exit(1)
}

let layout
try {
  layout = parseWorldLayout(readFileSync(file, 'utf8'))
} catch (e) {
  fail((e as Error).message)
}
layout = layout!
const params: Partial<PlanParams> = {}
if (opt('seed') !== undefined) params.seed = Number(opt('seed'))
if (opt('profile') !== undefined) params.profile = opt('profile')
if (opt('sidewalk') !== undefined) params.sidewalk = Number(opt('sidewalk'))
if (opt('margin') !== undefined) params.margin = Number(opt('margin'))
if (flag('no-access')) params.accessRoads = false
const blocks = opt('blocks')?.split(',')
const mode = (opt('mode') ?? (opt('library') || all('set-prefab').length || opt('regen-parcels') || opt('regen-chunks') ? 'full' : layout.plan?.catalog ? 'full' : 'layout-only')) as WorldMode
const issues: LayoutIssue[] = []

// 1. Plan (WG2).
let plan = layout.plan ?? null
const t0 = performance.now()
try {
  if (!plan || flag('reset')) plan = planLayout(layout, params)
  else if (Object.keys(params).length || blocks) plan = replan(layout, plan, params, blocks)
} catch (e) {
  if (e instanceof LayoutPlanError || e instanceof LayoutImportError) fail(e.message)
  throw e
}
plan = plan!
issues.push(...plan.issues)

// 2. Buildings (WG3).
let catalog = null
if (mode === 'full') {
  const dir = opt('library') ?? 'content/maps/prefab-library'
  const world = JSON.parse(readFileSync(join(dir, 'world.json'), 'utf8')) as WorldDocument
  catalog = prefabCatalog(`${world.worldId}@${world.contentVersion}`, world.prefabs.map((entry: PrefabEntry) => ({ entry, doc: JSON.parse(readFileSync(join(dir, entry.path), 'utf8')) })))
  if (!catalog.prefabs.length) fail(`${dir}: không có prefab nào có metadata placement`)
  const salt = opt('salt') !== undefined ? Number(opt('salt')) : undefined
  let r = placeBuildings(plan, catalog, { salt })
  issues.push(...r.issues)
  if (opt('regen-parcels') || opt('regen-chunks')) {
    r = placeBuildings(r.plan, catalog, { parcels: opt('regen-parcels')?.split(','), chunks: opt('regen-chunks')?.split(','), salt: salt ?? 1 })
    issues.push(...r.issues)
  }
  plan = r.plan
  for (const spec of all('set-prefab')) {
    const [parcel, prefab] = spec.split('=')
    const s = setParcelPrefab(plan, catalog, parcel, prefab === 'none' ? null : prefab)
    issues.push(...s.issues)
    plan = s.plan
  }
  issues.push(...checkBuildings(plan, catalog))
}
const ms = performance.now() - t0

layout = { ...layout, plan }
const m = plan.metrics
const a = plan.area
const built = plan.parcels.filter((q) => q.build && q.build.prefabId !== null)
console.log(
  `${layout.layoutId}: profile ${plan.params.profile}, seed ${plan.params.seed} → ${m.asphalt} mặt nhựa, ${m.dirt} mặt đất, ${m.sidewalks} vỉa hè, ${m.accessRoads} đường vào; ${m.blocks} khối, ${m.parcels} lô (${m.lots} mặt tiền, ${m.open} đất trống, ${m.interior} bên trong)${mode === 'full' ? `; ${built.length} công trình từ ${catalog!.id}` : ''}; vùng ${a.maxX - a.minX} × ${a.maxZ - a.minZ} m (${ms.toFixed(0)} ms)`,
)
for (const i of issues) console.log(`  ${i.severity.padEnd(7)} ${i.code}: ${i.message}`)

const out = opt('out') ?? file
writeFileSync(out, serializeWorldLayout(layout))
console.log(`${out}: WorldLayout + kế hoạch`)
const svg = opt('svg')
if (svg) {
  writeFileSync(svg, layoutPreviewSvg(layout))
  console.log(`${svg}: preview`)
}
const pack = opt('pack')
if (pack) {
  const worldId = opt('world-id') ?? layout.layoutId
  const doc = createLayoutWorld(layout, { worldId, name: opt('name') ?? layout.name, mode, catalog: catalog ?? undefined, validation: { lootTables: new Set(Object.keys(LOOT_TABLES)) } })
  writeFileSync(pack, exportPack(doc))
  const count = (k: 'roads' | 'instances' | 'zones' | 'spawns') => [...doc.chunks.values()].reduce((n, c) => n + c[k].length, 0)
  console.log(`${pack}: content pack ${mode} (${doc.world.chunks.length} chunk, ${count('roads')} mặt đường, ${count('instances')} công trình, ${count('zones')} zone zombie, ${count('spawns')} spawn) — mở bằng Import… trong editor hoặc npm run map:unpack`)
}
process.exit(issues.some((i) => i.severity === 'error') ? 1 : 0)
