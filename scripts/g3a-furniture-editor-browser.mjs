// G3a (graphics plan) furniture looks in the prefab editor, browser check with Playwright (fresh
// isolated context, dev server only: it opens the lab through window.__editor and reads the store).
//   BASE_URL=http://127.0.0.1:5174 node scripts/g3a-furniture-editor-browser.mjs
// Set PLAYWRIGHT_MODULE (file:// URL of playwright/index.mjs) and CHROMIUM_PATH when needed.
// Covers, through the real Inspector: the lab sofa shows its asset and "automatic" facing; setting a
// facing, switching the asset and going back to a plain box each write one change (undone again);
// R turns a chair's set facing with it; nothing becomes a validation error; no page error.
// Writes nothing to content.
import assert from 'node:assert/strict'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await (await browser.newContext({ viewport: { width: 1400, height: 850 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
const log = (label, value) => console.log(label.padEnd(30), typeof value === 'string' ? value : JSON.stringify(value))
const PREFAB = 'building/lab-house'

const look = (id) =>
  page.evaluate(
    ([prefab, id]) => {
      const s = window.__editor.getState()
      const o = s.edit.doc.prefabs.get(prefab).objects.find((x) => x.localId === id)
      return { visual: o.visual ?? null, size: o.size, errors: s.issues.filter((i) => i.severity === 'error').length }
    },
    [PREFAB, id],
  )
const pick = async (id) => {
  await page.evaluate((id) => window.__editor.getState().select([id]), id)
  await page.waitForTimeout(150)
}

try {
  await page.goto(`${base}/editor.html`)
  await page.waitForFunction(() => !!window.__editor, null, { timeout: 60000 })
  const opened = await page.evaluate(() => window.__editor.getState().openBundled('graphics-lab'))
  assert.equal(opened, true)
  await page.evaluate((p) => window.__editor.getState().enterPrefab(p), PREFAB)
  await page.waitForFunction((p) => window.__editor.getState().prefabMode === p, PREFAB)

  // 1. The sofa: its asset, facing automatic.
  await pick('sofa')
  const asset = page.locator('[data-furniture-asset]')
  const facing = page.locator('[data-furniture-facing]')
  assert.equal(await asset.inputValue(), 'furniture/sofa')
  assert.equal(await facing.inputValue(), '')
  log('sofa', await look('sofa'))

  // 2. Facing west, then a table, then a plain box: one change each.
  await facing.selectOption('3')
  assert.deepEqual((await look('sofa')).visual, { assetId: 'furniture/sofa', facing: 3 })
  await asset.selectOption('furniture/table')
  assert.deepEqual((await look('sofa')).visual, { assetId: 'furniture/table', facing: 3 })
  await asset.selectOption('')
  assert.equal((await look('sofa')).visual, null)
  assert.equal(await facing.count(), 0, 'no facing for a plain box')
  log('set / switch / plain', 'ok')
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z')
  assert.deepEqual((await look('sofa')).visual, { assetId: 'furniture/sofa' })
  log('undone', (await look('sofa')).visual)

  // 3. R turns a set facing with its (square) box.
  await pick('chair-1')
  assert.deepEqual((await look('chair-1')).visual, { assetId: 'furniture/chair', facing: 2 })
  await page.locator('canvas').first().hover()
  await page.keyboard.press('r')
  await page.waitForTimeout(150)
  const turned = await look('chair-1')
  assert.deepEqual(turned.visual, { assetId: 'furniture/chair', facing: 3 })
  assert.equal(await page.locator('[data-furniture-facing]').inputValue(), '3')
  log('R on chair-1', turned.visual)
  assert.equal(turned.errors, 0)
  assert.deepEqual(errors, [])
  console.log('G3a furniture editor browser check: PASS')
} catch (e) {
  console.log('FAIL', e.message, errors)
  process.exitCode = 1
} finally {
  await browser.close()
}
