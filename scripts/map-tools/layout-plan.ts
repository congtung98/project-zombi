// Streets and parcels from a WorldLayout (world generator WG2).
// Usage:
//   node scripts/map-tools/layout-plan.ts <file>.layout.json [--out <file>] [--svg <preview>.svg]
//        [--seed 1] [--profile default|vn-urban] [--sidewalk <m>] [--margin 24] [--no-access]
//        [--blocks <block-id>,…] [--reset]
//        [--pack <world>.mappack.json --world-id <id> [--name "…"]]
// Writes the plan into the layout (in place unless --out). A layout that already has a plan is
// replanned keeping its locked parcels (and, with --blocks, every parcel outside those blocks);
// --reset starts from scratch and drops the locks. --pack also writes a layout-only world (streets,
// fence, player start) as an editor content pack: open it with Import…, or `npm run map:unpack`.
// Same layout and options → byte-identical output. Exit code 1 when the plan has errors.
// Requires Node ≥ 22.18 (built-in TypeScript stripping).
import { readFileSync, writeFileSync } from 'node:fs'
import { exportPack } from '../../src/map/editor/pack.ts'
import { LayoutImportError, parseWorldLayout, serializeWorldLayout } from '../../src/map/layout/importer.ts'
import { buildLayoutWorld } from '../../src/map/layout/layoutWorld.ts'
import { LayoutPlanError, planLayout, replan } from '../../src/map/layout/plan.ts'
import { layoutPreviewSvg } from '../../src/map/layout/preview.ts'
import type { LayoutIssue, PlanParams } from '../../src/map/layout/schema.ts'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const file = args[0]
if (!file || file.startsWith('--')) {
  console.log('usage: node scripts/map-tools/layout-plan.ts <file>.layout.json [--out …] [--svg …] [--pack … --world-id …] (xem đầu file)')
  process.exit(1)
}

let layout
try {
  layout = parseWorldLayout(readFileSync(file, 'utf8'))
} catch (e) {
  console.log(`lỗi: ${(e as Error).message}`)
  process.exit(1)
}
const params: Partial<PlanParams> = {}
if (opt('seed') !== undefined) params.seed = Number(opt('seed'))
if (opt('profile') !== undefined) params.profile = opt('profile')
if (opt('sidewalk') !== undefined) params.sidewalk = Number(opt('sidewalk'))
if (opt('margin') !== undefined) params.margin = Number(opt('margin'))
if (flag('no-access')) params.accessRoads = false
const blocks = opt('blocks')?.split(',')

let plan
const t0 = performance.now()
try {
  if (layout.plan && !flag('reset')) {
    plan = replan(layout, layout.plan, params, blocks)
  } else {
    if (blocks) console.log('--blocks cần một kế hoạch có sẵn: lập kế hoạch mới cho toàn bộ')
    plan = planLayout(layout, params)
  }
} catch (e) {
  if (e instanceof LayoutPlanError || e instanceof LayoutImportError) {
    console.log(`lỗi: ${e.message}`)
    process.exit(1)
  }
  throw e
}
const ms = performance.now() - t0
layout = { ...layout, plan }
const m = plan.metrics
const a = plan.area
console.log(
  `${layout.layoutId}: profile ${plan.params.profile}, seed ${plan.params.seed} → ${m.asphalt} mặt nhựa, ${m.dirt} mặt đất, ${m.sidewalks} vỉa hè, ${m.accessRoads} đường vào; ${m.blocks} khối, ${m.parcels} lô (${m.lots} mặt tiền, ${m.open} đất trống, ${m.interior} bên trong); vùng ${a.maxX - a.minX} × ${a.maxZ - a.minZ} m (${ms.toFixed(0)} ms)`,
)
const print = (list: LayoutIssue[]) => {
  for (const i of list) console.log(`  ${i.severity.padEnd(7)} ${i.code}: ${i.message}`)
}
print(plan.issues)

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
  const doc = buildLayoutWorld(layout, plan, { worldId, name: opt('name') ?? layout.name })
  writeFileSync(pack, exportPack(doc))
  console.log(`${pack}: content pack (${doc.world.chunks.length} chunk, ${[...doc.chunks.values()].reduce((n, c) => n + c.roads.length, 0)} mặt đường) — mở bằng Import… trong editor hoặc npm run map:unpack`)
}
process.exit(plan.issues.some((i) => i.severity === 'error') ? 1 : 0)
