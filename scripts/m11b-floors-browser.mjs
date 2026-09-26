// Map editor M11b (storeys: data + simulation) browser check with Playwright (fresh isolated
// context, dev server: it reads the game through window.__runtime).
//   BASE_URL=http://127.0.0.1:5174 node scripts/m11b-floors-browser.mjs
// Set PLAYWRIGHT_MODULE (file:// URL of playwright/index.mjs) and CHROMIUM_PATH when needed.
// On the lab world `floors-lab` (a two-storey house, `?world=floors-lab`):
// - real keys walk the player (Rapier capsule, no gravity) up the flight: the simulation lifts it
//   to the upper floor, the body follows, the camera centre rises with it;
// - upstairs, E opens the wardrobe (not the cupboard right below it);
// - a zombie remembering the player walks in and climbs the flight;
// - a snapshot taken upstairs loads back upstairs (the remounted body starts on the upper floor);
// - walking back down puts the player on the ground.
// Screenshots in node_modules/.tmp/m11b-*.png.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const tmp = 'node_modules/.tmp'
mkdirSync(tmp, { recursive: true })
const log = (label, value) => console.log(label.padEnd(30), typeof value === 'string' ? value : JSON.stringify(value))
const errors = []
const HOUSE = 'c0_0/house'

const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

const player = () => page.evaluate(() => {
  const rt = window.__runtime
  const body = rt.playerBody?.translation()
  return { ...rt.player.position, bodyY: body?.y ?? null, prompt: rt.interactPrompt }
})
/** Put the player's body (and the simulation) at a point on the floor it stands on. */
const teleport = (x, y, z, facing) => page.evaluate(([x, y, z, facing]) => {
  const rt = window.__runtime
  rt.player.position = { x, y, z }
  if (facing !== undefined) rt.player.facing = facing
  rt.playerBody.setTranslation({ x, y: y + rt.config.player.height / 2 + 0.02, z }, true)
  rt.playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
}, [x, y, z, facing])
async function hold(keys, ms) {
  for (const k of keys) await page.keyboard.down(k)
  await page.waitForTimeout(ms)
  for (const k of keys) await page.keyboard.up(k)
  await page.waitForTimeout(150)
}

