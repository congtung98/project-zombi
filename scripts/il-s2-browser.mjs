// INV-LOOT S2 browser check (Playwright, fresh context, dev server): the two-window Inventory / Loot
// UI on real game data. Layout at 1920×1080 and 1366×768 (UI scale 100/125/150 %, compact mode),
// selection, double click, Take Selected / Take All, sort, search, tooltip, context menu by
// capability (equip, eat, disabled reasons), keyboard, window drag / resize / collapse / pin / close,
// Escape one layer per press, crafting window, input never reaching the game through the UI (T23),
// the game keeps running with its lighting while windows are open (T24), layout persistence and a
// frame-time comparison with a 500-item container.
//   BASE_URL=http://localhost:5199 PLAYWRIGHT_MODULE=file:///…/playwright/index.mjs CHROMIUM_PATH=… [GPU=1] node scripts/il-s2-browser.mjs
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
mkdirSync('docs/inventory-loot/s2', { recursive: true })
const shot = (name) => page.screenshot({ path: `docs/inventory-loot/s2/${name}.png` })
const log = (label, value) => console.log(label.padEnd(34), typeof value === 'string' ? value : JSON.stringify(value))
const hasText = (text, timeout = 15000) => page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout })
const button = (name) => page.getByRole('button', { name, exact: true })
const rt = (fn, arg) => page.evaluate(fn, arg)
const win = (id) => page.locator(`[data-inv-window="${id}"]`)
const rows = (id) => win(id).locator('.inv-row')
const box = (id) => win(id).boundingBox()

async function menu() {
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 30000 })
}
async function inGame() {
  await page.waitForFunction(() => !document.querySelector('h1') && !document.body.innerText.includes('Đang tải…') && document.querySelector('.hud'), null, { timeout: 60000 })
  await page.waitForTimeout(500)
}
/** Stand next to a container of the given loot table that holds items and open it (the runtime's E). */
async function openContainer(table, minItems = 1, id = null) {
  return rt(({ table, minItems, id }) => {
    const r = window.__runtime
    const defs = r.map.containers.filter((c) => (id ? c.id === id : c.loot === table) && r.world.containers.get(c.id).items.items.length >= minItems)
    for (const def of defs) {
      const target = r.interactables.find((i) => i.id === def.id)
      const p = target.position
      for (const rad of [0.9, 1.1, 0.7, 1.3]) {
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2
          const x = p.x + Math.cos(a) * rad
          const z = p.z + Math.sin(a) * rad
          const y = Math.max(0, Math.round((p.y - 0.5) / 2.9) * 2.9)
          if (!r.nav.isWalkable(x, z) || r.isBlocked({ x, y: y + 1, z }, { x: p.x, y: y + 1, z: p.z }, [target.id])) continue
          r.player.position = { x, y, z }
          r.playerBody?.setTranslation({ x, y: y + r.config.player.height / 2 + 0.02, z }, true)
          r.closeAllUi()
          r.interact(target)
          return target.id
        }
      }
    }
    return null
  }, { table, minItems, id })
}
/** Escape, one layer per press, until the pause menu shows (windows first, then pause). */
async function pauseGame() {
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Escape')
    try { await hasText('Tạm dừng', 700); return } catch { /* a window closed instead */ }
  }
  throw new Error('pause menu did not open')
}
const snapshot = () => rt(() => {
  const r = window.__runtime
  return { pos: { ...r.player.position }, zoom: r.cameraZoom, attack: r.player.attackTimer, stance: r.stance.requested, mouse0: r.input.isDown('attack'), mouse2: r.input.isDown('stance'), clock: r.clock.elapsed }
})
/** rAF frame intervals for `ms`: median and p95 in ms. */
const frames = (ms) => page.evaluate((ms) => new Promise((resolve) => {
  const d = []
  let last = performance.now()
  const end = last + ms
  const step = (t) => {
    d.push(t - last)
    last = t
    if (t < end) requestAnimationFrame(step)
    else {
      d.sort((a, b) => a - b)
      resolve({ n: d.length, median: +d[Math.floor(d.length / 2)].toFixed(2), p95: +d[Math.floor(d.length * 0.95)].toFixed(2) })
    }
  }
  requestAnimationFrame(step)
}), ms)

