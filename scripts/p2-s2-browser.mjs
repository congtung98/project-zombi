// P2-S2 browser check with Playwright (fresh, isolated browser context: never the player's profile).
//   Dev:        npm run dev -- --host 127.0.0.1 --port 5173 --strictPort   then  node scripts/p2-s2-browser.mjs
//   Production: npm run build && npm run preview -- --host 127.0.0.1 --port 5199 --strictPort
//               then  node scripts/p2-s2-browser.mjs --production
// Playwright is not a project dependency: set PLAYWRIGHT_MODULE to a file:// URL of playwright/index.mjs
// if it is not resolvable, and CHROMIUM_PATH to a Chromium executable if the bundled one is missing.
// Dev mode wrote the frozen S2 fixture (phase2-s2-v3.json) in P2-S2; since v4 it no longer rewrites it.
import { mkdirSync, readFileSync } from 'node:fs'
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
const log = (label, value) => console.log(label.padEnd(28), typeof value === 'string' ? value : JSON.stringify(value))

const hasText = (text, timeout = 10000) => page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout })
const hud = (sel) => page.locator(sel).first().innerText()
async function menu() {
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 20000 })
}
async function inGame() {
  await page.waitForFunction(() => !document.querySelector('h1') && !document.body.innerText.includes('Đang tải…') && document.querySelector('.hud'), null, { timeout: 30000 })
  await page.waitForTimeout(400)
}
/** Since P2-S3: New Game → character creation → Bắt đầu (→ overwrite confirmation if a save exists). */
async function newGame() {
  await page.getByRole('button', { name: 'New Game', exact: true }).click()
  await hasText('Tạo nhân vật')
  await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click()
  const confirm = page.getByRole('button', { name: 'Xóa bản lưu và bắt đầu' })
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
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
/** Esc closes open panels first, then pauses; press again only if the pause menu did not appear. */
async function pause() {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape')
    try {
      await hasText('Tạm dừng', 1000)
      return
    } catch { /* a panel was closed instead */ }
  }
  throw new Error('Pause menu did not open')
}
async function saveToMenu() {
  await pause()
  await page.getByRole('button', { name: 'Lưu và về menu' }).click()
  await menu()
}
async function continueGame() {
  const btn = page.getByRole('button', { name: 'Continue', exact: true })
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some((b) => b.textContent.trim() === 'Continue' && !b.disabled), null, { timeout: 15000 })
  await btn.click()
  await inGame()
}

