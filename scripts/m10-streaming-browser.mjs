// Map editor M10 (runtime streaming) browser check with Playwright (fresh isolated context, dev
// server: it reads the game through window.__runtime, __viewChunks, __scene and __renderInfo).
//   BASE_URL=http://127.0.0.1:5174 node scripts/m10-streaming-browser.mjs
// Set PLAYWRIGHT_MODULE (file:// URL of playwright/index.mjs) and CHROMIUM_PATH when needed.
// Covers, on a generated 8×8 town (~270 m, 100 chunks) written to content/maps/m10-browser-test:
// - content per world: the neighbourhood page never requests the town's chunk files; picking the
//   town loads them before the game starts;
// - nav warm-up: the runtime starts with part of the tile graph and finishes it on the menu;
// - view streaming: only the chunks around the camera are mounted (doors counted in the scene),
//   the set holds still while the camera does, a teleport across the town mounts the new chunks
//   and drops the old ones, and `?stream=off` (everything mounted) costs many more objects.
// Removes the temporary world at the end.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const tmp = 'node_modules/.tmp'
mkdirSync(tmp, { recursive: true })
const log = (label, value) => console.log(label.padEnd(30), typeof value === 'string' ? value : JSON.stringify(value))
const TEST_WORLD = 'm10-browser-test'
const errors = []

async function open(query) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  const requests = []
  page.on('request', (r) => requests.push(r.url()))
  await page.goto(`${base}/${query}`).catch(() => page.goto(`${base}/${query}`))
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 60000 })
  return { page, requests }
}
async function play(page) {
  await page.getByRole('button', { name: 'New Game', exact: true }).click()
  await page.waitForFunction(() => document.body.innerText.includes('Tạo nhân vật'))
  await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('h1') && document.querySelector('.hud') && window.__renderInfo, null, { timeout: 60000 })
  await page.evaluate(() => {
    window.__runtime.spawnTimer = 1e9
  })
  await page.waitForTimeout(1500)
}
/** Shown chunks, door leaves in the scene and doors the shown chunks hold. */
const state = (page) =>
  page.evaluate(() => {
    const rt = window.__runtime
    const shown = window.__viewChunks()
    const S = rt.map.chunkSize ?? 32
    const key = (x, z) => `${Math.floor(x / S)},${Math.floor(z / S)}`
    const expectedDoors = rt.map.doors.filter((d) => shown.includes(key(d.center.x, d.center.z))).length
    let leaves = 0
    let objects = 0
    window.__scene.traverse((o) => {
      objects++
      const g = o.geometry?.parameters
      if (o.isMesh && g && g.depth === 0.12 && g.height >= 1.9) leaves++
    })
    const cells = new Set(rt.map.doors.map((d) => key(d.center.x, d.center.z)))
    return { shown: shown.length, total: new Set([...rt.map.walls.map((w) => key(w.position.x, w.position.z)), ...cells]).size, expectedDoors, leaves, objects, calls: window.__renderInfo.calls, player: key(rt.player.position.x, rt.player.position.z), keys: shown }
  })

