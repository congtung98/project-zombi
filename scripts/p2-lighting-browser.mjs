// Building lighting browser check with Playwright (fresh isolated context). Measures real screen
// brightness of indoor floor patches (projected with the scene camera) in the house: living room
// (windows) vs bedroom (back room), bedroom door closed/open, night lamp off/on, player turning 4
// ways (room brightness must not follow the facing), outdoor ground unaffected by indoor changes;
// real E presses on a wall switch and a curtain; save v7 → reload → Continue keeps lamp/curtain.
//   Dev:        BASE_URL=http://127.0.0.1:5174 node scripts/p2-lighting-browser.mjs
//   Production: BASE_URL=http://127.0.0.1:5199 node scripts/p2-lighting-browser.mjs --production
// Set PLAYWRIGHT_MODULE (file:// URL of playwright/index.mjs) and CHROMIUM_PATH when needed.
// Dev mode writes src/game/systems/fixtures/phase2-light-v7.json (lamp on, curtain drawn).
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const production = process.argv.includes('--production')
const base = process.env.BASE_URL ?? (production ? 'http://127.0.0.1:5199' : 'http://127.0.0.1:5173')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
mkdirSync('node_modules/.tmp', { recursive: true })
const shot = (name) => page.screenshot({ path: `node_modules/.tmp/${name}.png` })
const log = (label, value) => console.log(label.padEnd(30), typeof value === 'string' ? value : JSON.stringify(value))
const button = (name) => page.getByRole('button', { name, exact: true })
const hasText = (text, timeout = 10000) => page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout })

async function menu() {
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 20000 })
}
async function inGame() {
  await page.waitForFunction(() => !document.querySelector('h1') && !document.body.innerText.includes('Đang tải…') && document.querySelector('.hud'), null, { timeout: 30000 })
  await page.waitForTimeout(500)
}
async function newGame() {
  await button('New Game').click()
  await hasText('Tạo nhân vật')
  await button('Bắt đầu').click()
  try {
    await button('Xóa bản lưu và bắt đầu').click({ timeout: 1500 })
  } catch { /* no save yet */ }
  await inGame()
}
async function pause() {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape')
    try { await hasText('Tạm dừng', 1000); return } catch { /* a panel closed instead */ }
  }
  throw new Error('Pause menu did not open')
}
async function readSlot(key) {
  return page.evaluate((key) => new Promise((resolve, reject) => {
    const req = indexedDB.open('zombie-outbreak', 1)
    req.onsuccess = () => {
      const db = req.result
      const r = db.transaction('saves', 'readonly').objectStore('saves').get(key)
      r.onsuccess = () => { resolve(r.result); db.close() }
    }
    req.onerror = () => reject(req.error)
  }), key)
}
const debugText = () => page.locator('.hud-debug').innerText()

