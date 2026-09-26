// P2-S4 browser check with Playwright (fresh isolated context): material loot, timed repair and
// craft with real input, interruptions, reservation, pause/save mid-action, v4 → v5 migration.
//   Dev:        BASE_URL=http://127.0.0.1:5174 node scripts/p2-s4-browser.mjs
//   Production: BASE_URL=http://127.0.0.1:5199 node scripts/p2-s4-browser.mjs --production
// Set PLAYWRIGHT_MODULE (file:// URL of playwright/index.mjs) and CHROMIUM_PATH when needed.
// The S4 fixture phase2-s4-v5.json is frozen since P2-S5 (v6); this script no longer rewrites it.
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
const log = (label, value) => console.log(label.padEnd(30), typeof value === 'string' ? value : JSON.stringify(value))
const hasText = (text, timeout = 10000) => page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout })
const button = (name) => page.getByRole('button', { name, exact: true })
const toast = () => page.locator('.hud-toast').innerText().catch(() => '')
const bagSlots = () => page.locator('.inv-panel:not(.inv-panel-container):not(.inv-panel-craft) .slot-filled')

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
async function idb(op, key, value) {
  return page.evaluate(({ op, key, value }) => new Promise((resolve, reject) => {
    const req = indexedDB.open('zombie-outbreak', 1)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('saves', op === 'get' ? 'readonly' : 'readwrite')
      const store = tx.objectStore('saves')
      const r = op === 'get' ? store.get(key) : store.put(value, key)
      r.onsuccess = () => resolve(op === 'get' ? r.result : true)
      tx.oncomplete = () => db.close()
    }
    req.onerror = () => reject(req.error)
  }), { op, key, value })
}
const readSlot = (slot) => idb('get', slot)
const count = (inv, itemId) => inv.slots.reduce((n, s) => n + (s?.itemId === itemId ? s.quantity : 0), 0)

/** Hold movement keys until the E prompt names `target` (real keyboard input). */
async function walkTo(keys, target, timeout = 5000) {
  for (const k of keys) await page.keyboard.down(k)
  try {
    await page.waitForFunction((t) => document.querySelector('.hud-prompt')?.textContent.includes(t), target, { timeout })
  } finally {
    for (const k of keys) await page.keyboard.up(k)
  }
  await page.waitForTimeout(150)
}

async function openBag() {
  if (!(await page.locator('.inv-overlay').count())) await page.keyboard.press('KeyI')
  await page.locator('.inv-overlay').waitFor()
}
async function closeBag() {
  if (await page.locator('.inv-overlay').count()) await page.keyboard.press('KeyI')
  await page.waitForFunction(() => !document.querySelector('.inv-overlay'))
}
async function bagTitles() {
  return Promise.all((await bagSlots().all()).map((s) => s.getAttribute('title')))
}
/** Select a bag slot by (part of) its tooltip text and return the detail card text. */
async function selectBagItem(text) {
  // Transfers reach the UI after the next tick flushes `inventory:changed`; wait for the slot.
  await page.waitForFunction((t) => Array.from(document.querySelectorAll('.inv-panel:not(.inv-panel-container):not(.inv-panel-craft) .slot-filled')).some((s) => s.title.includes(t)), text, { timeout: 5000 })
  const slots = await bagSlots().all()
  for (const s of slots) {
    if (!(await s.getAttribute('title')).includes(text)) continue
    if (!(await page.locator('.item-detail').count()) || !(await page.locator('.item-detail h4').innerText()).includes(text)) await s.click()
    await page.locator('.item-detail').waitFor()
    return page.locator('.item-detail').innerText()
  }
  throw new Error(`No bag item ${text}`)
}

