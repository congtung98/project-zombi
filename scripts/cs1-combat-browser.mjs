// CS1 combat stance in the real game with real mouse input (dev server, GPU=1 recommended).
// - A plain left click does nothing; holding the right button raises the weapon (stance, crosshair).
// - A swing at the aim lands at the old hit time; a click behind the back turns first (no hit in
//   front, no 180° snap), then lands.
// - Moving the cursor to the other side mid-strike keeps the swing's direction.
// - Spamming the left button never stacks swings; releasing the right button mid-swing finishes it.
// - Window blur clears the stance and never swings afterwards.
//   BASE_URL=... PLAYWRIGHT_MODULE=... CHROMIUM_PATH=... GPU=1 node scripts/cs1-combat-browser.mjs [--docs]
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const docs = process.argv.includes('--docs')
const outDir = docs ? 'docs/combat/cs1' : 'node_modules/.tmp'
mkdirSync(outDir, { recursive: true })
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: process.env.GPU ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const log = (label, value) => console.log(label.padEnd(24), JSON.stringify(value))
const shot = (name) => page.screenshot({ path: `${outDir}/${name}.png` })
const wait = (ms) => page.waitForTimeout(ms)

try {
  await page.goto(`${base}/`)
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 60000 })
  await page.getByRole('button', { name: 'New Game', exact: true }).click()
  await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click()
  await page.waitForFunction(() => window.__runtime?.playerBody && document.querySelector('.hud'), null, { timeout: 60000 })
  await wait(1500)
  // Open ground outside, no other zombies, armed with a bat, daylight; record left presses and hits.
  await page.evaluate(async () => {
    const rt = window.__runtime
    rt.spawnTimer = 1e9
    for (const z of [...rt.zombies.values()]) rt.removeZombie(z.id)
    rt.events.flush()
    rt.clock.timeOfDay = 0.5
    rt.cameraZoom = 50
    const { addItem } = await import('/src/game/systems/inventory.ts')
    addItem(rt.player.inventory, 'baseball_bat', 1)
    rt.equipItem(rt.player.inventory.items.find((s) => s.itemId === 'baseball_bat').id)
    // Outside the safehouse door, on open ground.
    const door = rt.map.doors.find((d) => d.id.endsWith('safehouse/door'))
    const p = { x: door.center.x, y: 0, z: door.center.z + 4 }
    rt.player.position = { ...p }
    rt.playerBody.setTranslation({ x: p.x, y: rt.config.player.height / 2 + 0.02, z: p.z }, true)
    rt.player.facing = 0
    window.__cs1 = { press: [], hits: [], swings: [] }
    window.addEventListener('pointerdown', (e) => { if (e.button === 0) window.__cs1.press.push(performance.now()) }, true)
    window.addEventListener('pointermove', (e) => { if (e.button === 0 && (e.buttons & 1)) window.__cs1.press.push(performance.now()) }, true)
    rt.events.on('zombie:damaged', (e) => window.__cs1.hits.push({ id: e.id, t: performance.now() }))
    rt.events.on('player:attacked', (e) => window.__cs1.swings.push({ t: performance.now(), hitIds: e.hitIds }))
  })
  await wait(600)
  const box = await page.locator('canvas').first().boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const A = { x: cx + 160, y: cy + 40 }
  const B = { x: cx - 160, y: cy - 40 }
  /** Spawn a frozen zombie 1.3 m from the player toward the cursor point currently under the mouse. */
  const spawnAtCursor = () => page.evaluate(() => {
    const rt = window.__runtime
    const p = rt.player.position
    const c = rt.cursorWorld
    const len = Math.hypot(c.x - p.x, c.z - p.z)
    const z = rt.spawnZombie({ x: p.x + ((c.x - p.x) / len) * 1.3, y: 0, z: p.z + ((c.z - p.z) / len) * 1.3 })
    rt.events.queue('zombie:spawned', { id: z.id })
    rt.events.flush()
    z.staggerTimer = 1e9
    z.health = 1000
    ;(window.__cs1.parked ??= {})[z.id] = { ...z.position }
    return z.id
  })
  const reset = () => page.evaluate(() => {
    window.__cs1.press.length = 0
    window.__cs1.hits.length = 0
    window.__cs1.swings.length = 0
    const rt = window.__runtime
    rt.player.attackCooldown = 0
    rt.player.stamina = 100
    // Knockback moved them: back to where they were parked.
    for (const [id, pos] of Object.entries(window.__cs1.parked ?? {})) {
      const z = rt.zombies.get(id)
      z.position = { ...pos }
      z.velocity.x = 0
      z.velocity.z = 0
      z.knockback = { x: 0, z: 0 }
    }
  })
  const state = () => page.evaluate(() => ({ ...window.__cs1, facing: window.__runtime.player.facing, stance: window.__runtime.stance.requested, cursor: document.querySelector('canvas').style.cursor }))

  // 1) A plain left click: nothing.
  await page.mouse.move(A.x, A.y)
  await wait(200)
  const front = await spawnAtCursor()
  await page.mouse.move(B.x, B.y)
  await wait(200)
  const back = await spawnAtCursor()
  await page.mouse.move(A.x, A.y)
  await wait(200)
  await reset()
  await page.mouse.down()
  await page.mouse.up()
  await wait(400)
  let s = await state()
  assert.equal(s.swings.length, 0, 'no swing outside the stance')
  log('plain click', { swings: s.swings.length })

  // 2) Stance at A: crosshair, then a swing at A lands at the old hit time (~0.15 s).
  await page.mouse.down({ button: 'right' })
  await wait(500)
  s = await state()
  assert.equal(s.stance, true)
  assert.equal(s.cursor, 'crosshair')
  await shot('cs1-ready')
  await reset()
  await page.mouse.down()
  await page.mouse.up()
  await wait(500)
  s = await state()
  const frontHit = s.hits.find((h) => h.id === front)
  assert.ok(frontHit, 'front zombie hit')
  const frontMs = Math.round(frontHit.t - s.press[0])
  log('front swing', { ms: frontMs, hits: s.hits.map((h) => h.id) })
  assert.ok(!s.hits.some((h) => h.id === back), 'nothing behind hit')

  // 3) Cursor to B and click at once: the body turns first, no hit in front, then the back zombie.
  await wait(1000)
  await reset()
  await page.mouse.move(B.x, B.y)
  await page.mouse.down()
  await page.mouse.up()
  const turn = await page.evaluate(async () => {
    const out = []
    const start = performance.now()
    while (performance.now() - start < 600) {
      await new Promise((r) => requestAnimationFrame(r))
      out.push({ t: Math.round(performance.now() - start), f: +window.__runtime.player.facing.toFixed(3), phase: window.__runtime.player.attackTimer < 0 ? '-' : window.__runtime.player.attackCommitted ? 'S' : 'W' })
    }
    return out
  })
  s = await state()
  const backHit = s.hits.find((h) => h.id === back)
  assert.ok(backHit, 'back zombie hit after turning')
  assert.ok(!s.hits.some((h) => h.id === front), 'the front zombie is not hit by the swing behind')
  const backMs = Math.round(backHit.t - s.press[0])
  // Largest change of the facing between two frames (a snap would be ≈ π at once).
  let maxJump = 0
  for (let i = 1; i < turn.length; i++) {
    let d = Math.abs(turn[i].f - turn[i - 1].f)
    if (d > Math.PI) d = 2 * Math.PI - d
    maxJump = Math.max(maxJump, d)
  }
  const turning = turn.filter((x) => x.phase === 'W')
  const turnMs = turning.length ? turning.at(-1).t - turning[0].t : 0
  log('back swing', { ms: backMs, maxFrameJumpRad: +maxJump.toFixed(3), windupMs: turnMs, samples: turn.filter((_, i) => i % 4 === 0).slice(0, 8) })
  assert.ok(backMs > frontMs + 100, 'turning first makes a swing behind land later')
  assert.ok(maxJump < 0.6, 'no snap: the body turns over several frames')
  assert.ok(turnMs > 150, 'the wind-up lasts while the body turns')

  // 4) Cursor flipped to the other side right after the commit: the swing keeps its direction.
  await wait(1000)
  await reset()
  await page.mouse.move(A.x, A.y)
  await wait(600)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForFunction(() => window.__runtime.player.attackCommitted, null, { timeout: 2000 })
  await page.mouse.move(B.x, B.y)
  await page.keyboard.press('F3')
  await wait(150)
  await shot('cs1-flip-debug')
  await page.keyboard.press('F3')
  await wait(350)
  s = await state()
  log('flip mid-strike', { hits: s.hits.map((h) => h.id) })
  assert.deepEqual(s.hits.map((h) => h.id), [front])

  // 5) Spam: 10 clicks in 1.2 s → at most 2 swings (1 s cooldown), each hit once.
  await wait(1200)
  await page.mouse.move(A.x, A.y)
  await wait(600)
  await reset()
  for (let i = 0; i < 10; i++) {
    await page.mouse.down()
    await page.mouse.up()
    await wait(120)
  }
  await wait(400)
  s = await state()
  log('spam', { swings: s.swings.length, hits: s.hits.length })
  assert.ok(s.swings.length <= 2 && s.swings.length >= 1)
  assert.equal(s.hits.length, s.swings.length)

  // 6) Release the right button mid-swing: the swing lands and finishes; the stance ends.
  await wait(1100)
  await reset()
  await page.mouse.down()
  await page.mouse.up()
  await page.mouse.up({ button: 'right' })
  await wait(500)
  s = await state()
  log('release mid-swing', { hits: s.hits.length, stance: s.stance, cursor: s.cursor })
  assert.equal(s.hits.length, 1)
  assert.equal(s.stance, false)
  assert.equal(s.cursor, '')

  // 7) Blur with the right button held: stance cleared, game paused; resuming never swings.
  await page.mouse.move(A.x, A.y)
  await page.mouse.down({ button: 'right' })
  await wait(300)
  await reset()
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await wait(200)
  const paused = await page.evaluate(() => ({ stance: window.__runtime.stance.requested, pause: !!document.querySelector('.overlay-dim') }))
  await page.mouse.up({ button: 'right' })
  await page.keyboard.press('Escape')
  await wait(800)
  s = await state()
  log('blur', { paused, swings: s.swings.length, stance: s.stance })
  assert.equal(paused.stance, false)
  assert.equal(paused.pause, true, 'blur pauses the game')
  assert.equal(s.swings.length, 0)
  assert.equal(s.stance, false)

  // 8) E: the object under the cursor is highlighted; E from the stance leaves it and opens the panel.
  const closet = await page.evaluate(() => {
    const rt = window.__runtime
    const item = rt.interactables.find((i) => i.id === 'c-1_-1/safehouse/closet')
    const b = rt.map.buildings.find((x) => x.id === 'c-1_-1/safehouse')
    const dx = b.center.x - item.position.x
    const dz = b.center.z - item.position.z
    const len = Math.hypot(dx, dz)
    const d = item.radius + 0.3
    const p = { x: item.position.x + (dx / len) * d, y: 0, z: item.position.z + (dz / len) * d }
    for (const z of [...rt.zombies.values()]) rt.removeZombie(z.id)
    rt.events.flush()
    window.__cs1.parked = {}
    rt.player.position = { ...p }
    rt.playerBody.setTranslation({ x: p.x, y: rt.config.player.height / 2 + 0.02, z: p.z }, true)
    rt.player.facing = Math.atan2(-dx, -dz)
    return item.id
  })
  await wait(1500) // the camera catches up
  /** Screen point of a world position (the live orthographic camera). */
  const toScreen = (pos) => page.evaluate(async ([pos, rect]) => {
    const THREE = await import('/node_modules/.vite/deps/three.js')
    const cam = window.__scene.getObjectByProperty('isOrthographicCamera', true)
    const v = new THREE.Vector3(pos.x, pos.y, pos.z).project(cam)
    return { x: rect.x + ((v.x + 1) / 2) * rect.width, y: rect.y + ((1 - v.y) / 2) * rect.height }
  }, [pos, box])
  const closetPos = await page.evaluate((id) => window.__runtime.interactables.find((i) => i.id === id).position, closet)
  const onCloset = await toScreen(closetPos)
  await page.mouse.move(onCloset.x, onCloset.y)
  await wait(300)
  const target = await page.evaluate(() => ({ id: window.__runtime.currentInteractable?.id, prompt: document.querySelector('.hud-prompt')?.textContent }))
  log('E target', target)
  assert.equal(target.id, closet)
  assert.match(target.prompt, /Tủ quần áo/)
  await shot('cs1-e-highlight')
  await page.mouse.down({ button: 'right' })
  await wait(300)
  assert.equal((await state()).stance, true)
  await page.keyboard.press('KeyE')
  await page.locator('[data-inv-window="loot"]').waitFor({ timeout: 3000 })
  s = await state()
  assert.equal(s.stance, false, 'E leaves the stance')
  // A click on the panel never reaches the world; the held right button does not bring the stance back.
  await reset()
  await page.locator('[data-inv-window="loot"] .inv-context').click()
  await wait(300)
  s = await state()
  assert.equal(s.swings.length, 0)
  assert.equal(s.stance, false)
  // Esc closes the window on top first (the loot window: no pause); the stance needs a new right press.
  await page.keyboard.press('Escape')
  await wait(300)
  const afterEsc = await page.evaluate(() => ({ panel: !!document.querySelector('[data-inv-window="loot"]'), paused: !!document.querySelector('.overlay-dim'), stance: window.__runtime.stance.requested }))
  log('E → panel → Esc', afterEsc)
  assert.deepEqual(afterEsc, { panel: false, paused: false, stance: false })
  // INV-LOOT S5: the inventory window still open does not block it; it collapses while aiming.
  assert.equal(await page.locator('[data-inv-window="inventory"]').count(), 1)
  await page.mouse.up({ button: 'right' })
  await page.mouse.down({ button: 'right' })
  await wait(250)
  assert.equal((await state()).stance, true)
  assert.equal(await page.locator('[data-inv-window="inventory"].inv-window-collapsed').count(), 1)

  // 9) E in the middle of a swing: ignored, never queued.
  await reset()
  await page.mouse.down()
  await page.mouse.up()
  await page.keyboard.press('KeyE')
  await wait(700)
  const midSwing = await page.evaluate(() => ({ panel: !!document.querySelector('[data-inv-window="loot"]'), swings: window.__cs1.swings.length }))
  log('E mid-swing', midSwing)
  assert.deepEqual(midSwing, { panel: false, swings: 1 })
  await page.mouse.up({ button: 'right' })
  await wait(200)

  // 10) Released outside the canvas (captured) and pointercancel: never a stuck stance.
  await page.mouse.down({ button: 'right' })
  await wait(200)
  const actions = await page.locator('.hud-stats').boundingBox()
  await page.mouse.move(actions.x + 20, actions.y + 20)
  await page.mouse.up({ button: 'right' })
  await wait(200)
  const outside = (await state()).stance
  await page.mouse.move(onCloset.x, onCloset.y)
  await page.mouse.down({ button: 'right' })
  await wait(200)
  await page.evaluate(() => document.querySelector('canvas').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })))
  await wait(200)
  const cancelled = (await state()).stance
  await page.mouse.up({ button: 'right' })
  log('release outside / cancel', { outside, cancelled })
  assert.equal(outside, false)
  assert.equal(cancelled, false)

  // 11) Toggle mode from the settings: one right click on, one off; the left click swings in it.
  const setMode = async (label) => {
    // INV-LOOT: Escape closes an open inventory window before it pauses; none is open here.
    await page.evaluate(() => window.__runtime.closeAllUi())
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Cài đặt', exact: true }).click()
    await page.locator('[data-combat-stance]').selectOption(label)
    await page.getByRole('button', { name: 'Quay lại', exact: true }).click()
    await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click()
    await wait(300)
  }
  await setMode('toggle')
  await page.mouse.move(onCloset.x + 150, onCloset.y)
  await reset()
  await page.mouse.down({ button: 'right' })
  await page.mouse.up({ button: 'right' })
  await wait(300)
  const on = await state()
  await page.mouse.down()
  await page.mouse.up()
  await wait(500)
  const swung = (await state()).swings.length
  await page.mouse.down({ button: 'right' })
  await page.mouse.up({ button: 'right' })
  await wait(300)
  const off = await state()
  log('toggle', { on: on.stance, swung, off: off.stance })
  assert.equal(on.stance, true)
  assert.equal(swung, 1)
  assert.equal(off.stance, false)
  const hint = await page.locator('.hud-hint').innerText()
  assert.match(hint, /Bấm chuột phải/)
  await setMode('hold')

  assert.deepEqual(errors, [])
  console.log(`PASS cs1 combat   plain click no swing, stance crosshair, front ${frontMs} ms, behind ${backMs} ms without snap, flip keeps the swing, spam bounded, release finishes, blur clears, E target/highlight/stance exit/panel/Esc, E mid-swing ignored, release outside + pointercancel, toggle mode`)
} finally {
  await browser.close()
}
