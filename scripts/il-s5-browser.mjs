// INV-LOOT S5 browser check (Playwright, fresh context, dev server, Chrome with the GPU), real mouse:
// sweep-select a run of rows with the left button and carry it to the other window (both ways),
// drop rows on the tabs (main ↔ worn bag, container ↔ floor), the combat stance with the windows
// open (they collapse, the swing works, pinned ones come back), unpinned windows collapsing after a
// while or on a press on the world, the backpack on the player's back, and a save holding an item
// this version does not know (kept, shown, saved back as it was).
//   GPU=1 BASE_URL=http://localhost:5199 PLAYWRIGHT_MODULE=file:///…/playwright/index.mjs node scripts/il-s5-browser.mjs
import { mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'

const base = process.env.BASE_URL ?? 'http://localhost:5199'
const gpu = process.env.GPU === '1'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({
  executablePath: gpu ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : process.env.CHROMIUM_PATH || undefined,
  args: gpu ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Outdated Optimize Dep')) errors.push(m.text()) })
mkdirSync('docs/inventory-loot/s5', { recursive: true })
const shot = (name) => page.screenshot({ path: `docs/inventory-loot/s5/${name}.png` })
const log = (label, value) => console.log(label.padEnd(34), typeof value === 'string' ? value : JSON.stringify(value))
const hasText = (text, timeout = 15000) => page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout })
const button = (name) => page.getByRole('button', { name, exact: true })
const rt = (fn, arg) => page.evaluate(fn, arg)
const win = (id) => page.locator(`[data-inv-window="${id}"]`)
const rows = (id) => win(id).locator('.inv-row')
/** The row whose item name is exactly `name`. */
const named = (id, name) => rows(id).filter({ has: page.locator('.inv-name', { hasText: new RegExp(`^${name}$`) }) })
const idle = () => page.waitForFunction(() => window.__runtime.jobs.length === 0, null, { timeout: 30000 })
const collapsed = (id) => win(id).evaluate((el) => el.classList.contains('inv-window-collapsed'))
/** Units of an item in main / worn / the open container / the floor around the player. */
const count = (where, itemId) => rt(([where, itemId]) => {
  const r = window.__runtime
  const worn = r.player.equipment.backInstanceId && r.world.bags.get(r.player.equipment.backInstanceId)
  const items = where === 'main' ? r.player.inventory.items
    : where === 'worn' ? (worn ? worn.items : [])
      : where === 'floor' ? r.world.floor.serialize().flatMap((c) => c.items.items)
        : r.world.containers.get(r.openContainerId).items.items
  return items.reduce((n, i) => n + (i.itemId === itemId ? i.quantity : 0), 0)
}, [where, itemId])

async function menu() {
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 30000 })
}
async function inGame() {
  await page.waitForFunction(() => !document.querySelector('h1') && !document.body.innerText.includes('Đang tải…') && document.querySelector('.hud'), null, { timeout: 60000 })
  await page.waitForTimeout(500)
}
/** Stand at a kitchen cupboard, put `items` in it and `main` in the bag; loot and inventory windows open. */
async function stockedBox(items, main = [], { bag = false } = {}) {
  const id = await rt(({ items, main, bag }) => {
    const r = window.__runtime
    const def = r.map.containers.find((c) => c.loot === 'house-kitchen')
    const target = r.interactables.find((i) => i.id === def.id)
    const p = target.position
    for (const rad of [0.9, 1.1, 0.7, 1.3]) for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2
      const x = p.x + Math.cos(a) * rad
      const z = p.z + Math.sin(a) * rad
      if (!r.nav.isWalkable(x, z) || r.isBlocked({ x, y: 1, z }, { x: p.x, y: 1, z: p.z }, [target.id])) continue
      r.player.position = { x, y: 0, z }
      r.playerBody?.setTranslation({ x, y: r.config.player.height / 2 + 0.02, z }, true)
      const box = r.world.containers.get(def.id).items
      box.items = []
      box.slotCapacity = 8
      let n = 0
      for (const [itemId, quantity] of items) box.items.push({ id: `${box.id}:s5-${n++}`, itemId, kind: 'stack', quantity })
      r.player.equipment.backInstanceId = null
      r.player.equipment.weaponInstanceId = null
      r.player.inventory.items = []
      // The test bag of an earlier step goes with the emptied inventory (a save needs every bag record owned).
      r.world.bags.delete('player:s5-bag')
      for (const [itemId, quantity] of main) r.player.inventory.items.push({ id: `player:s5-${n++}`, itemId, kind: 'stack', quantity })
      if (bag) {
        const id = `player:s5-bag`
        r.player.inventory.items.push({ id, itemId: 'backpack', kind: 'bag', quantity: 1 })
        r.world.bags.set(id, { id: `bag:${id}`, kind: 'bag', nextItemId: 1, items: [], slotCapacity: 8 })
        r.wearBag(id)
      }
      r.closeAllUi()
      r.interact(target)
      return def.id
    }
    return null
  }, { items, main, bag })
  assert.ok(id, 'a kitchen cupboard in reach')
  await win('loot').waitFor()
  await win('inventory').waitFor()
  await page.waitForFunction((n) => document.querySelectorAll('[data-inv-window="loot"] .inv-row').length === n, items.length)
  return id
}
const center = async (locator) => {
  const b = await locator.boundingBox()
  return { x: b.x + Math.min(60, b.width / 2), y: b.y + b.height / 2 }
}
/** Press on one row, sweep to another in the same list, then (optionally) carry the run to `to`. */
async function sweep(from, over, to, { beforeRelease } = {}) {
  const a = await center(from)
  const b = await center(over)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 8 })
  if (to) {
    const t = await center(to)
    await page.mouse.move(t.x, t.y, { steps: 14 })
  }
  if (beforeRelease) await beforeRelease()
  await page.mouse.up()
}

