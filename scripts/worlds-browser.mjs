// World menu browser check with Playwright (fresh isolated context, dev server: it reads the game
// through window.__runtime).
//   BASE_URL=http://127.0.0.1:5174 node scripts/worlds-browser.mjs
// Set PLAYWRIGHT_MODULE (file:// URL of playwright/index.mjs) and CHROMIUM_PATH when needed.
// Covers: a world written by `npm run map:generate` (same folder as `map:unpack`) shows in the main
// menu next to the neighbourhood (dev also lists the hidden lab world); picking it reloads the game
// on it with its own save slot; the choice survives a reload; `?world=` overrides it for one visit;
// switching back continues the neighbourhood save; a stored world that no longer exists falls back
// to the neighbourhood with a notice (shown once: the stale choice is forgotten).
// Writes a temporary world to content/maps/worlds-browser-test and removes it at the end.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
const tmp = 'node_modules/.tmp'
mkdirSync(tmp, { recursive: true })
const shot = (name) => page.screenshot({ path: `${tmp}/${name}.png` })
const log = (label, value) => console.log(label.padEnd(30), typeof value === 'string' ? value : JSON.stringify(value))
const TEST_WORLD = 'worlds-browser-test'
const HOME = 'neighborhood-50'
const until = (fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout })
const button = (name) => page.getByRole('button', { name, exact: true })

async function menu() {
  await until(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, 30000)
}
async function current() {
  await until(() => document.querySelector('[data-current-world]'))
  return page.evaluate(() => ({
    menu: document.querySelector('[data-current-world]').getAttribute('data-current-world'),
    runtime: window.__runtime.map.id,
    stored: localStorage.getItem('zombie-outbreak.world'),
    url: location.search,
    notice: document.querySelector('[data-world-notice]')?.textContent ?? null,
  }))
}
async function newGame() {
  await button('New Game').click()
  await until(() => document.body.innerText.includes('Tạo nhân vật'))
  await button('Bắt đầu').click()
  await until(() => !document.querySelector('h1') && document.querySelector('.hud'), null, 30000)
  await page.waitForTimeout(800)
}
async function saveToMenu() {
  for (let i = 0; i < 3 && !(await page.evaluate(() => document.body.innerText.includes('Tạm dừng'))); i++) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
  await button('Lưu và về menu').click()
  await menu()
}
async function worldList() {
  await page.locator('[data-open-worlds]').click()
  await until(() => document.querySelectorAll('[data-world]').length > 0 && !document.querySelector('[data-world-save="unknown"]'))
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-world]')].map((li) => ({
      id: li.getAttribute('data-world'),
      text: li.innerText.replace(/\s+/g, ' '),
      save: li.querySelector('[data-world-save]').getAttribute('data-world-save'),
      current: li.classList.contains('current'),
    })),
  )
}
async function choose(worldId) {
  await Promise.all([page.waitForEvent('load'), page.locator(`[data-choose-world="${worldId}"]`).click()])
  await menu()
}
const saveKeys = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('zombie-outbreak', 1)
        req.onsuccess = () => {
          const r = req.result.transaction('saves', 'readonly').objectStore('saves').getAllKeys()
          r.onsuccess = () => resolve(r.result)
        }
        req.onerror = () => resolve([])
      }),
  )

try {
  const out = execFileSync(process.execPath, ['scripts/map-tools/generate.ts', '--seed', '5', '--blocks', '2x2', '--world-id', TEST_WORLD, '--force'], { encoding: 'utf8' })
  log('map:generate', out.trim().split('\n')[0])
  await page.waitForTimeout(1500)

  // 1. Default: the neighbourhood; the menu offers the new world and (dev) the hidden lab.
  await page.goto(base).catch(() => page.goto(base))
  await menu()
  let c = await current()
  assert.deepEqual([c.menu, c.runtime, c.stored, c.notice], [HOME, HOME, null, null])
  await newGame()
  await saveToMenu()
  let list = await worldList()
  await shot('worlds-list')
  log('world list', list.map((w) => `${w.id}${w.current ? '*' : ''} [${w.save}]`).join(', '))
  assert.equal(list[0].id, HOME)
  assert.ok(list[0].current && list[0].save === 'ready', JSON.stringify(list[0]))
  const test = list.find((w) => w.id === TEST_WORLD)
  assert.ok(test && test.save === 'empty' && !test.current && /\d+ × \d+ m/.test(test.text), JSON.stringify(test))
  assert.ok(list.find((w) => w.id === 'neighborhood-50-lab')?.text.includes('ẩn'))

  // 2. Pick the generated world: reload on it, own empty slot, choice stored, no URL parameter.
  await choose(TEST_WORLD)
  c = await current()
  assert.deepEqual([c.menu, c.runtime, c.stored, c.url], [TEST_WORLD, TEST_WORLD, TEST_WORLD, ''])
  assert.ok(await page.evaluate(() => document.body.innerText.includes('Chưa có bản lưu.')))
  await newGame()
  await saveToMenu()
  const keys = await saveKeys()
  assert.ok(keys.includes('slot-1') && keys.includes(`slot-world-${TEST_WORLD}`), JSON.stringify(keys))
  log('save slots', keys)

  // 3. The choice survives a reload; `?world=` overrides it for one visit only.
  await page.reload()
  await menu()
  assert.equal((await current()).runtime, TEST_WORLD)
  await page.goto(`${base}/?world=${HOME}`)
  await menu()
  c = await current()
  assert.deepEqual([c.runtime, c.stored], [HOME, TEST_WORLD])
  await page.goto(base)
  await menu()
  assert.equal((await current()).runtime, TEST_WORLD)
  list = await worldList()
  assert.ok([HOME, TEST_WORLD].every((id) => list.find((w) => w.id === id)?.save === 'ready'), JSON.stringify(list))

  // 4. Back to the neighbourhood: stored choice cleared, its save continues.
  await choose(HOME)
  c = await current()
  assert.deepEqual([c.runtime, c.stored], [HOME, null])
  await until(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Continue' && !b.disabled))
  await button('Continue').click()
  await until(() => !document.querySelector('h1') && document.querySelector('.hud'), null, 30000)
  assert.equal(await page.evaluate(() => window.__runtime.map.id), HOME)
  log('switch back', 'neighbourhood save continued')

  // 5. A stored world that is gone: neighbourhood + notice, never a blank page.
  await page.evaluate(() => localStorage.setItem('zombie-outbreak.world', 'deleted-town'))
  await page.goto(base)
  await menu()
  c = await current()
  assert.equal(c.runtime, HOME)
  assert.ok(c.notice?.includes('deleted-town') && c.stored === null, JSON.stringify(c))
  await shot('worlds-notice')
  log('missing world', c.notice)

  assert.deepEqual(errors, [])
  console.log('PASS')
} catch (e) {
  await shot('worlds-failure').catch(() => {})
  console.log('errors:', errors)
  throw e
} finally {
  rmSync(`content/maps/${TEST_WORLD}`, { recursive: true, force: true })
  await browser.close()
}