/** Loot the starter kit and the closet weapon with real keys/clicks; returns the weapon name. */
async function lootKitAndWeapon() {
  await walkTo(['KeyW', 'KeyA'], 'Hộp đồ nghề nhà an toàn')
  await page.keyboard.press('KeyE')
  await page.locator('.inv-panel-container').waitFor()
  await button('Lấy tất cả').click()
  await page.waitForFunction(() => document.querySelector('.inv-panel-container .inv-empty'))
  const titles = await bagTitles()
  for (const name of ['Ván gỗ', 'Băng keo', 'Kim loại vụn']) assert.ok(titles.some((t) => t.includes(name)), `${name} looted`)
  await closeBag()
  await walkTo(['KeyD'], 'Tủ quần áo nhà an toàn')
  await page.keyboard.press('KeyE')
  const slot = page.locator('.inv-panel-container .slot-filled').first()
  await slot.waitFor()
  const weapon = (await slot.getAttribute('title')).split('\n')[0]
  await slot.click()
  await selectBagItem(weapon)
  await button('Trang bị').click()
  await page.waitForFunction(() => !document.querySelector('.hud-weapon')?.textContent.includes('Tay không'), null, { timeout: 5000 })
  if (await page.locator('.inv-panel-container').count()) await page.keyboard.press('KeyE')
  return weapon
}

async function waitWorkDone(timeout = 12000) {
  await page.waitForFunction(() => !document.querySelector('.hud-work'), null, { timeout })
}

