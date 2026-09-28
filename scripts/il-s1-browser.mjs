// SUPERSEDED since INV-LOOT S2/S3: the UI steps drive the S1-era slot grid (replaced by the two-window UI) and
// expect save v10 (now v11). Kept as the S1 record; the same checks now live in scripts/il-s2-browser.mjs,
// scripts/il-s3-browser.mjs and the migration tests on the frozen fixtures (inventoryV10.test.ts, floor.test.ts).
// INV-LOOT S1 browser check (Playwright, fresh context, dev server): the old slot UI still works on
// the v10 list inventories (take by click, equip by right click, capacity and weight header), a
// save is v10 and round-trips through Continue, and a real v9 save (written by the pre-v10 code,
// src/game/systems/fixtures/inv-loot-v9.json) migrates on Continue with its backup kept, every item,
// condition and the equipped weapon preserved and the backpack patch reported.
//   BASE_URL=http://127.0.0.1:5199 PLAYWRIGHT_MODULE=file:///…/playwright/index.mjs CHROMIUM_PATH=… node scripts/il-s1-browser.mjs
import { mkdirSync, readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5199'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
mkdirSync('docs/inventory-loot/s1', { recursive: true })
const shot = (name) => page.screenshot({ path: `docs/inventory-loot/s1/${name}.png` })
const log = (label, value) => console.log(label.padEnd(34), typeof value === 'string' ? value : JSON.stringify(value))
const hasText = (text, timeout = 15000) => page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout })
const button = (name) => page.getByRole('button', { name, exact: true })
const bagSlots = () => page.locator('.inv-panel:not(.inv-panel-container):not(.inv-panel-craft) .slot-filled')
const boxSlots = () => page.locator('.inv-panel-container .slot-filled')

async function menu() {
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 30000 })
}
async function inGame() {
  await page.waitForFunction(() => !document.querySelector('h1') && !document.body.innerText.includes('Đang tải…') && document.querySelector('.hud'), null, { timeout: 60000 })
  await page.waitForTimeout(500)
}
async function pause() {
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Escape')
    try { await hasText('Tạm dừng', 1000); return } catch { /* a panel closed instead */ }
  }
  throw new Error('Pause menu did not open')
}
async function continueGame() {
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some((b) => b.textContent.trim() === 'Continue' && !b.disabled), null, { timeout: 30000 })
  await button('Continue').click()
  await inGame()
}
async function idb(op, key, value) {
  return page.evaluate(({ op, key, value }) => new Promise((resolve, reject) => {
    const req = indexedDB.open('zombie-outbreak', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('saves')
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('saves', op === 'get' ? 'readonly' : 'readwrite')
      const store = tx.objectStore('saves')
      const r = op === 'get' ? store.get(key) : op === 'del' ? store.delete(key) : store.put(value, key)
      r.onsuccess = () => resolve(op === 'get' ? r.result : true)
      tx.oncomplete = () => db.close()
    }
    req.onerror = () => reject(req.error)
  }), { op, key, value })
}
/** Stand next to a container (walkable, in reach, no wall between) and open it with the runtime's E. */
async function openContainerWith(predicate) {
  return page.evaluate((src) => {
    const rt = window.__runtime
    const pick = new Function('c', 'rt', `return (${src})(c, rt)`)
    const target = rt.interactables.find((i) => i.kind === 'container' && pick(rt.world.containers.get(i.id), rt))
    if (!target) return null
    const p = target.position
    for (const r of [0.9, 1.1, 0.7, 1.3]) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2
        const x = p.x + Math.cos(a) * r
        const z = p.z + Math.sin(a) * r
        const y = p.y - 0.5 > 0.5 ? Math.round((p.y - 0.5) / 2.9) * 2.9 : 0
        if (!rt.nav.isWalkable(x, z)) continue
        if (rt.isBlocked({ x, y: y + 1, z }, { x: p.x, y: y + 1, z: p.z }, [target.id])) continue
        rt.player.position = { x, y, z }
        rt.playerBody?.setTranslation({ x, y: y + rt.config.player.height / 2 + 0.02, z }, true)
        rt.closeAllUi()
        rt.interact(target)
        return target.id
      }
    }
    return null
  }, predicate.toString())
}