try {
  await page.goto(`${base}/`)
  await menu()
  if (production) {
    assert.equal(await page.evaluate(() => typeof window.__runtime), 'undefined')
    await newGame()
    await page.keyboard.press('F3')
    await page.locator('.hud-debug').waitFor()
    await page.waitForFunction(() => /Ánh sáng: ngoài trời [\d.]+ · tại chỗ: Nhà an toàn [\d.]+ · điện có/.test(document.querySelector('.hud-debug')?.textContent ?? ''), null, { timeout: 5000 })
    const line = (await debugText()).match(/Ánh sáng:[^\n]*/)[0]
    // Walk to the lamp switch left of the safehouse door with real keys (S+A = +Z, W+A = −X).
    const pos = async () => {
      const m = (await debugText()).match(/Player: \((-?[\d.]+), (-?[\d.]+)\)/)
      return { x: Number(m[1]), z: Number(m[2]) }
    }
    await page.keyboard.down('KeyS'); await page.keyboard.down('KeyA')
    for (let i = 0; i < 60 && (await pos()).z < -11.1; i++) await page.waitForTimeout(50)
    await page.keyboard.up('KeyS'); await page.keyboard.up('KeyA')
    await page.keyboard.down('KeyW'); await page.keyboard.down('KeyA')
    for (let i = 0; i < 60 && (await pos()).x > -14.1; i++) await page.waitForTimeout(50)
    await page.keyboard.up('KeyW'); await page.keyboard.up('KeyA')
    await page.keyboard.down('KeyS'); await page.keyboard.down('KeyA')
    await page.waitForTimeout(120)
    await page.keyboard.up('KeyS'); await page.keyboard.up('KeyA')
    await page.waitForFunction(() => document.querySelector('.hud-prompt')?.textContent.includes('Bật Đèn nhà an toàn'), null, { timeout: 5000 })
    await page.keyboard.press('KeyE')
    await page.waitForFunction(() => document.querySelector('.hud-prompt')?.textContent.includes('Tắt Đèn nhà an toàn'), null, { timeout: 3000 })
    await page.keyboard.press('F6')
    await page.waitForFunction(() => document.querySelectorAll('.lighting-debug-label').length >= 4, null, { timeout: 5000 })
    const labels = await page.locator('.lighting-debug-label').count()
    await shot('lighting-prod-debug')
    await page.keyboard.press('F6')
    await page.keyboard.press('F3')
    await pause()
    await button('Lưu và về menu').click()
    await menu()
    const saved = await readSlot('slot-1')
    assert.equal(saved.schemaVersion, 7)
    assert.equal(saved.lighting.lamps.find((l) => l.id === 'lamp-safehouse').on, true)
    await page.waitForTimeout(500)
    assert.equal(errors.length, 0, JSON.stringify(errors))
    log('PASS production', { line, labels, savedLamp: true })
  } else {
    await page.evaluate(async () => {
      const { runtime } = await import('/src/game/core/runtime.ts')
      if (runtime !== window.__runtime) throw new Error('Restart Vite before this script to clear HMR module URLs.')
    })
    const rt = (fn, arg) => page.evaluate(fn, arg)
    await newGame()
    // Isolate lighting: no zombies nearby, no respawn/migration, no perception overlay.
    await rt(async () => {
      const r = window.__runtime
      r.spawnTimer = 1e9
      r.hordeTimer = 1e9
      r.pickWanderPoint = () => null
      let i = 0
      // R2: the simulation owns zombie positions (bodies only mirror them).
      for (const z of r.zombies.values()) {
        z.position = { x: -22 + (i % 3), y: 0.9, z: 20 + Math.floor(i++ / 3) }
        z.health = 0
      }
      const { useSettingsStore } = await import('/src/stores/settingsStore.ts')
      useSettingsStore.getState().set({ visionOverlay: false })
    })

    // Mean luminance of a 7×7 px patch around each world point (projected with the scene camera).
    const patches = async (points) => {
      const coords = await rt((points) => {
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
          const { data } = g.getImageData(Math.round(px * scale) - 3, Math.round(py * scale) - 3, 7, 7)
          let sum = 0
          for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
          return +(sum / (data.length / 4)).toFixed(1)
        })
      }, { b64: png.toString('base64'), coords })
    }
    const LIVING = [10.4, 0.03, 11]
    // Floor visible over the walls facing the camera (≥ 2.5 m from the E/S walls): near the partition.
    const BEDROOM = [14.62, 0.03, 12.2]
    const OUTSIDE = [5, 0.03, 5]
    const place = async (x, z, facing, timeOfDay) => {
      await rt(({ x, z, facing, timeOfDay }) => {
        const r = window.__runtime
        r.playerBody.setTranslation({ x, y: 0.9, z }, true)
        r.player.facing = facing
        if (timeOfDay !== undefined) r.clock.restore(r.clock.elapsed, timeOfDay, r.clock.day)
      }, { x, z, facing, timeOfDay })
      await page.waitForTimeout(1500)
    }
    const light = (id) => rt((id) => { const l = window.__runtime.lighting.getRoomLight(id); return { d: +l.directOutdoorLight.toFixed(2), p: +l.propagatedLight.toFixed(2), a: +l.artificialLight.toFixed(2), f: +l.finalLightLevel.toFixed(2) } }, id)
    const measure = async (label) => {
      await page.waitForTimeout(450) // uniform easing
      const [living, bedroom, outside] = await patches([LIVING, BEDROOM, OUTSIDE])
      const row = { living, bedroom, outside, livingLight: await light('room-house-living'), bedroomLight: await light('room-house-bedroom') }
      log(label, row)
      return row
    }

    // 1) Noon inside the house: window room vs back room, door open/closed.
    await place(11.2, 9.6, 0, 0.5)
    const noon = await measure('noon, door open')
    await shot('lighting-noon')
    assert.ok(noon.livingLight.f > 0.5 && noon.living > noon.bedroom + 5, 'living (windows) brighter than bedroom')
    await rt(() => window.__runtime.setDoorState('door-house-bedroom', 'closed'))
    const shut = await measure('noon, bedroom door closed')
    assert.ok(shut.bedroom < noon.bedroom - 5 && shut.bedroomLight.f < noon.bedroomLight.f * 0.3, 'closing the door darkens the bedroom')
    assert.ok(Math.abs(shut.outside - noon.outside) < 1.5 && Math.abs(shut.living - noon.living) < 1.5, 'living and outdoors unchanged')
    await rt(() => window.__runtime.setDoorState('door-house-bedroom', 'open'))
    await page.waitForTimeout(300) // the reopened door is solved on the next tick

    // 2) Turning 4 ways: room brightness and lighting revision never change.
    const revision = await rt(() => window.__runtime.lighting.revision)
    const turns = []
    for (const facing of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      await rt((f) => { window.__runtime.player.facing = f }, facing)
      await page.waitForTimeout(450)
      turns.push(await patches([LIVING, BEDROOM, OUTSIDE]))
    }
    const spread = [0, 1, 2].map((k) => +(Math.max(...turns.map((t) => t[k])) - Math.min(...turns.map((t) => t[k]))).toFixed(1))
    log('turning 4 ways (spread)', { living: spread[0], bedroom: spread[1], outside: spread[2], revisionSame: revision === await rt(() => window.__runtime.lighting.revision) })
    assert.ok(spread.every((d) => d < 1.5), 'brightness does not follow the facing')
    assert.equal(await rt(() => window.__runtime.lighting.revision), revision)

    // 3) Night: bedroom lamp off → dark, on → clearly lit; outdoors stays at night level.
    await place(11.2, 9.6, 0, 0.0)
    const nightOff = await measure('midnight, lamps off')
    await rt(() => window.__runtime.setLamp('lamp-house-bedroom', true))
    const nightOn = await measure('midnight, bedroom lamp on')
    await shot('lighting-night-lamp')
    assert.ok(nightOn.bedroom > nightOff.bedroom + 15, 'lamp lights the room')
    assert.ok(Math.abs(nightOn.outside - nightOff.outside) < 1.5, 'lamp does not light the outdoors')
    await rt(() => window.__runtime.setElectricity(false))
    const noPower = await measure('midnight, lamp on, no power')
    assert.ok(noPower.bedroomLight.a === 0 && noPower.bedroom < nightOn.bedroom - 15, 'no power, no lamp')
    await rt(() => window.__runtime.setElectricity(true))
    await rt(() => window.__runtime.setLamp('lamp-house-bedroom', false))

    // 4) Real E presses: living room switch (inside by the front door), safehouse north curtain.
    await place(12.05, 9.4, Math.PI, 0.5)
    await page.waitForFunction(() => document.querySelector('.hud-prompt')?.textContent.includes('Bật Đèn phòng khách'), null, { timeout: 5000 })
    await page.keyboard.press('KeyE')
    await page.waitForFunction(() => window.__runtime.world.lamps.get('lamp-house-living') === true, null, { timeout: 2000 })
    await place(-12, -16.9, Math.PI, 0.5)
    const before = await light('room-safehouse')
    await page.waitForFunction(() => document.querySelector('.hud-prompt')?.textContent.includes('Kéo rèm Cửa sổ phía bắc nhà an toàn'), null, { timeout: 5000 })
    await page.keyboard.press('KeyE')
    await page.waitForFunction(() => window.__runtime.world.curtains.get('win-safehouse-n') === true, null, { timeout: 2000 })
    await page.waitForTimeout(300)
    const after = await light('room-safehouse')
    log('curtain drawn (E)', { before, after })
    assert.ok(after.d < before.d && after.d > 0)
    await shot('lighting-curtain')

    // 5) F6 debug labels, then save → reload → Continue keeps lamp + curtain (fixture v7).
    await page.keyboard.press('F6')
    await page.waitForFunction(() => document.querySelectorAll('.lighting-debug-label').length >= 4, null, { timeout: 5000 })
    await place(13, 12, 0, 0.5)
    await shot('lighting-debug')
    await page.keyboard.press('F6')
    await pause()
    await button('Lưu và về menu').click()
    await menu()
    const saved = await readSlot('slot-1')
    assert.equal(saved.schemaVersion, 7)
    assert.equal(saved.lighting.lamps.find((l) => l.id === 'lamp-house-living').on, true)
    assert.equal(saved.lighting.curtains.find((c) => c.id === 'win-safehouse-n').closed, true)
    assert.equal(saved.doors.find((d) => d.id === 'door-house-bedroom').state, 'open')
    writeFileSync('src/game/systems/fixtures/phase2-light-v7.json', JSON.stringify({ ...saved, savedAt: 1790553600000 }, null, 2) + '\n')
    await page.reload()
    await menu()
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some((b) => b.textContent.trim() === 'Continue' && !b.disabled), null, { timeout: 15000 })
    await button('Continue').click()
    await inGame()
    const restored = await rt(() => ({ lamp: window.__runtime.world.lamps.get('lamp-house-living'), curtain: window.__runtime.world.curtains.get('win-safehouse-n'), living: window.__runtime.lighting.getRoomLight('room-house-living').artificialLight }))
    log('after Continue', restored)
    assert.deepEqual(restored, { lamp: true, curtain: true, living: 0.8 })
    assert.equal(errors.length, 0, JSON.stringify(errors))
    log('PASS dev', 'window vs back room, door closed/open, 4-way turn, night lamp/power, E switch + curtain, save v7/Continue, fixture written')
  }
} catch (e) {
  await shot(production ? 'lighting-prod-fail' : 'lighting-dev-fail').catch(() => undefined)
  console.error('FAIL', e.message, errors)
  process.exitCode = 1
} finally {
  await browser.close()
}
