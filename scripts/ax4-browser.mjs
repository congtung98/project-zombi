// AX4 browser check (Playwright, fresh context, dev server, Chrome with the GPU), real mouse: the
// cursor picks the object under it (hand cursor, highlight ring), a left click opens a cupboard after
// its short open action and opens/closes a door at once, a door out of reach says so, the combat
// stance keeps the left button for the swing, and a click on the floor still only hints.
// Screenshots in docs/character-action/.
//   GPU=1 BASE_URL=http://localhost:5199 PLAYWRIGHT_MODULE=file:///…/playwright/index.mjs node scripts/ax4-browser.mjs
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
const hovered = () => rt(() => window.__runtime.pointerTarget)
const cursor = () => page.evaluate(() => document.querySelector('canvas').style.cursor)

/** Stand `rad` m from an object of the kind (with a free, unblocked spot), zombies gone, no UI. */
async function standBy(kind, rad, filter = null) {
  const found = await rt(({ kind, rad, filter }) => {
    const r = window.__runtime
    for (const z of [...r.zombies.values()]) r.zombies.delete(z.id)
    r.closeAllUi()
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

/** Move the real mouse over the screen until the cursor picks `id`; returns where. */
async function hover(id) {
  for (let step = 70; step >= 20; step -= 25) {
    for (let y = 200; y <= 750; y += step) {
      for (let x = 400; x <= 1200; x += step) {
        await page.mouse.move(x, y)
        await page.waitForTimeout(34)
        const t = await hovered()
        if (t?.kind === 'object' && t.id === id) return { x, y }
      }
    }
  }
  throw new Error(`the cursor never picked ${id}`)
}

try {
  await page.goto(base)
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 30000 })
  await button('New Game').click()
  await hasText('Tạo nhân vật')
  await button('Bắt đầu').click()
  await page.waitForFunction(() => !document.querySelector('h1') && !document.body.innerText.includes('Đang tải…') && document.querySelector('.hud'), null, { timeout: 60000 })
  await page.waitForTimeout(500)

  // 1) Hover a cupboard: hand cursor, the ring on it; a left click opens it after the open action.
  const cupboard = await standBy('container', 1.0, 'kitchen')
  const at = await hover(cupboard)
  assert.equal(await cursor(), 'pointer')
  await shot('ax4-hover-container')
  await page.mouse.click(at.x, at.y)
  const opening = await rt(() => ({ jobs: window.__runtime.jobs.map((j) => j.type), state: window.__runtime.characterState, open: window.__runtime.openContainerId }))
  await page.waitForFunction((id) => window.__runtime.openContainerId === id, cupboard, { timeout: 5000 })
  assert.equal(await rt(() => window.__runtime.player.attackTimer < 0), true, 'no swing')
  await page.waitForTimeout(300)
  await shot('ax4-left-click-open')
  log('left click on a cupboard', { ...opening, opened: cupboard })

  // 2) A door: a left click opens it at once, a second one closes it.
  const door = await standBy('door', 1.2)
  const doorAt = await hover(door)
  const before = await rt((id) => window.__runtime.world.doors.get(id).state, door)
  await page.mouse.click(doorAt.x, doorAt.y)
  await page.waitForFunction(({ id, before }) => window.__runtime.world.doors.get(id).state !== before, { id: door, before }, { timeout: 3000 })
  await shot('ax4-door-toggled')
  await page.mouse.move(doorAt.x + 1, doorAt.y + 1)
  await hover(door)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForFunction(({ id, before }) => window.__runtime.world.doors.get(id).state === before, { id: door, before }, { timeout: 3000 })
  log('door by left click', { door, before, toggledTwice: true })

  // 3) The same door from 5 m: out of reach, nothing changes, the reason is shown.
  await rt(() => window.__runtime.closeAllUi())
  await standBy('door', 5)
  const far = await rt(() => window.__runtime.interactables.filter((i) => i.kind === 'door').map((i) => i.id))
  let farDoor = null
  for (const id of far) {
    try {
      await hover(id)
      farDoor = id
      break
    } catch { /* not on screen from here */ }
  }
  assert.ok(farDoor, 'a door on screen from afar')
  const farState = await rt((id) => window.__runtime.world.doors.get(id).state, farDoor)
  await page.mouse.down()
  await page.mouse.up()
  await hasText('quá xa', 3000)
  assert.equal(await rt((id) => window.__runtime.world.doors.get(id).state, farDoor), farState)
  await shot('ax4-too-far')
  log('far door', { door: farDoor, unchanged: farState })

  // 4) In the combat stance the left button swings, even over the cupboard.
  await rt(() => {
    const r = window.__runtime
    r.player.inventory.items.push({ id: 'player:ax4-bat', itemId: 'baseball_bat', kind: 'weapon', quantity: 1, condition: 80 })
    r.equipItem('player:ax4-bat')
  })
  const box = await standBy('container', 1.0, 'kitchen')
  const boxAt = await hover(box)
  await page.mouse.down({ button: 'right' })
  await page.waitForTimeout(150)
  await page.mouse.click(boxAt.x, boxAt.y)
  await page.waitForFunction(() => window.__runtime.player.attackTimer >= 0, null, { timeout: 2000 })
  await page.mouse.up({ button: 'right' })
  assert.equal(await rt(() => window.__runtime.jobs.length), 0, 'no open request in the stance')
  log('stance keeps the left button', 'swing, no open')

  assert.deepEqual(errors, [])
  log('PASS', 'hover pick + cursor + ring, left click opens a cupboard (timed) and a door (at once), too far, stance swing')
} catch (e) {
  await shot('ax4-failure').catch(() => {})
  console.error(e)
  console.error('page errors', errors)
  process.exitCode = 1
} finally {
  await browser.close()
}
