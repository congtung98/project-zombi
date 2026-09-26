// Map editor M8 (content migrations for saves) browser check with Playwright (fresh isolated
// context, dev server only: it reads the editor store through window.__editor and the game
// through window.__runtime).
//   BASE_URL=http://127.0.0.1:5174 node scripts/m8-editor-browser.mjs
// Set PLAYWRIGHT_MODULE (file:// URL of playwright/index.mjs) and CHROMIUM_PATH when needed.
// Covers: a copy of the neighbourhood (`map:unpack --world-id`) played and saved for real
// (IndexedDB, content v1) → in the editor: a house added, the scrap pile deleted, a prefab lamp
// renamed, Save compatibility panel (diff, suggested rename) → "Tạo migration" (content v2) →
// Export → `map:unpack --force` → Continue in the game: the save is migrated (lamp state kept
// under its new ID, door state kept, scrap items on the ground, new house in its initial state),
// the original kept as a content backup, the toast shown.
// Writes a temporary world to content/maps/m8-browser-test and removes it at the end.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const context = await browser.newContext({ viewport: { width: 1400, height: 850 }, acceptDownloads: true })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('dialog', (d) => d.accept())
const tmp = 'node_modules/.tmp'
mkdirSync(tmp, { recursive: true })
const shot = (name) => page.screenshot({ path: `${tmp}/${name}.png` })
const log = (label, value) => console.log(label.padEnd(34), typeof value === 'string' ? value : JSON.stringify(value))
const node = (args) => execFileSync(process.execPath, args, { encoding: 'utf8' }).trim().split('\n')[0]
const TEST_WORLD = 'm8-browser-test'
const SLOT = `slot-world-${TEST_WORLD}`
const LAMP = 'c0_0/house/lamp-living'
const LAMP_NEW = 'c0_0/house/lamp-lounge'
const DOOR = 'c0_0/house/door'
const SCRAP = 'c0_0/objects/house-scrap'

const until = (fn, arg, timeout = 10000) => page.waitForFunction(fn, arg, { timeout })
const hasText = (text, timeout = 10000) => until((t) => document.body.innerText.includes(t), text, timeout)
const button = (name) => page.getByRole('button', { name, exact: true })
const frame = () => page.waitForTimeout(150)
const menu = () => until(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, 30000)
const inGame = async () => {
  await until(() => !document.querySelector('h1') && !document.body.innerText.includes('Đang tải…') && document.querySelector('.hud'), null, 30000)
  await page.waitForTimeout(500)
}
async function pause() {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape')
    try {
      await hasText('Tạm dừng', 1000)
      return
    } catch {
      // a panel closed instead
    }
  }
  throw new Error('Pause menu did not open')
}
const readSlot = (key) =>
  page.evaluate(
    (key) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('zombie-outbreak', 1)
        req.onsuccess = () => {
          const db = req.result
          const read = db.transaction('saves').objectStore('saves').get(key)
          read.onsuccess = () => {
            resolve(read.result)
            db.close()
          }
          read.onerror = () => reject(read.error)
        }
        req.onerror = () => reject(req.error)
      }),
    key,
  )
const editor = () =>
  page.evaluate(() => {
    const s = window.__editor.getState()
    return {
      worldId: s.edit?.doc.world.worldId,
      contentVersion: s.edit?.doc.world.contentVersion,
      selection: s.edit?.selection ?? [],
      errors: s.issues.filter((i) => i.severity === 'error').map((i) => i.code),
      warnings: s.issues.filter((i) => i.severity === 'warning').map((i) => i.code),
      extras: s.edit ? [...s.edit.doc.extras.keys()] : [],
      prefabMode: s.prefabMode,
    }
  })
const screen = (x, z) =>
  page.evaluate(
    ([x, z]) => {
      const s = window.__editorThree()
      const v = s.camera.position.clone().set(x, 0, z).project(s.camera)
      const r = s.gl.domElement.getBoundingClientRect()
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
    },
    [x, z],
  )

