// Map editor M7 (editor polish) browser check with Playwright (fresh isolated context, dev server
// only: it reads the store through window.__editor and aims clicks with window.__editorThree).
//   BASE_URL=http://127.0.0.1:5174 node scripts/m7-editor-browser.mjs
// Set PLAYWRIGHT_MODULE (file:// URL of playwright/index.mjs) and CHROMIUM_PATH when needed.
// Covers, with real pointer input: resize handles on a neighbourhood road (one history entry,
// undo), per-chunk batching (draw calls), road draw layers clearing `surface-overlap`, a circle
// zone's radius handle, chunks added east and the play area fitted off-centre, a prefab room
// resized and its lamp fixture dragged off the room centre; exported → `npm run map:unpack` →
// played with `?world=` (off-centre ground/nav/fence, road layers, lamp position).
// Writes a temporary world to content/maps/m7-browser-test and removes it at the end.
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
const TEST_WORLD = 'm7-browser-test'
const PREFAB = 'building/m7-house'

const state = () =>
  page.evaluate(() => {
    const s = window.__editor.getState()
    const doc = s.edit?.doc
    const records = doc ? [...doc.chunks.values()].flatMap((c) => [...c.objects, ...c.roads, ...c.zones]) : []
    return {
      worldId: doc?.world.worldId,
      playArea: doc?.world.playArea,
      selection: s.edit?.selection ?? [],
      past: s.edit?.past.map((e) => e.label) ?? [],
      errors: s.issues.filter((i) => i.severity === 'error').map((i) => i.code),
      warnings: s.issues.filter((i) => i.severity === 'warning').map((i) => i.code),
      status: s.status?.text ?? '',
      prefab: s.prefabMode ? structuredClone(doc.prefabs.get(s.prefabMode)) : null,
      records: structuredClone(records),
    }
  })
const record = (s, id) => s.records.find((r) => (r.roadId ?? r.zoneId ?? r.objectId) === id)
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
async function drag(from, to) {
  const a = await screen(from.x, from.z)
  const b = await screen(to.x, to.z)
  await page.mouse.move(a.x, a.y)
  await frame()
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 })
  await page.mouse.move(b.x, b.y, { steps: 5 })
  await frame()
  await page.mouse.up()
  await frame()
}
const run = (fn, ...args) => page.evaluate(fn, args)
/** Draw calls of one rendered frame of the editor viewport. */
const drawCalls = () =>
  page.evaluate(() => {
    const s = window.__editorThree()
    s.gl.info.autoReset = false
    s.gl.info.reset()
    s.gl.render(s.scene, s.camera)
    const calls = s.gl.info.render.calls
    s.gl.info.autoReset = true
    return calls
  })

