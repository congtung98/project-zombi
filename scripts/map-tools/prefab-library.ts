// Prefab library for the world generator (WG3, owner decision Q6): a hidden world
// (`listed: false`) holding every prefab the generator may place, each with `placement` metadata,
// laid out along one showroom street so it can be opened and edited in the map editor like any world.
// Usage:
//   node scripts/map-tools/prefab-library.ts [--out content/maps/prefab-library] [--force]
// Bootstraps the library: copies the existing houses (neighbourhood, graphics lab, floors lab) and
// builds four placeholder prefabs with the editor's own prefab commands (starter house, wall runs,
// doors, windows, rooms, containers). After that the library is content: edit it in the editor;
// rerun only with --force to start over. Requires Node ≥ 22.18 (built-in TypeScript stripping).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { LOOT_TABLES } from '../../src/game/world/lootTables.ts'
import { formatJson } from '../../src/map/format.ts'
import { documentFiles, withExternalRefs, type MapDocument } from '../../src/map/editor/document.ts'
import { placeInstance, type CommandResult } from '../../src/map/editor/commands.ts'
import { createPrefab, placePrefabItem, updatePrefab, updatePrefabItem } from '../../src/map/editor/prefabCommands.ts'
import { doorSide } from '../../src/map/tools/generator.ts'
import { checkWorldDocuments, hasErrors } from '../../src/map/validate.ts'
import { MAP_SCHEMA_VERSION, RECORD_NAMESPACES, type ChunkDocument, type PrefabDocument, type PrefabPlacement, type QuarterTurns, type WorldDocument } from '../../src/map/schema.ts'
import { chunkIdOf, rotateXZ } from '../../src/map/transform.ts'

const args = process.argv.slice(2)
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const out = opt('out') ?? 'content/maps/prefab-library'
if (existsSync(join(out, 'world.json')) && !args.includes('--force')) {
  console.log(`${out} đã có: thư viện là nội dung, sửa trong editor; thêm --force để dựng lại từ đầu`)
  process.exit(1)
}

function ok(r: CommandResult, what: string): MapDocument {
  if (!r.ok) throw new Error(`${what}: ${r.error}`)
  return r.doc
}

// 1. An empty world: 6 × 2 chunks, one showroom street along z = 0.
const cells: [number, number][] = []
for (let cz = -1; cz <= 0; cz++) for (let cx = -3; cx <= 2; cx++) cells.push([cx, cz])
const chunks = new Map<string, ChunkDocument>()
for (const [cx, cz] of cells) chunks.set(chunkIdOf(cx, cz), { schemaVersion: MAP_SCHEMA_VERSION, contentVersion: 1, chunkId: chunkIdOf(cx, cz), cx, cz, instances: [], objects: [], roads: [], zones: [], spawns: [], externalRefs: [] })
const road = (name: string, cx: number, cz: number, x: number, z: number, size: [number, number], color: string, layer?: number) => {
  const c = chunks.get(chunkIdOf(cx, cz))!
  c.roads.push({ roadId: `${c.chunkId}/${RECORD_NAMESPACES.roads}/${name}`, position: { x, z }, size, color, ...(layer ? { layer } : {}) })
}
// Street (asphalt, layer 2) and its pavements (concrete), each owned by the chunk holding its centre.
// The play area spans x −112…80: the street runs −108…76 (centre −16, in chunk c-1_0).
road('street', -1, 0, 16, 0, [184, 6], '#3a3a3f', 2)
road('pavement-n', -1, -1, 16, 28.1, [184, 1.8], '#a19d94')
road('pavement-s', -1, 0, 16, 3.9, [184, 1.8], '#a19d94')
chunks.get('c0_0')!.spawns.push({ spawnId: `c0_0/${RECORD_NAMESPACES.spawns}/player-start`, kind: 'player', position: { x: 2, z: 0 } })
const world: WorldDocument = {
  schemaVersion: MAP_SCHEMA_VERSION,
  worldId: 'prefab-library',
  name: 'Thư viện prefab (world generator)',
  contentVersion: 1,
  chunkSize: 32,
  coordinateSystem: 'y-up-xz-meters',
  playArea: { size: 192, depth: 64, center: { x: -16, z: 0 } },
  boundary: { height: 2, thickness: 1 },
  chunkBounds: { minCx: -3, maxCx: 2, minCz: -1, maxCz: 0 },
  chunks: cells.map(([cx, cz]) => ({ chunkId: chunkIdOf(cx, cz), cx, cz, path: `chunks/${chunkIdOf(cx, cz)}.json` })),
  prefabs: [],
  playerSpawn: 'c0_0/spawns/player-start',
  listed: false,
}
let doc: MapDocument = { world, prefabs: new Map(), chunks, extras: new Map() }

