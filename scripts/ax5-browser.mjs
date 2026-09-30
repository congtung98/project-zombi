// AX5 browser check (Playwright, fresh context, dev server, Chrome with the GPU), real mouse: a right
// click on a cupboard opens its context menu next to the pointer (no stance, the held button stays
// out); Esc closes it; "Mở" opens the cupboard; a door's menu toggles it; a right click on a zombie
// takes the stance against it (red ring) and a left click swings; a right click on the floor is the
// stance as before. Screenshots in docs/character-action/.
//   GPU=1 BASE_URL=http://localhost:5199 PLAYWRIGHT_MODULE=file:///…/playwright/index.mjs node scripts/ax5-browser.mjs
import { mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'

const base = process.env.BASE_URL ?? 'http://localhost:5199'
const gpu = process.env.GPU === '1'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({
  executablePath: gpu ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : process.env.CHROMIUM_PATH || undefined,
  args: gpu ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } })
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
const menu = page.locator('[data-world-menu]')

async function standBy(kind, rad, filter = null) {
  const found = await rt(({ kind, rad, filter }) => {
    const r = window.__runtime
    for (const z of [...r.zombies.values()]) r.zombies.delete(z.id)
    r.closeAllUi()
    r.closeWorldMenu()
    for (const target of r.interactables.filter((i) => i.kind === kind && (!filter || i.id.includes(filter)) && i.position.y < 2)) {
      const p = target.position
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2
        const x = p.x + Math.cos(a) * rad
        const z = p.z + Math.sin(a) * rad
        if (!r.nav.isWalkable(x, z) || r.isBlocked({ x, y: 1, z }, { x: p.x, y: 1, z: p.z }, [target.id])) continue
        r.player.position = { x, y: 0, z }
        r.playerBody?.setTranslation({ x, y: r.config.player.height / 2 + 0.02, z }, true)
        r.cameraZoom = 64
        return target.id
      }
    }
    return null
  }, { kind, rad, filter })
  assert.ok(found, `a ${kind} to stand by`)
  await page.waitForTimeout(400)
  return found
}

/** Move the real mouse until the cursor picks `kind`/`id`; returns where. */
async function hover(test) {
  for (let step = 70; step >= 20; step -= 25) {
    for (let y = 200; y <= 750; y += step) {
      for (let x = 400; x <= 1200; x += step) {
        await page.mouse.move(x, y)
        await page.waitForTimeout(34)
        const t = await rt(() => window.__runtime.pointerTarget)
        if (t && test(t)) return { x, y }
      }
    }
  }
  throw new Error('the cursor never picked the target')
}
const rightClick = async (at) => {
  await page.mouse.move(at.x, at.y)
  await page.mouse.down({ button: 'right' })
  await page.waitForTimeout(250)
  await page.mouse.up({ button: 'right' })
}

