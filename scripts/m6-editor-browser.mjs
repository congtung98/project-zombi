// Map editor M6 (production tools) browser check with Playwright (fresh isolated context, dev
// server only: it reads the store through window.__editor and the playtest game through the
// frame's window.__runtime).
//   BASE_URL=http://127.0.0.1:5174 node scripts/m6-editor-browser.mjs
// Set PLAYWRIGHT_MODULE (file:// URL of playwright/index.mjs) and CHROMIUM_PATH when needed.
// Covers: prefab thumbnails; Play From Here on an edited, unsaved document (real keyboard input in
// the game frame, pause-menu save) → back to the editor with the same document object, selection,
// history and camera, no game database and no draft written; a start point inside a wall refused;
// deep check (clean, then a crate pushed into a wall → collider-overlap, click selects it); the
// generator in the New dialog equals `npm run map:generate --pack` byte for byte and its world
// plays; editor draw calls on a 4×4 generated town.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'

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

const state = () =>
  page.evaluate(() => {
    const s = window.__editor.getState()
    return {
      worldId: s.edit?.doc.world.worldId,
      selection: s.edit?.selection ?? [],
      past: s.edit?.past.length ?? 0,
      errors: s.issues.filter((i) => i.severity === 'error').map((i) => i.code),
      status: s.status?.text ?? '',
      tool: s.tool,
      playtest: s.playtest && { state: s.playtest.state, spawn: s.playtest.spawn },
      deep: s.deep && { codes: s.deep.issues.map((i) => i.code), ids: s.deep.issues.map((i) => i.entityId), ms: s.deep.ms },
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
const camera = () => page.evaluate(() => {
  const c = window.__editorThree().camera
  return [c.position.x, c.position.y, c.position.z, c.zoom].map((v) => Math.round(v * 1000) / 1000)
})
const until = (fn, arg, timeout = 10000) => page.waitForFunction(fn, arg, { timeout })
const frame = () => page.waitForTimeout(150)
async function click(x, z) {
  const p = await screen(x, z)
  await page.mouse.move(p.x, p.y)
  await frame()
  await page.mouse.click(p.x, p.y)
  await frame()
}
const gameFrame = () => page.frames().find((f) => f.url().includes('playtest.html'))

try {
  await page.goto(`${base}/editor.html`)
  await until(() => window.__editor?.getState().status?.text.includes('Đã mở'), null, 30000)
  await page.waitForTimeout(500)

  // 1. Thumbnails: one SVG per prefab, drawn from the resolver.
  const thumbs = await page.locator('svg[data-thumb]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-thumb'), e.querySelectorAll('rect').length]))
  assert.equal(thumbs.length, 3)
  assert.ok(thumbs.every(([, n]) => n > 10), JSON.stringify(thumbs))
  log('thumbnails', thumbs.map(([id, n]) => `${id}: ${n} shapes`).join(', '))

  // 2. Edit without saving, select something, then Play From Here at a free point.
  await page.evaluate(() => window.__editor.getState().select(['c0_0/objects/house-scrap']))
  await page.keyboard.press('ArrowLeft')
  let s = await state()
  assert.equal(s.past, 1)
  const before = { camera: await camera(), selection: s.selection }
  await page.evaluate(() => {
    window.__docBefore = window.__editor.getState().edit.doc
  })
  await page.locator('[data-play-hour]').selectOption('21')
  await page.locator('[data-play-here]').click()
  const wall = await page.evaluate(() => {
    const r = window.__editor.getState()
    return r.edit.doc.chunks.get('c-1_-1').instances[0].position
  })
  await click(-32 + wall.x - 4, -32 + wall.z) // the safehouse's west wall line: inside a collider
  s = await state()
  assert.equal(s.playtest, null)
  assert.match(s.status, /Không bắt đầu được/)
  await click(-13, -13)
  await until(() => window.__editor.getState().playtest?.state === 'started', null, 60000)
  await page.waitForTimeout(1500)
  const game = gameFrame()
  assert.ok(game, 'playtest frame')
  const g0 = await game.evaluate(() => ({ map: window.__runtime.map.id, p: window.__runtime.player.position, t: window.__runtime.clock.timeOfDay, scrap: window.__runtime.map.containers.find((c) => c.id === 'c0_0/objects/house-scrap').position.x }))
  assert.equal(g0.map, 'neighborhood-50')
  assert.deepEqual([Math.round(g0.p.x), Math.round(g0.p.z)], [-13, -13])
  assert.ok(Math.abs(g0.t - 21 / 24) < 0.01)
  assert.equal(g0.scrap, 20, 'the unsaved nudge (20.5 → 20) is in the snapshot')
  await shot('m6-playtest')
  // Real keyboard input inside the game frame: walk south for a moment.
  await page.locator('[data-playtest] iframe').click({ position: { x: 700, y: 400 } })
  await page.keyboard.down('s')
  await page.waitForTimeout(900)
  await page.keyboard.up('s')
  const g1 = await game.evaluate(() => window.__runtime.player.position)
  assert.ok(Math.hypot(g1.x - g0.p.x, g1.z - g0.p.z) > 0.5, `player moved: ${JSON.stringify(g1)}`)
  // Save from the pause menu: memory only.
  await page.keyboard.press('Escape')
  await game.getByRole('button', { name: 'Lưu game', exact: true }).click()
  await page.waitForTimeout(500)
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).sort())
  assert.deepEqual(dbs, ['zombie-outbreak-editor'])
  const drafts = await page.evaluate(() => window.__editor.getState().drafts.length)
  log('play from here', `start (-13,-13) at 21:00 on the unsaved edit; walked ${Math.hypot(g1.x - g0.p.x, g1.z - g0.p.z).toFixed(1)} m; saved in memory; databases ${JSON.stringify(dbs)}`)

  // 3. Back to the editor: same document object, selection, history and camera.
  await page.locator('[data-stop-playtest]').click()
  s = await state()
  assert.equal(s.playtest, null)
  assert.equal(await page.evaluate(() => window.__editor.getState().edit.doc === window.__docBefore), true)
  assert.deepEqual(s.selection, before.selection)
  assert.equal(s.past, 1)
  assert.deepEqual(await camera(), before.camera)
  assert.equal(await page.evaluate(() => window.__editor.getState().drafts.length), drafts)
  assert.equal(await page.locator('iframe').count(), 0)
  log('back to editor', 'document object, selection, history, camera unchanged; no draft written')

  // 4. Deep check: clean, then a crate pushed into the store wall.
  await page.getByRole('button', { name: /^Validate/ }).click()
  await page.locator('[data-deep-check]').click()
  s = await state()
  assert.deepEqual(s.deep.codes, [])
  assert.match(await page.locator('[data-deep-results]').innerText(), /đi tới được/)
  const store = await page.evaluate(() => {
    const d = window.__editor.getState().edit.doc
    const c = d.chunks.get('c0_-1')
    return { x: c.instances[0].position.x, z: c.instances[0].position.z }
  })
  await page.locator('[data-tab="objects"]').click()
  await page.locator('[data-preset="object/crate"]').click()
  // Store footprint ±6 × ±4 around its pivot: its north wall line is 4 m north of the pivot.
  await click(store.x + 2, -32 + store.z - 4)
  await page.keyboard.press('Escape')
  await page.locator('[data-deep-check]').click()
  s = await state()
  assert.ok(s.deep.codes.includes('collider-overlap'), JSON.stringify(s.deep))
  await page.locator('[data-deep-results] li').first().click()
  s = await state()
  assert.equal(s.selection.length, 1)
  log('deep check', `clean → after crate in a wall: ${s.deep.codes.join(', ')}; click selects ${s.selection[0]}`)
  await shot('m6-deep-check')

  // 5. Generator in the New dialog = CLI output; its world plays.
  await page.getByRole('button', { name: 'Mới', exact: true }).click()
  await page.locator('.modal label.field', { hasText: 'worldId' }).locator('input').fill('gen-42')
  await page.locator('.modal label.field', { hasText: 'Tên' }).locator('input').fill('Thị trấn 42')
  await page.locator('[data-new-mode]').selectOption('generate')
  await page.locator('[data-gen-seed]').fill('42')
  await page.locator('[data-gen-blocks]').selectOption('2x2')
  await page.getByRole('button', { name: 'Tạo', exact: true }).click()
  await until(() => window.__editor.getState().edit?.doc.world.worldId === 'gen-42')
  s = await state()
  assert.deepEqual(s.errors, [])
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export', exact: true }).click()])
  await dl.saveAs(`${tmp}/gen-42.editor.mappack.json`)
  execFileSync(process.execPath, ['scripts/map-tools/generate.ts', '--seed', '42', '--blocks', '2x2', '--world-id', 'gen-42', '--name', 'Thị trấn 42', '--pack', `${tmp}/gen-42.cli.mappack.json`])
  assert.equal(readFileSync(`${tmp}/gen-42.editor.mappack.json`, 'utf8'), readFileSync(`${tmp}/gen-42.cli.mappack.json`, 'utf8'))
  await page.locator('[data-deep-check]').click()
  s = await state()
  assert.deepEqual(s.deep.codes, [])
  await frame()
  await shot('m6-generated')
  await page.locator('[data-play-spawn]').click()
  await until(() => window.__editor.getState().playtest?.state === 'started', null, 60000)
  await page.waitForTimeout(2000)
  const gen = await gameFrame().evaluate(() => ({ map: window.__runtime.map.id, zombies: window.__runtime.zombies.size, buildings: window.__runtime.map.buildings.length }))
  assert.equal(gen.map, 'gen-42')
  assert.ok(gen.zombies > 0 && gen.buildings > 0)
  await shot('m6-generated-play')
  await page.locator('[data-stop-playtest]').click()
  log('generator', `editor export = CLI pack byte for byte; deep check clean; plays (${gen.buildings} buildings, ${gen.zombies} zombies)`)

  // 6. Editor rendering load on a 4×4 generated town.
  await page.getByRole('button', { name: 'Mới', exact: true }).click()
  await page.locator('.modal label.field', { hasText: 'worldId' }).locator('input').fill('gen-big')
  await page.locator('[data-new-mode]').selectOption('generate')
  await page.locator('[data-gen-seed]').fill('3')
  await page.locator('[data-gen-blocks]').selectOption('4x4')
  await page.getByRole('button', { name: 'Tạo', exact: true }).click()
  await until(() => window.__editor.getState().edit?.doc.world.worldId === 'gen-big')
  await page.waitForTimeout(800)
  const perf = await page.evaluate(async () => {
    const three = window.__editorThree()
    const frames = []
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now()
      three.invalidate()
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      frames.push(performance.now() - t0)
    }
    frames.sort((a, b) => a - b)
    return { calls: three.gl.info.render.calls, triangles: three.gl.info.render.triangles, frameMs: Math.round(frames[10] * 10) / 10 }
  })
  log('editor 4x4 town render', perf)
  await shot('m6-generated-4x4')

  assert.deepEqual(errors, [])
  console.log('PASS')
} catch (e) {
  await shot('m6-failure').catch(() => {})
  console.log('errors:', errors)
  throw e
} finally {
  await browser.close()
}
