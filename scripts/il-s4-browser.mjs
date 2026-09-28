// INV-LOOT S4 browser check (Playwright, fresh context, dev server, Chrome with the GPU): timed transfers
// through the one action queue with real input. Take All progress and Cancel keeping committed steps,
// spammed double clicks, drag and drop between windows, Shift+drag and the menu's quantity dialog, a
// full inventory (merges still go, one summary), walking cancels, a craft queued behind a transfer
// (running and waiting shown), Escape cancels the queue first, a real pause freezes the progress, a
// save mid-batch holds only committed steps and Continue has an empty queue.
//   GPU=1 BASE_URL=http://localhost:5199 PLAYWRIGHT_MODULE=file:///…/playwright/index.mjs node scripts/il-s4-browser.mjs
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
mkdirSync('docs/inventory-loot/s4', { recursive: true })
const shot = (name) => page.screenshot({ path: `docs/inventory-loot/s4/${name}.png` })
const log = (label, value) => console.log(label.padEnd(34), typeof value === 'string' ? value : JSON.stringify(value))
const hasText = (text, timeout = 15000) => page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout })
const button = (name) => page.getByRole('button', { name, exact: true })
const rt = (fn, arg) => page.evaluate(fn, arg)
const win = (id) => page.locator(`[data-inv-window="${id}"]`)
const rows = (id) => win(id).locator('.inv-row')
const count = (where, itemId) => rt(([where, itemId]) => {
  const r = window.__runtime
  const inv = where === 'main' ? r.player.inventory : r.openContainer.items
  return inv.items.reduce((n, i) => n + (i.itemId === itemId ? i.quantity : 0), 0)
}, [where, itemId])

async function menu() {
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 30000 })
}
async function inGame() {
  await page.waitForFunction(() => !document.querySelector('h1') && !document.body.innerText.includes('Đang tải…') && document.querySelector('.hud'), null, { timeout: 60000 })
  await page.waitForTimeout(500)
}
/** A real pause while work runs (the window losing focus pauses the game; Escape would cancel the queue first). */
async function pauseByBlur() {
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await hasText('Tạm dừng')
}
/** Stand at a kitchen cupboard, empty it and put `items` in; the loot and inventory windows open. */
async function stockedBox(items, main = []) {
  const id = await rt(({ items, main }) => {
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
      for (const [itemId, quantity] of items) box.items.push({ id: `${box.id}:s4-${n++}`, itemId, kind: 'stack', quantity })
      r.player.inventory.items = []
      for (const [itemId, quantity] of main) r.player.inventory.items.push({ id: `player:s4-${n++}`, itemId, kind: 'stack', quantity })
      r.closeAllUi()
      r.interact(target)
      return def.id
    }
    return null
  }, { items, main })
  assert.ok(id, 'a kitchen cupboard in reach')
  await win('loot').waitFor()
  await win('inventory').waitFor()
  await page.waitForFunction((n) => document.querySelectorAll('[data-inv-window="loot"] .inv-row').length === n, items.length)
  return id
}
const idle = () => page.waitForFunction(() => window.__runtime.jobs.length === 0, null, { timeout: 30000 })

