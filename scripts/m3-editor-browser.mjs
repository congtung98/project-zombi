// Map editor M3 browser check with Playwright (fresh isolated context, dev server only: it drives
// the store through window.__editor and aims clicks with window.__editorThree).
//   BASE_URL=http://127.0.0.1:5174 node scripts/m3-editor-browser.mjs
// Set PLAYWRIGHT_MODULE (file:// URL of playwright/index.mjs) and CHROMIUM_PATH when needed.
// Covers: open the neighbourhood (0 issues), place a prefab with ghost + rotation, drag inside and
// across a chunk line (one history entry each, ID kept), inspector edit, delete/undo/redo, hotkeys
// not firing while typing, export blocked on errors, Save Draft → reload → open draft, Export →
// Import round trip, invalid import rejected, editor never creates the game database, and a new
// world made in the editor → `npm run map:unpack` → played in the game with `?world=`.
// Writes a temporary world to content/maps/m3-browser-test and removes it at the end.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

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
const TEST_WORLD = 'm3-browser-test'

/** Store snapshot pieces the checks need (plain data). */
const state = () =>
  page.evaluate(() => {
    const s = window.__editor.getState()
    const doc = s.edit?.doc
    const records = {}
    if (doc) {
      for (const [chunkId, c] of doc.chunks) {
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
      contentVersion: doc?.world.contentVersion,
      retired: doc?.world.retiredIds ?? [],
      selection: s.edit?.selection ?? [],
      past: s.edit?.past.map((e) => e.label) ?? [],
      future: s.edit?.future.length ?? 0,
      errors: s.issues.filter((i) => i.severity === 'error').map((i) => i.code),
      warnings: s.issues.filter((i) => i.severity === 'warning').map((i) => i.code),
      ghost: s.preview?.ghostIds ?? [],
      tool: s.tool,
      status: s.status?.text ?? '',
      dirty: s.edit ? s.edit.doc !== s.savedDoc : false,
      source: s.source,
      records,
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

try {
  // 1. Open the bundled neighbourhood.
  await openEditor()
  let s = await state()
  assert.equal(s.worldId, 'neighborhood-50')
  assert.deepEqual([s.errors, s.warnings], [[], []])
  assert.equal(s.dirty, false)
  log('open', `${Object.keys(s.records).length} records, 0 issues`)
  await shot('m3-open')

  // 2. Place a house with a ghost preview and one rotation.
  await page.locator('[data-prefab="building/house"]').click()
  const spot = { x: -15, z: 12 }
  const p = await screen(spot.x + 0.1, spot.z - 0.1)
  await page.mouse.move(p.x, p.y)
  await frame()
  s = await state()
  assert.deepEqual(s.ghost, ['c-1_0/house-1'])
  await page.keyboard.press('r')
  await frame()
  s = await state()
  assert.equal(s.ghost.length, 1)
  await page.mouse.click(p.x, p.y)
  await frame()
  s = await state()
  assert.deepEqual(s.past, ['Đặt building/house'])
  assert.deepEqual(s.selection, ['c-1_0/house-1'])
  assert.deepEqual([s.records['c-1_0/house-1'].x, s.records['c-1_0/house-1'].z, s.records['c-1_0/house-1'].record.quarterTurns], [spot.x, spot.z, 1])
  assert.equal(s.dirty, true)
  log('place + ghost + R', 'c-1_0/house-1 at (-15, 12), 90°')
  await page.keyboard.press('Escape')
  await shot('m3-placed')

  // 3. Drag the new house 2 m east: one history entry, same ID, snapped.
  await drag({ x: spot.x, z: spot.z }, { x: spot.x + 2.1, z: spot.z })
  s = await state()
  assert.deepEqual(s.past, ['Đặt building/house', 'Di chuyển'])
  assert.deepEqual([s.records['c-1_0/house-1'].x, s.records['c-1_0/house-1'].z], [-13, 12])
  log('drag in chunk', '(-15,12) → (-13,12), 1 entry')

  // 4. Drag the scrap pile across the x = 0 chunk line: re-homed, ID kept.
  await click(20.5, 12)
  s = await state()
  assert.deepEqual(s.selection, ['c0_0/objects/house-scrap'])
  await drag({ x: 20.5, z: 12 }, { x: -4.5, z: 12 })
  s = await state()
  assert.equal(s.records['c0_0/objects/house-scrap'].chunkId, 'c-1_0')
  assert.deepEqual([s.records['c0_0/objects/house-scrap'].x, s.records['c0_0/objects/house-scrap'].z], [-4.5, 12])
  assert.match(s.status, /c0_0 → c-1_0/)
  assert.deepEqual(s.errors, [])
  log('drag across chunk', 'house-scrap owner c0_0 → c-1_0, ID kept')

  // 5. Inspector edit (Enter commits one entry).
  const nameInput = page.locator('.inspector label.field', { hasText: 'Tên' }).locator('input')
  await nameInput.fill('Đống sắt vụn')
  await nameInput.press('Enter')
  await frame()
  s = await state()
  assert.equal(s.records['c0_0/objects/house-scrap'].record.name, 'Đống sắt vụn')
  assert.equal(s.past.at(-1), 'Đổi tên')

  // 6. Hotkeys stay out of text inputs.
  await page.locator('.search').click()
  await page.keyboard.press('Delete')
  await page.keyboard.press('r')
  s = await state()
  assert.deepEqual(s.selection, ['c0_0/objects/house-scrap'])
  assert.equal(s.past.length, 4)
  await page.locator('.search').fill('')
  await page.locator('canvas').click({ position: { x: 5, y: 5 } }) // empty corner: deselect
  log('inspector + typing guard', 'rename = 1 entry; Delete/R in search ignored')

  // 7. Delete, undo, redo.
  await click(-13, 12)
  await page.keyboard.press('Delete')
  s = await state()
  assert.equal(s.records['c-1_0/house-1'], undefined)
  assert.deepEqual(s.retired, ['c-1_0/house-1'])
  await page.keyboard.press('Control+z')
  s = await state()
  assert.ok(s.records['c-1_0/house-1'])
  assert.deepEqual(s.selection, ['c-1_0/house-1'])
  assert.deepEqual(s.retired, [])
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  s = await state()
  assert.equal(s.records['c0_0/objects/house-scrap'].chunkId, 'c0_0')
  await page.keyboard.press('Control+y')
  await page.keyboard.press('Control+Shift+z')
  s = await state()
  assert.equal(s.records['c0_0/objects/house-scrap'].record.name, 'Đống sắt vụn')
  assert.equal(s.future, 1)
  log('delete / undo / redo', 'identity and selection restored')

  // 8. A blocking error disables export: zombie spawn moved into the store wall via the inspector.
  await page.evaluate(() => window.__editor.getState().select(['c0_-1/spawns/zombie-5']))
  await frame()
  const zInput = page.locator('.inspector label.field', { hasText: 'Z (world)' }).locator('input')
  await zInput.fill('-17')
  await zInput.press('Enter')
  await frame()
  const xInput = page.locator('.inspector label.field', { hasText: 'X (world)' }).locator('input')
  await xInput.fill('13')
  await xInput.press('Enter')
  await frame()
  s = await state()
  assert.ok(s.errors.includes('spawn-blocked'), JSON.stringify(s.errors))
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  s = await state()
  assert.match(s.status, /Export bị chặn/)
  await page.locator('.issues li.error').first().click()
  s = await state()
  assert.deepEqual(s.selection, ['c0_-1/spawns/zombie-5'])
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  s = await state()
  assert.deepEqual(s.errors, [])
  assert.ok(s.warnings.includes('content-changed-same-version'))
  log('validate', 'spawn-blocked blocks export; issue click selects the spawn')

  // 9. Save Draft → reload → open the draft.
  await page.keyboard.press('Control+s')
  await until(() => window.__editor.getState().status?.text.includes('Đã lưu nháp'))
  s = await state()
  assert.equal(s.dirty, false)
  const saved = s.records
  await openEditor()
  s = await state()
  assert.equal(s.records['c-1_0/house-1'], undefined)
  await page.getByRole('button', { name: 'Mở…' }).click()
  await page.getByRole('button', { name: /Khu phố 50 m \(neighborhood-50\)/ }).click()
  await until(() => window.__editor.getState().source.startsWith('nháp'))
  s = await state()
  assert.deepEqual(s.records, saved)
  log('draft', 'saved, reloaded, reopened identical')

  // 10. Export → Import round trip.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export', exact: true }).click()])
  const packPath = `${tmp}/m3-export.mappack.json`
  await download.saveAs(packPath)
  const packText = readFileSync(packPath, 'utf8')
  assert.equal(JSON.parse(packText).format, 'zombie-outbreak/map-pack')
  await page.locator('input[data-import]').setInputFiles(packPath)
  await until(() => window.__editor.getState().source.startsWith('import'))
  s = await state()
  assert.deepEqual(s.records, saved)
  log('export → import', `${download.suggestedFilename()} round trip identical`)

  // 11. An invalid pack is rejected and the open document stays.
  const bad = JSON.parse(packText)
  bad.files['chunks/c0_0.json'].instances[0].position.x = 40
  writeFileSync(`${tmp}/m3-bad.mappack.json`, JSON.stringify(bad))
  await page.locator('input[data-import]').setInputFiles(`${tmp}/m3-bad.mappack.json`)
  await until(() => window.__editor.getState().rejected !== null)
  s = await state()
  assert.ok(s.source.startsWith('import m3-export'))
  assert.deepEqual(s.records, saved)
  assert.ok(await page.locator('.rejected').innerText().then((t) => t.includes('owner-mismatch')))
  log('invalid import', 'rejected (owner-mismatch), document kept')

  // 12. The editor never opens the game's save database.
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).sort())
  assert.deepEqual(dbs, ['zombie-outbreak-editor'])
  log('storage', dbs.join(', '))

  // 13. New world in the editor → unpack → play it in the game.
  await page.getByRole('button', { name: 'Mới', exact: true }).click()
  await page.locator('.modal label.field', { hasText: 'worldId' }).locator('input').fill(TEST_WORLD)
  await page.locator('.modal label.field', { hasText: 'Tên' }).locator('input').fill('Thử M3')
  await page.getByRole('button', { name: 'Tạo', exact: true }).click()
  await until(() => window.__editor.getState().edit?.doc.world.worldId === 'm3-browser-test')
  await page.locator('[data-prefab="building/safehouse"]').click()
  const home = await screen(-12, 12)
  await page.mouse.move(home.x, home.y)
  await frame()
  await page.mouse.click(home.x, home.y)
  await page.keyboard.press('Escape')
  s = await state()
  assert.ok(s.records['c-1_0/safehouse-1'])
  assert.deepEqual(s.errors, [])
  await shot('m3-new-world')
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export', exact: true }).click()])
  const newPack = `${tmp}/${TEST_WORLD}.mappack.json`
  await dl2.saveAs(newPack)
  const out = execFileSync(process.execPath, ['scripts/map-tools/unpack.ts', newPack], { encoding: 'utf8' })
  log('map:unpack', out.trim().split('\n')[0])

  // New content files make Vite reload the open page; let that settle before navigating.
  await page.waitForTimeout(1500)
  await page.goto(`${base}/?world=${TEST_WORLD}`).catch(() => page.goto(`${base}/?world=${TEST_WORLD}`))
  await until(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, 30000)
  const mapId = await page.evaluate(() => window.__runtime.map.id)
  assert.equal(mapId, TEST_WORLD)
  await page.getByRole('button', { name: 'New Game', exact: true }).click()
  await until(() => document.body.innerText.includes('Tạo nhân vật'))
  await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click()
  await until(() => !document.querySelector('h1') && document.querySelector('.hud'), null, 30000)
  await page.waitForTimeout(1500)
  const game = await page.evaluate(() => ({
    door: window.__runtime.world.doors.has('c-1_0/safehouse-1/door'),
    containers: [...window.__runtime.world.containers.keys()].filter((k) => k.startsWith('c-1_0/safehouse-1/')).length,
    player: window.__runtime.player.position,
    time: window.__runtime.clock?.timeOfDay ?? null,
  }))
  assert.equal(game.door, true)
  assert.ok(game.containers > 0)
  assert.deepEqual([Math.round(game.player.x), Math.round(game.player.z)], [2, 2])
  const slots = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('zombie-outbreak', 1)
        req.onsuccess = () => {
          const r = req.result.transaction('saves', 'readonly').objectStore('saves').getAllKeys()
          r.onsuccess = () => resolve(r.result)
        }
        req.onerror = () => resolve('no db')
      }),
  )
  await shot('m3-play-new-world')
  log('play editor output', `?world=${TEST_WORLD}: door + ${game.containers} containers, player at spawn, save keys ${JSON.stringify(slots)}`)
  assert.ok(!Array.isArray(slots) || !slots.includes('slot-1'))

  assert.deepEqual(errors, [])
  console.log('PASS')
} catch (e) {
  await shot('m3-failure').catch(() => {})
  console.log('errors:', errors)
  throw e
} finally {
  rmSync(`content/maps/${TEST_WORLD}`, { recursive: true, force: true })
  await browser.close()
}
