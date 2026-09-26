// Map editor M4 (world authoring) browser check with Playwright (fresh isolated context, dev server
// only: it reads the store through window.__editor and aims clicks with window.__editorThree).
//   BASE_URL=http://127.0.0.1:5174 node scripts/m4-editor-browser.mjs
// Set PLAYWRIGHT_MODULE (file:// URL of playwright/index.mjs) and CHROMIUM_PATH when needed.
// Covers, with real pointer input on the viewport: layer lock/hide against picking, box select,
// a new world grown by two adjacent chunks with the chunk tool (status + fit play area), a building
// placed across a chunk line (one owner + reference), drag-sized road/fence/rectangle zone,
// scrap container and zombie spawn from the palette, rotate, chunk delete rules, and the result
// exported → `npm run map:unpack` → played with `?world=` (zone drives the zombie, one door).
// Writes a temporary world to content/maps/m4-browser-test and removes it at the end.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const context = await browser.newContext({ viewport: { width: 1400, height: 850 }, acceptDownloads: true })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('dialog', (d) => d.accept())
const tmp = 'node_modules/.tmp'
mkdirSync(tmp, { recursive: true })
const shot = (name) => page.screenshot({ path: `${tmp}/${name}.png` })
const log = (label, value) => console.log(label.padEnd(34), typeof value === 'string' ? value : JSON.stringify(value))
const TEST_WORLD = 'm4-browser-test'

/** Store snapshot pieces the checks need (plain data). */
const state = () =>
  page.evaluate(() => {
    const s = window.__editor.getState()
    const doc = s.edit?.doc
    const records = {}
    const refs = {}
    if (doc) {
      for (const [chunkId, c] of doc.chunks) {
        refs[chunkId] = c.externalRefs.map((r) => r.id)
        for (const cat of ['instances', 'objects', 'roads', 'zones', 'spawns']) {
          for (const r of c[cat]) {
            const id = r.instanceId ?? r.objectId ?? r.roadId ?? r.zoneId ?? r.spawnId
            const a = r.position ?? r.center
            records[id] = { chunkId, x: c.cx * doc.world.chunkSize + a.x, z: c.cz * doc.world.chunkSize + a.z, record: r }
          }
        }
      }
    }
    return {
      worldId: doc?.world.worldId,
      chunks: doc?.world.chunks.map((c) => c.chunkId) ?? [],
      chunkBounds: doc?.world.chunkBounds,
      playArea: doc?.world.playArea,
      selection: s.edit?.selection ?? [],
      past: s.edit?.past.map((e) => e.label) ?? [],
      errors: s.issues.filter((i) => i.severity === 'error').map((i) => i.code),
      warnings: s.issues.filter((i) => i.severity === 'warning').map((i) => i.code),
      tool: s.tool,
      selectedChunk: s.selectedChunk,
      status: s.status?.text ?? '',
      records,
      refs,
    }
  })

/** Screen point of a world ground point (through the viewport camera). */
const screen = (x, z) =>
  page.evaluate(
    ([x, z]) => {
      const s = window.__editorThree()
      const v = s.camera.position.clone().set(x, 0, z).project(s.camera)
      const r = s.gl.domElement.getBoundingClientRect()
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
    },
    [x, z],
  )
const until = (fn, arg, timeout = 10000) => page.waitForFunction(fn, arg, { timeout })
const frame = () => page.waitForTimeout(150)

async function openEditor() {
  await page.goto(`${base}/editor.html`)
  await until(() => window.__editor?.getState().status?.text.includes('Đã mở'), null, 30000)
  await page.waitForTimeout(500)
}

async function drag(from, to) {
  const a = await screen(from.x, from.z)
  const b = await screen(to.x, to.z)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 })
  await page.mouse.move(b.x, b.y, { steps: 5 })
  await frame()
  await page.mouse.up()
  await frame()
}

async function click(x, z, opts) {
  const p = await screen(x, z)
  await page.mouse.click(p.x, p.y, opts)
  await frame()
}

const tab = (id) => page.locator(`[data-tab="${id}"]`).click()
const layer = (id, column) => page.locator(`tr[data-layer="${id}"] td:nth-child(${column === 'show' ? 2 : 3}) input`)
/** Frame the whole world (F with nothing selected). */
async function frameWorld() {
  await page.evaluate(() => window.__editor.getState().select([]))
  await page.keyboard.press('f')
  await frame()
}

