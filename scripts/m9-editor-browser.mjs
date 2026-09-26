// Map editor M9 (generator layouts + trees) browser check with Playwright (fresh isolated context,
// dev server only: it reads the editor store through window.__editor and the game through
// window.__runtime / window.__renderInfo).
//   BASE_URL=http://127.0.0.1:5174 node scripts/m9-editor-browser.mjs
// Set PLAYWRIGHT_MODULE (file:// URL of playwright/index.mjs) and CHROMIUM_PATH when needed.
// Covers: New → generator "varied" + many trees from the dialog (= `map:generate` byte for byte),
// editor draw calls of a varied 4×4 town with trees, a tree placed from the palette (Inspector
// height/style, canopy radius handle with the real mouse, "Cây" layer hides it), a garden tree in a
// prefab (thumbnail), Export → `npm run map:unpack` → played with `?world=` (trees in the map,
// trunks block the nav, canopy drawn, game draw calls).
// Writes a temporary world to content/maps/m9-browser-test and removes it at the end.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'

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
const TEST_WORLD = 'm9-browser-test'
const until = (fn, arg, timeout = 10000) => page.waitForFunction(fn, arg, { timeout })
const button = (name) => page.getByRole('button', { name, exact: true })
const frame = () => page.waitForTimeout(150)
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
async function drag(from, to) {
  const a = await screen(from.x, from.z)
  const b = await screen(to.x, to.z)
  await page.mouse.move(a.x, a.y)
  await frame()
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 8 })
  await frame()
  await page.mouse.up()
  await frame()
}
const trees = () =>
  page.evaluate(() => {
    const doc = window.__editor.getState().edit.doc
    return [...doc.chunks.values()].flatMap((c) => c.objects.filter((o) => o.kind === 'tree').map((o) => ({ id: o.objectId, chunk: c.chunkId, cx: c.cx, cz: c.cz, ...o })))
  })
async function generate(worldId, seed, blocks, layout, trees) {
  await button('Mới').click()
  await page.locator('.modal label.field', { hasText: 'worldId' }).locator('input').fill(worldId)
  await page.locator('[data-new-mode]').selectOption('generate')
  await page.locator('[data-gen-seed]').fill(String(seed))
  await page.locator('[data-gen-blocks]').selectOption(blocks)
  await page.locator('[data-gen-layout]').selectOption(layout)
  await page.locator('[data-gen-trees]').selectOption(trees)
  await button('Tạo').click()
  await until((id) => window.__editor.getState().edit?.doc.world.worldId === id, worldId)
  await page.waitForTimeout(600)
}

