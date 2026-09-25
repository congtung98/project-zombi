// Map editor M5 (prefab editor) browser check with Playwright (fresh isolated context, dev server
// only: it reads the store through window.__editor and aims clicks with window.__editorThree).
//   BASE_URL=http://127.0.0.1:5174 node scripts/m5-editor-browser.mjs
// Set PLAYWRIGHT_MODULE (file:// URL of playwright/index.mjs) and CHROMIUM_PATH when needed.
// Covers, with real pointer input: opening the source prefab from an instance (banner lists the
// affected instances), a compatible edit (no save warning) vs a stateful one (warning), a brand-new
// house built in the GUI (starter walls/door/room, partition wall, window snapped onto a wall,
// kitchen with a chosen loot table, bed, lamp switch dragged), view-only rotation preview, the
// house placed in all four rotations, exported → `npm run map:unpack` → played with `?world=`.
// Writes a temporary world to content/maps/m5-browser-test and removes it at the end.
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
const dialogs = []
page.on('dialog', (d) => {
  dialogs.push(d.message())
  d.accept()
})
const tmp = 'node_modules/.tmp'
mkdirSync(tmp, { recursive: true })
const shot = (name) => page.screenshot({ path: `${tmp}/${name}.png` })
const log = (label, value) => console.log(label.padEnd(34), typeof value === 'string' ? value : JSON.stringify(value))
const TEST_WORLD = 'm5-browser-test'
const PREFAB = 'building/m5-house'

const state = () =>
  page.evaluate(() => {
    const s = window.__editor.getState()
    const doc = s.edit?.doc
    return {
      worldId: doc?.world.worldId,
      prefabMode: s.prefabMode,
      prefabView: s.prefabView,
      selection: s.edit?.selection ?? [],
      past: s.edit?.past.map((e) => e.label) ?? [],
      errors: s.issues.filter((i) => i.severity === 'error').map((i) => i.code),
      warnings: s.issues.filter((i) => i.severity === 'warning').map((i) => i.code),
      status: s.status?.text ?? '',
      prefab: s.prefabMode ? structuredClone(doc.prefabs.get(s.prefabMode)) : null,
      instances: doc ? [...doc.chunks.values()].flatMap((c) => c.instances.map((i) => ({ id: i.instanceId, q: i.quarterTurns }))) : [],
    }
  })
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
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 })
  await page.mouse.move(b.x, b.y, { steps: 5 })
  await frame()
  await page.mouse.up()
  await frame()
}
async function click(x, z) {
  const p = await screen(x, z)
  await page.mouse.move(p.x, p.y)
  await frame()
  await page.mouse.click(p.x, p.y)
  await frame()
}
const item = (s, id) => s.prefab.objects.find((o) => o.localId === id) ?? s.prefab.rooms.find((r) => r.localId === id)

