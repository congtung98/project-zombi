// M11c-1B (interior visibility) browser check with Playwright (fresh isolated context, dev server:
// it reads the game through window.__runtime and window.__cutaway).
//   BASE_URL=http://127.0.0.1:5174 node scripts/m11c1b-interior-browser.mjs
// Set PLAYWRIGHT_MODULE (file:// URL of playwright/index.mjs) and CHROMIUM_PATH when needed.
// On `cutaway-lab` (house A: living room x 7..13 with the south window at x 8.8..10.2, store room
// x 13..17 behind a solid wall), measured on screen (floor patches, 5 × 5 px):
// - outside, 4 m from the window, looking in: house A is cut (peek), the floor seen through the
//   window is lit, the living room floor off the window's wedge and the closed store room are near
//   black (mandatory: part of the room seen, the room next to it not revealed); a zombie in the
//   store room is not drawn;
// - curtain closed: the peek ends (roof back) after its hold;
// - after exploring the store room, it shows remembered (dim) from the window, and still after
//   save → menu → Continue;
// - the mask never touches the outdoors or the lights (mask on/off: same grass, same lights, same
//   room light); F4 tints the mask.
// Screenshots in node_modules/.tmp/m11c1b-*.png.
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
const A = 'c0_0/house-a'

const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

const teleport = (x, y, z, facing) => page.evaluate(([x, y, z, facing]) => {
  const rt = window.__runtime
  rt.player.position = { x, y, z }
  rt.player.facing = facing
  rt.playerBody.setTranslation({ x, y: y + rt.config.player.height / 2 + 0.02, z }, true)
  rt.playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
}, [x, y, z, facing])
const shot = (name) => page.screenshot({ path: `${tmp}/m11c1b-${name}.png` })
const view = () => page.evaluate(() => window.__cutaway.debugState())
const noon = () => page.evaluate(() => window.__runtime.clock.restore(window.__runtime.clock.elapsed, 0.5, window.__runtime.clock.day))
/** Mean luminance of a 5 × 5 px patch around each world point (projected with the scene camera). */
const patches = async (points) => {
  // The follow camera lags the player (a lot at a few frames per second): let it settle first, or
  // the points are projected with a camera that has moved by the time of the screenshot.
  await page.waitForFunction(() => {
    let cam = null
    window.__scene.traverse((o) => { if (o.isCamera && !cam) cam = o })
    const p = window.__runtime.player.position
    const o = window.__runtime.config.camera.offset
    return Math.abs(cam.position.x - p.x - o.x) < 0.01 && Math.abs(cam.position.z - p.z - o.z) < 0.01 && Math.abs(cam.position.y - p.y - o.y) < 0.01
  }, null, { timeout: 20000 })
  const coords = await page.evaluate((points) => {
    let cam = null
    window.__scene.traverse((o) => { if (o.isCamera && !cam) cam = o })
    cam.updateMatrixWorld()
    const v = cam.position.clone()
    return points.map(([x, y, z]) => {
      v.set(x, y, z).project(cam)
      return [Math.round((v.x + 1) / 2 * window.innerWidth), Math.round((1 - v.y) / 2 * window.innerHeight)]
    })
  }, points)
  const png = await page.screenshot()
  return page.evaluate(async ({ b64, coords }) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
    const c = new OffscreenCanvas(img.width, img.height)
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const scale = img.width / window.innerWidth
    return coords.map(([px, py]) => {
      const { data } = g.getImageData(Math.round(px * scale) - 2, Math.round(py * scale) - 2, 5, 5)
      let sum = 0
      for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      return +(sum / (data.length / 4)).toFixed(1)
    })
  }, { b64: png.toString('base64'), coords })
}
// Floor points: through the window's wedge, living room off the wedge, the store room, and grass.
const SEEN = [9.5, 0.03, 12.5]
const OFF_WEDGE = [12.2, 0.03, 12.5]
const STORE = [15, 0.03, 12.5]
const GRASS = [4, 0.03, 18]
const measure = async () => {
  const [seen, offWedge, store, grass] = await patches([SEEN, OFF_WEDGE, STORE, GRASS])
  return { seen, offWedge, store, grass }
}
const startGame = async () => {
  await page.waitForFunction(() => !document.querySelector('h1') && document.querySelector('.hud') && window.__runtime?.playerBody && window.__cutaway, null, { timeout: 60000 })
  await page.evaluate((a) => {
    const rt = window.__runtime
    rt.spawnTimer = 1e9
    rt.hordeTimer = 1e9
    rt.pickWanderPoint = () => null
    for (const z of rt.zombies.values()) z.health = 0
    rt.setDoorState(`${a}/door`, 'open')
    rt.setDoorState(`${a}/door-store`, 'closed')
  }, A)
  await noon()
}