try {
  await page.goto(base)
  await menu()
  await button('New Game').click()
  await hasText('Tạo nhân vật')
  await button('Bắt đầu').click()
  await inGame()

  // 1) Sweep two of three rows in the cupboard and carry them into the inventory in one gesture.
  await stockedBox([['water', 2], ['canned_food', 3], ['chips', 4]])
  const loot = rows('loot')
  const names = await loot.allInnerTexts()
  log('cupboard rows', names.map((t) => t.split('\n')[0]))
  let midSweep = null
  await sweep(loot.nth(0), loot.nth(1), null, {
    beforeRelease: async () => {
      midSweep = await win('loot').locator('.inv-row[aria-selected="true"]').count()
      await shot('inventory-sweep-select')
    },
  })
  assert.equal(midSweep, 2, 'the sweep selected the two rows it passed over')
  assert.equal(await win('loot').locator('.inv-row[aria-selected="true"]').count(), 2, 'released inside the list: the run stays selected')
  assert.equal(await rt(() => window.__runtime.jobs.length), 0, 'a sweep inside the list moves nothing')
  let highlighted = false
  await sweep(loot.nth(0), loot.nth(1), win('inventory').locator('.inv-tbody'), {
    beforeRelease: async () => {
      highlighted = await win('inventory').locator('.inv-tbody.inv-drop-target').count() === 1
      await page.locator('.inv-drag').waitFor()
      await shot('inventory-sweep-drag')
    },
  })
  assert.ok(highlighted, 'the inventory list lights up as the drop target')
  await idle()
  const firstTwo = await rt(() => window.__runtime.player.inventory.items.map((i) => i.itemId).sort())
  const leftInBox = await rt(() => window.__runtime.openContainer.items.items.map((i) => i.itemId))
  assert.equal(firstTwo.length, 2)
  assert.equal(leftInBox.length, 1)
  log('sweep → inventory', { carried: firstTwo, left: leftInBox })

  // 2) And back: sweep both inventory rows (bottom to top) into the cupboard.
  const inv = rows('inventory')
  // Leaving on a slant (down-right, over the other row) keeps the run as swept.
  let upSelected = 0
  await sweep(inv.nth(1), inv.nth(0), win('loot').locator('.inv-tbody'), {
    beforeRelease: async () => {
      upSelected = await win('inventory').locator('.inv-row[aria-selected="true"]').count()
    },
  })
  assert.equal(upSelected, 2, 'the run stays as swept while it is carried out on a slant')
  await idle()
  assert.equal(await rt(() => window.__runtime.player.inventory.items.length), 0)
  assert.equal(await rt(() => window.__runtime.openContainer.items.items.length), 3)
  log('sweep → cupboard', 'both rows back, upward sweep')

  // 3) Main ↔ worn bag through the Inventory window's tabs (a sweep of two rows onto "Balo đang đeo").
  await stockedBox([['water', 1]], [['bandage', 3], ['nails', 20], ['soda', 1]], { bag: true })
  const wornTab = win('inventory').getByRole('tab', { name: /Balo đang đeo/ })
  const mainTab = win('inventory').getByRole('tab', { name: /Túi chính/ })
  const bandage = rows('inventory').filter({ hasText: 'Băng gạc' })
  const nails = rows('inventory').filter({ hasText: 'Đinh' })
  // Two gestures: sweep the run and let go, then carry the selection by one of its rows (straight up
  // to the tab: a sweep carried out upward would pass back over its rows).
  await sweep(bandage, nails, null)
  assert.equal(await win('inventory').locator('.inv-row[aria-selected="true"]').count(), 2)
  const nb = await center(nails)
  const wt = await center(wornTab)
  await page.mouse.move(nb.x, nb.y)
  await page.mouse.down()
  await page.mouse.move(wt.x, wt.y, { steps: 12 })
  assert.equal(await wornTab.evaluate((el) => el.classList.contains('inv-drop-target')), true, 'the worn bag tab lights up')
  assert.match(await page.locator('.inv-drag').innerText(), /2 món/)
  await shot('inventory-drop-on-bag-tab')
  await page.mouse.up()
  await idle()
  assert.deepEqual([await count('worn', 'bandage'), await count('worn', 'nails'), await count('main', 'bandage'), await count('main', 'nails')], [3, 20, 0, 0])
  await wornTab.click()
  await page.waitForFunction(() => document.querySelectorAll('[data-inv-window="inventory"] .inv-row').length === 2)
  // One row back onto "Túi chính" (a plain drag, no sweep).
  const inBag = rows('inventory').filter({ hasText: 'Đinh' })
  const p = await center(inBag)
  const t = await center(mainTab)
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  await page.mouse.move(p.x + 200, p.y, { steps: 6 })
  await page.mouse.move(t.x, t.y, { steps: 10 })
  await page.mouse.up()
  await idle()
  assert.deepEqual([await count('main', 'nails'), await count('worn', 'nails')], [20, 0])
  log('main ↔ worn bag tabs', 'bandage+nails into the bag, nails back')

  // 4) Cupboard ↔ floor through the Loot window's tabs.
  await stockedBox([['water', 2], ['wood_plank', 2]])
  const floorTab = win('loot').getByRole('tab', { name: /Dưới đất/ })
  const water = named('loot', 'Nước')
  const wp = await center(water)
  const ft = await center(floorTab)
  await page.mouse.move(wp.x, wp.y)
  await page.mouse.down()
  await page.mouse.move(wp.x + 300, wp.y, { steps: 6 })
  await page.mouse.move(ft.x, ft.y, { steps: 10 })
  await page.mouse.up()
  await idle()
  assert.deepEqual([await count('box', 'water'), await count('floor', 'water')], [0, 2])
  const boxTabName = await win('loot').getByRole('tab', { selected: true }).innerText()
  await floorTab.click()
  // Water went one unit per step and floor drops never merge: two piles, swept together.
  await page.waitForFunction(() => document.querySelectorAll('[data-inv-window="loot"] .inv-row').length === 2)
  const boxTab = win('loot').getByRole('tab', { name: boxTabName.split('\n')[0] })
  await sweep(rows('loot').nth(0), rows('loot').nth(1), null)
  const fp = await center(rows('loot').nth(1))
  const bt = await center(boxTab)
  await page.mouse.move(fp.x, fp.y)
  await page.mouse.down()
  await page.mouse.move(fp.x + 300, fp.y, { steps: 6 })
  await page.mouse.move(bt.x, bt.y, { steps: 10 })
  await shot('inventory-floor-to-container-tab')
  await page.mouse.up()
  await idle()
  const back = await rt(() => {
    const r = window.__runtime
    const def = r.map.containers.find((c) => c.loot === 'house-kitchen')
    return r.world.containers.get(def.id).items.items.reduce((n, i) => n + (i.itemId === 'water' ? i.quantity : 0), 0)
  })
  assert.deepEqual([back, await count('floor', 'water')], [2, 0])
  log('cupboard ↔ floor tabs', 'water to the floor tab and back to the cupboard tab')

  // 5) Combat stance with pinned windows open: a right press on the world collapses them, the left
  // button swings, releasing brings the pinned windows back.
  await stockedBox([['water', 1]], [], { bag: true })
  await rt(() => {
    const r = window.__runtime
    r.player.inventory.items.push({ id: 'player:s5-bat', itemId: 'baseball_bat', kind: 'weapon', quantity: 1, condition: 80 })
    r.equipItem('player:s5-bat')
    r.player.stamina = r.config.player.maxStamina
  })
  assert.deepEqual([await collapsed('inventory'), await collapsed('loot')], [false, false])
  await page.mouse.move(1250, 720)
  await page.mouse.down({ button: 'right' })
  await page.waitForFunction(() => window.__runtime.stance.requested)
  await page.waitForFunction(() => document.querySelectorAll('.inv-window-collapsed').length === 2)
  await page.mouse.down({ button: 'left' })
  await page.waitForFunction(() => window.__runtime.player.attackTimer >= 0, null, { timeout: 3000 })
  await page.mouse.up({ button: 'left' })
  await shot('inventory-stance-collapsed')
  await page.mouse.up({ button: 'right' })
  await page.waitForFunction(() => !window.__runtime.stance.requested)
  await page.waitForFunction(() => document.querySelectorAll('.inv-window-collapsed').length === 0)
  log('stance with windows open', 'collapsed, swung, pinned windows back')

  // 6) The backpack on the player's back (zoomed in, from behind the shoulder).
  await rt(() => {
    const r = window.__runtime
    r.cameraZoom = r.config.camera.zoomMax
    r.closeAllUi()
    r.player.facing = Math.PI * 0.25 + Math.PI
  })
  await page.waitForTimeout(900)
  await shot('player-backpack')
  await page.screenshot({ path: 'docs/inventory-loot/s5/player-backpack-close.png', clip: { x: 780, y: 260, width: 360, height: 360 } })
  await rt(() => { window.__runtime.player.facing = Math.PI * 0.25 })
  await page.waitForTimeout(600)
  await shot('player-backpack-front')
  await page.screenshot({ path: 'docs/inventory-loot/s5/player-backpack-front-close.png', clip: { x: 780, y: 260, width: 360, height: 360 } })
  await rt(() => { window.__runtime.cameraZoom = window.__runtime.config.camera.zoomDefault })

  // 7) Unpinned: stays open for a while after the pointer leaves, collapses after the delay; a press
  // on the world collapses it at once.
  await stockedBox([['water', 1]])
  await win('inventory').locator(`.inv-tool[title^="Bỏ ghim"]`).click()
  await page.mouse.move(1250, 760, { steps: 4 })
  await page.waitForTimeout(700)
  assert.equal(await collapsed('inventory'), false, 'still open 0.7 s after leaving')
  await page.waitForTimeout(1400)
  assert.equal(await collapsed('inventory'), true, 'collapsed after the delay')
  const title = await center(win('inventory').locator('.inv-titlebar'))
  await page.mouse.move(title.x, title.y + 2, { steps: 4 })
  await page.waitForFunction(() => !document.querySelector('[data-inv-window="inventory"]').classList.contains('inv-window-collapsed'))
  await page.mouse.move(1250, 760, { steps: 4 })
  await page.mouse.click(1250, 760)
  await page.waitForTimeout(100)
  assert.equal(await collapsed('inventory'), true, 'a press on the world collapses it at once')
  assert.equal(await collapsed('loot'), false, 'the pinned loot window stays')
  await win('inventory').locator(`.inv-tool[title^="Ghim"]`).click()
  log('unpinned window', 'open for 0.7 s, collapsed by 2.1 s, hover opens, world click collapses')

  // 8) A save holding an item this version does not know: kept, shown, saved back unchanged.
  await rt(() => window.dispatchEvent(new Event('blur')))
  await hasText('Tạm dừng')
  await button('Lưu và về menu').click()
  await menu()
  const planted = await rt(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('zombie-outbreak', 1)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const tx = db.transaction('saves', 'readwrite')
    const store = tx.objectStore('saves')
    const keys = await new Promise((resolve) => { const r = store.getAllKeys(); r.onsuccess = () => resolve(r.result) })
    const key = keys.find((k) => !String(k).includes('backup'))
    const save = await new Promise((resolve) => { const r = store.get(key); r.onsuccess = () => resolve(r.result) })
    const inv = save.player.inventory
    const item = { id: `${inv.id}:${inv.nextItemId++}`, itemId: 'rare_gem', kind: 'stack', quantity: 3, cut: 'oval' }
    inv.items.push(item)
    store.put(save, key)
    await new Promise((resolve) => { tx.oncomplete = resolve })
    db.close()
    return { key, item }
  })
  await page.reload()
  await menu()
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some((b) => b.textContent.trim() === 'Continue' && !b.disabled), null, { timeout: 30000 })
  await button('Continue').click()
  await inGame()
  await hasText('phiên bản này không nhận ra (rare_gem)')
  await page.keyboard.press('KeyI')
  await win('inventory').waitFor()
  const unknownRow = rows('inventory').filter({ hasText: 'rare_gem' })
  assert.match(await unknownRow.innerText(), /Vật phẩm không xác định \(rare_gem ×3\)/)
  await unknownRow.click({ button: 'right' })
  const menuText = await page.locator('.inv-menu').innerText()
  assert.doesNotMatch(menuText, /Ăn|Uống|Dùng|Trang bị|Đeo/)
  await shot('inventory-unknown-item')
  await page.keyboard.press('Escape')
  await rt(() => window.dispatchEvent(new Event('blur')))
  await hasText('Tạm dừng')
  await button('Lưu và về menu').click()
  await menu()
  const stored = await rt(async (key) => {
    const db = await new Promise((resolve) => { const r = indexedDB.open('zombie-outbreak', 1); r.onsuccess = () => resolve(r.result) })
    const save = await new Promise((resolve) => { const r = db.transaction('saves').objectStore('saves').get(key); r.onsuccess = () => resolve(r.result) })
    db.close()
    return save.player.inventory.items.find((i) => i.itemId === 'rare_gem' || i.itemId === 'unknown_item')
  }, planted.key)
  assert.deepEqual(stored, planted.item, 'saved back exactly as it was loaded')
  log('unknown item', { planted: planted.item, stored })

  assert.equal(errors.length, 0, JSON.stringify(errors))
  log('PASS', 'sweep both ways, tab drops (bag, floor, container), stance, unpinned, backpack, unknown item')
} finally {
  await browser.close()
}
