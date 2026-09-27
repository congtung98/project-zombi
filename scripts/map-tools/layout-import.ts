// GeoJSON → WorldLayout (world generator WG1).
// Usage:
//   node scripts/map-tools/layout-import.ts <file.geojson> --id <layout-id> [--name "…"]
//        [--out <file>.layout.json] [--svg <preview>.svg] [--force]
//        [--crs auto|wgs84|web-mercator|local-metres] [--origin <lon>,<lat> | <x>,<y>] [--clip <W>x<D>]
//        [--grid 1] [--align auto|<deg>] [--simplify 2] [--axis-tolerance 20] [--stair-step 24]
//        [--max-deviation 5] [--max-length-change 0.25] [--join 1] [--default-zone residential]
//        [--attribution "…"] [--max-extent 500] [--no-normalize]
// Reads a local file only (no network). The same file and options give a byte-identical layout.
// Re-importing over an existing layout (--force) keeps its projection origin unless --origin is
// given, so node and road IDs stay stable. Exit code 1 when the import has errors or the snapped
// network is invalid (the files are still written for inspection).
// Requires Node ≥ 22.18 (built-in TypeScript stripping).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { importGeoJsonLayout, LayoutImportError, parseWorldLayout, serializeWorldLayout } from '../../src/map/layout/importer.ts'
import { layoutPreviewSvg } from '../../src/map/layout/preview.ts'
import type { GeoPoint, LandUseZone, LayoutIssue, OrthogonalParams, SourceCrs } from '../../src/map/layout/schema.ts'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const num = (name: string) => (opt(name) !== undefined ? Number(opt(name)) : undefined)

const file = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--') || ['force', 'no-normalize'].includes(args[i - 1].slice(2))))
const layoutId = opt('id')
if (!file || !layoutId) {
  console.log('usage: node scripts/map-tools/layout-import.ts <file.geojson> --id <layout-id> [--out …] [--svg …] (xem đầu file)')
  process.exit(1)
}
const out = opt('out') ?? `${layoutId}.layout.json`
const svg = opt('svg')
for (const target of [out, svg]) {
  if (target && existsSync(target) && !flag('force')) {
    console.log(`${target} đã tồn tại: thêm --force để ghi đè`)
    process.exit(1)
  }
}

const crs = (opt('crs') ?? 'auto') as 'auto' | SourceCrs
let origin: GeoPoint | { x: number; y: number } | undefined
const originArg = opt('origin')
if (originArg) {
  const [a, b] = originArg.split(',').map(Number)
  origin = crs === 'local-metres' ? { x: a, y: b } : { lon: a, lat: b }
} else if (existsSync(out)) {
  // Keep the previous projection origin so IDs stay stable across re-imports.
  try {
    const prev = parseWorldLayout(readFileSync(out, 'utf8'))
    origin = prev.projection.origin
    console.log(`giữ gốc chiếu của ${out}: ${JSON.stringify(origin)}`)
  } catch {
    // Not a readable layout: start fresh.
  }
}
const clipArg = opt('clip')
const clip = clipArg ? (([w, d]) => ({ width: w, depth: d ?? w }))(clipArg.split('x').map(Number)) : undefined
const align = opt('align')
const normalize: Partial<OrthogonalParams> = {
  alignment: align === undefined || align === 'auto' ? 'auto' : Number(align),
  grid: num('grid'),
  simplify: num('simplify'),
  axisTolerance: num('axis-tolerance'),
  stairStep: num('stair-step'),
  maxDeviation: num('max-deviation'),
  maxLengthChange: num('max-length-change'),
}
for (const k of Object.keys(normalize) as (keyof OrthogonalParams)[]) if (normalize[k] === undefined) delete normalize[k]

const text = readFileSync(file, 'utf8')
let layout
const t0 = performance.now()
try {
  layout = importGeoJsonLayout(text, {
    layoutId,
    name: opt('name') ?? layoutId,
    file: basename(file),
    crs,
    origin,
    clip,
    joinTolerance: num('join'),
    defaultZone: opt('default-zone') as LandUseZone | undefined,
    attribution: opt('attribution'),
    maxExtent: num('max-extent'),
    normalize: flag('no-normalize') ? false : normalize,
  })
} catch (e) {
  if (e instanceof LayoutImportError) {
    console.log(`lỗi: ${e.message}`)
    process.exit(1)
  }
  throw e
}
const ms = performance.now() - t0

const n = layout.normalized
const e = layout.extent
console.log(
  `${layoutId}: ${layout.source.features} feature (${layout.source.crs}) → ${layout.roads.length} đường (${layout.roads.filter((r) => r.network).length} trong mạng lưới), ${layout.network.nodes.length} node, ${layout.network.edges.length} cạnh, ${layout.zones.length} vùng đất, ${layout.restricted.length} vùng cấm, ${layout.buildings.length} nhà, ${layout.parcels.length} lô; phạm vi ${(e.maxX - e.minX).toFixed(0)} × ${(e.maxZ - e.minZ).toFixed(0)} m (${ms.toFixed(0)} ms)`,
)
if (n) {
  const m = n.metrics
  console.log(`nắn lưới: xoay ${n.frame.rotationDeg}°, grid ${n.params.grid} m, node dịch tối đa ${m.maxNodeShift.toFixed(2)} m (TB ${m.meanNodeShift.toFixed(2)}), cạnh lệch tối đa ${m.maxDeviation.toFixed(2)} m, đổi dài tối đa ${(m.maxLengthChange * 100).toFixed(0)} %, ${m.staircaseEdges} cạnh bậc thang — ${n.valid ? 'HỢP LỆ' : 'KHÔNG HỢP LỆ'}`)
}
const print = (title: string, list: LayoutIssue[]) => {
  if (!list.length) return
  console.log(title)
  for (const i of list) console.log(`  ${i.severity.padEnd(7)} ${i.code}: ${i.message}`)
}
print('nhập:', layout.issues)
print('nắn lưới:', n?.issues ?? [])

writeFileSync(out, serializeWorldLayout(layout))
console.log(`${out}: WorldLayout`)
if (svg) {
  writeFileSync(svg, layoutPreviewSvg(layout))
  console.log(`${svg}: preview`)
}
const failed = layout.issues.some((i) => i.severity === 'error') || (n !== null && !n.valid)
process.exit(failed ? 1 : 0)
