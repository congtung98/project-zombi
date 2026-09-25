// R0–R2 browser benchmark (dev server only: needs window.__runtime). For the normal map and the
// `?stress=4` map: standing still, walking (real keys) and a crowd of extra zombies around the player.
// Reads `runtime.perf` (simulation sections, counters, frame interval, draw calls, triangles, scene
// objects; the perf HUD is opened with `?perf=1`) after a warm-up. Prints one JSON line per case.
//   BASE_URL=http://127.0.0.1:5174 PLAYWRIGHT_MODULE=file:///.../playwright/index.mjs CHROMIUM_PATH=... \
//   node scripts/r0-perf-browser.mjs [label] [--gpu]
// `--gpu` asks Chrome for the real GPU (ANGLE D3D11); without it SwiftShader renders in software and
// FPS / frame time are NOT representative (draw calls, triangles and simulation ms still are).
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const label = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? 'current'
const gpu = process.argv.includes('--gpu')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: gpu
    ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const results = []
const errors = []

async function runMap(query, crowd) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/?perf=1${query}`)
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 60000 })
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'
  })
  await page.evaluate(async () => {
    const rt = window.__runtime
    const { useUiStore } = await import('/src/stores/uiStore.ts')
    const { useWorldStore } = await import('/src/stores/worldStore.ts')
    const { useSettingsStore } = await import('/src/stores/settingsStore.ts')
    useSettingsStore.getState().set({ maxPixelRatio: 1 })
    rt.newGame(20260925)
    rt.spawnTimer = 1e9
    useWorldStore.getState().syncFromRuntime(rt)
    useUiStore.setState({ screen: 'playing', sessionId: rt.sessionId, sceneReady: false })
  })
  await page.waitForFunction(() => document.querySelector('.perf-hud'), null, { timeout: 60000 })
  await page.waitForTimeout(1000)
  // Start at the (first tile's) crossroads, outdoors, so walking does not hit the safehouse walls.
  await page.evaluate(() => {
    const rt = window.__runtime
    const p = { x: rt.map.playerSpawn.x + 10, y: 0.9, z: rt.map.playerSpawn.z + 8 }
    rt.playerBody?.setTranslation(p, true)
    rt.player.position = { ...p }
  })
  await page.mouse.move(640, 300)

  const sample = async (name, seconds) => {
    await page.waitForTimeout(2500)
    const snaps = []
    for (let i = 0; i < seconds * 2; i++) {
      await page.waitForTimeout(500)
      snaps.push(await page.evaluate(() => {
        const rt = window.__runtime
        rt.player.health = rt.config.player.maxHealth
        rt.player.hunger = 100
        rt.player.thirst = 100
        return rt.perf.snapshot()
      }))
    }
    const avg = (f) => +(snaps.reduce((n, s) => n + f(s), 0) / snaps.length).toFixed(3)
    const max = (f) => +Math.max(...snaps.map(f)).toFixed(2)
    results.push({
      label,
      case: `${query ? 'stress' : 'normal'}/${name}`,
      renderer,
      fps: avg((s) => s.frame.fps),
      frameMs: avg((s) => s.frame.avgMs),
      worstFrameMs: max((s) => s.frame.maxMs),
      frameCpuMs: avg((s) => s.frame.cpuAvgMs),
      worstFrameCpuMs: max((s) => s.frame.cpuMaxMs),
      simMs: avg((s) => s.avgMs.sim),
      aiMs: avg((s) => s.avgMs.ai),
      moveMs: avg((s) => s.avgMs.movement),
      navMs: avg((s) => s.avgMs.nav),
      visionMs: avg((s) => s.avgMs.vision),
      worstSimMs: max((s) => s.maxMs.sim),
      drawCalls: avg((s) => s.gauges.drawCalls),
      triangles: avg((s) => s.gauges.triangles),
      sceneObjects: avg((s) => s.gauges.sceneObjects),
      zombies: avg((s) => s.gauges.zombies),
      active: avg((s) => s.gauges.zombiesActive),
      bodies: avg((s) => s.gauges.zombieBodies),
      aiUpdates: avg((s) => s.avgCount.aiUpdates),
      pathReq: avg((s) => s.avgCount.pathRequests),
      losRays: avg((s) => s.avgCount.visionRaycasts + s.avgCount.zombieRaycasts + s.avgCount.otherRaycasts),
      separation: avg((s) => s.avgCount.separationChecks),
    })
    console.log('R0 BROWSER', JSON.stringify(results.at(-1)))
  }

  await sample('standing', 5)
  await page.keyboard.down('KeyW')
  await page.keyboard.down('KeyD')
  await sample('moving', 5)
  await page.keyboard.up('KeyW')
  await page.keyboard.up('KeyD')
  await page.evaluate((n) => {
    const rt = window.__runtime
    const p = rt.player.position
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const r = 4 + (i % 5) * 1.6
      const cell = rt.nav.nearestWalkableCell(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, 6)
      if (!cell) continue
      const z = rt.spawnZombie(rt.nav.cellToWorld(cell.cx, cell.cz))
      rt.events.queue('zombie:spawned', { id: z.id })
    }
  }, crowd)
  await sample('crowd', 5)
  await page.close()
}

try {
  await runMap('', 30)
  await runMap('&stress=4', 100)
} finally {
  await browser.close()
}
console.log('R0 BROWSER DONE', JSON.stringify({ label, cases: results.length, errors }))