// 2. Existing houses, copied with placement metadata.
function copy(path: string, placement: PrefabPlacement) {
  const p = JSON.parse(readFileSync(path, 'utf8')) as PrefabDocument
  const file = `prefabs/${p.prefabId.split('/').pop()}.json`
  doc = { ...doc, world: { ...doc.world, prefabs: [...doc.world.prefabs, { prefabId: p.prefabId, contentVersion: p.contentVersion, path: file }] }, prefabs: new Map([...doc.prefabs, [p.prefabId, p]]) }
  doc = ok(updatePrefab(doc, p.prefabId, { placement }), p.prefabId)
}
const house = (weight: number, extra: Partial<PrefabPlacement> = {}): PrefabPlacement => ({ category: 'house', allowedZones: ['residential'], weight, setback: 3, sideGap: 1.5, roadFacing: true, frontage: [9, 40], ...extra })
copy('content/maps/neighborhood-50/prefabs/house.json', house(3, { anchors: [{ name: 'mailbox', position: { x: -3.2, z: -4.6 } }] }))
copy('content/maps/neighborhood-50/prefabs/safehouse.json', house(1))
copy('content/maps/neighborhood-50/prefabs/store.json', { category: 'shop', allowedZones: ['commercial'], weight: 3, setback: 1, sideGap: 1, roadFacing: true, frontage: [12, 60] })
copy('content/maps/graphics-lab/prefabs/lab-house.json', house(2))
copy('content/maps/graphics-lab/prefabs/lab-garage.json', { category: 'outbuilding', allowedZones: ['residential', 'industrial'], weight: 0.5, setback: 2, sideGap: 1, roadFacing: true, frontage: [8, 30] })
copy('content/maps/floors-lab/prefabs/two-storey.json', house(1.5))

// 3. Placeholder prefabs, built with the editor's prefab commands.
function build(prefabId: string, name: string, width: number, depth: number, steps: (d: MapDocument) => MapDocument, placement: PrefabPlacement, shape: 'rect' | 'twoStorey' = 'rect') {
  doc = ok(createPrefab(doc, { prefabId, name, width, depth, shape }), prefabId)
  doc = steps(doc)
  doc = ok(updatePrefab(doc, prefabId, { placement }), prefabId)
}
const put = (id: string, preset: string, at: { x: number; z: number }, to: { x: number; z: number } | null = null, turns = 0) => (d: MapDocument) => ok(placePrefabItem(d, id, preset, at, to, turns), `${id} ${preset}`)
const set = (id: string, key: string, patch: Record<string, unknown>) => (d: MapDocument) => ok(updatePrefabItem(d, id, key, patch), `${id} ${key}`)
const chain = (...fs: ((d: MapDocument) => MapDocument)[]) => (d: MapDocument) => fs.reduce((acc, f) => f(acc), d)

