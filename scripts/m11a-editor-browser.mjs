// Map editor M11a (L/T/U buildings and rooms) browser check with Playwright (fresh isolated context,
// dev server only: it reads the editor store through window.__editor, aims clicks with
// window.__editorThree and reads the game through window.__runtime).
//   BASE_URL=http://127.0.0.1:5174 node scripts/m11a-editor-browser.mjs
// Set PLAYWRIGHT_MODULE (file:// URL of playwright/index.mjs) and CHROMIUM_PATH when needed.
// Covers, with real pointer input: a new L-shaped prefab from the dialog (outline, walls, L room),
// dragging a footprint edge with "Sửa outline" on (undo), notching the room from the Inspector and
// dragging a room edge handle, placing the house turned 90°, Export → `npm run map:unpack` →
// played with `?world=`: indoors in the arms, outdoors in the notch (no room light there), the roof
// hidden only while the player stands in the L.
// Writes a temporary world to content/maps/m11a-browser-test and removes it at the end.
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
const TEST_WORLD = 'm11a-browser-test'
const PREFAB = 'building/m11a-house'

const state = () =>
  page.evaluate(() => {
    const s = window.__editor.getState()
    const doc = s.edit?.doc
    return {
      prefabMode: s.prefabMode,
      selection: s.edit?.selection ?? [],
      errors: s.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.path}`),
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
  await frame()
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
const bbox = (poly) => ({ minX: Math.min(...poly.map((p) => p.x)), maxX: Math.max(...poly.map((p) => p.x)), minZ: Math.min(...poly.map((p) => p.z)), maxZ: Math.max(...poly.map((p) => p.z)) })

try {
  // 1. New world, new L-shaped prefab from the dialog.
  await page.goto(`${base}/editor.html`)
  await until(() => window.__editor?.getState().status?.text.includes('Đã mở'), null, 30000)
  await page.getByRole('button', { name: 'Mới', exact: true }).click()
  await page.locator('.modal label.field', { hasText: 'worldId' }).locator('input').fill(TEST_WORLD)
  await page.locator('.modal label.field', { hasText: 'Tên' }).locator('input').fill('Thử M11a')
  await page.getByRole('button', { name: 'Tạo', exact: true }).click()
  await until((id) => window.__editor.getState().edit?.doc.world.worldId === id, TEST_WORLD)
  await page.locator('[data-new-prefab]').click()
  await page.locator('.modal label.field', { hasText: 'prefabId' }).locator('input').fill(PREFAB)
  await page.locator('.modal label.field', { hasText: 'Tên' }).locator('input').fill('Nhà chữ L')
  await page.locator('[data-prefab-shape]').selectOption('L')
  await page.locator('.modal label.field', { hasText: 'Rộng X' }).locator('input').fill('10')
  await page.locator('.modal label.field', { hasText: 'Sâu Z' }).locator('input').fill('8')
  await page.getByRole('button', { name: 'Tạo', exact: true }).click()
  await page.waitForTimeout(400)
  let s = await state()
  assert.equal(s.prefabMode, PREFAB)
  assert.deepEqual(s.prefab.outline, [{ x: -5, z: -4 }, { x: 0, z: -4 }, { x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 4 }, { x: -5, z: 4 }])
  assert.equal(s.prefab.objects.filter((o) => o.kind === 'wallRun').length, 6)
  assert.deepEqual(s.prefab.rooms[0].outline, s.prefab.outline)
  assert.deepEqual(s.errors, [])
  assert.equal(await page.locator('[data-outline]').getAttribute('data-outline'), '6')
  await shot('m11a-l-prefab')
  log('L prefab from dialog', 'outline 6 vertices, 6 wall runs, L room')

  // 2. Footprint edge drag (Sửa outline on, nothing selected), then undo.
  await page.locator('[data-outline-edit]').check()
  await drag({ x: 2.5, z: 0 }, { x: 2.5, z: -1 })
  s = await state()
  assert.deepEqual(s.prefab.outline.slice(2, 4), [{ x: 0, z: -1 }, { x: 5, z: -1 }], JSON.stringify(s.prefab.outline))
  assert.deepEqual(s.prefab.footprint, { minX: -5, minZ: -4, maxX: 5, maxZ: 4 })
  await page.keyboard.press('Control+z')
  s = await state()
  assert.deepEqual(s.prefab.outline[3], { x: 5, z: 0 })
  await page.locator('[data-outline-edit]').uncheck()
  log('footprint edge drag', 'notch edge z 0 → −1 by mouse, bounding box kept; undo')

  // 3. The room: pick it at its centre, notch its north edge, drag its west edge in.
  await click(-2.5, 0)
  s = await state()
  assert.deepEqual(s.selection, ['room-1'])
  await page.locator('[data-notch-edge="0"]').click()
  s = await state()
  const room = s.prefab.rooms[0]
  assert.equal(room.outline.length, 10, JSON.stringify(room.outline))
  assert.deepEqual(room.bounds, bbox(room.outline))
  await drag({ x: -5, z: 0 }, { x: -4.5, z: 0 })
  s = await state()
  assert.equal(s.prefab.rooms[0].bounds.minX, -4.5, JSON.stringify(s.prefab.rooms[0].outline))
  assert.deepEqual(s.errors, [])
  await shot('m11a-room-edited')
  log('room outline', `notched north edge (10 vertices), west edge dragged to x −4.5`)
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Escape')

  // 4. Place it turned 90°, export, unpack, play.
  await page.locator('[data-exit-prefab]').click()
  // The palette thumbnail draws the L floor as a polygon.
  assert.equal(await page.locator(`[data-thumb="${PREFAB}"] polygon`).count(), 1)
  await page.locator(`[data-prefab="${PREFAB}"]`).click()
  await page.mouse.move(0, 0)
  await page.keyboard.press('r')
  await click(-14, 14)
  await page.keyboard.press('Escape')
  s = await state()
  const placed = s.instances.find((i) => i.id.includes('m11a-house'))
  assert.equal(placed?.q, 1, JSON.stringify(s.instances))
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
  await page.evaluate(() => {
    window.__runtime.spawnTimer = 1e9
  })
  await page.waitForTimeout(1000)

  // The notch and an arm, found on a grid inside the bounding box.
  const probe = await page.evaluate(() => {
    const rt = window.__runtime
    const b = rt.map.buildings.find((x) => x.outline)
    const xs = b.outline.map((p) => p.x)
    const zs = b.outline.map((p) => p.z)
    const cells = []
    for (let x = Math.min(...xs) + 1; x < Math.max(...xs); x += 1) for (let z = Math.min(...zs) + 1; z < Math.max(...zs); z += 1) cells.push({ x, z, inside: rt.buildingAt({ x, z }) === b.id, room: rt.lighting.getRoomAtPosition({ x, y: 1, z })?.id ?? null })
    return { id: b.id, outline: b.outline, cells }
  })
  const notch = probe.cells.filter((c) => !c.inside)
  const arm = probe.cells.filter((c) => c.inside)
  assert.ok(notch.length >= 12 && arm.length >= 40, `${notch.length} notch, ${arm.length} arm`)
  assert.ok(notch.every((c) => c.room === null) && arm.every((c) => c.room !== null))
  const stand = async (p) => {
    await page.evaluate((p) => {
      const rt = window.__runtime
      const pos = { x: p.x, y: 0.9, z: p.z }
      rt.playerBody?.setTranslation(pos, true)
      rt.player.position = { ...pos }
    }, p)
    await page.waitForTimeout(1200)
    // The roof controller's own test (0.4 m margin, `ROOF_HIDE_MARGIN`).
    return page.evaluate(() => window.__runtime.buildingAt(window.__runtime.player.position, 0.4))
  }
  const inArm = arm.find((c) => arm.some((d) => d.x === c.x + 1 && d.z === c.z) && arm.some((d) => d.x === c.x - 1 && d.z === c.z) && arm.some((d) => d.z === c.z + 1 && d.x === c.x) && arm.some((d) => d.z === c.z - 1 && d.x === c.x))
  const inNotch = notch[Math.floor(notch.length / 2)]
  assert.equal(await stand(inArm), probe.id)
  await page.screenshot({ path: `${tmp}/m11a-play-inside.png` })
  assert.equal(await stand(inNotch), null)
  await page.screenshot({ path: `${tmp}/m11a-play-notch.png` })
  log('play editor output', `${probe.id}: ${arm.length} indoor / ${notch.length} notch probe points, no room in the notch; roof controller indoors at ${JSON.stringify(inArm)}, outdoors at ${JSON.stringify({ x: inNotch.x, z: inNotch.z })}`)

  assert.deepEqual(errors, [])
  console.log('PASS')
} catch (e) {
  await shot('m11a-failure').catch(() => {})
  console.log('errors:', errors)
  throw e
} finally {
  rmSync(`content/maps/${TEST_WORLD}`, { recursive: true, force: true })
  await browser.close()
}