try {
  // 1. Neighbourhood: open the house's source prefab from its instance.
  await page.goto(`${base}/editor.html`)
  await until(() => window.__editor?.getState().status?.text.includes('Đã mở'), null, 30000)
  await page.waitForTimeout(500)
  await page.evaluate(() => window.__editor.getState().select(['c0_0/house']))
  await frame()
  await page.locator('[data-open-prefab]').click()
  let s = await state()
  assert.equal(s.prefabMode, 'building/house')
  assert.match(await page.locator('[data-prefab-banner]').innerText(), /Ảnh hưởng 1 instance: c0_0\/house/)
  await page.waitForTimeout(300)
  await shot('m5-house-prefab')

  // Compatible edit (move the bed): no save warning. Stateful edit (new container): warning.
  const bed = item(s, 'bed')
  await drag({ x: bed.position.x, z: bed.position.z }, { x: bed.position.x, z: bed.position.z + 0.5 })
  s = await state()
  assert.deepEqual(item(s, 'bed').position, { ...bed.position, z: bed.position.z + 0.5 })
  assert.deepEqual([s.errors, s.warnings], [[], []])
  await page.locator('[data-prefab-tab="containers"]').click()
  await page.locator('[data-prefab-preset="container/nightstand"]').click()
  await click(-3.5, 0.5)
  s = await state()
  assert.ok(item(s, 'nightstand-1'), JSON.stringify(s.selection))
  assert.ok(s.warnings.includes('content-changed-same-version'), JSON.stringify(s.warnings))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  s = await state()
  assert.deepEqual(item(s, 'bed').position, bed.position)
  assert.deepEqual(s.warnings, [])
  await page.locator('[data-exit-prefab]').click()
  s = await state()
  assert.equal(s.prefabMode, null)
  log('source prefab from instance', 'banner lists c0_0/house; compatible move: no warning; new container: warning; undo')

  // 2. New world + brand-new prefab from the dialog (opens the prefab editor).
  await page.getByRole('button', { name: 'Mới', exact: true }).click()
  await page.locator('.modal label.field', { hasText: 'worldId' }).locator('input').fill(TEST_WORLD)
  await page.locator('.modal label.field', { hasText: 'Tên' }).locator('input').fill('Thử M5')
  await page.getByRole('button', { name: 'Tạo', exact: true }).click()
  await until((id) => window.__editor.getState().edit?.doc.world.worldId === id, TEST_WORLD)
  await page.locator('[data-new-prefab]').click()
  await page.locator('.modal label.field', { hasText: 'prefabId' }).locator('input').fill(PREFAB)
  await page.locator('.modal label.field', { hasText: 'Tên' }).locator('input').fill('Nhà M5')
  await page.getByRole('button', { name: 'Tạo', exact: true }).click()
  await page.waitForTimeout(400)
  s = await state()
  assert.equal(s.prefabMode, PREFAB)
  assert.deepEqual(s.prefab.objects.map((o) => o.localId), ['wall-n', 'wall-s', 'wall-w', 'wall-e', 'door'])
  assert.deepEqual(s.errors, [])

  // 3. Build it: partition wall (drag), window snapped onto the north wall, kitchen + loot table, bed, switch moved.
  await page.locator('[data-prefab-tab="structure"]').click()
  await page.locator('[data-prefab-preset="structure/wall-run"]').click()
  await drag({ x: 1, z: -3 }, { x: 1.2, z: 0 })
  await page.locator('[data-prefab-tab="openings"]').click()
  await page.locator('[data-prefab-preset="opening/window"]').click()
  await click(-1.5, -2.7)
  await page.locator('[data-prefab-tab="containers"]').click()
  await page.locator('[data-prefab-preset="container/kitchen"]').click()
  await click(-2.5, 2.5)
  await page.locator('[data-prefab-tab="furniture"]').click()
  await page.locator('[data-prefab-preset="furniture/bed"]').click()
  await click(2.5, -1.5)
  await page.keyboard.press('Escape')
  s = await state()
  assert.deepEqual(item(s, 'wall-1'), { kind: 'wallRun', localId: 'wall-1', from: { x: 1, z: -3 }, to: { x: 1, z: 0 }, height: 3, thickness: 0.3, color: '#c4a484' })
  assert.deepEqual([item(s, 'win-1').position, item(s, 'win-1').quarterTurns], [{ x: -1.5, z: -3 }, 0])
  assert.equal(item(s, 'bed-1').kind, 'prop')
  await click(-2.5, 2.5)
  s = await state()
  assert.deepEqual(s.selection, ['kitchen-1'])
  await page.locator('[data-loot-table]').selectOption('store-shelf')
  s = await state()
  assert.equal(item(s, 'kitchen-1').lootTableId, 'store-shelf')
  const sw = s.prefab.rooms[0].lamp.switchAt
  await drag({ x: sw.x, z: sw.z }, { x: sw.x - 2, z: sw.z })
  s = await state()
  assert.deepEqual(s.prefab.rooms[0].lamp.switchAt, { x: sw.x - 2, z: sw.z })
  assert.deepEqual([s.errors, s.warnings], [[], []])
  await page.evaluate(() => window.__editor.getState().select([]))
  await frame()
  await shot('m5-new-prefab')
  log('prefab built in GUI', `${s.prefab.objects.length} objects, room + lamp, switch at (${sw.x - 2}, ${sw.z})`)

  // 4. View-only rotation preview: clicks don't edit.
  await page.locator('[data-prefab-view]').selectOption('1')
  await click(2.5, -1.5)
  s = await state()
  assert.equal(s.prefabView, 1)
  assert.match(s.status, /về 0°/)
  await shot('m5-prefab-view-90')
  await page.locator('[data-prefab-view]').selectOption('0')
  log('rotation preview', '90° view is read-only')

  // 5. Back to the world: place it in all four rotations.
  await page.locator('[data-exit-prefab]').click()
  await page.locator(`[data-prefab="${PREFAB}"]`).click()
  const spots = [
    [-12, 10],
    [12, 10],
    [12, -12],
    [-12, -1],
  ]
  for (let q = 0; q < 4; q++) {
    const [x, z] = spots[q]
    await page.mouse.move(0, 0)
    await click(x, z)
    await page.keyboard.press('r')
  }
  await page.keyboard.press('Escape')
  s = await state()
  const placed = s.instances.filter((i) => i.id.includes('m5-house'))
  assert.deepEqual(
    placed.map((i) => i.q).sort(),
    [0, 1, 2, 3],
  )
  assert.deepEqual(s.errors, [])
  await page.evaluate(() => window.__editor.getState().requestFocus())
  await frame()
  await shot('m5-world-four-rotations')
  log('placed in four rotations', placed.map((i) => `${i.id}@${i.q * 90}°`).join(', '))

  // 6. Export → unpack → play.
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
  const game = await page.evaluate((ids) => {
    const rt = window.__runtime
    return ids.map((id) => {
      const b = rt.map.buildings.find((x) => x.id === id)
      const door = rt.map.doors.find((d) => d.id === `${id}/door`)
      const inside = { x: b.center.x, z: b.center.z }
      // A point 1.5 m out through the door, away from the building centre.
      const dx = door.center.x - inside.x
      const dz = door.center.z - inside.z
      const len = Math.hypot(dx, dz)
      const out = { x: door.center.x + (dx / len) * 1.5, z: door.center.z + (dz / len) * 1.5 }
      const closed = rt.nav.componentAt(inside.x, inside.z) !== rt.nav.componentAt(out.x, out.z)
      rt.setDoorState(door.id, 'open')
      const open = rt.nav.componentAt(inside.x, inside.z) === rt.nav.componentAt(out.x, out.z)
      const kitchen = rt.world.containers.get(`${id}/kitchen-1`)
      return {
        id,
        closed,
        open,
        loot: kitchen.items.slots.filter(Boolean).length,
        window: rt.world.curtains.has(`${id}/win-1`),
        lamp: rt.world.lamps.has(`${id}/lamp-1`),
        indoor: rt.buildingAt(inside) === id,
      }
    })
  }, placed.map((i) => i.id))
  for (const g of game) {
    assert.ok(g.closed && g.open, `${g.id}: door must separate and then connect inside/outside`)
    assert.ok(g.loot > 0 && g.window && g.lamp && g.indoor, JSON.stringify(g))
  }
  await shot('m5-play')
  log('play editor output', game.map((g) => `${g.id}: door ok, loot ${g.loot}`).join('; '))

  assert.deepEqual(errors, [])
  console.log('PASS')
} catch (e) {
  await shot('m5-failure').catch(() => {})
  console.log('errors:', errors, 'dialogs:', dialogs)
  throw e
} finally {
  rmSync(`content/maps/${TEST_WORLD}`, { recursive: true, force: true })
  await browser.close()
}