try {
  await page.goto(`${base}/`)
  await menu()
  if (production) {
    assert.equal(await page.evaluate(() => typeof window.__runtime), 'undefined')
    await newGame()
    const weapon = await lootKitAndWeapon()
    log('looted', { weapon, bag: (await bagTitles()).map((t) => t.split('\n')[0]) })
    const detail = await selectBagItem(weapon)
    const craft = await page.locator('.inv-panel-craft').innerText()
    assert.match(craft, /Gậy gỗ tự chế/)
    assert.match(craft, /Ván gỗ 1\/2/)
    assert.equal(await button('Chế tạo (4 s)').isDisabled(), true)
    let branch
    if (detail.includes('Độ bền đã đầy')) {
      branch = 'full weapon: Sửa disabled'
      assert.ok(await page.getByRole('button', { name: /^Sửa \(/ }).isDisabled())
    } else {
      // Pause mid-repair (progress stops), save, reload: materials were not spent, no action is restored.
      await page.getByRole('button', { name: /^Sửa \(/ }).click()
      await page.locator('.hud-work').waitFor()
      await page.waitForTimeout(800)
      await saveToMenu()
      const mid = await readSlot('slot-1')
      assert.equal(mid.schemaVersion, 9)
      assert.equal(count(mid.player.inventory, 'duct_tape'), 1)
      assert.doesNotMatch(JSON.stringify(mid), /action|reserv/i)
      await page.reload()
      await menu()
      await continueGame()
      assert.equal(await page.locator('.hud-work').count(), 0)
      // Now repair for real and let it finish.
      await openBag()
      const before = await selectBagItem(weapon)
      await page.getByRole('button', { name: /^Sửa \(/ }).click()
      await page.locator('.hud-work').waitFor()
      await shot('p2s4-prod-repair')
      await waitWorkDone()
      await hasText('Đã sửa')
      const after = await selectBagItem(weapon)
      branch = `repaired: ${before.match(/Độ bền \d+\/\d+/)?.[0]} → ${after.match(/Độ bền \d+\/\d+/)?.[0]}`
      await saveToMenu()
      const saved = await readSlot('slot-1')
      assert.equal(count(saved.player.inventory, 'duct_tape'), 0)
      await page.reload()
      await menu()
      await continueGame()
    }
    log('production repair', branch)
    assert.equal(errors.length, 0, JSON.stringify(errors))
    log('PASS production', 'loot kit + closet (real input), craft panel requirements, repair/pause/save/reload/Continue; no __runtime')
  } else {
    await page.evaluate(async () => {
      const { runtime } = await import('/src/game/core/runtime.ts')
      if (runtime !== window.__runtime) throw new Error('Restart Vite before this script to clear HMR module URLs.')
    })
    const rt = (fn, arg) => page.evaluate(fn, arg)
    const give = (items) => rt(async (items) => {
      const { addItem } = await import('/src/game/systems/inventory.ts')
      for (const [id, n] of items) addItem(window.__runtime.player.inventory, id, n)
      window.__runtime.setInventoryOpen(true)
      window.__runtime.setInventoryOpen(false)
    }, items)
    const bag = () => rt(() => JSON.parse(JSON.stringify(window.__runtime.player.inventory)))
    const held = () => rt(() => { const r = window.__runtime; return JSON.parse(JSON.stringify(r.player.inventory.slots.find((i) => i?.id === r.player.equipment.weaponInstanceId))) })

    await newGame()
    // 1) Real input: starter kit (materials) and the closet weapon.
    const weaponName = await lootKitAndWeapon()
    const start = await bag()
    log('looted', { weaponName, bag: start.slots.filter(Boolean).map((s) => `${s.itemId}x${s.quantity}`) })
    assert.deepEqual(['wood_plank', 'duct_tape', 'scrap_metal'].map((id) => count(start, id)), [1, 1, 1])

    // Materials have no direct use (right click): hint, nothing spent.
    await openBag()
    const wood = bagSlots().filter({ hasText: 'Ván gỗ' })
    await wood.click({ button: 'right' })
    await page.waitForFunction(() => document.querySelector('.hud-toast')?.textContent.includes('không dùng trực tiếp'), null, { timeout: 3000 })
    assert.equal(count(await bag(), 'wood_plank'), 1)
    await closeBag()

    // 2) Break the weapon (dev hook), hit a parked zombie: 20% damage.
    // With INTERACT_RANGE 1 the closet prompt stops the player in the NE corner; step back into the
    // room (real A key) so the zombie parked towards the cursor is not behind the east wall.
    await page.keyboard.down('KeyA')
    await page.waitForTimeout(600)
    await page.keyboard.up('KeyA')
    const canvas = page.locator('canvas').first()
    const box = await canvas.boundingBox()
    const park = () => rt(() => {
      const r = window.__runtime
      const p = r.player.position
      const c = r.cursorWorld
      const len = Math.hypot(c.x - p.x, c.z - p.z)
      const pos = { x: p.x + ((c.x - p.x) / len) * 1.2, y: 0.9, z: p.z + ((c.z - p.z) / len) * 1.2 }
      const z = r.zombies.get('zombie-1')
      z.health = 50
      z.staggerTimer = 1e6
      z.position = { ...pos } // R2: the simulation owns the position; the body follows next tick
    })
    const hit = async () => {
      await page.waitForFunction(() => window.__runtime.player.attackCooldown <= 0 && window.__runtime.player.stamina > 30, null, { timeout: 10000 })
      // The pointer must be over the canvas (not a closed panel) for the cursor ray.
      await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 40)
      await page.waitForTimeout(150)
      await park()
      await page.mouse.down()
      await page.mouse.up()
      await page.waitForTimeout(700)
      return rt(() => 50 - window.__runtime.zombies.get('zombie-1').health)
    }
    await rt(() => { const r = window.__runtime; r.player.inventory.slots.find((i) => i?.id === r.player.equipment.weaponInstanceId).condition = 0 })
    const weak = await hit()
    const w0 = await held()
    log('broken hit', { weapon: w0.itemId, damage: weak })
    assert.ok(weak > 0 && weak <= 7)

    // 3) Repair through the detail card: preview, progress bar, work pose, completion once.
    await openBag()
    const detail = await selectBagItem(weaponName)
    const group = w0.itemId === 'baseball_bat' ? { gain: 30, max: 80, time: 4 } : { gain: 25, max: 120, time: 5 }
    assert.match(detail, new RegExp(`Sửa: độ bền 0 → ${group.gain}/${group.max}`))
    const t0 = await rt(() => window.__runtime.clock.elapsed)
    await button(`Sửa (${group.time} s)`).click()
    await page.locator('.hud-work').waitFor()
    assert.match(await page.locator('.hud-work').innerText(), new RegExp(`Sửa ${weaponName}`))
    await page.waitForTimeout(600)
    const pose = await rt(() => {
      let arm = null
      window.__scene.traverse((o) => { if (o.name === 'weaponSocket' && o.children.length) arm = o.parent })
      return { armPitch: +arm.rotation.x.toFixed(2), elapsed: +window.__runtime.action.elapsed.toFixed(2) }
    })
    log('work pose', pose)
    assert.ok(pose.armPitch < -0.6, 'right arm forward while working')
    await shot('p2s4-repair-progress')
    await waitWorkDone()
    await hasText('Đã sửa')
    const t1 = await rt(() => window.__runtime.clock.elapsed)
    const w1 = await held()
    const afterRepair = await bag()
    log('repaired', { condition: w1.condition, gameSeconds: +(t1 - t0).toFixed(2), bag: afterRepair.slots.filter(Boolean).map((s) => `${s.itemId}x${s.quantity}`) })
    assert.equal(w1.id, w0.id)
    assert.equal(w1.condition, group.gain)
    assert.ok(t1 - t0 >= group.time - 0.05)
    assert.equal(count(afterRepair, 'duct_tape'), 0)
    await closeBag()
    const strong = await hit()
    log('hit after repair', strong)
    assert.ok(strong >= 25)

    // 4) Interruptions: moving (real W), X key, a zombie blow; nothing is spent.
    await give([['wood_plank', 4], ['scrap_metal', 2], ['duct_tape', 3]])
    const interrupt = async (how) => {
      await openBag()
      await selectBagItem(weaponName)
      const before = await bag()
      await page.getByRole('button', { name: /^Sửa \(/ }).click()
      await page.locator('.hud-work').waitFor()
      await page.waitForTimeout(700)
      await how()
      await page.waitForFunction(() => !document.querySelector('.hud-work'), null, { timeout: 3000 })
      const text = await toast()
      const after = await bag()
      assert.deepEqual(after, before, 'cancel spends nothing')
      return text
    }
    const moved = await interrupt(async () => { await page.keyboard.down('KeyS'); await page.waitForTimeout(120); await page.keyboard.up('KeyS') })
    const keyX = await interrupt(() => page.keyboard.press('KeyX'))
    const blow = await interrupt(() => rt(() => {
      const r = window.__runtime
      const z = r.zombies.get('zombie-1')
      z.staggerTimer = 0
      z.ai = 'ATTACK'
      z.attackCooldown = 0
      z.attackWindup = 0.01
    }))
    log('cancel toasts', { moved, keyX, blow })
    assert.match(moved, /di chuyển/)
    assert.match(keyX, /bấm hủy/)
    assert.match(blow, /bị trúng đòn/)
    await rt(() => { const z = window.__runtime.zombies.get('zombie-1'); z.health = 0; z.ai = 'DEAD' })

    // 5) Reserved items cannot be dropped while working.
    await openBag()
    await selectBagItem(weaponName)
    await page.getByRole('button', { name: /^Sửa \(/ }).click()
    await page.locator('.hud-work').waitFor()
    await selectBagItem('Băng keo')
    const tapeBefore = count(await bag(), 'duct_tape')
    await button('Thả xuống').click()
    await page.waitForFunction(() => document.querySelector('.hud-toast')?.textContent.includes('đang dùng cho'), null, { timeout: 3000 })
    assert.equal(count(await bag(), 'duct_tape'), tapeBefore)

    // 6) Pause stops progress; a save mid-action keeps the materials and restores no action.
    await page.waitForTimeout(500)
    await pause()
    const e1 = await rt(() => window.__runtime.action.elapsed)
    await page.waitForTimeout(1500)
    const e2 = await rt(() => window.__runtime.action.elapsed)
    log('paused progress', { e1: +e1.toFixed(3), e2: +e2.toFixed(3) })
    assert.equal(e1, e2)
    const preSave = await bag()
    await button('Lưu và về menu').click()
    await menu()
    const mid = await readSlot('slot-1')
    assert.equal(mid.schemaVersion, 9)
    assert.deepEqual(mid.player.inventory, preSave)
    assert.doesNotMatch(JSON.stringify(mid), /action|reserv/i)
    await page.reload()
    await menu()
    await continueGame()
    assert.equal(await rt(() => window.__runtime.action), null)
    assert.equal(await page.locator('.hud-work').count(), 0)
    assert.deepEqual(await bag(), preSave)

    // 7) Craft a club from the crafting panel, equip it: model in the hand socket.
    await openBag()
    const panel = page.locator('.inv-panel-craft')
    assert.match(await panel.innerText(), /Ván gỗ \d+\/2/)
    await panel.getByRole('button', { name: 'Chế tạo (4 s)' }).click()
    await page.locator('.hud-work').waitFor()
    await shot('p2s4-craft-progress')
    await waitWorkDone()
    await hasText('Đã chế tạo Gậy gỗ tự chế')
    const clubs = (await bag()).slots.filter((i) => i?.itemId === 'wooden_club')
    assert.equal(clubs.length, 1)
    assert.equal(clubs[0].condition, 40)
    await selectBagItem('Gậy gỗ tự chế')
    await button('Trang bị').click()
    await page.waitForTimeout(400)
    const sockets = await rt(() => { const s = []; window.__scene.traverse((o) => { if (o.name === 'weaponSocket' && o.children.length) s.push(o.children.map((c) => c.name)) }); return s })
    log('socket', sockets)
    assert.deepEqual(sockets, [['weapon:wooden_club']])
    await shot('p2s4-inventory-craft')
    await closeBag()

    // 8) Save → fixture → reload → Continue keeps the club, the repaired weapon and materials.
    await saveToMenu()
    const saved = await readSlot('slot-1')
    assert.equal(saved.schemaVersion, 9)
    assert.equal(saved.containers.find((c) => c.id === 'c-1_-1/safehouse/toolbox').opened, true)
    await page.reload()
    await menu()
    await continueGame()
    assert.deepEqual(await bag(), saved.player.inventory)
    assert.equal((await held()).itemId, 'wooden_club')

    // 9) A real S3 (v4) save migrates on Continue: backup-v4 kept, three material containers seeded once.
    const v4 = JSON.parse(readFileSync('src/game/systems/fixtures/phase2-s3-v4.json', 'utf8'))
    await pause()
    await button('Về menu (không lưu)').click()
    await menu()
    await idb('put', 'slot-1', v4)
    await page.reload()
    await menu()
    await continueGame()
    await hasText('3 chỗ vật liệu')
    const migrated = await readSlot('slot-1')
    const backup = await readSlot('slot-1.backup-v4')
    assert.equal(migrated.schemaVersion, 9)
    assert.deepEqual(backup, v4)
    const ids = migrated.containers.filter((c) => !c.position).map((c) => c.id)
    for (const id of ['c-1_-1/safehouse/toolbox', 'c0_-1/store/hardware', 'c0_0/objects/house-scrap']) assert.ok(ids.includes(id))
    log('migration v4 → v6', { containers: ids.length, backup: 'slot-1.backup-v4' })
    await shot('p2s4-migrated')
    assert.equal(errors.length, 0, JSON.stringify(errors))
    log('PASS dev', 'loot kit/closet, broken→repair→full damage, cancel (move/X/hit), reservation, pause/save mid-action, craft+equip club, v4 → v6 migration')
  }
} finally {
  await browser.close()
}