try {
  await page.goto(`${base}/?world=floors-lab`).catch(() => page.goto(`${base}/?world=floors-lab`))
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 60000 })
  await page.getByRole('button', { name: 'New Game', exact: true }).click()
  await page.waitForFunction(() => document.body.innerText.includes('Tạo nhân vật'))
  await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('h1') && document.querySelector('.hud') && window.__runtime?.playerBody, null, { timeout: 60000 })
  const setup = await page.evaluate((house) => {
    const rt = window.__runtime
    rt.spawnTimer = 1e9
    for (const z of rt.zombies.values()) z.health = 0
    rt.setDoorState(`${house}/door`, 'open')
    return { world: rt.map.id, storeys: rt.map.buildings[0].storeys, layers: rt.navWorld.layers.length, stairs: rt.navWorld.stairs.length, floors: rt.map.floors.length }
  }, HOUSE)
  log('world', setup)
  assert.deepEqual([setup.world, setup.storeys, setup.layers, setup.stairs], ['floors-lab', 2, 2, 1])
  await page.waitForTimeout(800)

  // 1. Up the flight with real keys (S + D walks +X with the default camera).
  await teleport(13.4, 0, 16.95, Math.PI / 2)
  await page.waitForTimeout(300)
  const foot = await player()
  log('at the foot', foot)
  assert.equal(foot.y, 0)
  await hold(['KeyS', 'KeyD'], 900)
  const mid = await player()
  log('after 0.9 s', mid)
  await hold(['KeyS', 'KeyD'], 1400)
  const top = await player()
  log('upstairs', top)
  assert.ok(mid.y > 0.3 || top.y === 3, `climbing: ${JSON.stringify(mid)}`)
  assert.equal(top.y, 3, JSON.stringify(top))
  assert.ok(top.x > 18.5, 'walked off the top onto the landing')
  assert.ok(Math.abs(top.bodyY - (3 + 0.9 + 0.02)) < 0.05, `body floats over the upper floor: ${top.bodyY}`)
  await page.screenshot({ path: `${tmp}/m11b-upstairs.png` })

  // 1b. Drawn at their storey: the bedroom door leaf and both lamp switches (small boxes 0.1 × 0.14).
  await teleport(16.8, 3, 14.2, Math.PI)
  await page.waitForTimeout(600)
  const drawn = await page.evaluate(() => {
    const out = { leaves: [], switches: [] }
    window.__scene.updateMatrixWorld(true)
    window.__scene.traverse((o) => {
      const g = o.geometry?.parameters
      if (!o.isMesh || !g) return
      const p = o.getWorldPosition(o.position.clone())
      const at = [Math.round(p.x * 10) / 10, Math.round(p.y * 100) / 100, Math.round(p.z * 10) / 10]
      if (g.depth === 0.12 && g.height >= 1.9) out.leaves.push(at)
      if (g.width === 0.1 && g.height === 0.14 && g.depth === 0.1) out.switches.push(at)
    })
    return out
  })
  log('door leaves / switches', drawn)
  // Front door (ground): centre 1.1 m up; bedroom door (upper floor): 4.1 m. Switches 1.3 / 4.3 m.
  assert.deepEqual(drawn.leaves.map((l) => l[1]).sort(), [1.1, 4.1])
  assert.deepEqual(drawn.switches.map((s) => s[1]).sort(), [1.3, 4.3])
  await page.screenshot({ path: `${tmp}/m11b-door-switch.png` })

  // 2. Upstairs, E reaches the wardrobe, not the cupboard right below it.
  await teleport(12.5, 3, 11.4, Math.PI)
  await page.waitForTimeout(400)
  const near = await page.evaluate(() => window.__runtime.currentInteractable?.id)
  log('facing the wardrobe', near)
  assert.equal(near, `${HOUSE}/wardrobe`)
  await page.keyboard.press('KeyE')
  await page.waitForTimeout(400)
  const opened = await page.evaluate(() => window.__runtime.openContainerId)
  log('opened', opened)
  assert.equal(opened, `${HOUSE}/wardrobe`)
  await page.screenshot({ path: `${tmp}/m11b-wardrobe.png` })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // 3. A zombie that heard the player walks in and climbs after them.
  await teleport(15, 3, 11.8, 0)
  const climbed = await page.evaluate(async () => {
    const rt = window.__runtime
    rt.pathBudget = { ...rt.pathBudget, maxPathMs: Infinity }
    const z = rt.spawnZombie({ x: 13, y: 0, z: 15.5 })
    z.ai = 'SEARCH'
    z.lastKnownTarget = { ...rt.player.position }
    z.memorySource = 'noise'
    let onStairs = false
    const t0 = performance.now()
    while (performance.now() - t0 < 20000) {
      await new Promise((r) => setTimeout(r, 100))
      if (z.position.y > 0.5 && z.position.y < 2.5) onStairs = true
      if (z.position.y === 3 && Math.hypot(z.position.x - rt.player.position.x, z.position.z - rt.player.position.z) < 3) break
    }
    return { id: z.id, onStairs, position: z.position, ai: z.ai, seconds: Math.round((performance.now() - t0) / 100) / 10 }
  })
  log('zombie followed', climbed)
  assert.ok(climbed.onStairs && climbed.position.y === 3, JSON.stringify(climbed))
  await page.screenshot({ path: `${tmp}/m11b-zombie-upstairs.png` })
  await page.evaluate((zid) => {
    window.__runtime.zombies.get(zid).health = 0
  }, climbed.id)

  // 4. Saved upstairs (pause → save and back to the menu), Continue loads back upstairs: the scene
  // remounts the body on the upper floor.
  await teleport(16, 3, 15.5, 0)
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Lưu và về menu', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 30000 })
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('h1') && document.querySelector('.hud') && window.__runtime?.playerBody, null, { timeout: 60000 })
  await page.waitForTimeout(1500)
  const loaded = await player()
  log('after load', loaded)
  assert.equal(loaded.y, 3)
  assert.ok(Math.abs(loaded.bodyY - 3.92) < 0.05, `remounted body upstairs: ${loaded.bodyY}`)

  // 5. Back down the flight (W + A walks −X).
  await page.evaluate(() => {
    const rt = window.__runtime
    rt.spawnTimer = 1e9
    for (const z of rt.zombies.values()) z.health = 0
  })
  await teleport(19.6, 3, 16.95, -Math.PI / 2)
  await hold(['KeyW', 'KeyA'], 2000)
  const down = await player()
  log('back down', down)
  assert.equal(down.y, 0)
  assert.ok(down.x < 14.5, 'left the flight at its foot')
  await page.screenshot({ path: `${tmp}/m11b-downstairs.png` })

  // 6. The lighting debug (F6) draws the stairwell edge (not a door) without errors.
  await page.keyboard.press('F6')
  await page.waitForTimeout(800)
  const labels = await page.evaluate(() => [...document.querySelectorAll('.lighting-debug-label')].map((e) => e.textContent))
  log('F6 labels', labels.length)
  assert.ok(labels.some((t) => t.startsWith('Cầu thang')), 'stairwell edge label')
  await page.screenshot({ path: `${tmp}/m11b-f6.png` })
  await page.keyboard.press('F6')

  assert.deepEqual(errors, [])
  console.log('M11b floors browser check: PASS')
} catch (e) {
  console.error(e)
  console.error('page errors', errors)
  process.exitCode = 1
} finally {
  await browser.close()
}