try {
  await page.goto(base)
  await menu()
  await button('New Game').click()
  await hasText('Tạo nhân vật')
  await button('Bắt đầu').click()
  await inGame()

  // 1) Default layout at 1920×1080 with a kitchen cupboard: Inventory left, Loot right below the clock.
  const kitchen = await openContainer('house-kitchen', 2)
  assert.ok(kitchen, 'a kitchen with loot')
  await win('inventory').waitFor()
  await win('loot').waitFor()
  const inv = await box('inventory')
  const loot = await box('loot')
  const clock = await page.locator('.hud-clock').boundingBox()
  log('1920 layout', { inv, loot })
  assert.ok(Math.abs(inv.width - 480) <= 2 && Math.abs(inv.height - 360) <= 2, 'inventory ~480×360')
  assert.ok(inv.x + inv.width < loot.x, 'side by side')
  assert.ok(loot.y >= clock.y + clock.height, 'loot below the clock')
  assert.equal(await page.locator('.overlay-dim').count(), 0, 'no full-screen dim')
  // T24: the game keeps running (clock, not paused) with windows open.
  const t0 = await snapshot()
  await page.waitForTimeout(800)
  const t1 = await snapshot()
  assert.ok(t1.clock > t0.clock, 'simulation runs with the windows open')
  await shot('inventory-loot-default')

  // 2) Double click a loot row: it moves to the main inventory; Ctrl+click two and Take Selected.
  const lootRows = await rows('loot').count()
  const mainBefore = await rows('inventory').count()
  await rows('loot').first().dblclick()
  await page.waitForFunction((n) => document.querySelectorAll('[data-inv-window="loot"] .inv-row').length === n - 1, lootRows)
  assert.ok((await rows('inventory').count()) >= mainBefore)
  const remaining = await rows('loot').count()
  if (remaining >= 2) {
    await rows('loot').nth(0).click()
    await rows('loot').nth(1).click({ modifiers: ['Control'] })
    await page.waitForFunction(() => document.querySelector('[data-inv-window="loot"] .inv-footer-count')?.textContent.includes('2 đã chọn'))
    await win('loot').getByRole('button', { name: 'Lấy đã chọn' }).click()
    await page.waitForFunction((n) => document.querySelectorAll('[data-inv-window="loot"] .inv-row').length === n - 2, remaining)
  }
  log('taken', { lootLeft: await rows('loot').count(), carried: await rows('inventory').count() })

  // 3) A second container with a weapon: Take All (ignores the search), then the menu by capability.
  const weaponBox = await rt(() => {
    const r = window.__runtime
    return r.map.containers.find((c) => ['house-nightstand', 'safehouse-closet', 'tool-shelf'].includes(c.loot) && r.world.containers.get(c.id).items.items.some((i) => i.kind === 'weapon'))?.id ?? null
  })
  assert.ok(weaponBox)
  assert.equal(await openContainer(null, 1, weaponBox), weaponBox)
  await win('loot').waitFor()
  await win('loot').locator('.inv-search').fill('zzz')
  await hasText('Không có món nào khớp')
  const inBox = await rt(() => window.__runtime.openContainer.items.items.length)
  await win('loot').getByRole('button', { name: 'Lấy hết' }).click()
  await page.waitForFunction(() => window.__runtime.openContainer.items.items.length === 0)
  log('take all (filtered view)', { moved: inBox })
  await win('loot').locator('.inv-search').fill('')

  // Tooltip on the weapon (condition from the instance), then the context menu: equip.
  log('inventory rows', await rows('inventory').allInnerTexts())
  const weaponRow = win('inventory').locator('.inv-row', { has: page.locator('.inv-cond') }).first()
  await weaponRow.hover({ timeout: 5000 })
  await page.locator('.inv-tooltip').waitFor({ timeout: 3000 })
  const tip = await page.locator('.inv-tooltip').innerText()
  assert.match(tip, /Độ bền\s+\d+\/\d+/)
  assert.match(tip, /Sát thương/)
  await shot('inventory-tooltip')
  await weaponRow.click({ button: 'right' })
  await page.locator('.inv-menu').waitFor()
  const menuText = await page.locator('.inv-menu').innerText()
  assert.match(menuText, /Trang bị/)
  await page.locator('.inv-menu').getByRole('menuitem', { name: 'Trang bị' }).click()
  await page.waitForFunction(() => document.querySelector('[data-inv-window="inventory"] .inv-badge-eq'))
  // Equipped: store and drop are disabled with the reason; the menu says so.
  await rt(() => window.__runtime.interact(window.__runtime.interactables.find((i) => i.id === window.__runtime.openContainerId)))
  await openContainer('house-kitchen')
  await win('inventory').locator('.inv-row', { has: page.locator('.inv-badge-eq') }).click({ button: 'right' })
  await page.locator('.inv-menu').waitFor()
  const storeItem = page.locator('.inv-menu-item', { hasText: 'Cất vào' })
  assert.equal(await storeItem.isDisabled(), true)
  assert.match(await storeItem.innerText(), /Đang trang bị — tháo ra trước/)
  assert.equal(await page.locator('.inv-menu-item', { hasText: 'Bỏ xuống' }).isDisabled(), true)
  await shot('inventory-menu-equipped')
  // Escape closes the menu only (one layer).
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('.inv-menu'))
  assert.equal(await win('inventory').count(), 1)
  assert.equal(await win('loot').count(), 1)

  // Eat/drink through the menu really changes the stat and the quantity.
  const drink = await rt(() => {
    const r = window.__runtime
    r.player.thirst = 20
    r.player.hunger = 20
    return r.player.inventory.items.find((i) => ['water', 'soda', 'canned_food', 'chips'].includes(i.itemId))?.itemId ?? null
  })
  if (drink) {
    const name = await rt((id) => ({ water: 'Nước', soda: 'Nước ngọt', canned_food: 'Đồ hộp', chips: 'Snack' })[id], drink)
    const before = await rt(() => ({ thirst: window.__runtime.player.thirst, hunger: window.__runtime.player.hunger, total: window.__runtime.player.inventory.items.reduce((n, i) => n + i.quantity, 0) }))
    await win('inventory').locator('.inv-row', { hasText: name }).first().click({ button: 'right' })
    await page.locator('.inv-menu').getByRole('menuitem', { name: /^(Ăn|Uống)$/ }).click()
    await page.waitForFunction((b) => window.__runtime.player.inventory.items.reduce((n, i) => n + i.quantity, 0) === b.total - 1, before)
    const after = await rt(() => ({ thirst: window.__runtime.player.thirst, hunger: window.__runtime.player.hunger }))
    assert.ok(after.thirst > before.thirst || after.hunger > before.hunger)
    log('used from menu', { item: drink, before, after })
  }

  // 4) Sort by weight, search without accents.
  await win('inventory').locator('.inv-th', { hasText: 'Kg' }).click()
  assert.equal(await win('inventory').locator('.inv-th', { hasText: 'Kg' }).getAttribute('aria-sort'), 'ascending')
  const kgs = await win('inventory').locator('.inv-row .col-kg').allInnerTexts()
  assert.deepEqual(kgs.map(Number), [...kgs.map(Number)].sort((a, b) => a - b))
  await win('inventory').locator('.inv-search').fill('GAY')
  await page.waitForFunction(() => [...document.querySelectorAll('[data-inv-window="inventory"] .inv-row .inv-name')].every((n) => n.textContent.includes('Gậy')))
  await win('inventory').locator('.inv-search').fill('')

  // 5) Keyboard in the table: arrows and Ctrl+A stay in the UI (no walking, no "A" = left).
  const k0 = await snapshot()
  await win('inventory').locator('.inv-tbody').focus()
  for (const key of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'End', 'Home', 'Control+a']) await page.keyboard.press(key)
  await page.waitForTimeout(300)
  const k1 = await snapshot()
  assert.equal(Math.hypot(k1.pos.x - k0.pos.x, k1.pos.z - k0.pos.z) < 0.01, true, 'table keys never move the character')
  const allCount = await rows('inventory').count()
  assert.match(await win('inventory').locator('.inv-footer-count').innerText(), new RegExp(`^${allCount} đã chọn$`))

  // 6) T23: presses, wheel and drags on the UI never reach the game.
  const z0 = await snapshot()
  const rowBox = await rows('inventory').first().boundingBox()
  await page.mouse.move(rowBox.x + 40, rowBox.y + 10)
  await page.mouse.down({ button: 'left' })
  const pressed = await snapshot()
  await page.mouse.up({ button: 'left' })
  await page.mouse.down({ button: 'right' })
  const pressedRight = await snapshot()
  await page.mouse.up({ button: 'right' })
  await page.keyboard.press('Escape') // the menu the right press opened
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(200)
  const title = await win('inventory').locator('.inv-titlebar').boundingBox()
  await page.mouse.move(title.x + 60, title.y + 12)
  await page.mouse.down()
  await page.mouse.move(title.x + 260, title.y + 112, { steps: 8 })
  await page.mouse.up()
  const z1 = await snapshot()
  assert.equal(pressed.mouse0, false, 'a press on a row is not a game click')
  assert.equal(pressedRight.mouse2 || pressedRight.stance, false, 'a right press on a row is not the combat stance')
  assert.equal(z1.zoom, z0.zoom, 'wheel over the table does not zoom')
  assert.ok(z1.attack < 0, 'no swing')
  assert.ok(Math.hypot(z1.pos.x - z0.pos.x, z1.pos.z - z0.pos.z) < 0.01, 'no movement')
  const moved = await box('inventory')
  assert.ok(Math.abs(moved.x - (inv.x + 200)) <= 2 && Math.abs(moved.y - (inv.y + 100)) <= 2, 'window dragged')
  log('T23 input', { zoom: [z0.zoom, z1.zoom], attack: z1.attack, pressed: [pressed.mouse0, pressedRight.mouse2, pressedRight.stance] })

  // 7) Resize, collapse, unpin auto-collapse, persistence.
  const grip = await win('inventory').locator('.inv-resize').boundingBox()
  await page.mouse.move(grip.x + 7, grip.y + 7)
  await page.mouse.down()
  await page.mouse.move(grip.x + 107, grip.y + 57, { steps: 5 })
  await page.mouse.up()
  const resized = await box('inventory')
  assert.ok(Math.abs(resized.width - (moved.width + 100)) <= 2 && Math.abs(resized.height - (moved.height + 50)) <= 2, 'resized')
  const stored = await rt(() => JSON.parse(localStorage.getItem('zombie-outbreak.inventory-layout.v1')).inventory.rect)
  assert.equal(Math.round(stored.w), Math.round(resized.width))
  await win('loot').locator('.inv-tool[title="Thu gọn"]').click()
  assert.ok((await box('loot')).height <= 32, 'collapsed to the title bar')
  await win('loot').locator('.inv-tool[title="Mở rộng"]').click()
  await win('loot').locator('.inv-tool[aria-pressed="true"]').first().click() // unpin
  await page.mouse.move(960, 900)
  // INV-LOOT S5: an unpinned window waits 1.5 s after the pointer left (was 350 ms).
  await page.waitForTimeout(1900)
  assert.ok((await box('loot')).height <= 32, 'unpinned window collapsed after the pointer left')
  const lootTitle = await win('loot').locator('.inv-titlebar').boundingBox()
  await page.mouse.move(lootTitle.x + 40, lootTitle.y + 10)
  await page.waitForTimeout(100)
  assert.ok((await box('loot')).height > 100, 'expands under the pointer')
  await win('loot').locator('.inv-tool[title^="Ghim"]').click() // pin again

  // 8) Crafting window from the inventory title bar.
  await win('inventory').locator('.inv-tool[title="Chế tạo"]').click()
  await win('crafting').waitFor()
  assert.match(await win('crafting').innerText(), /Gậy gỗ tự chế/)

  // 9) Escape, one layer per press: running action → focused window → … → pause.
  await rt(() => {
    const r = window.__runtime
    const inv = r.player.inventory
    inv.items.push({ id: 'test:plank', itemId: 'wood_plank', kind: 'stack', quantity: 1 }, { id: 'test:tape', itemId: 'duct_tape', kind: 'stack', quantity: 1 })
    const bat = inv.items.find((i) => i.kind === 'weapon')
    bat.condition = Math.min(bat.condition, 10)
    inv.slotCapacity = Math.max(inv.slotCapacity, inv.items.length)
    r.startRepair(bat.id)
  })
  await page.locator('.inv-action').waitFor()
  await shot('inventory-action-strip')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !window.__runtime.action)
  assert.equal(await win('crafting').count(), 1, 'Escape cancelled the action, windows stay')
  await win('crafting').locator('.inv-titlebar').click()
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('[data-inv-window="crafting"]'))
  assert.equal(await win('inventory').count(), 1)
  await win('loot').locator('.inv-titlebar').click()
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !window.__runtime.openContainerId)
  assert.equal(await win('inventory').count(), 1, 'loot closed alone, inventory stays')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !window.__runtime.inventoryOpen)
  await page.keyboard.press('Escape')
  await hasText('Tạm dừng')
  log('escape layers', 'action → crafting → loot → inventory → pause')

  // 10) 1366×768 at 100 / 125 / 150 %: windows inside the view; narrow = one window with tabs.
  await page.setViewportSize({ width: 1366, height: 768 })
  await button('Cài đặt').click()
  for (const scale of ['1', '1.25', '1.5']) {
    await page.locator('[data-ui-scale]').selectOption(scale)
    await page.locator('[data-reset-layout]').click()
    await button('Quay lại').click()
    await button('Tiếp tục').click()
    await openContainer('house-kitchen')
    await win('loot').waitFor()
    for (const id of ['inventory', 'loot']) {
      const b = await box(id)
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= 1366 && b.y + b.height <= 768, `${id} inside 1366×768 at ${scale}`)
    }
    assert.ok((await box('inventory')).x + (await box('inventory')).width < (await box('loot')).x, `side by side at ${scale}`)
    await shot(`inventory-1366-${Math.round(Number(scale) * 100)}`)
    // The table scrolls inside; the page never scrolls sideways.
    assert.equal(await rt(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await pauseGame()
    await button('Cài đặt').click()
  }
  await page.setViewportSize({ width: 1024, height: 640 })
  await button('Quay lại').click()
  await button('Tiếp tục').click()
  await openContainer('house-kitchen')
  await page.locator('.inv-title-tab').first().waitFor()
  assert.equal(await page.locator('[data-inv-window]').count(), 1, 'compact: one window')
  assert.deepEqual(await page.locator('.inv-title-tab').allInnerTexts(), ['TÚI ĐỒ', 'LỤC ĐỒ'])
  await page.locator('[data-inv-window="inventory"]').getByRole('button', { name: 'Lấy hết' }).click()
  await page.waitForFunction(() => window.__runtime.openContainer.items.items.length === 0 || document.body.innerText.includes('không chuyển'))
  await shot('inventory-compact-layout')
  log('compact', '1024×640 at 150 %: one window with tabs, Take All works')

  // 11) Frame time: windows closed vs open on a 500-item container (same scene, same machine).
  await page.setViewportSize({ width: 1920, height: 1080 })
  await pauseGame()
  await button('Cài đặt').click()
  await page.locator('[data-ui-scale]').selectOption('1')
  await page.locator('[data-reset-layout]').click()
  await button('Quay lại').click()
  await button('Tiếp tục').click()
  await page.waitForTimeout(1500)
  const closed = await frames(4000)
  await openContainer('house-kitchen')
  await rt(() => {
    const r = window.__runtime
    const c = r.openContainer.items
    const kinds = ['water', 'nails', 'bandage', 'canned_food', 'chips', 'wood_plank']
    for (let n = 0; n < 500; n++) c.items.push(n % 7 === 0 ? { id: `${c.id}:big${n}`, itemId: 'baseball_bat', kind: 'weapon', quantity: 1, condition: 10 + (n % 60) } : { id: `${c.id}:big${n}`, itemId: kinds[n % kinds.length], kind: 'stack', quantity: 1 })
    r.setInventoryOpen(false)
    r.setInventoryOpen(true)
  })
  await page.waitForFunction(() => Number(document.querySelector('[data-inv-window="loot"] .inv-table')?.getAttribute('aria-rowcount')) > 400)
  // Long lists are windowed: only the rows in view (plus a margin) are in the DOM.
  const rendered = await rows('loot').count()
  assert.ok(rendered < 60, `windowed rows: ${rendered}`)
  const open = await frames(4000)
  // Click → React re-render of 500+ rows → next painted frame, measured inside the page.
  const sortMs = await page.evaluate(() => new Promise((resolve) => {
    const th = [...document.querySelectorAll('[data-inv-window="loot"] .inv-th')].find((b) => b.textContent.startsWith('Tên'))
    const t0 = performance.now()
    th.click()
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(+(performance.now() - t0).toFixed(1))))
  }))
  assert.ok(await win('loot').locator('.inv-th[aria-sort="descending"]').count())
  const scroll = page.evaluate(() => new Promise((resolve) => {
    const el = document.querySelector('[data-inv-window="loot"] .inv-tbody')
    let n = 0
    const tick = () => { el.scrollTop += 40; if (++n < 120) requestAnimationFrame(tick); else resolve() }
    requestAnimationFrame(tick)
  }))
  const scrolling = await frames(2000)
  await scroll
  log('frames (ms)', { gpu, closed, open500: open, scrolling500: scrolling, sortClickMs: sortMs })

  assert.equal(errors.length, 0, JSON.stringify(errors))
  log('PASS', 'layout, transfers, tooltip, menu, keys, input capture, window gestures, escape layers, scale/compact, frames')
} finally {
  await browser.close()
}
