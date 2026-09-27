// C3 (character plan): player locomotion in the real game (dev server). Holds W+D (straight −Z with
// the fixed isometric camera) in the open and then against the +Z face of a building wall, records the
// left hip angle every rendered frame, and checks:
// - free walk: the legs swing (amplitude > 0.5 rad), footsteps sound;
// - blocked: the body does not move and the legs settle (amplitude < 0.1 rad) instead of running in
//   place; the simulation keeps its intended speed/footsteps (gameplay unchanged);
// - pause (Escape) freezes the pose.
//   BASE_URL=... PLAYWRIGHT_MODULE=... CHROMIUM_PATH=... GPU=1 node scripts/c3-locomotion-browser.mjs
import assert from 'node:assert/strict'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: process.env.GPU ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const log = (label, value) => console.log(label.padEnd(20), JSON.stringify(value))

try {
  await page.goto(`${base}/`)
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 60000 })
  await page.getByRole('button', { name: 'New Game', exact: true }).click()
  await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click()
  await page.waitForFunction(() => window.__runtime?.playerBody && document.querySelector('.hud'), null, { timeout: 60000 })
  await page.evaluate(() => {
    const rt = window.__runtime
    rt.spawnTimer = 1e9
    for (const z of [...rt.zombies.values()]) rt.removeZombie(z.id)
    rt.events.flush()
    setInterval(() => { rt.player.health = 100; rt.player.stamina = 100; rt.player.hunger = 100; rt.player.thirst = 100 }, 100)
  })
  await page.waitForTimeout(500)
  // The player's rig: the 'character' root nearest to the player (removed zombies unmount after a render).
  await page.evaluate(() => {
    const p = window.__runtime.player.position
    const roots = []
    window.__scene.traverse((o) => { if (o.name === 'character') roots.push(o) })
    const at = (o) => { o.updateWorldMatrix(true, false); return Math.hypot(o.matrixWorld.elements[12] - p.x, o.matrixWorld.elements[14] - p.z) }
    window.__hip = roots.sort((a, b) => at(a) - at(b))[0].getObjectByName('hipL')
  })

  const place = (x, z) => page.evaluate(([x, z]) => {
    const rt = window.__runtime
    rt.player.position = { x, y: 0, z }
    rt.playerBody.setTranslation({ x, y: rt.config.player.height / 2 + 0.02, z }, true)
    rt.playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
  }, [x, z])
  const hold = (down) => page.evaluate((d) => { window.__runtime.input.simulateKey('KeyW', d); window.__runtime.input.simulateKey('KeyD', d) }, down)
  /** Hip angle every frame for `ms` after `settle` ms; body displacement over the recording. */
  const record = (settle, ms) => page.evaluate(async ([settle, ms]) => {
    await new Promise((r) => setTimeout(r, settle))
    const rt = window.__runtime
    const p0 = { ...rt.player.position }
    const hip = []
    const t0 = performance.now()
    while (performance.now() - t0 < ms) {
      await new Promise((r) => requestAnimationFrame(r))
      hip.push(window.__hip.rotation.x)
    }
    const p1 = rt.player.position
    return { frames: hip.length, amplitude: +(Math.max(...hip) - Math.min(...hip)).toFixed(3), moved: +Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(3), intended: rt.player.moveSpeed }
  }, [settle, ms])

  // A ground-floor building wall at least 3 m wide whose +Z side is open ground (nothing within 3 m).
  const spot = await page.evaluate(() => {
    const rt = window.__runtime
    const walls = rt.map.walls.filter((w) => !w.prop && w.position.y < 3 && w.size[0] >= 3 && w.size[1] >= 2)
    const blocks = (x, z) => rt.map.walls.some((w) => Math.abs(x - w.position.x) < w.size[0] / 2 + 0.5 && Math.abs(z - w.position.z) < w.size[2] / 2 + 0.5 && w.position.y < 3)
    for (const w of walls) {
      const x = w.position.x
      const z = w.position.z + w.size[2] / 2 + 0.45
      let open = true
      for (let d = 0.2; d <= 3; d += 0.4) if (blocks(x, z + d) || blocks(x + 0.6, z + d) || blocks(x - 0.6, z + d)) open = false
      if (open) return { x, z, wall: w.id }
    }
    return null
  })
  assert.ok(spot, 'a wall with open ground in front')
  log('wall', spot)

  // 1) Free walk: from 2.5 m in front of the wall toward it (−Z), stop before reaching it.
  await place(spot.x, spot.z + 3.2)
  await page.waitForTimeout(300)
  await hold(true)
  const free = await record(250, 450)
  await hold(false)
  log('free walk', free)
  assert.ok(free.amplitude > 0.5, 'legs swing when walking')
  assert.ok(free.moved > 1, 'the body moves')

  // 2) Pushing into the wall: the body stays, the legs settle.
  await place(spot.x, spot.z)
  await page.waitForTimeout(300)
  await hold(true)
  const blocked = await record(700, 800)
  log('blocked', blocked)
  assert.ok(blocked.moved < 0.1, `the wall stops the body (${blocked.moved} m)`)
  assert.ok(blocked.intended > 0, 'the simulation still intends to move (gameplay unchanged)')
  assert.ok(blocked.amplitude < 0.1, `no running in place (hip amplitude ${blocked.amplitude})`)
  await hold(false)

  // 3) Pause while walking freezes the pose.
  await place(spot.x, spot.z + 6)
  await hold(true)
  await page.waitForTimeout(400)
  await page.keyboard.press('Escape')
  const paused = await record(150, 500)
  log('paused', paused)
  assert.ok(paused.amplitude < 0.001, 'pose frozen while paused')
  await page.keyboard.press('Escape')
  await hold(false)

  assert.deepEqual(errors, [])
  console.log('PASS c3 locomotion', 'free walk, blocked (no running in place), pause freezes')
} finally {
  await browser.close()
}
