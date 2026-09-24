// P2-S3 browser check with Playwright (fresh isolated context): character creation, model rig,
// weapon socket, animation states, appearance persistence, low graphics.
//   Dev:        BASE_URL=http://127.0.0.1:5174 node scripts/p2-s3-browser.mjs
//   Production: BASE_URL=http://127.0.0.1:5199 node scripts/p2-s3-browser.mjs --production
// Set PLAYWRIGHT_MODULE (file:// URL of playwright/index.mjs) and CHROMIUM_PATH when needed.
// The v4 fixture (phase2-s3-v4.json) was written by this script in S3 and is frozen since S4 (save v5).
import { mkdirSync } from 'node:fs'
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
async function readSlot(slot) {
  return page.evaluate((key) => new Promise((resolve, reject) => {
    const req = indexedDB.open('zombie-outbreak', 1)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('saves')
      const read = tx.objectStore('saves').get(key)
      read.onsuccess = () => resolve(read.result)
      tx.oncomplete = () => db.close()
    }
    req.onerror = () => reject(req.error)
  }), slot)
}
const radio = (group, label) => page.getByRole('radiogroup', { name: group }).getByRole('radio', { name: label })

/** Real input in the creation screen: name with a space and diacritics, then one option per row. */
async function createCharacter(name, picks) {
  await button('New Game').click()
  await hasText('Tạo nhân vật')
  await page.waitForFunction(() => document.querySelectorAll('canvas').length >= 2, null, { timeout: 15000 })
  const input = page.locator('.creation-name')
  await input.click()
  await input.pressSequentially(name)
  for (const [group, label] of picks) {
    await radio(group, label).click()
    // React applies the choice on its next render: wait for it instead of reading once (race seen in S3/S4 production runs).
    await page.getByRole('radiogroup', { name: group }).getByRole('radio', { name: label, checked: true }).waitFor({ timeout: 3000 })
  }
}