try {
  await page.goto(`${base}/editor.html`)
  await until(() => window.__editor?.getState().status?.text.includes('Đã mở'), null, 30000)

  // 1. Draw calls of a varied 4×4 town with many trees.
  await generate('gen-big', 7, '4x4', 'varied', '1')
  const big = await page.evaluate(async () => {
    const three = window.__editorThree()
    for (let i = 0; i < 3; i++) {
      three.invalidate()
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    }
    const doc = window.__editor.getState().edit.doc
    return { calls: three.gl.info.render.calls, trees: [...doc.chunks.values()].reduce((n, c) => n + c.objects.filter((o) => o.kind === 'tree').length, 0) }
  })
  assert.ok(big.trees > 100, JSON.stringify(big))
  await shot('m9-editor-4x4-varied')
  log('editor varied 4x4 + trees', big)

  // 2. The test world: varied 2×2 from the dialog = the CLI pack byte for byte.
  await generate(TEST_WORLD, 42, '2x2', 'varied', '1')
  let s = await page.evaluate(() => {
    const st = window.__editor.getState()
    return { errors: st.issues.filter((i) => i.severity === 'error').length, params: st.edit.doc.world.generator.params }
  })
  assert.deepEqual(s, { errors: 0, params: { blocksX: 2, blocksZ: 2, layout: 'varied', trees: 1 } })
  execFileSync(process.execPath, ['scripts/map-tools/generate.ts', '--seed', '42', '--blocks', '2x2', '--layout', 'varied', '--trees', '1', '--world-id', TEST_WORLD, '--name', 'Thị trấn sinh tự động (seed 42)', '--pack', `${tmp}/m9-cli.json`])
  const [dl0] = await Promise.all([page.waitForEvent('download'), button('Export').click()])
  await dl0.saveAs(`${tmp}/m9-editor.json`)
  const editorPack = readFileSync(`${tmp}/m9-editor.json`, 'utf8')
  const cliPack = readFileSync(`${tmp}/m9-cli.json`, 'utf8')
  const nameOf = (text) => JSON.parse(text).files['world.json'].name
  assert.equal(editorPack.replace(nameOf(editorPack), ''), cliPack.replace(nameOf(cliPack), ''))
  const generated = await trees()
  log('generator varied 2x2', `${generated.length} trees; editor export = CLI pack (same options)`)

  // 3. A tree from the palette: Inspector fields, canopy radius handle, layer.
  await page.locator('[data-tab="objects"]').click()
  await page.locator('[data-preset="object/tree"]').click()
  await page.evaluate(() => window.__editor.getState().requestFocus({ minX: -40, minZ: -45, maxX: -20, maxZ: -25 }))
  await frame()
  // An open spot in the north-west corner (inside the play area, off the streets).
  const spot = await page.evaluate(() => {
    const doc = window.__editor.getState().edit.doc
    const area = doc.world.playArea
    return { x: -area.size / 2 + 3, z: -(area.depth ?? area.size) / 2 + 3 }
  })
  const at = await screen(spot.x, spot.z)
  await page.mouse.move(at.x, at.y)
  await frame()
  await page.mouse.click(at.x, at.y)
  await page.keyboard.press('Escape')
  s = await page.evaluate(() => ({ selection: window.__editor.getState().edit.selection, errors: window.__editor.getState().issues.filter((i) => i.severity === 'error').map((i) => i.message) }))
  const treeId = s.selection[0]
  assert.match(treeId ?? '', /\/objects\/tree-\d+$/, JSON.stringify(s))
  assert.deepEqual(s.errors, [])
  await page.evaluate(() => window.__editor.getState().requestFocus())
  await frame()
  await page.locator('[data-tree-style]').selectOption('pine')
  const height = page.locator('.inspector label.field', { hasText: 'Cao (m)' }).locator('input')
  await height.fill('9')
  await height.press('Enter')
  let placed = (await trees()).find((t) => t.id === treeId)
  assert.deepEqual([placed.style, placed.height], ['pine', 9])
  const world = { x: placed.cx * 32 + placed.position.x, z: placed.cz * 32 + placed.position.z }
  await page.evaluate(() => window.__editor.getState().requestFocus({ minX: -48, minZ: -50, maxX: -18, maxZ: -20 }))
  await frame()
  await drag({ x: world.x + placed.canopy, z: world.z }, { x: world.x + 3, z: world.z })
  placed = (await trees()).find((t) => t.id === treeId)
  assert.equal(placed.canopy, 3)
  await shot('m9-tree-editor')
  // Hidden layer: no longer pickable.
  await page.evaluate(() => window.__editor.getState().setLayer('vegetation', { hidden: true }))
  await page.evaluate(() => window.__editor.getState().select([]))
  const hit = await screen(world.x, world.z)
  await page.mouse.click(hit.x, hit.y)
  assert.ok(!(await page.evaluate(() => window.__editor.getState().edit.selection)).includes(treeId))
  await page.evaluate(() => window.__editor.getState().setLayer('vegetation', { hidden: false }))
  log('palette tree', `${treeId}: pine 9 m, canopy handle → 3 m, hidden layer not pickable`)

  // 4. Garden tree in a prefab: thumbnail shows it.
  await page.locator('[data-tab="prefabs"]').click()
  await page.locator('[data-new-prefab]').click()
  await page.locator('.modal label.field', { hasText: 'prefabId' }).locator('input').fill('building/m9-garden')
  await page.locator('.modal label.field', { hasText: 'Tên' }).locator('input').fill('Nhà vườn')
  await button('Tạo').click()
  await page.waitForTimeout(400)
  await page.locator('[data-prefab-tab="furniture"]').click()
  await page.locator('[data-prefab-preset="furniture/tree"]').click()
  const g = await screen(2, 5)
  await page.mouse.move(g.x, g.y)
  await frame()
  await page.mouse.click(g.x, g.y)
  await page.keyboard.press('Escape')
  await page.locator('[data-exit-prefab]').click()
  await page.waitForTimeout(300)
  assert.equal(await page.locator('[data-thumb="building/m9-garden"] circle').count(), 1)
  log('prefab garden tree', 'placed in the prefab; thumbnail draws its canopy')

  // 5. Export → unpack → play.
  const [dl] = await Promise.all([page.waitForEvent('download'), button('Export').click()])
  const packPath = `${tmp}/${TEST_WORLD}.mappack.json`
  await dl.saveAs(packPath)
  const out = execFileSync(process.execPath, ['scripts/map-tools/unpack.ts', packPath], { encoding: 'utf8' })
  log('map:unpack', out.trim().split('\n')[0])
  await page.waitForTimeout(1500)
  await page.goto(`${base}/?world=${TEST_WORLD}`).catch(() => page.goto(`${base}/?world=${TEST_WORLD}`))
  await until(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, 30000)
  await button('New Game').click()
  await until(() => document.body.innerText.includes('Tạo nhân vật'))
  await button('Bắt đầu').click()
  await until(() => !document.querySelector('h1') && document.querySelector('.hud'), null, 30000)
  await page.waitForTimeout(2000)
  const game = await page.evaluate((id) => {
    const rt = window.__runtime
    const t = rt.map.trees.find((x) => x.id === id)
    // Move the player right beside the tree: the canopy is between the camera and the player.
    rt.player.position.x = t.position.x + 1
    rt.player.position.z = t.position.z + 1
    return {
      trees: rt.map.trees.length,
      trunkWalls: rt.map.trees.every((x) => rt.map.walls.some((w) => w.id === x.id)),
      trunkBlocked: !rt.nav.isWalkable(t.position.x, t.position.z),
      besideWalkable: rt.nav.isWalkable(t.position.x + t.canopy - 0.2, t.position.z),
      calls: window.__renderInfo.calls,
    }
  }, treeId)
  assert.ok(game.trees === generated.length + 1 && game.trunkWalls && game.trunkBlocked && game.besideWalkable, JSON.stringify(game))
  await page.waitForTimeout(1000)
  await shot('m9-play')
  log('play editor output', game)

  assert.deepEqual(errors, [])
  console.log('PASS')
} catch (e) {
  await shot('m9-failure').catch(() => {})
  console.log('errors:', errors)
  throw e
} finally {
  rmSync(`content/maps/${TEST_WORLD}`, { recursive: true, force: true })
  await browser.close()
}