try {
  await page.goto(base)
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 30000 })
  await button('New Game').click()
  await hasText('Tạo nhân vật')
  await button('Bắt đầu').click()
  await page.waitForFunction(() => !document.querySelector('h1') && !document.body.innerText.includes('Đang tải…') && document.querySelector('.hud'), null, { timeout: 60000 })
  await page.waitForTimeout(500)

  // 1) Right click (held a moment) on a cupboard: its menu at the pointer, no stance.
  const cupboard = await standBy('container', 1.0, 'kitchen')
  const at = await hover((t) => t.kind === 'object' && t.id === cupboard)
  await rightClick(at)
  await menu.waitFor()
  const box = await menu.boundingBox()
  assert.ok(Math.abs(box.x - at.x) < 40 && Math.abs(box.y - at.y) < 40, `menu next to the pointer: ${JSON.stringify(box)} vs ${JSON.stringify(at)}`)
  assert.equal(await rt(() => window.__runtime.stance.requested), false, 'a right click on an object is not the stance')
  const entries = await menu.locator('.inv-menu-item').allInnerTexts()
  assert.ok(entries[0].startsWith('Mở') || entries[0].startsWith('Xem'), entries.join(' | '))
  assert.ok(entries.some((e) => e.startsWith('Lấy hết')))
  await shot('ax5-container-menu')
  log('cupboard menu', entries)

  // 2) Esc closes the menu first (not the game's pause).
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => document.body.innerText.includes('Tạm dừng')), false)

  // 3) Menu → Mở: OPEN_CONTAINER, the loot window after its short action.
  await rightClick(at)
  await menu.waitFor()
  await menu.locator('.inv-menu-item').first().click()
  await page.waitForFunction((id) => window.__runtime.openContainerId === id, cupboard, { timeout: 5000 })
  log('menu → open', cupboard)

  // 4) A door's menu toggles it.
  const door = await standBy('door', 1.2)
  const doorAt = await hover((t) => t.kind === 'object' && t.id === door)
  const before = await rt((id) => window.__runtime.world.doors.get(id).state, door)
  await rightClick(doorAt)
  await menu.waitFor()
  await shot('ax5-door-menu')
  await menu.locator('.inv-menu-item').first().click()
  await page.waitForFunction(({ id, before }) => window.__runtime.world.doors.get(id).state !== before, { id: door, before }, { timeout: 3000 })
  log('door menu', { door, before })

  // 5) A zombie right-clicked: the stance against it (red ring), a left click swings.
  await rt(() => {
    const r = window.__runtime
    r.player.inventory.items.push({ id: 'player:ax5-bat', itemId: 'baseball_bat', kind: 'weapon', quantity: 1, condition: 80 })
    r.equipItem('player:ax5-bat')
    r.closeAllUi()
    const p = r.player.position
    const spot = [[1.3, 0], [-1.3, 0], [0, 1.3], [0, -1.3]].map(([dx, dz]) => ({ x: p.x + dx, y: p.y, z: p.z + dz })).find((q) => r.nav.isWalkable(q.x, q.z))
    const z = r.spawnZombie(spot)
    z.staggerTimer = 1e6
    // spawnZombie is the tests' helper: tell the view like the game's own spawner does.
    r.events.queue('zombie:spawned', { id: z.id })
  })
  await page.waitForTimeout(300)
  const zAt = await hover((t) => t.kind === 'character')
  await page.mouse.move(zAt.x, zAt.y)
  await page.mouse.down({ button: 'right' })
  await page.waitForFunction(() => window.__runtime.stance.requested && window.__runtime.combatTarget !== null, null, { timeout: 3000 })
  await page.waitForTimeout(300)
  await shot('ax5-zombie-target')
  await page.mouse.click(zAt.x, zAt.y)
  await page.waitForFunction(() => window.__runtime.player.attackTimer >= 0, null, { timeout: 2000 })
  await page.mouse.up({ button: 'right' })
  log('zombie right click', 'stance with target, swing')

  // 6) The floor: the stance as before.
  await rt(() => { for (const z of [...window.__runtime.zombies.values()]) window.__runtime.zombies.delete(z.id) })
  await page.waitForTimeout(600)
  const floorAt = await hover((t) => t.kind === 'ground')
  await page.mouse.move(floorAt.x, floorAt.y)
  await page.mouse.down({ button: 'right' })
  await page.waitForFunction(() => window.__runtime.stance.requested && window.__runtime.combatTarget === null, null, { timeout: 2000 })
  await page.mouse.up({ button: 'right' })
  assert.equal(await menu.count(), 0)

  assert.deepEqual(errors, [])
  log('PASS', 'object menu at the pointer (no stance), Esc, menu open, door menu, zombie target + swing, floor stance')
} catch (e) {
  await shot('ax5-failure').catch(() => {})
  console.error(e)
  console.error('page errors', errors)
  process.exitCode = 1
} finally {
  await browser.close()
}
