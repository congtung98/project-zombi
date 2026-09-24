// P2-S5 browser check with Playwright (fresh isolated context): wandering zombies, footstep noise,
// a zombie that saw the player bashing the closed safehouse door (real Rapier colliders), save
// mid-siege → reload → Continue → the door breaks and the zombie comes in; save schema v6.
//   Dev:        BASE_URL=http://127.0.0.1:5174 node scripts/p2-s5-browser.mjs
//   Production: BASE_URL=http://127.0.0.1:5199 node scripts/p2-s5-browser.mjs --production
// Set PLAYWRIGHT_MODULE (file:// URL of playwright/index.mjs) and CHROMIUM_PATH when needed.
// Dev mode writes src/game/systems/fixtures/phase2-s5-v6.json from the real mid-siege save.
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
const hasText = (text, timeout = 10000) => page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout })
const button = (name) => page.getByRole('button', { name, exact: true })

async function menu() {
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 20000 })
}
async function inGame() {
  await page.waitForFunction(() => !document.querySelector('h1') && !document.body.innerText.includes('Đang tải…') && document.querySelector('.hud'), null, { timeout: 30000 })
  await page.waitForTimeout(500)
}
async function pause() {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape')
    try { await hasText('Tạm dừng', 1000); return } catch { /* a panel closed instead */ }
  }
  throw new Error('Pause menu did not open')
}
async function saveToMenu() {
  await pause()
  await button('Lưu và về menu').click()
  await menu()
}
async function continueGame() {
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some((b) => b.textContent.trim() === 'Continue' && !b.disabled), null, { timeout: 15000 })
  await button('Continue').click()
  await inGame()
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
/** Hold keys for `ms`, reading the F3 footstep line while they are held. */
async function holdAndRead(keys, ms = 400) {
  for (const k of keys) await page.keyboard.down(k)
  await page.waitForTimeout(ms)
  const text = await debugText()
  for (const k of keys) await page.keyboard.up(k)
  return text.match(/Tiếng bước chân: ([^·]+)/)[1].trim()
}