try {
  // 1. Neighbourhood: resize a road with its east handle (real mouse), one history entry, undo.
  await page.goto(`${base}/editor.html`)
  await until(() => window.__editor?.getState().status?.text.includes('Đã mở'), null, 30000)
  await page.waitForTimeout(500)
  const neighbourhoodCalls = await drawCalls()
  let s = await state()
  const road = s.records.find((r) => r.roadId && r.size[0] < r.size[1])
  const roadId = road.roadId
  await run(([id]) => window.__editor.getState().select([id]), roadId)
  await run(() => window.__editor.getState().requestFocus())
  await frame()
  const worldOf = (id) =>
    run(([id]) => {
      const doc = window.__editor.getState().edit.doc
      for (const c of doc.chunks.values()) {
        const r = c.roads.find((x) => x.roadId === id)
        if (r) return { x: c.cx * doc.world.chunkSize + r.position.x, z: c.cz * doc.world.chunkSize + r.position.z }
      }
    }, id)
  const world = await worldOf(roadId)
  const east = { x: world.x + road.size[0] / 2, z: world.z }
  await drag(east, { x: east.x + 2, z: east.z })
  s = await state()
  const resized = record(s, roadId)
  assert.deepEqual(resized.size, [road.size[0] + 2, road.size[1]])
  assert.deepEqual(await worldOf(roadId), { x: world.x + 1, z: world.z })
  assert.equal(s.past.at(-1), 'Đổi kích thước')
  assert.equal(s.past.length, 1)
  await shot('m7-road-handle')
  await page.keyboard.press('Control+z')
  s = await state()
  assert.deepEqual(record(s, roadId), road)
  log('road east handle', `${roadId}: ${road.size[0]} → ${resized.size[0]} m wide, centre +1 m; undo restores`)
  log('neighbourhood draw calls', `${neighbourhoodCalls} (per-chunk batches)`)

  // 2. New world: two overlapping surfaces of different colour → surface-overlap; layer 1 clears it.
  await page.getByRole('button', { name: 'Mới', exact: true }).click()
  await page.locator('.modal label.field', { hasText: 'worldId' }).locator('input').fill(TEST_WORLD)
  await page.locator('.modal label.field', { hasText: 'Tên' }).locator('input').fill('Thử M7')
  await page.getByRole('button', { name: 'Tạo', exact: true }).click()
  await until((id) => window.__editor.getState().edit?.doc.world.worldId === id, TEST_WORLD)
  await page.waitForTimeout(300)
  await page.locator('[data-tab="roads"]').click()
  await page.locator('[data-preset="surface/asphalt"]').click()
  await drag({ x: -20, z: 8 }, { x: -2, z: 12 })
  await page.locator('[data-preset="surface/sidewalk"]').click()
  await drag({ x: -12, z: 4 }, { x: -8, z: 20 })
  await page.keyboard.press('Escape')
  s = await state()
  assert.ok(s.warnings.includes('surface-overlap'), JSON.stringify(s.warnings))
  const sidewalk = s.records.find((r) => r.roadId?.includes('sidewalk'))
  await run(([id]) => window.__editor.getState().select([id]), sidewalk.roadId)
  await frame()
  await page.locator('[data-road-layer]').selectOption('1')
  s = await state()
  assert.equal(record(s, sidewalk.roadId).layer, 1)
  assert.ok(!s.warnings.includes('surface-overlap'), JSON.stringify(s.warnings))
  log('road draw layer', `${sidewalk.roadId} on layer 1: surface-overlap cleared`)

  // 3. Circle zone radius handle.
  await page.locator('[data-tab="zones"]').click()
  await page.locator('[data-preset="zone/circle"]').click()
  await drag({ x: -14, z: -14 }, { x: -10, z: -14 })
  await page.keyboard.press('Escape')
  s = await state()
  const zone = s.records.find((r) => r.zoneId && r.shape === 'circle')
  await run(([id]) => window.__editor.getState().select([id]), zone.zoneId)
  await frame()
  await drag({ x: -14 + zone.radius, z: -14 }, { x: -7, z: -14 })
  s = await state()
  assert.equal(record(s, zone.zoneId).radius, 7)
  log('zone radius handle', `${zone.zoneId}: ${zone.radius} → 7 m`)

  // 4. Chunks east, play area fitted off-centre (chunk tab button).
  await run(() => {
    const s = window.__editor.getState()
    s.set({ paletteTab: 'chunks' })
    s.setTool('chunk')
  })
  await page.locator('[data-tab="chunks"]').click()
  await page.evaluate(() => window.__editor.getState().requestFocus({ minX: -32, minZ: -32, maxX: 64, maxZ: 32 }))
  await frame()
  for (const p of [{ x: 48, z: -16 }, { x: 48, z: 16 }]) {
    const at = await screen(p.x, p.z)
    await page.mouse.click(at.x, at.y)
    await frame()
  }
  await page.locator('[data-fit-play]').click()
  s = await state()
  assert.deepEqual(s.playArea, { size: 92, depth: 60, center: { x: 16, z: 0 } })
  await page.locator('[data-tab="spawns"]').click()
  await page.locator('[data-preset="spawn/zombie"]').click()
  const spawnAt = await screen(56, 20)
  await page.mouse.click(spawnAt.x, spawnAt.y)
  await page.keyboard.press('Escape')
  s = await state()
  assert.deepEqual(s.errors, [])
  await shot('m7-off-centre')
  log('play area fitted', s.playArea)

  // 5. Prefab: resize the room with a handle, drag the lamp fixture off the centre.
  await page.locator('[data-tab="prefabs"]').click()
  await page.locator('[data-new-prefab]').click()
  await page.locator('.modal label.field', { hasText: 'prefabId' }).locator('input').fill(PREFAB)
  await page.locator('.modal label.field', { hasText: 'Tên' }).locator('input').fill('Nhà M7')
  await page.getByRole('button', { name: 'Tạo', exact: true }).click()
  await page.waitForTimeout(400)
  s = await state()
  const room = s.prefab.rooms[0]
  await run(([id]) => window.__editor.getState().select([id]), room.lamp.localId)
  await frame()
  const centre = { x: (room.bounds.minX + room.bounds.maxX) / 2, z: (room.bounds.minZ + room.bounds.maxZ) / 2 }
  await drag(centre, { x: centre.x + 1.5, z: centre.z - 1 })
  s = await state()
  assert.deepEqual(s.prefab.rooms[0].lamp.at, { x: centre.x + 1.5, z: centre.z - 1 })
  assert.equal(s.past.at(-1), 'Dời đèn')
  await page.locator('[data-lamp-centre]').click()
  s = await state()
  assert.equal(s.prefab.rooms[0].lamp.at, undefined)
  await page.keyboard.press('Control+z')
  s = await state()
  const lampAt = s.prefab.rooms[0].lamp.at
  assert.deepEqual(lampAt, { x: centre.x + 1.5, z: centre.z - 1 })
  await run(([id]) => window.__editor.getState().select([id]), room.localId)
  await frame()
  const south = { x: centre.x, z: room.bounds.maxZ }
  await drag(south, { x: south.x, z: south.z - 1 })
  s = await state()
  assert.equal(s.prefab.rooms[0].bounds.maxZ, room.bounds.maxZ - 1)
  assert.deepEqual(s.errors, [])
  await shot('m7-prefab-handles')
  log('prefab handles', `lamp at (${lampAt.x}, ${lampAt.z}); room south edge ${room.bounds.maxZ} → ${room.bounds.maxZ - 1}`)
  await page.locator('[data-exit-prefab]').click()

  // Place the house, then export → unpack → play.
  await page.locator(`[data-prefab="${PREFAB}"]`).click()
  const houseAt = await screen(40, 0)
  await page.mouse.move(houseAt.x, houseAt.y)
  await frame()
  await page.mouse.click(houseAt.x, houseAt.y)
  await page.keyboard.press('Escape')
  s = await state()
  assert.equal(s.past.at(-1), `Đặt ${PREFAB}`)
  assert.deepEqual(s.errors, [])
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
    const room = rt.map.rooms.find((r) => r.lamp)
    const lamp = room?.lamp
    return {
      area: { size: rt.map.size, depth: rt.map.depth, center: rt.map.center },
      walkEast: rt.nav.isWalkable(58, -20),
      fenceEast: rt.nav.isWalkable(62.5, 0),
      path: !!rt.nav.findPath(rt.player.position, { x: 58, y: 0, z: -20 }),
      layers: rt.map.roads.map((r) => r.layer ?? 0).sort(),
      // Lamp relative to its (resized) room centre: (1.5, −1) from the old centre, the centre moved −0.5 in z.
      lamp: lamp && { dx: lamp.position.x - (room.bounds.minX + room.bounds.maxX) / 2, dz: lamp.position.z - (room.bounds.minZ + room.bounds.maxZ) / 2 },
    }
  })
  assert.deepEqual(game.area, { size: 92, depth: 60, center: { x: 16, z: 0 } })
  assert.ok(game.walkEast && !game.fenceEast && game.path, JSON.stringify(game))
  assert.deepEqual(game.layers, [0, 1])
  assert.deepEqual(game.lamp, { dx: 1.5, dz: -0.5 })
  await shot('m7-play')
  log('play editor output', game)

  assert.deepEqual(errors, [])
  console.log('PASS')
} catch (e) {
  await shot('m7-failure').catch(() => {})
  console.log('errors:', errors)
  throw e
} finally {
  rmSync(`content/maps/${TEST_WORLD}`, { recursive: true, force: true })
  await browser.close()
}