try {
  // 1) New Game: take loot by clicking the old slot grid, equip by right click; the header shows slots and kg.
  await page.goto(base)
  await menu()
  await idb('del', 'slot-1')
  await page.reload()
  await menu()
  await button('New Game').click()
  await hasText('Tạo nhân vật')
  await button('Bắt đầu').click()
  await inGame()
  const boxId = await openContainerWith((c) => c && !c.position && c.items.items.some((i) => i.kind === 'weapon') && c.items.items.length >= 2)
  assert.ok(boxId, 'a container with a weapon')
  await page.locator('.inv-panel-container').waitFor()
  const inBox = await boxSlots().count()
  log('opened', { boxId, filled: inBox })
  // Take every filled cell by clicking it (the grid is drawn from the list, padded to the capacity).
  for (let n = 0; n < inBox; n++) {
    await boxSlots().first().click()
    await page.waitForFunction((want) => document.querySelectorAll('.inv-panel:not(.inv-panel-container):not(.inv-panel-craft) .slot-filled').length === want, n + 1, { timeout: 5000 })
  }
  assert.equal(await boxSlots().count(), 0)
  const header = await page.locator('.inv-panel:not(.inv-panel-container):not(.inv-panel-craft) .inv-count').innerText()
  log('bag header', header)
  assert.match(header, new RegExp(`^${inBox}/12 · \\d+\\.\\d kg$`))
  const weaponSlot = bagSlots().filter({ has: page.locator('.slot-cond') }).first()
  await weaponSlot.click({ button: 'right' })
  await page.locator('.slot-equipped').first().waitFor({ timeout: 5000 })
  const live = await page.evaluate(() => {
    const rt = window.__runtime
    return { equipped: rt.player.equipment.weaponInstanceId, items: rt.player.inventory.items.map((i) => i.id), capacity: rt.player.inventory.slotCapacity }
  })
  assert.ok(live.items.includes(live.equipped))
  assert.equal(live.capacity, 12)
  await shot('old-ui-list-inventory')

  // 2) Save: v10 shape; Continue restores the same bag and weapon.
  await pause()
  await button('Lưu và về menu').click()
  await menu()
  const saved = await idb('get', 'slot-1')
  assert.equal(saved.schemaVersion, 10)
  assert.equal(saved.player.inventory.kind, 'player')
  assert.equal(saved.player.inventory.slotCapacity, 12)
  assert.deepEqual(saved.player.inventory.items.map((i) => i.id), live.items)
  assert.deepEqual(saved.player.equipment, { weaponInstanceId: live.equipped, backInstanceId: null })
  assert.deepEqual(saved.lootPatches, ['backpack-v1'])
  assert.ok(Array.isArray(saved.bags))
  assert.equal(saved.bags.length, saved.containers.flatMap((c) => c.items.items).filter((i) => i.kind === 'bag').length + saved.player.inventory.items.filter((i) => i.kind === 'bag').length)
  log('saved v10', { items: saved.player.inventory.items.length, bags: saved.bags.length, containers: saved.containers.length })
  await page.reload()
  await menu()
  await continueGame()
  const back = await page.evaluate(() => ({ items: window.__runtime.player.inventory.items, equipment: window.__runtime.player.equipment }))
  assert.deepEqual(back.items, saved.player.inventory.items)
  assert.deepEqual(back.equipment, saved.player.equipment)

  // 3) A real v9 save migrates on Continue: backup kept, items/conditions/weapon kept, patch reported.
  const v9 = JSON.parse(readFileSync('src/game/systems/fixtures/inv-loot-v9.json', 'utf8'))
  await pause()
  await button('Về menu (không lưu)').click()
  await menu()
  await idb('put', 'slot-1', v9)
  await page.reload()
  await menu()
  await continueGame()
  await hasText('Túi đồ chuyển sang dạng danh sách')
  const toast = await page.locator('.hud-toast').innerText().catch(() => '')
  log('migration toast', toast)
  const migrated = await idb('get', 'slot-1')
  const backup = await idb('get', 'slot-1.backup-v9')
  assert.deepEqual(backup, v9)
  assert.equal(migrated.schemaVersion, 10)
  const v9Items = v9.player.inventory.slots.filter(Boolean)
  assert.deepEqual(migrated.player.inventory.items, v9Items)
  assert.equal(migrated.player.equipment.weaponInstanceId, v9.player.equipment.weaponInstanceId)
  assert.equal(migrated.player.inventory.items.find((i) => i.id === v9.player.equipment.weaponInstanceId).condition, 37)
  // Every v9 container instance is still in the container of the same ID (content v1 → v2 keeps them).
  for (const c of v9.containers) {
    const now = migrated.containers.find((x) => x.id === c.id)
    assert.ok(now, `container ${c.id}`)
    assert.deepEqual(now.items.items.filter((i) => !i.id.endsWith(':backpack-v1')), c.items.slots.filter(Boolean))
    assert.equal(now.opened, c.opened)
  }
  const bonus = migrated.containers.filter((c) => c.items.items.some((i) => i.id.endsWith(':backpack-v1')))
  assert.ok(bonus.every((c) => !c.opened))
  assert.equal(migrated.bags.length, bonus.length)
  log('migrated v9 → v10', { containers: migrated.containers.length, backpacksAdded: bonus.length, wardrobe: bonus.some((c) => c.id === 'c0_0/house/wardrobe') })
  const ui = await page.evaluate(() => window.__runtime.player.inventory.items.length)
  assert.equal(ui, v9Items.length)
  await page.keyboard.press('KeyI')
  await page.locator('.inv-overlay').waitFor()
  await shot('migrated-v9-bag')

  // 4) The wardrobe's backpack: take it, wear it by right click, save: the worn bag and its contents persist.
  await page.keyboard.press('KeyI')
  const wardrobe = await openContainerWith((c) => c && c.id === 'c0_0/house/wardrobe')
  assert.equal(wardrobe, 'c0_0/house/wardrobe')
  await page.locator('.inv-panel-container').waitFor()
  const bagCell = page.locator('.inv-panel-container .slot-filled', { hasText: 'Balo' })
  await bagCell.click()
  await page.waitForFunction(() => window.__runtime.player.inventory.items.some((i) => i.kind === 'bag'))
  await bagSlots().filter({ hasText: 'Balo' }).click({ button: 'right' })
  await hasText('Đang đeo balo')
  await shot('backpack-worn')
  await pause()
  await button('Lưu và về menu').click()
  await menu()
  const withBag = await idb('get', 'slot-1')
  const worn = withBag.player.inventory.items.find((i) => i.kind === 'bag')
  assert.equal(withBag.player.equipment.backInstanceId, worn.id)
  assert.ok(withBag.bags.some((b) => b.id === `bag:${worn.id}` && b.slotCapacity === 8))
  log('worn bag saved', { id: worn.id })

  assert.equal(errors.length, 0, JSON.stringify(errors))
  log('PASS', 'old UI on list inventories, v10 save/Continue, real v9 → v10 migration with backup, backpack worn and saved')
} finally {
  await browser.close()
}