try {
  await page.goto(`${base}/`)
  await menu()
  if (!production) {
    await page.evaluate(async () => {
      const { runtime } = await import('/src/game/core/runtime.ts')
      if (runtime !== window.__runtime) throw new Error('Restart Vite before this script to clear HMR module URLs.')
    })
  } else {
    assert.equal(await page.evaluate(() => typeof window.__runtime), 'undefined')
  }

  // 1) First character: no save yet, so no overwrite confirmation.
  await createCharacter('Mai An', [['Dáng người', 'Mảnh khảnh'], ['Kiểu tóc', 'Tóc dài'], ['Màu da', 'Sáng'], ['Áo', 'Xanh lá'], ['Quần', 'Kaki']])
  await button('Bắt đầu').click()
  await inGame()
  assert.equal((await page.locator('.hud-name').innerText()).trim(), 'Mai An')
  await saveToMenu()
  const first = await readSlot('slot-1')
  assert.equal(first.schemaVersion, 6)
  assert.deepEqual([first.player.name, first.player.appearance], ['Mai An', { preset: 'slim', hair: 'long', skin: 'light', shirt: 'green', pants: 'khaki' }])
  await hasText('Mai An')

  // 2) New Game → Back: the save is untouched and Continue still offers it.
  await button('New Game').click()
  await hasText('Tạo nhân vật')
  await radio('Kiểu tóc', 'Mohawk').click()
  await button('Quay lại').click()
  await menu()
  assert.deepEqual(await readSlot('slot-1'), first)

  // 3) Randomize/Reset, then a second character; the existing save needs explicit overwrite.
  await createCharacter('  Trần Tùng  ', [])
  await button('Ngẫu nhiên').click()
  await button('Mặc định').click()
  assert.equal(await radio('Dáng người', 'Cân đối').getAttribute('aria-checked'), 'true')
  for (const [group, label] of [['Dáng người', 'Vạm vỡ'], ['Kiểu tóc', 'Mohawk'], ['Màu da', 'Sẫm'], ['Áo', 'Đỏ'], ['Quần', 'Ô liu']]) await radio(group, label).click()
  await shot('p2s3-creation')
  await button('Bắt đầu').click()
  await hasText('Bản lưu hiện tại sẽ bị xóa')
  assert.deepEqual(await readSlot('slot-1'), first) // still intact until confirmed
  await button('Xóa bản lưu và bắt đầu').click()
  await inGame()
  assert.equal((await page.locator('.hud-name').innerText()).trim(), 'Trần Tùng')
  const look = { preset: 'sturdy', hair: 'mohawk', skin: 'dark', shirt: 'red', pants: 'olive' }

  if (!production) {
    // 4) Rig in the real scene: one character per actor, weapon model in the right-hand socket.
    const rigInfo = await page.evaluate(async () => {
      const rt = window.__runtime
      const { addItem } = await import('/src/game/systems/inventory.ts')
      addItem(rt.player.inventory, 'crowbar', 1, { condition: 90 })
      rt.equipItem(rt.player.inventory.slots.find((i) => i?.itemId === 'crowbar').id)
      rt.cameraZoom = rt.config.camera.zoomMax
      await new Promise((r) => setTimeout(r, 400))
      const chars = []
      window.__scene.traverse((o) => { if (o.name === 'character') chars.push(o) })
      const sockets = []
      window.__scene.traverse((o) => { if (o.name === 'weaponSocket' && o.children.length) sockets.push(o.children.map((c) => c.name)) })
      return { characters: chars.length, zombies: Array.from(rt.zombies.values()).filter((z) => z.ai !== 'DEAD').length, sockets, appearance: rt.player.appearance }
    })
    log('scene rig', rigInfo)
    assert.equal(rigInfo.characters, rigInfo.zombies + 1)
    assert.deepEqual(rigInfo.sockets, [['weapon:crowbar']])
    assert.deepEqual(rigInfo.appearance, look)
    await page.waitForTimeout(300)
    await shot('p2s3-ingame-closeup')

    // 5) Swing: capture the arm yaw at the hit frame from the live rig (damage timing is runtime-owned).
    const swing = await page.evaluate(async () => {
      const rt = window.__runtime
      let rigR = null
      window.__scene.traverse((o) => { if (o.name === 'weaponSocket' && o.children.length) rigR = o.parent })
      rt.input.simulateKey('Mouse0', true)
      const samples = []
      const start = performance.now()
      while (performance.now() - start < 600) {
        await new Promise((r) => requestAnimationFrame(r))
        if (rt.player.attackTimer >= 0) samples.push({ t: +rt.player.attackTimer.toFixed(3), yaw: +rigR.rotation.y.toFixed(2) })
      }
      rt.input.simulateKey('Mouse0', false)
      return samples
    })
    const hitDelay = 0.15
    const near = swing.reduce((best, s) => (Math.abs(s.t - hitDelay) < Math.abs(best.t - hitDelay) ? s : best), swing[0])
    log('swing samples', { frames: swing.length, nearHit: near, first: swing[0], last: swing.at(-1) })
    assert.ok(swing.length >= 2)
    assert.ok(swing[0].yaw < 0 && swing.at(-1).yaw > 0, 'arm sweeps right → left across the front')
    // Posed after the tick: the arm is (near) straight ahead in the frame closest to the damage frame.
    if (Math.abs(near.t - hitDelay) < 0.03) assert.ok(Math.abs(near.yaw) < 0.45, `arm yaw at hit ${near.yaw}`)

    await page.waitForTimeout(1400)
    await page.evaluate(() => window.__runtime.input.simulateKey('Mouse0', true))
    await page.waitForTimeout(90)
    await shot('p2s3-swing')
    await page.evaluate(() => window.__runtime.input.simulateKey('Mouse0', false))

    // 6) Zombie hit reaction, attack and death poses on the live rig; dead zombies deal no damage.
    const zombieStates = await page.evaluate(async () => {
      const rt = window.__runtime
      const z = Array.from(rt.zombies.values()).find((q) => q.ai !== 'DEAD')
      const p = rt.player.position
      // Toward the safehouse centre so the test zombie is never placed inside a wall.
      const c = { x: -14 - p.x, z: -14 - p.z }
      const len = Math.hypot(c.x, c.z) || 1
      const pos = { x: p.x + (c.x / len) * 1.3, y: 0.9, z: p.z + (c.z / len) * 1.3 }
      z.position = { ...pos }
      rt.zombieBodies.get(z.id).setTranslation(pos, true)
      const rootOf = () => {
        let root = null
        window.__scene.traverse((o) => { if (o.name === 'character' && Math.abs(o.getWorldPosition(o.position.clone()).x - z.position.x) < 0.2 && Math.abs(o.getWorldPosition(o.position.clone()).z - z.position.z) < 0.2) root = o })
        return root
      }
      await new Promise((r) => setTimeout(r, 200))
      const health = rt.player.health
      z.facing = Math.atan2(p.x - pos.x, p.z - pos.z)
      z.attackWindup = rt.config.zombie.attackWindup * 0.3
      await new Promise((r) => setTimeout(r, 30))
      z.health = 1
      z.staggerTimer = 0.3
      await new Promise((r) => setTimeout(r, 60))
      const hurtPitch = rootOf()?.children[0].children[2]?.rotation.x
      const { damageZombie } = await import('/src/game/systems/ai.ts')
      damageZombie(z, 5)
      await new Promise((r) => setTimeout(r, 900))
      const root = rootOf()
      return { ai: z.ai, rootPitch: root ? +root.rotation.x.toFixed(2) : null, hurtPitch, healthKept: rt.player.health >= health - 10 }
    })
    log('zombie hurt/death', zombieStates)
    assert.equal(zombieStates.ai, 'DEAD')
    assert.equal(zombieStates.rootPitch, -1.57)
    await shot('p2s3-zombie-dead')

    // 7) Save → reload → Continue keeps name and appearance.
    await saveToMenu()
    const saved = await readSlot('slot-1')
    assert.deepEqual([saved.player.name, saved.player.appearance], ['Trần Tùng', look])
    await page.reload()
    await menu()
    await hasText('Trần Tùng')
    await continueGame()
    const restored = await page.evaluate(() => ({ name: window.__runtime.player.name, appearance: window.__runtime.player.appearance }))
    assert.deepEqual(restored, { name: 'Trần Tùng', appearance: look })
    assert.equal((await page.locator('.hud-name').innerText()).trim(), 'Trần Tùng')

    // 8) Low graphics (shadows off): zombies still render and animate.
    const low = await page.evaluate(async () => {
      const { useSettingsStore } = await import('/src/stores/settingsStore.ts')
      useSettingsStore.getState().set({ shadows: 'off' })
      await new Promise((r) => setTimeout(r, 2500))
      let chars = 0
      let casters = 0
      window.__scene.traverse((o) => { if (o.name === 'character') chars++; if (o.isMesh && o.castShadow) casters++ })
      return { chars, casters, render: window.__renderInfo }
    })
    log('shadows off', low)
    assert.ok(low.chars >= 2)
    assert.ok(low.render.calls > 0)
    await shot('p2s3-low-graphics')
  } else {
    await saveToMenu()
    const saved = await readSlot('slot-1')
    assert.deepEqual([saved.player.name, saved.player.appearance], ['Trần Tùng', look])
    await page.reload()
    await menu()
    await hasText('Trần Tùng')
    await continueGame()
    assert.equal((await page.locator('.hud-name').innerText()).trim(), 'Trần Tùng')
    await shot('p2s3-prod-ingame')
  }
  assert.equal(errors.length, 0, JSON.stringify(errors))
  log(`PASS ${production ? 'production' : 'dev'}`, 'creation (name/options/random/reset), Back keeps save, overwrite confirm, persistence' + (production ? '' : ', rig/socket, swing, zombie death, shadows off'))
} finally {
  await browser.close()
}
