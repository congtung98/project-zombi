// INV-LOOT S3 browser check (Playwright, fresh context, dev server, Chrome with the GPU): sample containers
// (kitchen, wardrobe, nightstand, tool shelf), loot tabs of the containers in reach (a new one never
// takes the shown tab), out of reach shown instead of closing, floor drop / pick-up with the real
// positions, E on nothing opens the floor, a worn backpack with items: take off, drop, save,
// Continue, pick up, wear, contents kept, the floor never duplicated.
//   GPU=1 BASE_URL=http://localhost:5199 PLAYWRIGHT_MODULE=file:///…/playwright/index.mjs node scripts/il-s3-browser.mjs
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
mkdirSync('docs/inventory-loot/s3', { recursive: true })
const shot = (name) => page.screenshot({ path: `docs/inventory-loot/s3/${name}.png` })
const log = (label, value) => console.log(label.padEnd(34), typeof value === 'string' ? value : JSON.stringify(value))
const hasText = (text, timeout = 15000) => page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout })
const button = (name) => page.getByRole('button', { name, exact: true })
const rt = (fn, arg) => page.evaluate(fn, arg)
const win = (id) => page.locator(`[data-inv-window="${id}"]`)
const rows = (id) => win(id).locator('.inv-row')

async function menu() {
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 30000 })
}
async function inGame() {
  await page.waitForFunction(() => !document.querySelector('h1') && !document.body.innerText.includes('Đang tải…') && document.querySelector('.hud'), null, { timeout: 60000 })
  await page.waitForTimeout(500)
}
async function pauseGame() {
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Escape')
    try { await hasText('Tạm dừng', 700); return } catch { /* a window closed instead */ }
  }
  throw new Error('pause menu did not open')
}
/** Stand at a walkable spot in reach of the container (no wall between) and press nothing yet. */
async function standAt(id) {
  return rt((id) => {
    const r = window.__runtime
    const target = r.interactables.find((i) => i.id === id)
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
        return true
      }
    }
    return false
  }, id)
}
const teleport = (x, z) => rt(([x, z]) => {
  const r = window.__runtime
  r.player.position = { x, y: 0, z }
  r.playerBody?.setTranslation({ x, y: r.config.player.height / 2 + 0.02, z }, true)
}, [x, z])
const waitNearby = () => page.waitForTimeout(400)

