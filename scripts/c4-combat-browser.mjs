// C4 (character plan): hit reactions and deaths in the real game (dev server, GPU=1 recommended).
// - A zombie with its back to a wall, pushed toward it by the killing blow, never falls through the
//   wall (the preferred fall on its back is skipped).
// - A settled corpse keeps a static pose (no more posing).
// - Pausing mid-fall freezes the fall; resuming finishes it.
// - The dying zombie's windup never lands: the player's health is unchanged.
//   BASE_URL=... PLAYWRIGHT_MODULE=... CHROMIUM_PATH=... GPU=1 node scripts/c4-combat-browser.mjs
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
  })

  // Open ground in front (+Z) of a long wall (the same search as c3-locomotion-browser).
  const spot = await page.evaluate(() => {
    const rt = window.__runtime
    const walls = rt.map.walls.filter((w) => !w.prop && w.position.y < 3 && w.size[0] >= 3 && w.size[1] >= 2)
    const blocks = (x, z) => rt.map.walls.some((w) => Math.abs(x - w.position.x) < w.size[0] / 2 + 0.5 && Math.abs(z - w.position.z) < w.size[2] / 2 + 0.5 && w.position.y < 3)
    for (const w of walls) {
      const x = w.position.x
      const z = w.position.z + w.size[2] / 2 + 0.5
      let open = true
      for (let d = 0.2; d <= 4; d += 0.4) if (blocks(x, z + d) || blocks(x + 2, z + d) || blocks(x - 2, z + d)) open = false
      if (open) return { x, z, wall: w.id }
    }
    return null
  })
  assert.ok(spot)
  log('wall', spot)

  /** Spawn a zombie at (x, z) facing `facing`, return its id; the player stands 3 m away, invulnerable. */
  const spawn = (x, z, facing) => page.evaluate(([x, z, facing]) => {
    const rt = window.__runtime
    const zombie = rt.spawnZombie({ x, y: 0, z })
    rt.events.queue('zombie:spawned', { id: zombie.id })
    rt.events.flush()
    zombie.facing = facing
    zombie.staggerTimer = 1e9 // hold still until killed
    return zombie.id
  }, [x, z, facing])
  /** The rig root of a zombie (nearest 'character' root to its position). */
  const rootInfo = (id) => page.evaluate((id) => {
    const z = window.__runtime.zombies.get(id)
    let best = null
    let bestD = Infinity
    window.__scene.traverse((o) => {
      if (o.name !== 'character') return
      o.parent.updateWorldMatrix(true, false)
      const e = o.parent.matrixWorld.elements
      const d = Math.hypot(e[12] - z.position.x, e[14] - z.position.z)
      if (d < bestD) { bestD = d; best = o }
    })
    return { pitch: +best.rotation.x.toFixed(3), roll: +best.rotation.z.toFixed(3), hips: best.getObjectByName('hips').rotation.toArray().slice(0, 3).map((v) => +v.toFixed(4)) }
  }, id)
  const kill = (id, push) => page.evaluate(async ([id, push]) => {
    const rt = window.__runtime
    const z = rt.zombies.get(id)
    const { damageZombie } = await import('/src/game/systems/ai.ts')
    z.staggerTimer = 0
    await new Promise((r) => setTimeout(r, 50))
    // The blow: a push (knockback) and a stagger, then the killing damage in the same moment.
    z.knockback = { x: push.x, z: push.z }
    z.staggerTimer = 0.2
    z.health = 1
    z.attackWindup = rt.config.zombie.attackWindup * 0.5 // was mid-windup: must never land
    await new Promise((r) => requestAnimationFrame(r))
    damageZombie(z, 5)
  }, [id, push])

  await page.evaluate(([x, z]) => {
    const rt = window.__runtime
    rt.player.position = { x, y: 0, z }
    rt.playerBody.setTranslation({ x, y: rt.config.player.height / 2 + 0.02, z }, true)
    rt.player.health = 100
    // Face the test spot: the player-vision system only draws (and so poses) zombies in sight.
    rt.player.facing = Math.atan2(-2, -1)
  }, [spot.x + 2, spot.z + 4])
  const health0 = await page.evaluate(() => window.__runtime.player.health)

  // 1) Back to the wall, pushed toward it: must not fall on its back (through the wall).
  const a = await spawn(spot.x, spot.z, 0)
  await page.waitForTimeout(400)
  await kill(a, { x: 0, z: -1.5 })
  await page.waitForTimeout(1200)
  const wallFall = await rootInfo(a)
  log('fall at the wall', wallFall)
  assert.notEqual(wallFall.pitch, -1.571, 'did not fall on its back into the wall')

  // 2) The settled corpse is static across frames.
  const s1 = await rootInfo(a)
  await page.waitForTimeout(300)
  const s2 = await rootInfo(a)
  assert.deepEqual(s1, s2, 'corpse pose static')

  // 3) In the open, pushed back: falls on its back; pause mid-fall freezes it, resume finishes it.
  const b = await spawn(spot.x, spot.z + 3, Math.PI)
  await page.waitForTimeout(400)
  await kill(b, { x: 0, z: 1.5 })
  await page.waitForTimeout(120)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
  const p1 = await rootInfo(b)
  await page.waitForTimeout(500)
  const p2 = await rootInfo(b)
  log('paused mid-fall', { p1, p2 })
  assert.deepEqual(p1, p2, 'fall frozen while paused')
  assert.ok(Math.abs(p1.pitch) < 1.5, 'the fall was not finished before the pause')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(900)
  const open = await rootInfo(b)
  log('open fall', open)
  assert.equal(open.pitch, -1.571, 'pushed back in the open: on its back')

  const health1 = await page.evaluate(() => window.__runtime.player.health)
  assert.equal(health1, health0, 'no windup of a dying zombie landed')
  assert.deepEqual(errors, [])
  console.log('PASS c4 combat', 'fall avoids the wall, static corpse, pause freezes the fall, dying windup never lands')
} finally {
  await browser.close()
}