try {
  await page.goto(`${base}/`)
  await menu()
  if (production) {
    assert.equal(await page.evaluate(() => typeof window.__runtime), 'undefined')
    await newGame()
    await page.keyboard.press('F3')
    await page.locator('.hud-debug').waitFor()
    // Zombies rest then wander around their zones; the F3 list shows state and zone.
    await page.waitForFunction(() => /WANDER/.test(document.querySelector('.hud-debug')?.textContent ?? ''), null, { timeout: 20000 })
    const list = await debugText()
    assert.match(list, /zombie-\d+: (IDLE|WANDER)[^\n]* (south|east|north|store|yard|west|park)/)
    await page.waitForTimeout(300)
    const silent = (await debugText()).match(/Tiếng bước chân: ([^·]+)/)[1].trim()
    const walking = await holdAndRead(['KeyW'])
    const running = await holdAndRead(['ShiftLeft', 'KeyW'])
    log('footsteps', { silent, walking, running })
    assert.deepEqual([silent, walking, running], ['im lặng', '5 m', '12 m'])
    await shot('p2s5-prod-wander')
    await page.keyboard.press('F3')
    await saveToMenu()
    const saved = await readSlot('slot-1')
    assert.equal(saved.schemaVersion, 6)
    assert.ok(saved.horde && Number.isFinite(saved.horde.timer))
    assert.ok(saved.zombies.every((z) => typeof z.zoneId === 'string' && 'memoryAge' in z && z.structureTargetId === null))
    const moved = saved.zombies.filter((z) => ![[-14, 13], [4, 14], [20, 0], [-2, -20], [16, -5], [22, 20], [-22, 0], [8, 22]].some(([x, zz]) => Math.hypot(z.position.x - x, z.position.z - zz) < 0.3))
    log('saved zombies', saved.zombies.map((z) => `${z.id}:${z.ai}@${z.zoneId}`))
    assert.ok(moved.length >= 3, `${moved.length} zombies left their spawn point`)
    await page.reload()
    await menu()
    await continueGame()
    await page.waitForTimeout(1500)
    assert.equal(errors.length, 0, JSON.stringify(errors))
    log('PASS production', 'wandering + zones in F3, footstep radius walk/run/silent, save v6 → reload → Continue; no __runtime')
  } else {
    await page.evaluate(async () => {
      const { runtime } = await import('/src/game/core/runtime.ts')
      if (runtime !== window.__runtime) throw new Error('Restart Vite before this script to clear HMR module URLs.')
    })
    const rt = (fn, arg) => page.evaluate(fn, arg)
    await newGame()

    // 1) Wandering: positions change, states cycle, destinations stay in the zone.
    const before = await rt(() => Array.from(window.__runtime.zombies.values(), (z) => ({ id: z.id, x: z.position.x, z: z.position.z })))
    await page.waitForTimeout(9000)
    const after = await rt(() => Array.from(window.__runtime.zombies.values(), (z) => ({ id: z.id, ai: z.ai, zone: z.zoneId, x: z.position.x, z: z.position.z })))
    const moved = after.filter((a) => { const b = before.find((x) => x.id === a.id); return b && Math.hypot(a.x - b.x, a.z - b.z) > 0.5 })
    log('wander', { moved: moved.length, states: after.map((z) => `${z.id}:${z.ai}@${z.zone}`) })
    assert.ok(moved.length >= 4, 'most zombies moved on their own')

    // 2) Footsteps (real keys): walking 5 m, running 12 m, standing still silent.
    await page.keyboard.press('F3')
    await page.locator('.hud-debug').waitFor()
    const walking = await holdAndRead(['KeyW'])
    const running = await holdAndRead(['ShiftLeft', 'KeyW'])
    await page.waitForTimeout(300)
    const silent = await rt(() => window.__runtime.playerNoise)
    log('footsteps', { walking, running, silent })
    assert.deepEqual([walking, running, silent], ['5 m', '12 m', 0])
    await page.keyboard.press('F3')

    // 3) Siege staging: one zombie outside the safehouse door, facing it; others removed, no respawn,
    //    no wandering/migration so the scene is reproducible. Everything after uses real input/physics.
    await rt(() => {
      const r = window.__runtime
      for (const z of r.zombies.values()) z.health = 0
      r.spawnTimer = 1e9
      r.hordeTimer = 1e9
      r.pickWanderPoint = () => null
      // Back to the spawn spot after the footstep test (the body is the source of truth).
      r.playerBody.setTranslation({ x: -13, y: 0.9, z: -13 }, true)
      const z = r.spawnZombie({ x: -13, y: 0, z: -3.5 })
      z.facing = Math.PI
      r.events.queue('zombie:spawned', { id: z.id })
      window.__siegeZombie = z.id
    })
    await page.waitForTimeout(600)
    const zombieState = () => rt(() => { const z = window.__runtime.zombies.get(window.__siegeZombie); return { ai: z.ai, x: +z.position.x.toFixed(2), z: +z.position.z.toFixed(2), door: z.structureTargetId, mem: z.memorySource } })
    const door = () => rt(() => ({ ...window.__runtime.world.doors.get('door-safehouse') }))
    // Walk to the door (S+A = straight towards +Z on screen axes), open it with E.
    await page.keyboard.down('KeyS'); await page.keyboard.down('KeyA')
    await page.waitForFunction(() => document.querySelector('.hud-prompt')?.textContent.includes('Mở Cửa nhà an toàn'), null, { timeout: 5000 })
    await page.keyboard.up('KeyS'); await page.keyboard.up('KeyA')
    await page.keyboard.press('KeyE')
    await page.waitForFunction(() => window.__runtime.zombies.get(window.__siegeZombie).ai === 'CHASE', null, { timeout: 6000 })
    log('seen through the doorway', await zombieState())
    await page.keyboard.press('KeyE') // close it in its face
    await page.waitForFunction(() => window.__runtime.world.doors.get('door-safehouse').state === 'closed', null, { timeout: 2000 })
    await page.waitForFunction(() => window.__runtime.zombies.get(window.__siegeZombie).ai === 'ATTACK_STRUCTURE', null, { timeout: 15000 })
    await page.waitForFunction(() => window.__runtime.world.doors.get('door-safehouse').hp <= 80, null, { timeout: 8000 })
    const mid = await door()
    const prompt = await page.locator('.hud-prompt').innerText().catch(() => '')
    log('siege', { zombie: await zombieState(), door: mid, prompt, health: await rt(() => window.__runtime.player.health) })
    assert.match(prompt, /độ bền \d+\/120/)
    assert.equal(await rt(() => window.__runtime.player.health), 100, 'no damage through the closed door')
    await shot('p2s5-siege')
    // Step back into the room (W+D = straight towards -Z), so the zombie has to come in.
    await page.keyboard.down('KeyW'); await page.keyboard.down('KeyD')
    await page.waitForTimeout(600)
    await page.keyboard.up('KeyW'); await page.keyboard.up('KeyD')
    await page.waitForTimeout(200)

    // 4) Save mid-siege → fixture → reload → Continue: HP and the siege resume.
    await saveToMenu()
    const saved = await readSlot('slot-1')
    const sz = saved.zombies.find((z) => z.ai !== 'DEAD' && z.structureTargetId)
    assert.equal(saved.schemaVersion, 6)
    assert.ok(sz && sz.ai === 'ATTACK_STRUCTURE' && sz.structureTargetId === 'door-safehouse' && sz.memorySource === 'sight')
    const savedDoor = saved.doors.find((d) => d.id === 'door-safehouse')
    assert.ok(savedDoor.state === 'closed' && savedDoor.hp < 120 && savedDoor.hp > 0)
    writeFileSync('src/game/systems/fixtures/phase2-s5-v6.json', JSON.stringify({ ...saved, savedAt: 1790467200000 }, null, 2) + '\n')
    await page.reload()
    await menu()
    await continueGame()
    const resumed = await door()
    log('continue', { door: resumed, zombie: await rt(() => { const z = Array.from(window.__runtime.zombies.values()).find((z) => z.structureTargetId); return z && { id: z.id, ai: z.ai } }) })
    assert.ok(resumed.hp <= savedDoor.hp)
    await rt(() => { window.__siegeZombie = Array.from(window.__runtime.zombies.values()).find((z) => z.structureTargetId).id })

    // 5) The door breaks: leaf/collider gone (raycast passes), nav open, zombie comes in and attacks.
    await page.waitForFunction(() => window.__runtime.world.doors.get('door-safehouse').state === 'destroyed', null, { timeout: 30000 })
    await hasText('đã bị zombie phá vỡ', 3000)
    const through = await rt(() => window.__runtime.physics.isBlocked({ x: -13, y: 1.5, z: -8.5 }, { x: -13, y: 1.5, z: -11.5 }, []))
    assert.equal(through, false, 'no invisible collider left in the frame')
    await shot('p2s5-broken')
    log('player inside at', await rt(() => ({ x: +window.__runtime.player.position.x.toFixed(2), z: +window.__runtime.player.position.z.toFixed(2) })))
    await page.waitForFunction(() => { const z = window.__runtime.zombies.get(window.__siegeZombie); return z.position.z < -10.6 && (z.ai === 'CHASE' || z.ai === 'ATTACK') }, null, { timeout: 12000 })
    await page.waitForFunction(() => window.__runtime.player.health < 100, null, { timeout: 10000 })
    log('breach', { zombie: await zombieState(), health: await rt(() => window.__runtime.player.health) })
    assert.equal(errors.length, 0, JSON.stringify(errors))
    log('PASS dev', 'wander, footsteps, seen → door closed (E) → bash → save/reload/Continue mid-siege → break → enter → attack; fixture v6 written')
  }
} catch (e) {
  await shot(production ? 'p2s5-prod-fail' : 'p2s5-fail').catch(() => undefined)
  console.error('errors', errors)
  throw e
} finally {
  await browser.close()
}