try {
  await page.goto(`${base}/?world=cutaway-lab`).catch(() => page.goto(`${base}/?world=cutaway-lab`))
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 60000 })
  await page.getByRole('button', { name: 'New Game', exact: true }).click()
  await page.waitForFunction(() => document.body.innerText.includes('Tạo nhân vật'))
  await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click()
  await startGame()

  // A zombie in the closed store room, standing still (not seen, not hearing).
  const zombie = await page.evaluate(() => {
    const rt = window.__runtime
    const z = rt.spawnZombie({ x: 15.2, y: 0, z: 10.5 })
    rt.events.queue('zombie:spawned', { id: z.id })
    return z.id
  })

  // 1. Outside, 4 m from the south window, looking in.
  await teleport(9.5, 0, 20, Math.PI)
  await page.waitForTimeout(1200)
  const peek = await view()
  const first = await measure()
  const zombieDrawn = await page.evaluate((id) => ({ opacity: window.__runtime.vision.opacity(id), reason: window.__runtime.vision.get(id)?.reason ?? null }), zombie)
  log('through the window', { peek: peek.peeks, building: peek.building, ...first, zombie: zombieDrawn })
  await shot('window')
  // (Another house seen from the start may still be within its hold time.)
  assert.ok(peek.building === null && peek.peeks.includes(A), 'house A cut while looked into from outside')
  // Mandatory: part of the room is seen, the rest of it and the closed room next to it are not.
  assert.ok(first.seen > 4 * Math.max(first.offWedge, first.store, 8), `seen part lit, the rest dark: ${JSON.stringify(first)}`)
  assert.ok(first.store < 20 && first.offWedge < 20, `unseen interior near black: ${JSON.stringify(first)}`)
  assert.ok(first.grass > 40, 'the outdoors is not darkened')
  assert.equal(zombieDrawn.opacity, 0, 'the zombie in the closed room is not drawn')
  await page.evaluate((id) => { window.__runtime.zombies.get(id).health = 0 }, zombie)

  // 2. Curtain closed: nothing seen inside, the peek ends after its hold (the roof comes back).
  await page.evaluate((a) => window.__runtime.setCurtain(`${a}/win-s`, true), A)
  await page.waitForTimeout(1600)
  const curtained = await view()
  log('curtain closed', { peeks: curtained.peeks })
  await shot('curtain')
  assert.deepEqual(curtained.peeks, [])
  await page.evaluate((a) => window.__runtime.setCurtain(`${a}/win-s`, false), A)

  // 3. Explore the store room (through its own door), then look through the window again: remembered.
  await teleport(15, 0, 12.5, -Math.PI / 2)
  await page.waitForTimeout(900)
  await teleport(15, 0, 12.5, Math.PI / 2)
  await page.waitForTimeout(900)
  const explored = await page.evaluate((a) => window.__runtime.interior.exploredShare(`${a}/store`), A)
  await teleport(9.5, 0, 20, Math.PI)
  await page.waitForTimeout(1200)
  const again = await measure()
  log('store explored', { share: +explored.toFixed(2), ...again })
  await shot('remembered')
  assert.ok(explored > 0.5, 'the store room was explored')
  assert.ok(again.store > first.store * 2 + 4 && again.store < again.seen * 0.8, `remembered: dimmer than seen, brighter than never seen: ${JSON.stringify({ first, again })}`)

  // 4. Save → menu → Continue: the memory comes back.
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Lưu và về menu', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 30000 })
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await startGame()
  await teleport(9.5, 0, 20, Math.PI)
  await page.waitForTimeout(1500)
  const loaded = { share: await page.evaluate((a) => window.__runtime.interior.exploredShare(`${a}/store`), A), ...(await measure()) }
  log('after Continue', loaded)
  assert.ok(Math.abs(loaded.share - explored) < 1e-9, 'explored cells restored')
  assert.ok(loaded.store > first.store * 2 + 4, 'still remembered after loading')

  // 5. The mask is not lighting: switched off, the grass and the lights are the same; the hidden
  //    floor lights up to its plain room light.
  const lights = () => page.evaluate((a) => {
    const out = []
    window.__scene.traverse((o) => { if (o.isLight) out.push(+o.intensity.toFixed(3)) })
    return { lights: out, room: +window.__runtime.lighting.getRoomLight(`${a}/store`).finalLightLevel.toFixed(3) }
  }, A)
  const on = { ...(await measure()), ...(await lights()) }
  await page.evaluate(() => { window.__runtime.config.interiorVisibility.enabled = false })
  await noon()
  await page.waitForTimeout(600)
  const off = { ...(await measure()), ...(await lights()) }
  await page.evaluate(() => { window.__runtime.config.interiorVisibility.enabled = true })
  log('mask on / off', { on, off })
  assert.ok(Math.abs(on.grass - off.grass) < 3, 'outdoors unchanged')
  assert.deepEqual([on.lights, on.room], [off.lights, off.room], 'lights and room light unchanged')
  assert.ok(off.store > on.store * 1.5, 'the mask darkened the store room')

  // 6. F4: the mask tinted (debug).
  await noon()
  await page.waitForTimeout(600)
  await page.keyboard.press('F4')
  await page.waitForTimeout(800)
  await shot('f4-mask')
  await page.keyboard.press('F4')

  assert.deepEqual(errors, [])
  console.log('M11c-1B interior browser check: PASS')
} catch (e) {
  console.error(e)
  console.error('page errors', errors)
  process.exitCode = 1
} finally {
  await browser.close()
}
