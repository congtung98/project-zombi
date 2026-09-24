// P2-S5 feedback check (dev only): leg animation smoothness with an uncapped frame rate and the
// player footstep sounds. Records the player's hip angle every rendered frame while walking/running
// and wraps sfx.play to count footstep sounds (walk / run / standing still).
//   BASE_URL=http://127.0.0.1:5174 node scripts/p2-s5-gait.mjs
// Set PLAYWRIGHT_MODULE (file:// URL of playwright/index.mjs) and CHROMIUM_PATH when needed.
import assert from 'node:assert/strict'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  // Uncapped frames (well above the 60 Hz physics step), like a high refresh monitor.
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
})
const page = await (await browser.newContext({ viewport: { width: 960, height: 600 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const log = (label, value) => console.log(label.padEnd(24), JSON.stringify(value))
const button = (name) => page.getByRole('button', { name, exact: true })

try {
  await page.goto(`${base}/`)
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 20000 })
  await button('New Game').click()
  await button('Bắt đầu').click()
  await page.waitForFunction(() => !document.querySelector('h1') && document.querySelector('.hud') && !document.body.innerText.includes('Đang tải…'), null, { timeout: 30000 })
  await page.evaluate(async () => {
    const { sfx } = await import('/src/game/audio/sfx.ts')
    const r = window.__runtime
    for (const z of r.zombies.values()) z.health = 0
    r.spawnTimer = 1e9
    window.__sounds = []
    const play = sfx.play.bind(sfx)
    sfx.play = (name, gain) => { window.__sounds.push(name); play(name, gain) }
    // Player rig: the 'character' root nearest to the player; hips → hipL is the left leg joint.
    const roots = []
    window.__scene.traverse((o) => { if (o.name === 'character') roots.push(o) })
    const world = (o) => { o.updateWorldMatrix(true, false); return { x: o.matrixWorld.elements[12], z: o.matrixWorld.elements[14] } }
    const p = r.player.position
    const root = roots.sort((a, b) => Math.hypot(world(a).x - p.x, world(a).z - p.z) - Math.hypot(world(b).x - p.x, world(b).z - p.z))[0]
    window.__hip = root.children[0].children[0]
    window.__rec = null
    const tick = (t) => {
      if (window.__rec) window.__rec.push({ t, leg: window.__hip.rotation.x })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  async function sample(keys, ms) {
    await page.evaluate(() => { window.__rec = []; window.__sounds = []; window.__t0 = window.__runtime.clock.elapsed; window.__steps = 0; window.__off?.(); window.__off = window.__runtime.events.on('player:footstep', () => window.__steps++) })
    for (const k of keys) await page.keyboard.down(k)
    await page.waitForTimeout(ms)
    for (const k of keys) await page.keyboard.up(k)
    return page.evaluate(() => {
      const rec = window.__rec.slice(Math.floor(window.__rec.length * 0.3)) // skip the ease-in
      window.__rec = null
      const dt = rec.slice(1).map((f, i) => f.t - rec[i].t)
      const dLeg = rec.slice(1).map((f, i) => Math.abs(f.leg - rec[i].leg))
      const amp = Math.max(...rec.map((f) => Math.abs(f.leg)))
      return {
        fps: Math.round(1000 / (dt.reduce((a, b) => a + b, 0) / dt.length)),
        amplitude: +amp.toFixed(2),
        // Frames where a walking leg did not move at all: the old per-physics-step stutter.
        frozenFrames: +(dLeg.filter((d) => d < 1e-5).length / dLeg.length).toFixed(3),
        sounds: window.__sounds.slice(),
        gameSeconds: +(window.__runtime.clock.elapsed - window.__t0).toFixed(2),
        events: window.__steps,
      }
    })
  }

  // Walk towards the NW corner inside the safehouse (W), then run, then stand still.
  await page.evaluate(() => window.__runtime.playerBody.setTranslation({ x: -10.8, y: 0.9, z: -10.8 }, true))
  await page.waitForTimeout(300)
  const walk = await sample(['KeyW'], 3000)
  await page.evaluate(() => window.__runtime.playerBody.setTranslation({ x: -10.8, y: 0.9, z: -10.8 }, true))
  await page.waitForTimeout(300)
  const run = await sample(['ShiftLeft', 'KeyW'], 2500)
  const still = await sample([], 1200)
  const count = (s, name) => s.sounds.filter((n) => n === name).length
  log('walk', { ...walk, sounds: count(walk, 'stepWalk') })
  log('run', { ...run, sounds: count(run, 'stepRun') })
  log('still', { sounds: still.sounds.filter((n) => n.startsWith('step')).length })
  assert.ok(walk.fps > 0)
  assert.ok(walk.frozenFrames < 0.05, 'legs move every frame while walking')
  assert.ok(run.frozenFrames < 0.05, 'legs move every frame while running')
  // Exact cadence per game second is covered by src/game/core/footsteps.test.ts; headless
  // SwiftShader runs slower than real time, so here: steps sound while moving, one per event.
  for (const [sample, name] of [[walk, 'stepWalk'], [run, 'stepRun']]) {
    assert.ok(sample.events >= 2, `${name}: ${sample.events} footstep events`)
    assert.equal(count(sample, name), sample.events)
  }
  assert.equal(count(walk, 'stepRun') + count(run, 'stepWalk'), 0)
  assert.equal(still.sounds.filter((n) => n.startsWith('step')).length, 0)
  assert.equal(errors.length, 0, JSON.stringify(errors))
  console.log('PASS gait/footsteps')
} finally {
  await browser.close()
}