try {
  // 1. Layers: a locked or hidden layer is never picked; box select from empty ground.
  await openEditor()
  let s = await state()
  assert.equal(s.worldId, 'neighborhood-50')
  assert.deepEqual([s.errors, s.warnings], [[], []])
  await click(20.5, 12)
  s = await state()
  assert.deepEqual(s.selection, ['c0_0/objects/house-scrap'])
  await layer('containers', 'lock').check()
  s = await state()
  assert.deepEqual(s.selection, [], 'locking a layer drops its records from the selection')
  await click(20.5, 12)
  s = await state()
  assert.ok(!s.selection.includes('c0_0/objects/house-scrap'), JSON.stringify(s.selection))
  await layer('containers', 'lock').uncheck()
  await layer('buildings', 'show').uncheck()
  await click(s.records['c0_0/house'].x, s.records['c0_0/house'].z)
  s = await state()
  assert.ok(!s.selection.includes('c0_0/house'))
  await shot('m4-layer-hidden')
  await layer('buildings', 'show').check()
  log('layers', 'locked container / hidden building not picked')

  const p1 = s.records['c0_0/objects/pillar-1']
  const p2 = s.records['c0_0/objects/pillar-2']
  const box = { minX: Math.min(p1.x, p2.x) - 1.5, maxX: Math.max(p1.x, p2.x) + 1.5, minZ: Math.min(p1.z, p2.z) - 1.5, maxZ: Math.max(p1.z, p2.z) + 1.5 }
  // Surfaces and zone outlines are pickable ground: lock them so the drag starts a box, not a move.
  await layer('surfaces', 'lock').check()
  await layer('zones', 'lock').check()
  await drag({ x: box.minX, z: box.minZ }, { x: box.maxX, z: box.maxZ })
  s = await state()
  assert.ok(s.selection.includes('c0_0/objects/pillar-1') && s.selection.includes('c0_0/objects/pillar-2'), JSON.stringify(s.selection))
  assert.equal(s.past.length, 0)
  await layer('surfaces', 'lock').uncheck()
  await layer('zones', 'lock').uncheck()
  log('box select', s.selection.join(', '))

  // 2. New world, grown by two chunks east with the chunk tool.
  await page.getByRole('button', { name: 'Mới', exact: true }).click()
  await page.locator('.modal label.field', { hasText: 'worldId' }).locator('input').fill(TEST_WORLD)
  await page.locator('.modal label.field', { hasText: 'Tên' }).locator('input').fill('Thử M4')
  await page.getByRole('button', { name: 'Tạo', exact: true }).click()
  await until((id) => window.__editor.getState().edit?.doc.world.worldId === id, TEST_WORLD)
  s = await state()
  assert.deepEqual([s.errors, s.warnings], [[], []])
  await tab('chunks')
  s = await state()
  assert.equal(s.tool, 'chunk')
  await page.mouse.move(0, 0)
  // Zoom out so the empty cells east of the world are on screen.
  const mid = await screen(16, 0)
  await page.mouse.move(mid.x, mid.y)
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 200)
  await frame()
  await shot('m4-chunk-tool')
  await click(40, 10)
  await click(40, -10)
  s = await state()
  assert.deepEqual(s.chunks, ['c-1_-1', 'c0_-1', 'c-1_0', 'c0_0', 'c1_0', 'c1_-1'])
  assert.deepEqual(s.chunkBounds, { minCx: -1, maxCx: 1, minCz: -1, maxCz: 0 })
  assert.deepEqual(s.past, ['Thêm chunk c1_0', 'Thêm chunk c1_-1'])
  assert.equal(s.selectedChunk, 'c1_-1')
  assert.match(await page.locator('[data-chunk="c1_0"]').innerText(), /● sửa/)
  await page.getByRole('button', { name: 'Khớp vùng chơi với chunk' }).click()
  s = await state()
  // M7: the play area follows the chunks (off-centre rectangle), no longer a square around the origin.
  assert.deepEqual(s.playArea, { size: 92, depth: 60, center: { x: 16, z: 0 } })
  log('chunk tool', `${s.chunks.length} chunks, play area ${JSON.stringify(s.playArea)}`)

  // 3. A house across the x = 32 line: one owner, a reference in the other chunk.
  await tab('prefabs')
  await page.locator('[data-prefab="building/house"]').click()
  const at = await screen(32, 10)
  await page.mouse.move(at.x, at.y)
  await frame()
  await page.mouse.click(at.x, at.y)
  await page.keyboard.press('Escape')
  s = await state()
  assert.equal(s.records['c1_0/house-1'].chunkId, 'c1_0')
  assert.deepEqual(s.refs['c0_0'], ['c1_0/house-1'])
  log('building across chunk line', 'owner c1_0, referenced by c0_0')

  // 4. Drag-sized palette records: road, fence; scrap container and zombie spawn by click.
  await tab('roads')
  await page.locator('[data-preset="surface/asphalt"]').click()
  await drag({ x: 44, z: -40 }, { x: 48, z: 40 })
  await tab('objects')
  await page.locator('[data-preset="object/fence"]').click()
  await drag({ x: 50, z: 12 }, { x: 58, z: 12.3 })
  await page.locator('[data-preset="object/scrap"]').click()
  await click(54, 20)
  await tab('zones')
  await page.locator('[data-preset="zone/rect"]').click()
  await drag({ x: 50, z: 14 }, { x: 60, z: 28 })
  await tab('spawns')
  await page.locator('[data-preset="spawn/zombie"]').click()
  await click(56, 24)
  await page.keyboard.press('Escape')
  s = await state()
  assert.deepEqual(s.records['c1_0/roads/road-1'].record, { roadId: 'c1_0/roads/road-1', position: { x: 14, z: 0 }, size: [4, 80], color: '#3a3a3f' })
  assert.deepEqual(s.records['c1_0/objects/fence-1'].record.size, [8, 1, 0.15])
  assert.equal(s.records['c1_0/objects/scrap-1'].record.lootTableId, 'scrap-pile')
  assert.deepEqual(s.records['c1_0/zones/zone-1'].record.size, [10, 14])
  assert.deepEqual([s.records['c1_0/spawns/zombie-1'].x, s.records['c1_0/spawns/zombie-1'].z], [56, 24])
  assert.deepEqual(s.selection, ['c1_0/spawns/zombie-1'], 'a placed record is selected')
  await click(56, 24)
  assert.match(await page.locator('.inspector').innerText(), /Thuộc zone\s+c1_0\/zones\/zone-1/)
  log('palette records', 'road 4×80, fence 8 m, scrap, rect zone 10×14, zombie spawn in zone')
  await frameWorld()
  await shot('m4-authored')

  // 5. Rotate the fence (R swaps X/Z), then drag the house wholly east: reference gone, ID kept.
  await click(54, 12)
  s = await state()
  assert.deepEqual(s.selection, ['c1_0/objects/fence-1'])
  await page.keyboard.press('r')
  s = await state()
  assert.deepEqual(s.records['c1_0/objects/fence-1'].record.size, [0.15, 1, 8])
  await click(32, 10)
  await drag({ x: 32, z: 10 }, { x: 38, z: 10 })
  s = await state()
  assert.deepEqual([s.records['c1_0/house-1'].x, s.records['c1_0/house-1'].chunkId], [38, 'c1_0'])
  assert.deepEqual(s.refs['c0_0'], [])
  await page.keyboard.press('Control+z')
  s = await state()
  assert.deepEqual(s.refs['c0_0'], ['c1_0/house-1'])
  log('rotate + drag across', 'fence 0.15×8; house reference follows the move, undo restores it')

  // 6. Chunk delete: refused while it owns records, allowed when empty; undo brings it back.
  await tab('chunks')
  await click(40, 10)
  s = await state()
  assert.equal(s.selectedChunk, 'c1_0')
  assert.equal(await page.getByRole('button', { name: 'Xóa chunk' }).isDisabled(), true)
  await click(40, -10)
  assert.equal(await page.getByRole('button', { name: 'Xóa chunk' }).isDisabled(), false)
  await page.getByRole('button', { name: 'Xóa chunk' }).click()
  s = await state()
  assert.ok(!s.chunks.includes('c1_-1'))
  await page.keyboard.press('Control+z')
  s = await state()
  assert.ok(s.chunks.includes('c1_-1'))
  assert.deepEqual(s.errors, [])
  log('chunk delete', 'non-empty refused, empty removed, undo restores')

  // 7. Export → unpack → play the world.
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export', exact: true }).click()])
  const packPath = `${tmp}/${TEST_WORLD}.mappack.json`
  await dl.saveAs(packPath)
  const out = execFileSync(process.execPath, ['scripts/map-tools/unpack.ts', packPath], { encoding: 'utf8' })
  log('map:unpack', out.trim().split('\n')[0])
  await page.waitForTimeout(1500)
  await page.goto(`${base}/?world=${TEST_WORLD}`).catch(() => page.goto(`${base}/?world=${TEST_WORLD}`))
  await until(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, 30000)
  await page.getByRole('button', { name: 'New Game', exact: true }).click()
  await until(() => document.body.innerText.includes('Tạo nhân vật'))
  await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click()
  await until(() => !document.querySelector('h1') && document.querySelector('.hud'), null, 30000)
  await page.waitForTimeout(1500)
  const game = await page.evaluate(() => {
    const rt = window.__runtime
    const zone = rt.map.zombieZones.find((z) => z.id === 'c1_0/zones/zone-1')
    const east = [...rt.zombies.values()].find((z) => z.home.x === 56 && z.home.z === 24)
    return {
      map: rt.map.id,
      area: [rt.map.size, rt.map.depth, rt.map.center],
      doors: rt.map.doors.filter((d) => d.id === 'c1_0/house-1/door').length,
      zone: zone && { center: zone.center, halfSize: zone.halfSize },
      eastZone: east?.zoneId ?? null,
      scrap: rt.world.containers.has('c1_0/objects/scrap-1'),
      fence: rt.map.walls.some((w) => w.id === 'c1_0/objects/fence-1'),
    }
  })
  assert.equal(game.map, TEST_WORLD)
  assert.deepEqual(game.area, [92, 60, { x: 16, z: 0 }])
  assert.equal(game.doors, 1)
  assert.deepEqual(game.zone, { center: { x: 55, y: 0, z: 21 }, halfSize: { x: 5, z: 7 } })
  assert.equal(game.eastZone, 'c1_0/zones/zone-1')
  assert.ok(game.scrap && game.fence)
  await shot('m4-play')
  log('play editor output', JSON.stringify(game))

  assert.deepEqual(errors, [])
  console.log('PASS')
} catch (e) {
  await shot('m4-failure').catch(() => {})
  console.log('errors:', errors)
  throw e
} finally {
  rmSync(`content/maps/${TEST_WORLD}`, { recursive: true, force: true })
  await browser.close()
}
