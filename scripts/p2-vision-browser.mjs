// Player vision browser check with Playwright (fresh isolated context). First: world lighting does not
// depend on the facing and the VisionOverlay stays subtle (lights + measured screen brightness with the
// overlay off/on while turning 4 ways at 12:00, 00:00 and indoors, a fast 180° turn, zoom limits). Then zombies in front / behind / right behind the back, a
// real-key 180° turn, a closed vs open safehouse door, the fade, debug drawing (F4). Hidden zombies
// keep their AI (a hidden zombie bashes the door).
//   Dev:        BASE_URL=http://127.0.0.1:5174 node scripts/p2-vision-browser.mjs
//   Production: BASE_URL=http://127.0.0.1:5199 node scripts/p2-vision-browser.mjs --production
// Set PLAYWRIGHT_MODULE (file:// URL of playwright/index.mjs) and CHROMIUM_PATH when needed.
// Writes no fixture (the save schema is unchanged).
import { mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'

const production = process.argv.includes('--production')
const base = process.env.BASE_URL ?? (production ? 'http://127.0.0.1:5199' : 'http://127.0.0.1:5173')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
mkdirSync('node_modules/.tmp', { recursive: true })
const shot = (name) => page.screenshot({ path: `node_modules/.tmp/${name}.png` })
const log = (label, value) => console.log(label.padEnd(30), typeof value === 'string' ? value : JSON.stringify(value))
const button = (name) => page.getByRole('button', { name, exact: true })

async function menu() {
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 20000 })
}
async function inGame() {
  await page.waitForFunction(() => !document.querySelector('h1') && !document.body.innerText.includes('Đang tải…') && document.querySelector('.hud'), null, { timeout: 30000 })
  await page.waitForTimeout(500)
}
async function newGame() {
  await button('New Game').click()
  await page.waitForFunction(() => document.body.innerText.includes('Tạo nhân vật'), null, { timeout: 10000 })
  await button('Bắt đầu').click()
  try {
    await button('Xóa bản lưu và bắt đầu').click({ timeout: 1500 })
  } catch { /* no save yet */ }
  await inGame()
}