// Corner shop 14 × 10: wide shop windows at the front, shelves and fridges along the walls, a counter.
build(
  'library/corner-shop',
  'Tiệm tạp hóa góc phố',
  14,
  10,
  chain(
    put('library/corner-shop', 'opening/window', { x: -4, z: 5 }),
    put('library/corner-shop', 'opening/window', { x: 4, z: 5 }),
    put('library/corner-shop', 'container/shelf', { x: -4, z: -4.3 }),
    put('library/corner-shop', 'container/shelf', { x: 0, z: -4.3 }),
    put('library/corner-shop', 'container/shelf', { x: 4, z: -1 }),
    put('library/corner-shop', 'container/fridge', { x: 6.3, z: -4.2 }),
    put('library/corner-shop', 'container/fridge', { x: -6.3, z: -4.2 }),
    put('library/corner-shop', 'furniture/counter', { x: -5.5, z: 2.5 }, { x: -3.5, z: 2.5 }),
  ),
  { category: 'shop', allowedZones: ['commercial'], weight: 2, setback: 1, sideGap: 1, roadFacing: true, frontage: [15, 60] },
)
// Warehouse 22 × 14: wide loading door, shelving with hardware and tools, a garage corner.
build(
  'library/warehouse',
  'Nhà kho',
  22,
  14,
  chain(
    put('library/warehouse', 'opening/door-wide', { x: 6, z: 7 }),
    put('library/warehouse', 'container/shelf', { x: -8, z: -6.3 }),
    set('library/warehouse', 'shelf-1', { name: 'Kệ vật tư', lootTableId: 'hardware-shelf' }),
    put('library/warehouse', 'container/shelf', { x: -4, z: -6.3 }),
    set('library/warehouse', 'shelf-2', { name: 'Kệ đồ nghề', lootTableId: 'tool-shelf' }),
    put('library/warehouse', 'container/shelf', { x: 0, z: -6.3 }),
    set('library/warehouse', 'shelf-3', { name: 'Kệ vật tư', lootTableId: 'hardware-shelf' }),
    put('library/warehouse', 'cluster/garage', { x: 6, z: -5.5 }),
    put('library/warehouse', 'decor/carton', { x: -8, z: 2 }),
    put('library/warehouse', 'decor/carton', { x: -7.4, z: 2.6 }),
  ),
  { category: 'industrial', allowedZones: ['industrial'], weight: 2, setback: 4, sideGap: 2, roadFacing: true, frontage: [24, 80] },
)
// Clinic 16 × 12: waiting room at the front, treatment room at the back behind a door.
build(
  'library/clinic',
  'Trạm y tế',
  16,
  12,
  chain(
    put('library/clinic', 'structure/wall-run', { x: -8, z: 0 }, { x: 8, z: 0 }),
    put('library/clinic', 'opening/door', { x: 3, z: 0 }),
    put('library/clinic', 'opening/window', { x: -4, z: 6 }),
    put('library/clinic', 'opening/window', { x: 5, z: 6 }),
    set('library/clinic', 'room-1', { name: 'Phòng chờ', bounds: { minX: -8, minZ: 0, maxX: 8, maxZ: 6 } }),
    put('library/clinic', 'room/lamp', { x: -8, z: -6 }, { x: 8, z: 0 }),
    set('library/clinic', 'room-2', { name: 'Phòng khám' }),
    put('library/clinic', 'container/empty', { x: -6, z: -5.4 }),
    set('library/clinic', 'cabinet-1', { name: 'Tủ thuốc', lootTableId: 'safehouse-cabinet' }),
    put('library/clinic', 'container/empty', { x: -3, z: -5.4 }),
    set('library/clinic', 'cabinet-2', { name: 'Tủ thuốc', lootTableId: 'safehouse-cabinet' }),
    put('library/clinic', 'furniture/bed', { x: 4, z: -4.5 }),
    put('library/clinic', 'furniture/chair', { x: -6, z: 4.5 }),
    put('library/clinic', 'furniture/chair', { x: -5, z: 4.5 }),
    put('library/clinic', 'furniture/desk', { x: 5, z: 2 }),
  ),
  { category: 'public', allowedZones: ['public'], weight: 1, setback: 3, sideGap: 2, roadFacing: true, frontage: [18, 80] },
)
// Tube house 4 × 14 (Vietnamese shophouse): built to the lot lines, front room, kitchen at the back.
// 4 m wide keeps its walls and doors on the 0.5 m grid wherever the generator places it.
build(
  'library/tube-house',
  'Nhà ống',
  4,
  14,
  chain(
    put('library/tube-house', 'structure/wall-run', { x: -2, z: -1 }, { x: 2, z: -1 }),
    put('library/tube-house', 'opening/door', { x: 0.5, z: -1 }),
    set('library/tube-house', 'room-1', { name: 'Phòng trước', bounds: { minX: -2, minZ: -1, maxX: 2, maxZ: 7 } }),
    put('library/tube-house', 'room/lamp', { x: -2, z: -7 }, { x: 2, z: -1 }),
    set('library/tube-house', 'room-2', { name: 'Bếp' }),
    put('library/tube-house', 'container/kitchen', { x: -1, z: -6.4 }),
    put('library/tube-house', 'container/wardrobe', { x: -1, z: 1.4 }),
    put('library/tube-house', 'furniture/table', { x: 0.6, z: 4 }),
  ),
  { category: 'house', allowedZones: ['residential', 'commercial'], weight: 3, setback: 0, sideGap: 0, roadFacing: true, frontage: [4, 8] },
)

// 4. Showroom: prefabs along the street, north row facing south, south row facing north.
const turnsTo = (p: PrefabDocument, face: 'N' | 'S'): QuarterTurns => {
  const from = doorSide(p) ?? 'S'
  const v = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[from]
  const w = { N: [0, -1], S: [0, 1] }[face]
  for (let q = 0; q < 4; q++) {
    const [x, z] = rotateXZ(v[0], v[1], q)
    if (x === w[0] && z === w[1]) return q as QuarterTurns
  }
  return 0
}
let x = -100
let side: 'N' | 'S' = 'N'
for (const entry of doc.world.prefabs) {
  const p = doc.prefabs.get(entry.prefabId)!
  const q = turnsTo(p, side === 'N' ? 'S' : 'N')
  const f = p.footprint
  const [w, d] = q % 2 ? [f.maxZ - f.minZ, f.maxX - f.minX] : [f.maxX - f.minX, f.maxZ - f.minZ]
  const cx = x + w / 2 + 2
  const cz = side === 'N' ? -(5 + d / 2) : 5 + d / 2
  doc = ok(placeInstance(doc, entry.prefabId, { x: cx - (f.minX + f.maxX) / 2, z: cz }, q), `showroom ${entry.prefabId}`)
  if (side === 'S') x += 30
  side = side === 'N' ? 'S' : 'N'
}
doc = withExternalRefs(doc)

const files = new Map(documentFiles(doc))
const checked = checkWorldDocuments((path) => files.get(path), { lootTables: new Set(Object.keys(LOOT_TABLES)) })
for (const i of checked.issues) console.log(`  ${i.severity.padEnd(7)} ${i.code} ${i.path} ${i.message}`)
if (hasErrors(checked.issues)) process.exit(1)
for (const [path, json] of files) {
  mkdirSync(dirname(join(out, path)), { recursive: true })
  writeFileSync(join(out, path), formatJson(json))
}
console.log(`${out}: ${doc.world.prefabs.length} prefab (${doc.world.prefabs.map((e) => e.prefabId).join(', ')})`)