try {
  // 0. A copy of the neighbourhood as its own world (content v1, no migrations).
  node(['scripts/map-tools/pack.ts', 'content/maps/neighborhood-50', `${tmp}/m8-source.mappack.json`])
  log('fork', node(['scripts/map-tools/unpack.ts', `${tmp}/m8-source.mappack.json`, '--world-id', TEST_WORLD, '--name', 'Thử M8']))
  await page.waitForTimeout(1500)

  // 1. Play content v1 and save for real: lamp on, door open, scrap pile loot noted.
  await page.goto(`${base}/?world=${TEST_WORLD}`)
  await menu()
  await button('New Game').click()
  await hasText('Tạo nhân vật')
  await button('Bắt đầu').click()
  await inGame()
  const v1 = await page.evaluate(
    ([lamp, door, scrap]) => {
      const rt = window.__runtime
      rt.world.lamps.set(lamp, true)
      rt.setDoorState(door, 'open')
      return { contentVersion: rt.map.contentVersion, scrap: rt.world.containers.get(scrap).items.slots.filter(Boolean).map((i) => i.id) }
    },
    [LAMP, DOOR, SCRAP],
  )
  assert.equal(v1.contentVersion, 1)
  assert.ok(v1.scrap.length > 0)
  await pause()
  await button('Lưu và về menu').click()
  await menu()
  const saved = await readSlot(SLOT)
  assert.equal(saved.contentVersion, 1)
  log('played + saved content v1', `lamp on, door open, scrap items ${v1.scrap.join(', ')}`)

  // 2. Editor: open the world, make stateful changes.
  await page.goto(`${base}/editor.html`)
  await until(() => window.__editor?.getState().status?.text.includes('Đã mở'), null, 30000)
  await button('Mở…').click()
  await page.locator('.modal button', { hasText: TEST_WORLD }).first().click()
  await until((id) => window.__editor.getState().edit?.doc.world.worldId === id, TEST_WORLD)
  await page.waitForTimeout(400)
  assert.match(await page.locator('[data-save-compat]').innerText(), /save cũ nạp bình thường/)

  // A new house from the palette, at the first spot without errors.
  let placed = null
  for (const at of [{ x: 8, z: 14 }, { x: -6, z: 16 }, { x: 16, z: -8 }, { x: 6, z: 4 }]) {
    await page.locator('[data-prefab="building/house"]').click()
    const p = await screen(at.x, at.z)
    await page.mouse.move(p.x, p.y)
    await frame()
    await page.mouse.click(p.x, p.y)
    await page.keyboard.press('Escape')
    await frame()
    const s = await editor()
    if (s.errors.length === 0 && s.selection[0]?.includes('house-')) {
      placed = s.selection[0]
      break
    }
    await page.keyboard.press('Control+z')
  }
  assert.ok(placed, 'house placed')
  await page.evaluate((id) => window.__editor.getState().select([id]), SCRAP)
  await frame()
  await page.keyboard.press('Delete')
  // Rename the living-room lamp in the source prefab (a stateful rename: confirmed).
  await page.evaluate(() => window.__editor.getState().select(['c0_0/house']))
  await frame()
  await page.locator('[data-open-prefab]').click()
  await page.evaluate(() => window.__editor.getState().select(['lamp-living']))
  await frame()
  const localId = page.locator('.inspector label.field', { hasText: /^Local ID$/ }).locator('input')
  await localId.fill('lamp-lounge')
  await localId.press('Enter')
  await frame()
  await page.locator('[data-exit-prefab]').click()
  await page.evaluate(() => window.__editor.getState().select([]))
  await frame()
  let s = await editor()
  assert.ok(s.warnings.includes('content-changed-same-version'), JSON.stringify(s.warnings))
  const compat = await page.locator('[data-save-compat]').innerText()
  assert.match(compat, /house-scrap/)
  assert.equal(await page.locator(`[data-compat-rename="${LAMP}"]`).inputValue(), LAMP_NEW)
  await page.screenshot({ path: `${tmp}/m8-compat.png`, fullPage: false })
  await page.locator('[data-create-migration]').click()
  s = await editor()
  assert.equal(s.contentVersion, 2)
  assert.ok(s.extras.includes('migrations/content-v1.json'), JSON.stringify(s.extras))
  assert.ok(!s.warnings.includes('content-changed-same-version'))
  assert.deepEqual(s.errors, [])
  await page.locator('[data-compat-file]').waitFor()
  await shot('m8-migration')
  log('editor migration', `house ${placed}, scrap deleted, ${LAMP} → ${LAMP_NEW}; content v2 + migrations/content-v1.json`)

  // 3. Export → unpack over the world.
  const [dl] = await Promise.all([page.waitForEvent('download'), button('Export').click()])
  const packPath = `${tmp}/${TEST_WORLD}.mappack.json`
  await dl.saveAs(packPath)
  log('map:unpack --force', node(['scripts/map-tools/unpack.ts', packPath, '--force']))
  await page.waitForTimeout(1500)

  // 4. Continue: migrated save.
  await page.goto(`${base}/?world=${TEST_WORLD}`)
  await menu()
  await until(() => window.__runtime?.map.contentVersion === 2, null, 15000)
  await hasText('Bản lưu:')
  await button('Continue').click()
  await inGame()
  const toast = await page.locator('.hud-toast').innerText()
  assert.match(toast, /nội dung v1 → v2/)
  const game = await page.evaluate(
    ([lamp, lampOld, door, scrap, house, items]) => {
      const rt = window.__runtime
      return {
        contentVersion: rt.map.contentVersion,
        lamp: rt.world.lamps.get(lamp),
        oldLamp: rt.world.lamps.has(lampOld),
        door: rt.world.doors.get(door).state,
        scrap: rt.world.containers.has(scrap),
        bags: items.map((id) => rt.world.containers.get(`drop:${id}`)?.items.slots[0]?.id ?? null),
        houseDoor: rt.world.doors.get(`${house}/door`)?.state ?? null,
        houseLamp: rt.world.lamps.get(`${house}/lamp-lounge`),
      }
    },
    [LAMP_NEW, LAMP, DOOR, SCRAP, placed, v1.scrap],
  )
  assert.deepEqual(game, { contentVersion: 2, lamp: true, oldLamp: false, door: 'open', scrap: false, bags: v1.scrap, houseDoor: 'closed', houseLamp: false })
  const slot = await readSlot(SLOT)
  const backup = await readSlot(`${SLOT}.backup-v9-content-v1`)
  assert.equal(slot.contentVersion, 2)
  assert.equal(backup?.contentVersion, 1)
  await shot('m8-continue')
  log('continue (migrated)', game)
  log('storage', `${SLOT}: content v2; ${SLOT}.backup-v9-content-v1: content v1`)

  assert.deepEqual(errors, [])
  console.log('PASS')
} catch (e) {
  await shot('m8-failure').catch(() => {})
  console.log('errors:', errors)
  throw e
} finally {
  rmSync(`content/maps/${TEST_WORLD}`, { recursive: true, force: true })
  await browser.close()
}