try {
  await page.goto(base)
  await menu()
  await button('New Game').click()
  await hasText('Tạo nhân vật')
  await button('Bắt đầu').click()
  await inGame()

  // 1) The four sample containers open in the loot window with their real items.
  const samples = {}
  for (const table of ['house-kitchen', 'house-wardrobe', 'house-nightstand', 'tool-shelf']) {
    const id = await rt((t) => window.__runtime.map.containers.find((c) => c.loot === t && window.__runtime.world.containers.get(c.id).items.items.length > 0)?.id ?? window.__runtime.map.containers.find((c) => c.loot === t).id, table)
    assert.ok(await standAt(id), `reach ${id}`)
    const name = await rt((id) => window.__runtime.interactables.find((i) => i.id === id).name, id)
    await rt((id) => window.__runtime.interact(window.__runtime.interactables.find((i) => i.id === id)), id)
    await win('loot').waitFor()
    await page.waitForFunction((n) => document.querySelector('[data-inv-window="loot"] .inv-tab[aria-selected="true"]')?.textContent.startsWith(n), name)
    const shown = await rows('loot').count()
    const real = await rt((id) => window.__runtime.world.containers.get(id).items.items.length, id)
    assert.ok(shown >= 1 || real === 0)
    samples[table] = { id, items: real, tab: await win('loot').locator('.inv-tab[aria-selected="true"]').innerText() }
    if (table === 'house-kitchen') await shot('loot-kitchen')
    await rt(() => window.__runtime.closeContainer())
  }
  log('sample containers', samples)

  // 2) Two containers in reach: both are tabs with the floor; a container coming in reach keeps the tab.
  // Two containers side by side and a spot reaching both, by the runtime's own reach rule (range, storey, walls).
  const pair = await rt(() => {
    const r = window.__runtime
    const cs = r.map.containers
    for (const c1 of cs) for (const c2 of cs) {
      if (c1.id >= c2.id || Math.hypot(c1.position.x - c2.position.x, c1.position.z - c2.position.z) > 1.6 || Math.abs(c1.position.y - c2.position.y) > 0.5) continue
      const [a, b] = [c1, c2].map((c) => r.interactables.find((i) => i.id === c.id).position)
      for (const rad of [0.6, 0.8, 1, 1.2]) for (let k = 0; k < 24; k++) {
        const ang = (k / 24) * Math.PI * 2
        const x = (a.x + b.x) / 2 + Math.cos(ang) * rad
        const z = (a.z + b.z) / 2 + Math.sin(ang) * rad
        if (!r.nav.isWalkable(x, z)) continue
        r.player.position = { x, y: Math.max(0, Math.round((a.y - 0.5) / 2.9) * 2.9), z }
        r.refreshNearby()
        if (r.nearbyContainerIds.includes(c1.id) && r.nearbyContainerIds.includes(c2.id)) {
          r.playerBody?.setTranslation({ x, y: r.player.position.y + r.config.player.height / 2 + 0.02, z }, true)
          return [c1.id, c2.id]
        }
      }
    }
    return null
  })
  assert.ok(pair, 'two containers side by side, both in reach from one spot')
  await rt((id) => window.__runtime.interact(window.__runtime.interactables.find((i) => i.id === id)), pair[0])
  await waitNearby()
  const tabs = await win('loot').locator('.inv-tab').allInnerTexts()
  log('loot tabs', tabs)
  assert.ok(tabs[0].startsWith('Dưới đất'), 'floor tab first')
  assert.equal(tabs.length, 3, 'floor and both containers')
  assert.equal(await rt(() => window.__runtime.openContainerId), pair[0], 'the shown tab stays')
  const otherTab = await rt((ids) => window.__runtime.nearbyContainerIds.indexOf(ids[1]) + 1, pair)
  await win('loot').locator('.inv-tab').nth(otherTab).click()
  await page.waitForFunction((id) => window.__runtime.openContainerId === id, pair[1])
  assert.equal(await rt((id) => window.__runtime.world.containers.get(id).opened, pair[1]), true, 'looking into it opens it')
  await shot('loot-tabs')

  // 3) Walking away keeps the window: "Ngoài tầm", nothing can be taken; back in reach it works again.
  const here = await rt(() => ({ ...window.__runtime.player.position }))
  await teleport(here.x + 6, here.z + 6)
  await hasText('Ngoài tầm')
  assert.equal(await win('loot').getByRole('button', { name: 'Lấy hết' }).isDisabled(), true)
  await shot('loot-out-of-reach')
  await rt((p) => { const r = window.__runtime; r.player.position = p; r.playerBody?.setTranslation({ x: p.x, y: p.y + r.config.player.height / 2 + 0.02, z: p.z }, true) }, here)
  await page.waitForFunction(() => window.__runtime.lootInReach)
  log('out of reach', 'shown and disabled, back in reach enabled')
  await rt(() => window.__runtime.closeAllUi())

  // 4) A worn backpack with items (injected like loot): wear by menu, move items in, take off, drop.
  const spot = await rt(() => {
    const r = window.__runtime
    const p = r.map.playerSpawn
    for (let d = 0; d < 30; d += 1) for (const [dx, dz] of [[d, 0], [0, d], [-d, 0], [0, -d]]) {
      const x = p.x + dx
      const z = p.z + dz
      if (r.nav.isWalkable(x, z) && r.nav.isWalkable(x + 1, z) && !r.interactables.some((i) => Math.hypot(i.position.x - x, i.position.z - z) < 3)) return { x, z }
    }
    return null
  })
  assert.ok(spot, 'an open spot with nothing to interact with')
  await teleport(spot.x, spot.z)
  // This part checks the bag and the floor, not combat: zombies near the spot are removed so a hit never
  // cancels the (timed) transfers; interruptions are covered by actionQueue.test.ts and il-s4-browser.mjs.
  const clearZombies = () => rt(() => {
    const r = window.__runtime
    for (const z of [...r.zombies.values()]) if (Math.hypot(z.position.x - r.player.position.x, z.position.z - r.player.position.z) < 40) r.removeZombie(z.id)
  })
  await clearZombies()
  const bagId = await rt(() => {
    const r = window.__runtime
    const inv = r.player.inventory
    const id = 'test:pack'
    inv.items.push({ id, itemId: 'backpack', kind: 'bag', quantity: 1 }, { id: 'test:plank', itemId: 'wood_plank', kind: 'stack', quantity: 3 }, { id: 'test:water', itemId: 'water', kind: 'stack', quantity: 2 })
    r.world.bags.set(id, { id: `bag:${id}`, kind: 'bag', nextItemId: 1, items: [], slotCapacity: 8 })
    r.toggleInventory()
    return id
  })
  await win('inventory').waitFor()
  await rows('inventory').filter({ hasText: 'Balo' }).click({ button: 'right' })
  await page.locator('.inv-menu').getByRole('menuitem', { name: 'Đeo balo' }).click()
  await win('inventory').getByRole('tab', { name: /Balo đang đeo/ }).waitFor()
  for (const name of ['Ván gỗ', 'Nước']) {
    await rows('inventory').filter({ hasText: name }).click({ button: 'right' })
    await page.locator('.inv-menu').getByRole('menuitem', { name: /Chuyển vào Balo đang đeo/ }).click()
    await page.waitForFunction((n) => ![...document.querySelectorAll('[data-inv-window="inventory"] .inv-row .inv-name')].some((x) => x.textContent === n), name)
  }
  await win('inventory').getByRole('tab', { name: /Balo đang đeo/ }).click()
  assert.deepEqual((await rows('inventory').locator('.inv-name').allInnerTexts()).sort(), ['Nước', 'Ván gỗ'])
  await shot('backpack-worn-contents')
  await win('inventory').getByRole('tab', { name: /Túi chính/ }).click()
  // Worn: dropping is refused with the reason; take it off first.
  await rows('inventory').filter({ hasText: 'Balo' }).click({ button: 'right' })
  assert.equal(await page.locator('.inv-menu-item', { hasText: 'Bỏ xuống đất' }).isDisabled(), true)
  await page.locator('.inv-menu').getByRole('menuitem', { name: 'Tháo balo' }).click()
  await page.waitForFunction(() => !window.__runtime.player.equipment.backInstanceId)
  await rows('inventory').filter({ hasText: 'Balo' }).click({ button: 'right' })
  await page.locator('.inv-menu').getByRole('menuitem', { name: 'Bỏ xuống đất' }).click()
  await page.waitForFunction((id) => window.__runtime.world.floor.find(id) !== null, bagId)
  const dropped = await rt((id) => window.__runtime.world.floor.find(id).position, bagId)
  log('backpack on the floor', dropped)

  // 5) E on nothing opens the floor; the backpack is listed there.
  await page.keyboard.press('KeyI') // inventory closed: E opens both
  await waitNearby()
  await page.keyboard.press('KeyE')
  await win('loot').waitFor()
  assert.match(await win('loot').locator('.inv-tab[aria-selected="true"]').innerText(), /Dưới đất/)
  assert.deepEqual(await rows('loot').locator('.inv-name').allInnerTexts(), ['Balo'])
  await shot('floor-tab')

  // 6) Save, Continue: one floor item, one bag record; pick up by double click, wear: contents kept.
  await pauseGame()
  await button('Lưu và về menu').click()
  await menu()
  await page.reload()
  await menu()
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some((b) => b.textContent.trim() === 'Continue' && !b.disabled), null, { timeout: 30000 })
  await button('Continue').click()
  await inGame()
  const after = await rt(() => ({ floor: window.__runtime.world.floor.entries().map((e) => e.item.id), bags: [...window.__runtime.world.bags.keys()] }))
  assert.deepEqual(after.floor, [bagId], 'one floor item after reload')
  assert.ok(after.bags.includes(bagId))
  await waitNearby()
  await page.keyboard.press('KeyE')
  await win('loot').waitFor()
  // Picking up a heavy bag takes ~1.4 s; a zombie's hit cancels it (INV-LOOT §8.4): pick it up again, like a player.
  await clearZombies()
  for (let attempt = 0; attempt < 6; attempt++) {
    await rows('loot').filter({ hasText: 'Balo' }).dblclick()
    await page.waitForFunction(() => window.__runtime.jobs.length === 0, null, { timeout: 15000 })
    if (await rt((id) => window.__runtime.world.floor.find(id) === null, bagId)) break
    log('pick-up interrupted', `attempt ${attempt + 1}`)
  }
  assert.equal(await rt((id) => window.__runtime.world.floor.find(id), bagId), null, 'picked up')
  await rt((id) => window.__runtime.wearBag(id), bagId)
  const contents = await rt((id) => window.__runtime.world.bags.get(id).items.map((i) => `${i.itemId}x${i.quantity}`).sort(), bagId)
  assert.deepEqual(contents, ['waterx2', 'wood_plankx3'])
  log('backpack after save + pick-up', contents)
  await shot('backpack-picked-up')

  assert.equal(errors.length, 0, JSON.stringify(errors))
  log('PASS', 'sample containers, tabs, out of reach, drop/pick-up with positions, E floor, bag lifecycle through save')
} finally {
  await browser.close()
}