/** Real input only: walk with D (+x −z on this camera) until the closet prompt shows, E, take, equip. */
async function lootStarterWeapon() {
  assert.match(await hud('.hud-weapon'), /Tay không/)
  const canvas = page.locator('canvas').first()
  const box = await canvas.boundingBox()
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.up()
  await hasText('Tay không: tìm vũ khí')
  await page.keyboard.down('KeyD')
  try {
    await page.waitForFunction(() => document.querySelector('.hud-prompt')?.textContent.includes('Tủ quần áo nhà an toàn'), null, { timeout: 4000 })
  } finally {
    await page.keyboard.up('KeyD')
  }
  await page.keyboard.press('KeyE')
  const containerSlot = page.locator('.inv-panel-container .slot-filled').first()
  await containerSlot.waitFor()
  const looted = (await containerSlot.getAttribute('title')).split('\n')
  await containerSlot.click()
  const bagSlot = page.locator('.inv-panel:not(.inv-panel-container) .slot-filled').first()
  await bagSlot.click()
  await hasText('Độ bền')
  await page.getByRole('button', { name: 'Trang bị', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.hud-weapon')?.textContent.includes('Tay không'), null, { timeout: 5000 })
  return looted
}

try {
  if (production) {
    await page.goto(`${base}/?lab=doors`)
    await menu()
    assert.equal(await page.evaluate(() => typeof window.__runtime), 'undefined')
    await newGame()
    assert.equal(await page.evaluate(() => document.body.innerText.includes('Phòng thử cửa')), false)
    const looted = await lootStarterWeapon()
    log('looted starter', looted.slice(0, 3))
    const held = await hud('.hud-weapon')
    log('HUD weapon', held)
    await shot('p2s2-prod-equipped')
    await saveToMenu()
    const saved = await readSlot('slot-1')
    assert.equal(saved.schemaVersion, 6)
    const weapons = saved.player.inventory.slots.filter((i) => i?.kind === 'weapon')
    assert.equal(weapons.length, 1)
    assert.equal(saved.player.equipment.weaponInstanceId, weapons[0].id)
    const closet = saved.containers.find((c) => c.id === 'ct-safehouse-closet')
    assert.equal(closet.opened, true)
    assert.equal(closet.items.slots.filter(Boolean).length, 0)
    await page.reload()
    await menu()
    await continueGame()
    assert.equal(await hud('.hud-weapon'), held)
    log('PASS production', 'unarmed New Game → closet → equip → save → reload → Continue; lab off; no __runtime')
  } else {
    await page.goto(`${base}/`)
    await menu()
    await page.evaluate(async () => {
      const { runtime } = await import('/src/game/core/runtime.ts')
      if (runtime !== window.__runtime) throw new Error('Restart Vite before this script to clear HMR module URLs.')
    })
    await newGame()
    const toast = await hud('.hud-toast')
    assert.match(toast, /tay không/i)
    const looted = await lootStarterWeapon()
    log('looted starter', looted.slice(0, 3))
    await shot('p2s2-inventory-detail')
    await page.keyboard.press('KeyI')
    await page.waitForFunction(() => !document.querySelector('.inv-overlay'))

    // Real mouse swing at a zombie parked on the cursor ray, frozen in place by a long stagger.
    const canvas = page.locator('canvas').first()
    const box = await canvas.boundingBox()
    const aim = { x: box.x + box.width / 2 + 90, y: box.y + box.height / 2 + 40 }
    await page.mouse.move(aim.x, aim.y)
    await page.waitForTimeout(150)
    const park = () => page.evaluate(() => {
      const rt = window.__runtime
      const p = rt.player.position
      const c = rt.cursorWorld
      const len = Math.hypot(c.x - p.x, c.z - p.z)
      const pos = { x: p.x + ((c.x - p.x) / len) * 1.2, y: 0.9, z: p.z + ((c.z - p.z) / len) * 1.2 }
      const z = rt.zombies.get('zombie-1')
      z.health = 50
      z.staggerTimer = 1e6
      z.position = { ...pos }
      rt.zombieBodies.get('zombie-1').setTranslation(pos, true)
      const w = rt.player.inventory.slots.find((i) => i?.id === rt.player.equipment.weaponInstanceId)
      return { condition: w.condition, itemId: w.itemId }
    })
    const hit = async () => {
      await page.waitForFunction(() => window.__runtime.player.attackCooldown <= 0 && window.__runtime.player.stamina > 30, null, { timeout: 10000 })
      const before = await park()
      await page.mouse.down()
      await page.mouse.up()
      await page.waitForTimeout(700)
      return page.evaluate((b) => {
        const rt = window.__runtime
        const w = rt.player.inventory.slots.find((i) => i?.id === rt.player.equipment.weaponInstanceId)
        return { ...b, damage: 50 - rt.zombies.get('zombie-1').health, after: w.condition }
      }, before)
    }
    const first = await hit()
    log('hit (full condition)', first)
    assert.equal(first.after, first.condition - 1)
    assert.ok(first.damage >= 25)
    await page.evaluate(() => {
      const rt = window.__runtime
      rt.player.inventory.slots.find((i) => i?.id === rt.player.equipment.weaponInstanceId).condition = 1
    })
    const last = await hit()
    log('hit (condition 1)', last)
    assert.deepEqual([last.damage, last.after], [first.damage, 0])
    await hasText('đã HỎNG')
    assert.match(await hud('.hud-weapon'), /HỎNG/)
    await shot('p2s2-broken-hud')
    const weak = await hit()
    log('hit (broken)', weak)
    assert.equal(weak.damage, Math.max(1, Math.round(first.damage * 0.2)))

    // Drop the broken weapon via the detail card, pick it back up with E, re-equip by right-click.
    await page.keyboard.press('KeyI')
    await page.locator('.inv-panel:not(.inv-panel-container) .slot-equipped').click()
    await page.getByRole('button', { name: 'Thả xuống' }).click()
    await page.waitForFunction(() => document.querySelector('.hud-weapon')?.textContent.includes('Tay không'))
    await page.keyboard.press('KeyI')
    await page.waitForTimeout(200)
    await page.waitForFunction(() => document.querySelector('.hud-prompt')?.textContent.includes('Túi đồ rơi'), null, { timeout: 4000 })
    await page.keyboard.press('KeyE')
    await page.locator('.inv-panel-container .slot-filled').first().click()
    await page.locator('.inv-panel:not(.inv-panel-container) .slot-filled').first().click({ button: 'right' })
    await page.waitForFunction(() => document.querySelector('.hud-weapon')?.textContent.includes('HỎNG'))
    await page.keyboard.press('Escape')

    // A spare pipe dropped on the floor stays in the world save with its own condition.
    const spare = await page.evaluate(async () => {
      const { addItem } = await import('/src/game/systems/inventory.ts')
      const rt = window.__runtime
      addItem(rt.player.inventory, 'metal_pipe', 1, { condition: 33 })
      const slot = rt.player.inventory.slots.findIndex((i) => i?.itemId === 'metal_pipe' && i.condition === 33)
      return { id: rt.player.inventory.slots[slot].id, dropped: rt.dropItem(slot) }
    })
    assert.equal(spare.dropped, true)
    await saveToMenu()
    const saved = await readSlot('slot-1')
    assert.equal(saved.schemaVersion, 6)
    const equipped = saved.player.inventory.slots.find((i) => i?.id === saved.player.equipment.weaponInstanceId)
    assert.equal(equipped.condition, 0)
    assert.equal(saved.containers.find((c) => c.id === `drop:${spare.id}`).items.slots[0].condition, 33)
    await page.reload()
    await menu()
    await continueGame()
    assert.match(await hud('.hud-weapon'), /0\/\d+\s+HỎNG/)
    const reloaded = await page.evaluate(() => {
      const rt = window.__runtime
      const w = rt.player.inventory.slots.find((i) => i?.id === rt.player.equipment.weaponInstanceId)
      return { id: w.id, condition: w.condition }
    })
    assert.deepEqual(reloaded, { id: equipped.id, condition: 0 })
    log('save/reload', { equipped: `${equipped.itemId}@${equipped.condition}`, dropBag: 'metal_pipe@33' })

    // Migration through the real Continue flow: S2 v3, S1 v2 and Phase 1 v1 fixtures, each backed up.
    for (const [file, version, note] of [['phase2-s2-v3.json', 3, 'giữ bản sao v3'], ['phase2-s1-v2.json', 2, 'giữ bản sao v2'], ['phase1-v1.json', 1, 'giữ bản sao v1']]) {
      const original = JSON.parse(readFileSync(`src/game/systems/fixtures/${file}`, 'utf8'))
      await pause()
      await page.getByRole('button', { name: 'Về menu (không lưu)' }).click()
      await menu()
      await page.evaluate(async ({ original, version }) => {
        const storage = await import('/src/game/systems/saveStorage.ts')
        await storage.deleteSave(storage.backupSlotFor('slot-1', version))
        await storage.writeSave(original)
      }, { original, version })
      await page.reload()
      await menu()
      const before = await readSlot('slot-1')
      assert.deepEqual(before, original) // menu preview never writes
      await continueGame()
      assert.match(await hud('.hud-toast'), new RegExp(note))
      const upgraded = await readSlot('slot-1')
      const backup = await readSlot(`slot-1.backup-v${version}`)
      assert.equal(upgraded.schemaVersion, 6)
      assert.deepEqual(backup, original)
      const ids = upgraded.containers.map((c) => c.id)
      for (const id of ['ct-safehouse-closet', 'ct-store-tools', 'ct-house-nightstand', 'ct-park-toolbox']) assert.ok(ids.includes(id), id)
      const weapons = upgraded.player.inventory.slots.filter((i) => i?.kind === 'weapon').map((i) => i.condition).sort((a, b) => a - b)
      log(`migration v${version} → v5`, { backup: `slot-1.backup-v${version}`, containers: ids.length, bagWeapons: weapons })
    }

    // Lab: weapon kit and the unchanged door/physics checks still work next to the S2 UI.
    await page.goto(`${base}/?lab=doors`)
    await menu()
    await newGame()
    await page.getByRole('button', { name: /Bộ vũ khí thử/ }).click()
    await hasText('Xà beng')
    const kit = await page.evaluate(() => window.__runtime.player.inventory.slots.filter(Boolean).map((i) => `${i.itemId}@${i.condition}`))
    log('lab weapon kit', kit)
    await shot('p2s2-lab-kit')
    assert.equal(errors.length, 0, JSON.stringify(errors))
    log('PASS dev', 'unarmed start, loot/equip by real input, wear, broken 20%, drop/pickup, save/reload, v1/v2 migration + backup')
  }
} finally {
  await browser.close()
}
if (errors.length) {
  console.error('Browser errors:', errors)
  process.exitCode = 1
}
