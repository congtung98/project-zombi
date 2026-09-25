// Same-scene render comparison (dev build only, needs window.__runtime and window.__renderInfo).
// Fixed seed, player at the crossroads, 10 zombies frozen in a ring around it, default camera.
// Reports average draw calls / triangles / FPS per shadow setting. Headless SwiftShader FPS is NOT a
// GPU benchmark; draw calls and triangles are the comparable numbers between builds.
//   BASE_URL=http://127.0.0.1:5174 PLAYWRIGHT_MODULE=file:///.../playwright/index.mjs CHROMIUM_PATH=... \
//   node scripts/p2-render-bench.mjs [label]
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const label = process.argv[2] ?? 'current'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

async function setup() {
  await page.evaluate(async () => {
    const rt = window.__runtime
    const { useUiStore } = await import('/src/stores/uiStore.ts')
    const { useWorldStore } = await import('/src/stores/worldStore.ts')
    rt.newGame(20260924)
    useWorldStore.getState().syncFromRuntime(rt)
    useUiStore.setState({ screen: 'playing', sessionId: rt.sessionId, sceneReady: false })
    while (rt.zombies.size < 10) {
      const z = rt.spawnZombie({ x: 0, y: 0, z: 0 })
      rt.events.queue('zombie:spawned', { id: z.id })
    }
    rt.events.flush()
    rt.spawnTimer = 1e9
  })
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    const rt = window.__runtime
    const center = { x: -3, z: -5 }
    rt.playerBody.setTranslation({ x: center.x, y: 0.9, z: center.z }, true)
    rt.player.position = { x: center.x, y: 0.9, z: center.z }
    let i = 0
    for (const z of rt.zombies.values()) {
      const a = (i++ / rt.zombies.size) * Math.PI * 2
      const pos = { x: center.x + Math.cos(a) * 4, y: 0.9, z: center.z + Math.sin(a) * 4 }
      z.position = { ...pos } // R2: the simulation owns the position; the body follows next tick
      z.staggerTimer = 1e9
      z.facing = Math.atan2(center.x - pos.x, center.z - pos.z)
    }
  })
}

async function sample(seconds) {
  const out = []
  for (let t = 0; t < seconds * 4; t++) {
    await page.waitForTimeout(250)
    out.push(await page.evaluate(() => ({ ...window.__renderInfo })))
  }
  const avg = (k) => Math.round(out.reduce((n, s) => n + s[k], 0) / out.length)
  return { calls: avg('calls'), triangles: avg('triangles'), fps: avg('fps') }
}

const results = {}
try {
  await page.goto(`${base}/`)
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak')
  for (const shadows of ['high', 'low']) {
    await page.evaluate(async (s) => {
      const { useSettingsStore } = await import('/src/stores/settingsStore.ts')
      useSettingsStore.getState().set({ shadows: s, maxPixelRatio: 1 })
    }, shadows)
    await setup()
    await page.waitForTimeout(3000)
    results[shadows] = await sample(5)
  }
  await page.screenshot({ path: `node_modules/.tmp/p2-bench-${label}.png` })
  const zombies = await page.evaluate(() => Array.from(window.__runtime.zombies.values()).filter((z) => z.ai !== 'DEAD').length)
  console.log('RENDER BENCH', label, JSON.stringify({ zombies, ...results, errors: errors.length }))
} finally {
  await browser.close()
}
