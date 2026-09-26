// G3b (graphics plan) decor, clusters and house variants in the editor, browser check with Playwright
// (fresh isolated context, dev server only: opens the lab through window.__editor, aims clicks with
// window.__editorThree and reads the store).
//   BASE_URL=http://127.0.0.1:5174 node scripts/g3b-decor-editor-browser.mjs
// Set PLAYWRIGHT_MODULE (file:// URL of playwright/index.mjs) and CHROMIUM_PATH when needed.
// Covers, with real input: the "Trang trí" palette tab; placing the dinner cluster with a click (its
// objects get their own IDs, one history step, undone); a decor's Inspector (asset, turn, "only in"
// variants); the prefab's variant boxes; an instance's variant select in the world view. No page
// error, no validation error. Writes nothing to content.
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

const state = () =>
  page.evaluate((p) => {
    const s = window.__editor.getState()
    const prefab = s.edit.doc.prefabs.get(p)
    return {
      selection: s.edit.selection,
      objects: prefab.objects.map((o) => o.localId),
      visual: prefab.visual ?? null,
      errors: s.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.path}`),
    }
  }, PREFAB)
const object = (id) => page.evaluate(([p, id]) => structuredClone(window.__editor.getState().edit.doc.prefabs.get(p).objects.find((o) => o.localId === id)), [PREFAB, id])
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
  await page.goto(`${base}/editor.html`)
  await page.waitForFunction(() => !!window.__editor, null, { timeout: 60000 })
  assert.equal(await page.evaluate(() => window.__editor.getState().openBundled('graphics-lab')), true)
  await page.evaluate((p) => window.__editor.getState().enterPrefab(p), PREFAB)
  await page.waitForFunction((p) => window.__editor.getState().prefabMode === p, PREFAB)
  await page.waitForTimeout(500)
  const before = await state()

  // 1. The dinner cluster, placed with a real click in the empty north-west of the living room.
  await page.locator('[data-prefab-tab="decor"]').click()
  await page.locator('[data-prefab-preset="cluster/dinner"]').click()
  const p = await screen(-3.2, -2.6)
  await page.mouse.move(p.x, p.y)
  await page.waitForTimeout(150)
  await page.mouse.click(p.x, p.y)
  await page.waitForTimeout(300)
  let s = await state()
  const added = s.objects.filter((id) => !before.objects.includes(id))
  assert.equal(added.length, 6, `cluster objects: ${added}`)
  assert.deepEqual([...s.selection].sort(), [...added].sort())
  assert.deepEqual(s.errors, [])
  log('cluster placed', added)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+z')
  s = await state()
  assert.deepEqual(s.objects, before.objects, 'one undo removes the whole cluster')
  log('undone', `${s.objects.length} objects`)

  // 2. A decor's Inspector: turn it, restrict it to a variant, then undo both.
  await page.evaluate(() => window.__editor.getState().select(['cup-1']))
  await page.waitForTimeout(150)
  assert.equal(await page.locator('[data-decor-asset]').inputValue(), 'decor/cup')
  await page.locator('[data-decor-asset]').selectOption('decor/bottle')
  assert.equal((await object('cup-1')).assetId, 'decor/bottle')
  await page.locator('[data-decor-variants] input').nth(0).check()
  assert.deepEqual((await object('cup-1')).variants, ['intact', 'lived-in'])
  log('decor fields', await object('cup-1'))
  // Focus is in the select (the editor leaves keys typed into fields alone): undo from the toolbar's store action.
  await page.evaluate(() => window.__editor.getState().undo())
  await page.evaluate(() => window.__editor.getState().undo())
  assert.deepEqual(await object('cup-1'), { kind: 'decor', localId: 'cup-1', assetId: 'decor/cup', position: { x: 2.86, y: 0.75, z: -1.52 }, variants: ['lived-in'] })

  // 3. The prefab's variants: offer "intact" too (prefab Inspector, nothing selected).
  await page.evaluate(() => window.__editor.getState().select([]))
  await page.waitForTimeout(150)
  await page.locator('[data-prefab-variants] input').nth(0).check()
  s = await state()
  assert.deepEqual(s.visual, { variants: ['intact', 'lived-in', 'abandoned'] })
  log('prefab variants', s.visual)

  // 4. World view: house B's variant select lists them; choose "intact".
  await page.evaluate(() => window.__editor.getState().exitPrefab?.())
  await page.evaluate(() => window.__editor.getState().select(['c0_0/house-b']))
  await page.waitForTimeout(300)
  const variant = page.locator('[data-instance-variant]')
  assert.equal(await variant.inputValue(), 'abandoned')
  await variant.selectOption('intact')
  const chosen = await page.evaluate(() => {
    const doc = window.__editor.getState().edit.doc
    return [...doc.chunks.values()].flatMap((c) => c.instances).find((i) => i.instanceId === 'c0_0/house-b').visual
  })
  assert.deepEqual(chosen, { variantId: 'intact' })
  log('instance variant', chosen)
  assert.deepEqual((await state()).errors, [])
  assert.deepEqual(errors, [])
  console.log('G3b decor editor browser check: PASS')
} catch (e) {
  console.log('FAIL', e.message, errors)
  process.exitCode = 1
} finally {
  await browser.close()
}
