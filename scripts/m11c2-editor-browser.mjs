// Map editor M11c-2 (storeys in the prefab editor) browser check with Playwright (fresh isolated
// context, dev server only: it reads the editor store through window.__editor, aims clicks with
// window.__editorThree and reads the game through window.__runtime / window.__cutaway).
//   BASE_URL=http://127.0.0.1:5174 node scripts/m11c2-editor-browser.mjs
// Set PLAYWRIGHT_MODULE (file:// URL of playwright/index.mjs) and CHROMIUM_PATH when needed.
// Covers, with real pointer input: a new two-storey prefab from the dialog (flight, both storeys'
// walls and rooms, no issue); the storey selector (the upper storey drawn and picked, the ground
// one a ghost); placing a wardrobe, a partition and a door snapping to it on the upper storey; the
// iso view picking on the upper storey's floor; dragging the flight's top end and placing a new
// flight by drag on the ground storey (undone); "Số tầng" 2 → 3 (undone); then the house placed,
// exported, unpacked and played: the player walks up the flight to the upper storey.
// Writes a temporary world to content/maps/m11c2-browser-test and removes it at the end.
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
const TEST_WORLD = 'm11c2-browser-test'
const PREFAB = 'building/m11c2-house'

const state = () =>
  page.evaluate(() => {
    const s = window.__editor.getState()
    const doc = s.edit?.doc
    return {
      prefabMode: s.prefabMode,
      floor: s.prefabFloor,
      selection: s.edit?.selection ?? [],
      status: s.status?.text ?? '',
      errors: s.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.path}`),
      prefab: s.prefabMode ? structuredClone(doc.prefabs.get(s.prefabMode)) : null,
      instances: doc ? [...doc.chunks.values()].flatMap((c) => c.instances.map((i) => ({ id: i.instanceId, q: i.quarterTurns }))) : [],
    }
  })
/** Screen point of a world point (y: the storey's floor height in the prefab editor). */
const screen = (x, z, y = 0) =>
  page.evaluate(
    ([x, y, z]) => {
      const s = window.__editorThree()
      const v = s.camera.position.clone().set(x, y, z).project(s.camera)
      const r = s.gl.domElement.getBoundingClientRect()
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
    },
    [x, y, z],
  )
const until = (fn, arg, timeout = 10000) => page.waitForFunction(fn, arg, { timeout })
const frame = () => page.waitForTimeout(150)
async function drag(from, to, y = 0) {
  const a = await screen(from.x, from.z, y)
  const b = await screen(to.x, to.z, y)
  await page.mouse.move(a.x, a.y)
  await frame()
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 })
  await page.mouse.move(b.x, b.y, { steps: 5 })
  await frame()
  await page.mouse.up()
  await frame()
}
async function click(x, z, y = 0) {
  const p = await screen(x, z, y)
  await page.mouse.move(p.x, p.y)
  await frame()
  await page.mouse.click(p.x, p.y)
  await frame()
}
const level = (o) => o.level ?? 0
const tool = async (presetId) => {
  const tab = presetId.split('/')[0] === 'container' ? 'containers' : presetId.split('/')[0] === 'opening' ? 'openings' : presetId.split('/')[0]
  await page.locator(`[data-prefab-tab="${tab}"]`).click()
  await page.locator(`[data-prefab-preset="${presetId}"]`).click()
}

try {
  // 1. New world, new two-storey prefab from the dialog.
  await page.goto(`${base}/editor.html`)
  await until(() => window.__editor?.getState().status?.text.includes('Đã mở'), null, 30000)
  await page.getByRole('button', { name: 'Mới', exact: true }).click()
  await page.locator('.modal label.field', { hasText: 'worldId' }).locator('input').fill(TEST_WORLD)
  await page.locator('.modal label.field', { hasText: 'Tên' }).locator('input').fill('Thử M11c-2')
  await page.getByRole('button', { name: 'Tạo', exact: true }).click()
  await until((id) => window.__editor.getState().edit?.doc.world.worldId === id, TEST_WORLD)
  await page.locator('[data-new-prefab]').click()
  await page.locator('.modal label.field', { hasText: 'prefabId' }).locator('input').fill(PREFAB)
  await page.locator('.modal label.field', { hasText: 'Tên' }).locator('input').fill('Nhà hai tầng')
  await page.locator('[data-prefab-shape]').selectOption('twoStorey')
  await page.locator('.modal label.field', { hasText: 'Rộng X' }).locator('input').fill('10')
  await page.locator('.modal label.field', { hasText: 'Sâu Z' }).locator('input').fill('8')
  await page.getByRole('button', { name: 'Tạo', exact: true }).click()
  await page.waitForTimeout(400)
  let s = await state()
  assert.equal(s.prefabMode, PREFAB)
  assert.equal(s.prefab.building.storeys, 2)
  assert.deepEqual(s.errors, [])
  assert.equal(await page.locator('[data-floors]').getAttribute('data-floors'), '2')
  assert.equal(s.prefab.objects.filter((o) => o.kind === 'stairs').length, 1)
  await shot('m11c2-ground-storey')
  log('two-storey prefab from dialog', `${s.prefab.objects.length} objects, ${s.prefab.rooms.length} rooms, flight, no issue`)

  // 2. The upper storey: selector, picking there, placing a wardrobe, a partition and a door on it.
  await page.locator('[data-prefab-floor="1"]').click()
  s = await state()
  assert.equal(s.floor, 1)
  const H = s.prefab.building.height
  await click(0, -4, H)
  s = await state()
  assert.deepEqual(s.selection, ['wall-n-2'], 'the upper north wall is picked, not the ground one')
  await page.keyboard.press('Escape')
  await tool('container/wardrobe')
  await click(3, 2.5, H)
  await tool('structure/wall-run')
  await drag({ x: -5, z: 0.5 }, { x: 5, z: 0.5 }, H)
  await tool('opening/door')
  await click(2, 0.8, H)
  await page.keyboard.press('Escape')
  s = await state()
  const wardrobe = s.prefab.objects.find((o) => o.localId.startsWith('wardrobe'))
  const partition = s.prefab.objects.find((o) => o.kind === 'wallRun' && o.localId.startsWith('wall-') && !o.localId.endsWith('-2') && !['wall-n', 'wall-s', 'wall-w', 'wall-e'].includes(o.localId))
  const door = s.prefab.objects.find((o) => o.kind === 'door' && o.localId !== 'door')
  log('placed upstairs', { wardrobe: wardrobe && [wardrobe.localId, level(wardrobe)], partition: partition && [partition.localId, level(partition), partition.from, partition.to], door: door && [door.localId, level(door), door.position] })
  assert.equal(level(wardrobe), 1)
  assert.deepEqual([level(partition), partition.from.z, partition.to.z], [1, 0.5, 0.5])
  assert.deepEqual([level(door), door.position.z], [1, 0.5], 'the door snapped onto the upper partition')
  assert.deepEqual(s.errors, [])
  await shot('m11c2-upper-storey')

  // 3. Iso view: the pointer lands on the upper storey's floor (3 m up), not the ground.
  await page.keyboard.press('Tab')
  await page.waitForTimeout(600)
  await click(wardrobe.position.x, wardrobe.position.z, H)
  s = await state()
  assert.deepEqual(s.selection, [wardrobe.localId], 'picked in the iso view at the storey height')
  await shot('m11c2-upper-iso')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  log('iso pick upstairs', s.selection)

  // 4. Ground storey (PageDown): drag the flight's top end, place a flight by drag; both undone.
  await page.keyboard.press('PageDown')
  s = await state()
  assert.equal(s.floor, 0)
  const flight = s.prefab.objects.find((o) => o.kind === 'stairs')
  await click(flight.position.x, flight.position.z)
  s = await state()
  assert.deepEqual(s.selection, [flight.localId])
  const top = { x: flight.position.x + flight.length / 2, z: flight.position.z }
  // To a point on the editor's snap grid (0.5 m): the foot stays, the run grows to reach it.
  const reach = Math.ceil(top.x + 0.5)
  await drag(top, { x: reach, z: top.z })
  s = await state()
  const longer = s.prefab.objects.find((o) => o.localId === flight.localId)
  const footX = flight.position.x - flight.length / 2
  assert.deepEqual([longer.length, longer.position.x], [+(reach - footX).toFixed(3), +((reach + footX) / 2).toFixed(3)], JSON.stringify(longer))
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Escape')
  await tool('structure/stairs')
  await drag({ x: 3.5, z: 3 }, { x: 3.5, z: -1 })
  await page.keyboard.press('Escape')
  s = await state()
  const added = s.prefab.objects.filter((o) => o.kind === 'stairs').at(-1)
  assert.notEqual(added.localId, flight.localId)
  assert.deepEqual([added.length, added.position, added.width], [4, { x: 3.5, z: 1 }, 1.2], JSON.stringify(added))
  await shot('m11c2-new-flight')
  await page.keyboard.press('Control+z')
  s = await state()
  assert.equal(s.prefab.objects.filter((o) => o.kind === 'stairs').length, 1)
  log('flights by mouse', `top end dragged to x ${reach} (${longer.length} m, undone); new flight dragged foot (3.5, 3) → top (3.5, −1): ${added.length} m (undone)`)

  // 5. "Số tầng" 2 → 3: a third storey button; undone.
  await page.keyboard.press('Escape')
  await page.locator('.inspector label.field', { hasText: 'Số tầng' }).locator('input').fill('3')
  await page.locator('.inspector label.field', { hasText: 'Số tầng' }).locator('input').press('Enter')
  await page.waitForTimeout(300)
  s = await state()
  assert.equal(s.prefab.building.storeys, 3)
  assert.equal(await page.locator('[data-floors]').getAttribute('data-floors'), '3')
  await page.keyboard.press('Control+z')
  s = await state()
  assert.equal(s.prefab.building.storeys, 2)
  assert.deepEqual(s.errors, [])
  log('storeys field', '2 → 3 (three storey buttons) → undo')

  // 6. Place the house, export, unpack, play: walk up the flight.
  await page.locator('[data-exit-prefab]').click()
  await page.locator(`[data-prefab="${PREFAB}"]`).click()
  await click(-14, 14)
  await page.keyboard.press('Escape')
  s = await state()
  assert.ok(s.instances.some((i) => i.id.includes('m11c2-house')), JSON.stringify(s.instances))
  assert.deepEqual(s.errors, [])
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export', exact: true }).click()])
  const packPath = `${tmp}/${TEST_WORLD}.mappack.json`
  await dl.saveAs(packPath)
  const out = execFileSync(process.execPath, ['scripts/map-tools/unpack.ts', packPath], { encoding: 'utf8' })
  log('map:unpack', out.trim().split('\n')[0])
  const check = execFileSync(process.execPath, ['scripts/map-tools/check.ts', `content/maps/${TEST_WORLD}`, '--deep'], { encoding: 'utf8' })
  log('map:check --deep', check.trim().split('\n').at(-1))
  assert.ok(check.includes('deep check OK'), check)
  await page.waitForTimeout(1500)
  await page.goto(`${base}/?world=${TEST_WORLD}`).catch(() => page.goto(`${base}/?world=${TEST_WORLD}`))
  await until(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, 30000)
  await page.getByRole('button', { name: 'New Game', exact: true }).click()
  await until(() => document.body.innerText.includes('Tạo nhân vật'))
  await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click()
  await until(() => !document.querySelector('h1') && document.querySelector('.hud') && window.__runtime?.playerBody, null, 30000)
  const foot = await page.evaluate(() => {
    const rt = window.__runtime
    rt.spawnTimer = 1e9
    for (const z of rt.zombies.values()) z.health = 0
    const s = rt.map.stairs[0]
    // 0.9 m before the bottom end, on the flight's centre line.
    const cx = (s.rect.minX + s.rect.maxX) / 2
    const cz = (s.rect.minZ + s.rect.maxZ) / 2
    const back = -(s.length / 2 + 0.9) * s.dir
    const p = s.axis === 'x' ? { x: cx + back, z: cz } : { x: cx, z: cz + back }
    rt.player.position = { x: p.x, y: 0, z: p.z }
    rt.playerBody.setTranslation({ x: p.x, y: 0.92, z: p.z }, true)
    return { ...p, axis: s.axis, dir: s.dir, layers: rt.navWorld.layers.length }
  })
  log('played: flight foot', foot)
  assert.deepEqual([foot.axis, foot.dir, foot.layers], ['x', 1, 2])
  await page.waitForTimeout(800)
  // S + D walks +X with the default camera.
  for (const k of ['KeyS', 'KeyD']) await page.keyboard.down(k)
  await page.waitForTimeout(2600)
  for (const k of ['KeyS', 'KeyD']) await page.keyboard.up(k)
  await page.waitForTimeout(1200)
  const up = await page.evaluate(() => ({ y: window.__runtime.player.position.y, cut: window.__cutaway?.debugState() }))
  log('walked up', { y: up.y, storey: up.cut?.level })
  assert.equal(up.y, 3)
  assert.equal(up.cut?.level, 1)
  await shot('m11c2-play-upstairs')

  assert.deepEqual(errors, [])
  console.log('PASS')
} catch (e) {
  await shot('m11c2-failure').catch(() => {})
  console.log('errors:', errors)
  throw e
} finally {
  rmSync(`content/maps/${TEST_WORLD}`, { recursive: true, force: true })
  await browser.close()
}