try {
  await page.goto(base)
  await menu()
  await button('New Game').click()
  await hasText('Tạo nhân vật')
  await button('Bắt đầu').click()
  await inGame()

  // 1) Take All runs as timed steps with progress; Cancel keeps what is done, the rest stays.
  await stockedBox([['water', 5], ['canned_food', 5], ['wood_plank', 3]])
  await win('loot').getByRole('button', { name: 'Lấy hết' }).click()
  await win('inventory').locator('.inv-action').waitFor()
  await page.waitForFunction(() => window.__runtime.player.inventory.items.reduce((n, i) => n + i.quantity, 0) >= 3)
  await shot('inventory-transfer-progress')
  const strip = await win('inventory').locator('.inv-action').innerText()
  assert.match(strip, /Đang làm: Lấy Nước \+2/)
  assert.match(strip, /\d+\/13/)
  await win('inventory').locator('.inv-action').getByRole('button', { name: /Hủy/ }).click()
  await idle()
  const kept = await rt(() => window.__runtime.player.inventory.items.reduce((n, i) => n + i.quantity, 0))
  const left = await rt(() => window.__runtime.openContainer.items.items.reduce((n, i) => n + i.quantity, 0))
  assert.equal(kept + left, 13, 'nothing lost or made')
  assert.ok(kept >= 3 && kept < 13)
  log('take all → cancel', { kept, left, strip: strip.replace(/\n/g, ' ') })

  // 2) Spammed double clicks on one row queue it once.
  await stockedBox([['canned_food', 3]])
  const row = rows('loot').first()
  for (let i = 0; i < 4; i++) await row.dblclick()
  const queued = await rt(() => window.__runtime.jobs.length)
  assert.ok(queued <= 1, `one job, got ${queued}`)
  await idle()
  assert.equal(await count('main', 'canned_food'), 3)
  assert.equal(await count('box', 'canned_food'), 0)
  log('spammed double clicks', { jobsAtOnce: queued, carried: 3 })

  // 3) Drag a row from the loot window onto the inventory window.
  await stockedBox([['water', 2], ['chips', 3]])
  const src = await rows('loot').filter({ hasText: 'Snack' }).boundingBox()
  const dst = await win('inventory').locator('.inv-tbody').boundingBox()
  await page.mouse.move(src.x + 40, src.y + 12)
  await page.mouse.down()
  await page.mouse.move(src.x + 80, src.y + 30, { steps: 4 })
  await page.locator('.inv-drag').waitFor()
  await shot('inventory-drag')
  await page.mouse.move(dst.x + 100, dst.y + 60, { steps: 10 })
  await page.mouse.up()
  await idle()
  assert.equal(await count('main', 'chips'), 3)
  log('drag and drop', 'loot row → inventory window')

  // 4) Shift+drag a stack: choose how many (3 of 10 nails), then the menu's "Chọn số lượng…" with Max.
  await stockedBox([['nails', 10], ['duct_tape', 4]])
  const nails = await rows('loot').filter({ hasText: 'Đinh' }).boundingBox()
  await page.keyboard.down('Shift')
  await page.mouse.move(nails.x + 40, nails.y + 12)
  await page.mouse.down()
  await page.mouse.move(dst.x + 100, dst.y + 60, { steps: 10 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await page.locator('.inv-qty').waitFor()
  await page.locator('.inv-qty input').fill('3')
  await shot('inventory-quantity-dialog')
  await page.locator('.inv-qty').getByRole('button', { name: 'Đồng ý' }).click()
  await idle()
  assert.deepEqual([await count('box', 'nails'), await count('main', 'nails')], [7, 3])
  await rows('loot').filter({ hasText: 'Băng keo' }).click({ button: 'right' })
  await page.locator('.inv-menu').getByRole('menuitem', { name: 'Chọn số lượng…' }).click()
  await page.locator('.inv-qty').getByRole('button', { name: 'Tối đa' }).click()
  await page.locator('.inv-qty').getByRole('button', { name: 'Đồng ý' }).click()
  await idle()
  assert.equal(await count('main', 'duct_tape'), 4)
  log('quantity dialog', 'Shift+drag 3 of 10 nails; menu Max for tape')

  // 5) A full inventory: the water stack with room still fills, the rest stays with one summary.
  await stockedBox([['water', 4], ['bandage', 2], ['soda', 1]], [['water', 2], ...Array.from({ length: 11 }, () => ['medkit', 1])])
  await win('loot').getByRole('button', { name: 'Lấy hết' }).click()
  await idle()
  await hasText('không chuyển')
  const toast = await page.locator('.hud-toast').innerText()
  // The water line moved 3 of 4 (the stack had room for 3): it counts as a line that did not fully move.
  assert.match(toast, /Đã chuyển 3 · 3 món không chuyển: Hết chỗ \(3\)/)
  assert.deepEqual([await count('main', 'water'), await count('box', 'water'), await count('box', 'bandage')], [5, 1, 2])
  await shot('inventory-full-partial')
  log('full inventory', toast)

  // 6) Walking cancels the queue; committed steps stay.
  await stockedBox([['water', 5]])
  await win('loot').getByRole('button', { name: 'Lấy hết' }).click()
  await page.waitForFunction(() => window.__runtime.player.inventory.items.reduce((n, i) => n + i.quantity, 0) >= 1)
  await page.keyboard.down('KeyW')
  await idle()
  await page.keyboard.up('KeyW')
  const walked = await count('main', 'water')
  assert.ok(walked >= 1 && walked < 5)
  await hasText('Đã hủy')
  log('walking cancels', { carried: walked })

  // 7) A craft queued behind a transfer: running and waiting shown; both finish.
  await stockedBox([['water', 3]], [['wood_plank', 2], ['duct_tape', 1]])
  await win('loot').getByRole('button', { name: 'Lấy hết' }).click()
  await win('inventory').locator('.inv-tool[title="Chế tạo"]').click()
  await win('crafting').waitFor()
  await win('crafting').getByRole('button', { name: /Xếp hàng chế tạo/ }).click()
  await win('inventory').locator('.inv-queue').waitFor()
  assert.match(await win('inventory').locator('.inv-queue').innerText(), /Đang chờ: Chế tạo Gậy gỗ tự chế/)
  await shot('inventory-queue-craft')
  await idle()
  assert.deepEqual([await count('main', 'water'), await count('main', 'wooden_club')], [3, 1])
  log('craft behind transfer', 'queued, shown waiting, both done')

  // 8) Escape: the running queue first (windows stay), then the windows.
  await stockedBox([['water', 5]])
  await win('loot').getByRole('button', { name: 'Lấy hết' }).click()
  await page.waitForFunction(() => window.__runtime.jobs.length === 1)
  await win('loot').locator('.inv-titlebar').click()
  await page.keyboard.press('Escape')
  await idle()
  assert.equal(await win('loot').count(), 1, 'Escape cancelled the queue, windows stay')

  // 9) A real pause freezes the step; resuming continues.
  await win('loot').getByRole('button', { name: 'Lấy hết' }).click()
  await page.waitForFunction(() => window.__runtime.jobs[0]?.step?.elapsed > 0)
  await pauseByBlur()
  const frozen = await rt(() => [window.__runtime.jobs.length, window.__runtime.jobs[0]?.step?.elapsed ?? -1, window.__runtime.player.inventory.items.reduce((n, i) => n + i.quantity, 0)])
  await page.waitForTimeout(1000)
  const still = await rt(() => [window.__runtime.jobs.length, window.__runtime.jobs[0]?.step?.elapsed ?? -1, window.__runtime.player.inventory.items.reduce((n, i) => n + i.quantity, 0)])
  assert.equal(frozen[0], 1, 'the job still runs when the game pauses')
  assert.deepEqual(still, frozen, 'no progress while paused')
  await button('Tiếp tục').click()
  await idle()
  assert.equal(await count('main', 'water'), 5)
  log('pause', { frozen, still })

  // 10) Save mid-batch: only committed steps; Continue starts with an empty queue.
  await stockedBox([['wood_plank', 4]])
  await win('loot').getByRole('button', { name: 'Lấy hết' }).click()
  await page.waitForFunction(() => window.__runtime.player.inventory.items.reduce((n, i) => n + i.quantity, 0) >= 1)
  await pauseByBlur()
  const atSave = await rt(() => ({ carried: window.__runtime.player.inventory.items.reduce((n, i) => n + i.quantity, 0), jobs: window.__runtime.jobs.length }))
  assert.equal(atSave.jobs, 1, 'saved in the middle of the batch')
  assert.ok(atSave.carried < 4)
  await button('Lưu và về menu').click()
  await menu()
  await page.reload()
  await menu()
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some((b) => b.textContent.trim() === 'Continue' && !b.disabled), null, { timeout: 30000 })
  await button('Continue').click()
  await inGame()
  const loaded = await rt(() => ({ carried: window.__runtime.player.inventory.items.reduce((n, i) => n + i.quantity, 0), jobs: window.__runtime.jobs.length, ledger: window.__runtime.ledger.isEmpty() }))
  assert.deepEqual(loaded, { carried: atSave.carried, jobs: 0, ledger: true })
  log('save mid-batch', { atSave, loaded })

  assert.equal(errors.length, 0, JSON.stringify(errors))
  log('PASS', 'progress/cancel, spam, drag, quantity, full, walk cancel, craft queue, escape, pause, save')
} finally {
  await browser.close()
}