try {
  const out = execFileSync(process.execPath, ['scripts/map-tools/generate.ts', '--seed', '8', '--blocks', '8x8', '--layout', 'varied', '--world-id', TEST_WORLD, '--force'], { encoding: 'utf8' })
  log('map:generate', out.trim().split('\n')[0])
  await new Promise((r) => setTimeout(r, 1500))

  // 1. The neighbourhood never downloads the town's chunks (only its world.json, for the menu).
  {
    const { page, requests } = await open('')
    const town = requests.filter((u) => u.includes(`/content/maps/${TEST_WORLD}/`))
    assert.ok(town.every((u) => u.includes('/world.json')), JSON.stringify(town))
    log('neighbourhood page', `${requests.length} requests, town files: ${town.map((u) => u.split(TEST_WORLD)[1].split('?')[0]).join(', ') || 'none'}`)
    await page.close()
  }

  // 2. The town: its chunks load before the game; the nav graph finishes warming on the menu.
  const { page, requests } = await open(`?perf=1&world=${TEST_WORLD}`)
  const chunkFiles = requests.filter((u) => u.includes(`/content/maps/${TEST_WORLD}/chunks/`)).length
  assert.ok(chunkFiles > 50, `chunk files requested: ${chunkFiles}`)
  const warm0 = await page.evaluate(() => window.__runtime.nav.tiles.pendingWarm)
  await page.waitForFunction(() => window.__runtime.nav.tiles.warmed, null, { timeout: 60000 })
  log('content + nav', `${chunkFiles} chunk files loaded; nav tiles pending at menu: ${warm0} → 0`)
  await play(page)

  // 3. Streaming: few chunks shown, every door of those chunks mounted, nothing else.
  let s = await state(page)
  log('shown at start', { shown: s.shown, chunks: s.total, doors: s.leaves, calls: s.calls, objects: s.objects })
  assert.ok(s.shown < s.total / 2, JSON.stringify(s))
  assert.equal(s.leaves, s.expectedDoors)
  assert.ok(s.keys.includes(s.player))
  // Still camera → the set holds (no load/unload churn).
  const before = s.keys.join('|')
  await page.waitForTimeout(1500)
  assert.equal((await state(page)).keys.join('|'), before)

  // 4. Teleport across the town: the new place is mounted, the old one dropped.
  const target = await page.evaluate(() => {
    const rt = window.__runtime
    const far = rt.map.doors.reduce((a, d) => (Math.hypot(d.center.x - rt.player.position.x, d.center.z - rt.player.position.z) > Math.hypot(a.center.x - rt.player.position.x, a.center.z - rt.player.position.z) ? d : a))
    const p = rt.nav.cellToWorld(...Object.values(rt.nav.nearestWalkableCell(far.center.x + 3, far.center.z + 3, 10)))
    const pos = { x: p.x, y: 0.9, z: p.z }
    rt.playerBody?.setTranslation(pos, true)
    rt.player.position = { ...pos }
    return { x: pos.x, z: pos.z, door: far.id }
  })
  await page.waitForTimeout(2500)
  const after = await state(page)
  log('after teleport', { to: target, shown: after.shown, doors: after.leaves, calls: after.calls, objects: after.objects })
  assert.ok(after.keys.includes(after.player))
  // Everything shown is around the new place; the start (160 m away) is gone.
  const near = (k, p) => {
    const [a, b] = k.split(',').map(Number)
    const [c, d] = p.split(',').map(Number)
    return Math.max(Math.abs(a - c), Math.abs(b - d)) <= 3
  }
  assert.ok(after.keys.every((k) => near(k, after.player)), `shown ${after.keys} around ${after.player}`)
  assert.ok(!after.keys.includes(s.player) && s.keys.filter((k) => !after.keys.includes(k)).length >= s.keys.length - 1, `before ${s.keys} after ${after.keys}`)
  assert.equal(after.leaves, after.expectedDoors)
  assert.ok(after.leaves > 0)
  await page.screenshot({ path: `${tmp}/m10-teleport.png` })
  s = after
  await page.close()

  // 5. Everything mounted (`?stream=off`) for comparison.
  const off = await open(`?perf=1&stream=off&world=${TEST_WORLD}`)
  await play(off.page)
  const all = await state(off.page)
  log('stream=off', { doors: all.leaves, calls: all.calls, objects: all.objects })
  assert.ok(all.objects > 2 * s.objects, `${all.objects} vs ${s.objects}`)
  await off.page.close()

  assert.deepEqual(errors, [])
  console.log('PASS')
} catch (e) {
  console.log('errors:', errors)
  throw e
} finally {
  rmSync(`content/maps/${TEST_WORLD}`, { recursive: true, force: true })
  await browser.close()
}