try {
  await page.goto(`${base}/`)
  await menu()
  if (production) {
    assert.equal(await page.evaluate(() => typeof window.__runtime), 'undefined')
    await newGame()
    await page.keyboard.press('F3')
    await page.locator('.hud-debug').waitFor()
    await page.waitForFunction(() => /Tầm nhìn: thấy \d+ · ứng viên \d+ · raycast \d+/.test(document.querySelector('.hud-debug')?.textContent ?? ''), null, { timeout: 5000 })
    await page.waitForFunction(() => /nhìn=(VISIBLE|OUTSIDE_FOV|OUT_OF_RANGE|BLOCKED_BY_OCCLUDER|NEAR_DETECTION)/.test(document.querySelector('.hud-debug')?.textContent ?? ''), null, { timeout: 5000 })
    const line = (await page.locator('.hud-debug').innerText()).match(/Tầm nhìn:[^\n]*/)[0]
    // VisionOverlay readout: shade 10 m behind the player > 0 and ≤ 0.15, CPU time per frame.
    await page.waitForFunction(() => /Overlay: hướng \d+° · ánh sáng ngày [\d.]+ · độ mạnh [\d.]+ · alpha trước [\d.]+ \/ sau [\d.]+ · [\d.]+ ms/.test(document.querySelector('.hud-debug')?.textContent ?? ''), null, { timeout: 5000 })
    const overlay = (await page.locator('.hud-debug').innerText()).match(/Overlay:[^\n]*/)[0]
    const rear = Number(overlay.match(/sau ([\d.]+)/)[1])
    assert.ok(rear > 0 && rear <= 0.15, overlay)
    await page.keyboard.press('F3')
    await page.keyboard.press('F4')
    await page.waitForFunction(() => document.querySelectorAll('.vision-debug-label').length >= 1, null, { timeout: 5000 })
    const labels = await page.locator('.vision-debug-label').count()
    await shot('vision-prod-debug')
    await page.keyboard.press('F4')
    await page.waitForFunction(() => document.querySelectorAll('.vision-debug-label').length === 0, null, { timeout: 5000 })
    await page.waitForTimeout(1000)
    assert.equal(errors.length, 0, JSON.stringify(errors))
    log('PASS production', { line, overlay, labels })
  } else {
    await page.evaluate(async () => {
      const { runtime } = await import('/src/game/core/runtime.ts')
      if (runtime !== window.__runtime) throw new Error('Restart Vite before this script to clear HMR module URLs.')
    })
    const rt = (fn, arg) => page.evaluate(fn, arg)
    await newGame()

    // Rendered state of one zombie: its rig ('character') nearest the zombie position; the vision
    // fade drives the visual group (rig → offset group → visual group) and the material opacity.
    const drawn = (id) => rt((id) => {
      const r = window.__runtime
      const z = r.zombies.get(id)
      let best = null
      window.__scene.traverse((o) => {
        if (o.name !== 'character' || !o.parent?.parent) return
        const p = o.getWorldPosition(o.position.clone())
        const d = Math.hypot(p.x - z.position.x, p.z - z.position.z)
        if (!best || d < best.d) best = { o, d }
      })
      let opacity = 1
      best.o.traverse((m) => { if (m.isMesh) opacity = Math.min(opacity, m.material.opacity) })
      const v = r.vision.get(id)
      return { reason: v?.reason, visible: v?.isVisibleToPlayer, simOpacity: +(v?.opacity ?? 0).toFixed(2), drawn: best.o.parent.parent.visible, opacity: +opacity.toFixed(2), ai: z.ai }
    }, id)

    // 0) Lighting is the day/night clock's alone. All zombies parked far away (out of range, so the
    //    set of drawn entities is constant), the player turned in place; lights and mean screen
    //    brightness per quadrant (HUD and the player in the middle excluded) must not change.
    const luminance = async () => {
      const png = await page.screenshot()
      return page.evaluate(async (b64) => {
        const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
        const c = new OffscreenCanvas(img.width, img.height)
        const g = c.getContext('2d')
        g.drawImage(img, 0, 0)
        const { data, width, height } = g.getImageData(0, 0, img.width, img.height)
        const sum = [0, 0, 0, 0]
        const n = [0, 0, 0, 0]
        for (let y = 110; y < height - 170; y += 3) {
          for (let x = 20; x < width - 20; x += 3) {
            if (Math.abs(x - width / 2) < 150 && Math.abs(y - height / 2) < 150) continue
            const i = (y * width + x) * 4
            const k = (y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1)
            sum[k] += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
            n[k] += 1
          }
        }
        return sum.map((v, k) => +(v / n[k]).toFixed(2))
      }, png.toString('base64'))
    }
    const lights = () => rt(() => {
      const out = []
      window.__scene.traverse((o) => { if (o.isLight) out.push(`${o.type}:${o.intensity.toFixed(3)}`) })
      return out.sort().join(' ')
    })
    const overlays = () => rt(() => {
      const found = { shader: 0, stencil: 0 }
      window.__scene.traverse((o) => {
        if (!o.isMesh) return
        if (o.material?.isShaderMaterial) found.shader += 1
        if (o.material?.stencilWrite) found.stencil += 1
      })
      return found
    })
    const setOverlay = (on) => rt(async (on) => {
      const { useSettingsStore } = await import('/src/stores/settingsStore.ts')
      useSettingsStore.getState().set({ visionOverlay: on })
    }, on)
    await rt(() => {
      const r = window.__runtime
      r.spawnTimer = 1e9
      r.hordeTimer = 1e9
      r.pickWanderPoint = () => null
      let i = 0
      for (const [id, body] of r.zombieBodies) {
        body.setTranslation({ x: 20 + (i % 3), y: 0.9, z: 20 + Math.floor(i++ / 3) }, true)
        r.zombies.get(id).health = 0
      }
    })
    const place = async (where, timeOfDay, zoom = 28) => {
      await rt(({ where, timeOfDay, zoom }) => {
        const r = window.__runtime
        r.playerBody.setTranslation({ x: where[0], y: 0.9, z: where[1] }, true)
        r.clock.restore(r.clock.elapsed, timeOfDay, r.clock.day)
        r.cameraZoom = zoom
      }, { where, timeOfDay, zoom })
      await page.waitForTimeout(1500) // camera settles on the player
    }
    // Per facing: frame without the overlay (pure world lighting) and with it. World lighting must not
    // follow the facing; the overlay may only dim each screen quadrant to ≥ minRatio (≥ 85 %).
    const turnAround = async (label, where, timeOfDay, minRatio) => {
      await place(where, timeOfDay)
      const rows = []
      for (const facing of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        await rt((f) => { window.__runtime.player.facing = f }, facing)
        await setOverlay(false)
        await page.waitForTimeout(350)
        const off = await luminance()
        const lightsOff = await lights()
        await setOverlay(true)
        await page.waitForTimeout(450)
        const on = await luminance()
        rows.push({ facing, off, on, lights: [lightsOff, await lights()], ratio: on.map((v, k) => +(v / off[k]).toFixed(3)) })
        if (facing === 0 || facing === Math.PI) await shot(`vision-overlay-${label}-${facing === 0 ? 'north' : 'south'}`)
      }
      const spreadOff = [0, 1, 2, 3].map((k) => +(Math.max(...rows.map((r) => r.off[k])) - Math.min(...rows.map((r) => r.off[k]))).toFixed(2))
      const ratios = rows.flatMap((r) => r.ratio)
      const mean = +(rows[0].off.reduce((x, y) => x + y, 0) / 4).toFixed(1)
      const summary = { lights: rows[0].lights[0], mean, spreadWithoutOverlay: spreadOff, minRatio: Math.min(...ratios), maxRatio: Math.max(...ratios) }
      log(`lighting ${label}`, summary)
      assert.ok(rows.every((r) => r.lights[0] === rows[0].lights[0] && r.lights[1] === rows[0].lights[0]), 'lights never follow the facing or the overlay')
      assert.ok(spreadOff.every((d) => d < 2.5), `world brightness does not follow the facing: ${spreadOff}`)
      assert.ok(summary.minRatio >= minRatio, `overlay stays subtle: ${summary.minRatio} ≥ ${minRatio}`)
      assert.ok(summary.maxRatio <= 1.01, 'the overlay never brightens (not a light)')
      return summary
    }
    const found = await overlays()
    assert.deepEqual(found, { shader: 1, stencil: 0 }, 'exactly one overlay pass, no stencil mask')
    const noon = await turnAround('noon', [0, -8], 0.5, 0.85)
    assert.ok(noon.minRatio < 0.99, 'behind the player is slightly subdued at noon')
    const midnight = await turnAround('midnight', [0, -8], 0.0, 0.9)
    const indoor = await turnAround('indoor', [-14, -14], 0.5, 0.85)
    log('day vs night', { noon: noon.mean, midnight: midnight.mean, indoor: indoor.mean })
    assert.ok(noon.mean > midnight.mean + 10, 'night is darker because of the clock')

    // Fast 180° turn: every frame stays close to the unshaded brightness (no black frame, no flash).
    await place([0, -8], 0.5)
    await rt(() => { window.__runtime.player.facing = 0 })
    await page.waitForTimeout(400)
    const before = await luminance()
    await rt(() => { window.__runtime.player.facing = Math.PI })
    const frames = []
    for (let i = 0; i < 4; i++) frames.push(await luminance())
    const worst = Math.min(...frames.flatMap((f) => f.map((v, k) => v / before[k])))
    log('fast 180° turn', { worstRatioVsBefore: +worst.toFixed(3) })
    assert.ok(worst > 0.82, 'no dark frame while the overlay turns')

    // Zoom in/out: the shade is world-space (same bounds at the zoom limits).
    for (const zoom of [14, 60]) {
      await place([0, -8], 0.5, zoom)
      await setOverlay(false)
      await page.waitForTimeout(350)
      const off = await luminance()
      await setOverlay(true)
      await page.waitForTimeout(450)
      const on = await luminance()
      const r = on.map((v, k) => +(v / off[k]).toFixed(3))
      log(`zoom ${zoom}`, r)
      assert.ok(Math.min(...r) >= 0.85 && Math.max(...r) <= 1.01)
    }
    await rt(() => { window.__runtime.cameraZoom = 28 })

    // Debug tint (F4) for the screenshot only.
    await page.keyboard.press('F4')
    await page.waitForTimeout(400)
    await shot('vision-overlay-debug')
    await page.keyboard.press('F4')
    await rt(() => window.__runtime.clock.restore(window.__runtime.clock.elapsed, 0.3, window.__runtime.clock.day))

    // 1) Outdoor staging north of the crossroads: player at (0, -8) facing +Z, zombies in front (8 m),
    //    behind (8 m) and right behind the back (1.8 m), all facing away (none notices the player).
    await rt(() => {
      const r = window.__runtime
      for (const z of r.zombies.values()) z.health = 0
      r.spawnTimer = 1e9
      r.hordeTimer = 1e9
      r.pickWanderPoint = () => null
      r.playerBody.setTranslation({ x: 0, y: 0.9, z: -8 }, true)
      r.player.facing = 0
      const put = (x, z, facing) => {
        const zz = r.spawnZombie({ x, y: 0, z })
        zz.facing = facing
        r.events.queue('zombie:spawned', { id: zz.id })
        return zz.id
      }
      window.__v = { front: put(0, 0, 0), behind: put(0, -16, Math.PI), near: put(0.3, -9.8, Math.PI) }
    })
    const ids = await rt(() => window.__v)
    await page.waitForTimeout(1500)
    const first = { front: await drawn(ids.front), behind: await drawn(ids.behind), near: await drawn(ids.near) }
    log('facing +Z', first)
    assert.deepEqual([first.front.reason, first.front.drawn, first.front.opacity], ['VISIBLE', true, 1])
    assert.deepEqual([first.behind.reason, first.behind.drawn], ['OUTSIDE_FOV', false])
    assert.deepEqual([first.near.reason, first.near.drawn], ['NEAR_DETECTION', true])
    await page.keyboard.press('F4')
    await page.waitForFunction(() => document.querySelectorAll('.vision-debug-label').length >= 3, null, { timeout: 5000 })
    await page.waitForTimeout(300)
    await shot('vision-front-debug')
    await page.keyboard.press('F4')

    // 2) Real keys: W+D walks/turns towards −Z (screen axes) → the zombie behind fades in, the one in front out.
    await page.keyboard.down('KeyW'); await page.keyboard.down('KeyD')
    await page.waitForTimeout(250)
    await page.keyboard.up('KeyW'); await page.keyboard.up('KeyD')
    const turned = await rt(() => +window.__runtime.player.facing.toFixed(2))
    await page.waitForFunction((id) => window.__runtime.vision.get(id).isVisibleToPlayer, ids.behind, { timeout: 2000 })
    await page.waitForTimeout(800)
    const second = { front: await drawn(ids.front), behind: await drawn(ids.behind), near: await drawn(ids.near) }
    log('after turning', { facing: turned, ...second })
    assert.ok(Math.abs(Math.abs(turned) - Math.PI) < 0.4, `faces −Z (${turned})`)
    assert.deepEqual([second.behind.reason, second.behind.drawn, second.behind.opacity], ['VISIBLE', true, 1])
    assert.deepEqual([second.front.reason, second.front.drawn], ['OUTSIDE_FOV', false])
    await shot('vision-turned')

    // 3) Safehouse door: player inside facing the closed door, a zombie outside in front of it.
    await rt(() => {
      const r = window.__runtime
      for (const id of Object.values(window.__v)) r.zombies.get(id).health = 0
      r.playerBody.setTranslation({ x: -13, y: 0.9, z: -13 }, true)
      const z = r.spawnZombie({ x: -13, y: 0, z: -4.5 })
      z.facing = Math.PI
      r.events.queue('zombie:spawned', { id: z.id })
      window.__door = z.id
    })
    const doorZombie = await rt(() => window.__door)
    // Walk to the door (S+A = straight towards +Z on screen axes) until the E prompt shows.
    await page.keyboard.down('KeyS'); await page.keyboard.down('KeyA')
    await page.waitForFunction(() => document.querySelector('.hud-prompt')?.textContent.includes('Mở Cửa nhà an toàn'), null, { timeout: 5000 })
    await page.keyboard.up('KeyS'); await page.keyboard.up('KeyA')
    await page.waitForTimeout(600)
    const closed = await drawn(doorZombie)
    log('door closed', closed)
    assert.deepEqual([closed.reason, closed.drawn], ['BLOCKED_BY_OCCLUDER', false])
    await page.keyboard.press('KeyE')
    await page.waitForFunction((id) => window.__runtime.vision.get(id).isVisibleToPlayer, doorZombie, { timeout: 3000 })
    await page.waitForTimeout(500)
    const open = await drawn(doorZombie)
    log('door open', open)
    assert.deepEqual([open.reason, open.drawn], ['VISIBLE', true])
    await shot('vision-door-open')
    // It saw the player through the doorway; close the door: hidden again, yet it keeps bashing.
    await page.waitForFunction((id) => window.__runtime.zombies.get(id).ai === 'CHASE', doorZombie, { timeout: 6000 })
    await page.keyboard.press('KeyE')
    await page.waitForFunction((id) => window.__runtime.zombies.get(id).ai === 'ATTACK_STRUCTURE', doorZombie, { timeout: 15000 })
    await page.waitForFunction(() => window.__runtime.world.doors.get('door-safehouse').hp < 120, null, { timeout: 8000 })
    const bashing = await drawn(doorZombie)
    log('hidden but bashing', { ...bashing, doorHp: await rt(() => window.__runtime.world.doors.get('door-safehouse').hp) })
    assert.deepEqual([bashing.ai, bashing.drawn], ['ATTACK_STRUCTURE', false])

    assert.equal(errors.length, 0, JSON.stringify(errors))
    log('PASS dev', 'lighting independent of facing (noon/midnight/indoor), front/behind/near, real-key turn, closed/open door, hidden zombie bashes, F4 debug')
  }
} catch (e) {
  await shot(production ? 'vision-prod-fail' : 'vision-dev-fail').catch(() => undefined)
  console.error('FAIL', e.message, errors)
  process.exitCode = 1
} finally {
  await browser.close()
}
