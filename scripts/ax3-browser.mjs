// AX3 browser check (Playwright, fresh context, dev server, Chrome with the GPU), real mouse:
// in a real game, drink, eat a sealed tin (open, then eat), bandage and eat from a cupboard through
// the item context menu; mid-action the Action System presents the pose group and the item in hand,
// the weapon is put away and comes back; screenshots of each moment (docs/character-action/).
//   GPU=1 BASE_URL=http://localhost:5199 PLAYWRIGHT_MODULE=file:///…/playwright/index.mjs node scripts/ax3-browser.mjs
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
mkdirSync('docs/character-action', { recursive: true })
const shot = (name) => page.screenshot({ path: `docs/character-action/${name}.png` })
const log = (label, value) => console.log(label.padEnd(30), typeof value === 'string' ? value : JSON.stringify(value))
const hasText = (text, timeout = 15000) => page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout })
const button = (name) => page.getByRole('button', { name, exact: true })
const rt = (fn, arg) => page.evaluate(fn, arg)
const win = (id) => page.locator(`[data-inv-window="${id}"]`)
const idle = () => page.waitForFunction(() => window.__runtime.jobs.length === 0, null, { timeout: 30000 })
const shown = () => rt(() => window.__runtime.actionPresentation)

/** Open the item menu on the first row named `name` in `window` and pick `entry`. */
async function menuPick(window, name, entry) {
  await win(window).locator('.inv-row', { has: page.locator('.inv-name', { hasText: new RegExp(`^${name}$`) }) }).first().click({ button: 'right' })
  await page.locator('.inv-menu').getByRole('menuitem', { name: entry, exact: true }).click()
}

/** Stats low, a bat in hand, the given items in the bag; the inventory window open, camera close. */
async function prepare(items) {
  await rt((items) => {
    const r = window.__runtime
    for (const z of [...r.zombies.values()]) r.zombies.delete(z.id)
    r.closeAllUi()
    r.player.inventory.items = []
    r.player.equipment.weaponInstanceId = null
    r.player.equipment.backInstanceId = null
    let n = 0
    r.player.inventory.items.push({ id: 'player:ax3-bat', itemId: 'baseball_bat', kind: 'weapon', quantity: 1, condition: 80 })
    r.equipItem('player:ax3-bat')
    for (const [itemId, quantity] of items) r.player.inventory.items.push({ id: `player:ax3-${n++}`, itemId, kind: 'stack', quantity })
    r.player.thirst = 20
    r.player.hunger = 20
    r.player.health = 40
    r.cameraZoom = r.config.camera.zoomMax
    r.setInventoryOpen(true)
  }, items)
  await win('inventory').waitFor()
}

try {
  await page.goto(base)
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 30000 })
  await button('New Game').click()
  await hasText('Tạo nhân vật')
  await button('Bắt đầu').click()
  await page.waitForFunction(() => !document.querySelector('h1') && !document.body.innerText.includes('Đang tải…') && document.querySelector('.hud'), null, { timeout: 60000 })
  await page.waitForTimeout(500)

  await prepare([['water', 2], ['canned_food', 2], ['bandage', 2], ['chips', 1]])

  // 1) Drink: the bottle in the right hand, the bat put away, the thirst only at the end.
  await menuPick('inventory', 'Nước', 'Uống')
  await page.waitForFunction(() => window.__runtime.actionPresentation?.progress > 0.45, null, { timeout: 10000 })
  const drinking = await shown()
  assert.equal(drinking.group, 'drink')
  assert.deepEqual(drinking.prop, { itemId: 'water', hand: 'right' })
  assert.equal(drinking.hideWeapon, true)
  assert.equal(await rt(() => window.__runtime.player.thirst < 21), true, 'no thirst restored before the end')
  await shot('ax3-drink')
  await idle()
  assert.ok(await rt(() => window.__runtime.player.thirst > 55))
  log('drink', drinking)

  // 2) A sealed tin through "Mở rồi ăn": opening in the left hand, then eating the opened tin.
  await menuPick('inventory', 'Đồ hộp', 'Mở rồi ăn')
  await page.waitForFunction(() => window.__runtime.actionPresentation?.group === 'work', null, { timeout: 10000 })
  const opening = await shown()
  assert.deepEqual(opening.prop, { itemId: 'canned_food', hand: 'left' })
  await shot('ax3-open-tin')
  await page.waitForFunction(() => window.__runtime.actionPresentation?.group === 'eat' && window.__runtime.actionPresentation.progress > 0.3, null, { timeout: 10000 })
  const eating = await shown()
  assert.deepEqual(eating.prop, { itemId: 'canned_food_open', hand: 'right' })
  await shot('ax3-eat-tin')
  await idle()
  log('open then eat', { opening: opening.group, eating: eating.group, hunger: await rt(() => Math.round(window.__runtime.player.hunger)) })

  // 3) Bandage: the roll in the left hand, the head down; a step cancels it and nothing is used.
  await menuPick('inventory', 'Băng gạc', 'Băng bó / sơ cứu')
  await page.waitForFunction(() => window.__runtime.actionPresentation?.progress > 0.4, null, { timeout: 10000 })
  const bandaging = await shown()
  assert.equal(bandaging.group, 'medical')
  assert.deepEqual(bandaging.prop, { itemId: 'bandage', hand: 'left' })
  await shot('ax3-bandage')
  const before = await rt(() => ({ health: window.__runtime.player.health, n: window.__runtime.player.inventory.items.find((i) => i.itemId === 'bandage').quantity }))
  await page.mouse.move(960, 300)
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(250)
  await page.keyboard.up('KeyW')
  await idle()
  const after = await rt(() => ({ health: window.__runtime.player.health, n: window.__runtime.player.inventory.items.find((i) => i.itemId === 'bandage').quantity, shown: window.__runtime.actionPresentation }))
  assert.deepEqual({ health: after.health, n: after.n, shown: after.shown }, { health: before.health, n: before.n, shown: null })
  log('bandage cancelled by a step', { before, after })

  // 4) The bat is back in the hand, never unequipped.
  assert.equal(await rt(() => window.__runtime.player.equipment.weaponInstanceId), 'player:ax3-bat')
  await rt(() => window.__runtime.setInventoryOpen(false))
  await page.waitForTimeout(300)
  await shot('ax3-after')

  assert.deepEqual(errors, [])
  log('PASS', 'drink, open then eat, bandage + cancel, weapon put away and back, screenshots')
} catch (e) {
  await shot('ax3-failure').catch(() => {})
  console.error(e)
  console.error('page errors', errors)
  process.exitCode = 1
} finally {
  await browser.close()
}
