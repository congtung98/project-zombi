// C0 (character plan): crowd benchmark for character rendering and animation, the same scene every
// sprint. Default world (neighborhood-50), the player stands on the street at (3, 0, 3) facing the
// camera's diagonal, invulnerable; N zombies (fixed ring positions) hunt it with the normal AI, so they
// walk, crowd and attack. Per density: frame interval, CPU, posing time (`animatorMs`), draw calls,
// triangles, character meshes/materials; then a spawn/remove lifecycle (renderer memory must return).
//   BASE_URL=... PLAYWRIGHT_MODULE=... CHROMIUM_PATH=... node scripts/c0-character-bench.mjs \
//     [--label=c0] [--gpu] [--uncapped] [--densities=0,10,30] [--warmup=2500] [--sample=6000] [--docs=<dir>]
// Needs the dev server (window.__runtime, __scene, __gl). Report: node_modules/.tmp/character/<label>/bench.json
import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const label = opt('label', 'baseline')
const out = opt('out', `node_modules/.tmp/character/${label}`)
const gpu = flag('gpu')
const uncapped = flag('uncapped')
const densities = opt('densities', '0,10,30').split(',').map(Number)
const warmupMs = Number(opt('warmup', '2500'))
const sampleMs = Number(opt('sample', '6000'))
const graphics = opt('graphics', 'medium')
const shadows = opt('shadows', 'high')
const docsDir = opt('docs', null)
const AT = { x: 3, y: 0, z: 3 }

const launchArgs = gpu ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
if (uncapped) launchArgs.push('--disable-frame-rate-limit', '--disable-gpu-vsync')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: launchArgs })
mkdirSync(out, { recursive: true })
if (docsDir) mkdirSync(docsDir, { recursive: true })
const errors = []

const stats = (values) => {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  const r = (v) => Math.round(v * 100) / 100
  return { n: s.length, mean: r(s.reduce((n, v) => n + v, 0) / s.length), median: r(q(0.5)), p95: r(q(0.95)), max: r(s[s.length - 1]) }
}

/** Meshes and materials that belong to characters (under a root named 'character'), visible ones. */
function characterCounts() {
  const roots = []
  window.__scene.traverse((o) => { if (o.name === 'character') roots.push(o) })
  let meshes = 0
  let visibleMeshes = 0
  let casters = 0
  let skinned = 0
  const materials = new Set()
  const geometries = new Set()
  let triangles = 0
  for (const root of roots) {
    let shown = true
    for (let p = root; p; p = p.parent) if (!p.visible) shown = false
    root.traverse((o) => {
      if (!o.isMesh) return
      meshes++
      if (o.isSkinnedMesh) skinned++
      let v = shown
      for (let p = o; p && p !== root; p = p.parent) if (!p.visible) v = false
      if (!v) return
      visibleMeshes++
      if (o.castShadow) casters++
      for (const m of [o.material].flat()) materials.add(m)
      geometries.add(o.geometry)
      const g = o.geometry
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3
    })
  }
  const shown = roots.filter((r) => { for (let p = r; p; p = p.parent) if (!p.visible) return false; return true }).length
  return { characters: roots.length, shown, meshes, skinned, visibleMeshes, shadowCasters: casters, materials: materials.size, geometries: geometries.size, triangles: Math.round(triangles) }
}

const report = { label, date: new Date().toISOString(), environment: null, densities: [], lifecycle: null, errors }
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  await context.addInitScript(([s, g]) => localStorage.setItem('zombie-outbreak.settings.v1', JSON.stringify({ shadows: s, maxPixelRatio: 1, visionOverlay: true, showHints: false, graphics: g })), [shadows, graphics])
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(`${base}/`)
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 120000 })
  await page.getByRole('button', { name: 'New Game', exact: true }).click()
  await page.waitForFunction(() => document.body.innerText.includes('Tạo nhân vật'))
  await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click()
  await page.waitForFunction(() => window.__runtime?.playerBody && window.__gl && document.querySelector('.hud'), null, { timeout: 120000 })
  report.environment = await page.evaluate(() => {
    const probe = document.createElement('canvas').getContext('webgl2')
    const ext = probe?.getExtension('WEBGL_debug_renderer_info')
    return { userAgent: navigator.userAgent, gpu: ext ? probe.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', pixelRatio: window.__gl.getPixelRatio() }
  })
  report.environment.machine = { cpu: os.cpus()[0]?.model, cores: os.cpus().length, os: `${os.platform()} ${os.release()}` }
  report.environment.browser = { version: browser.version(), headless: true, gpu: gpu ? 'ANGLE D3D11' : 'SwiftShader', uncapped }
  report.environment.settings = { shadows, graphics, viewport: '1280x800', dpr: 1, zoom: 28, warmupMs, sampleMs }

  // Invulnerable player at the fixed spot, natural spawns off, noon.
  await page.evaluate((at) => {
    const rt = window.__runtime
    rt.spawnTimer = 1e9
    for (const z of rt.zombies.values()) rt.removeZombie(z.id)
    rt.events.flush()
    rt.player.position = { ...at }
    rt.player.facing = Math.PI / 4
    rt.playerBody.setTranslation({ x: at.x, y: at.y + rt.config.player.height / 2 + 0.02, z: at.z }, true)
    rt.cameraZoom = rt.config.camera.zoomDefault
    rt.clock.restore(rt.clock.elapsed, 0.5, rt.clock.day)
    window.__god = setInterval(() => {
      const p = rt.player
      p.health = rt.config.player.maxHealth
      p.hunger = 100
      p.thirst = 100
      rt.clock.restore(rt.clock.elapsed, 0.5, rt.clock.day)
    }, 50)
  }, AT)
  await page.waitForTimeout(1500)

  const spawnRing = (n) => page.evaluate(([n, at]) => {
    const rt = window.__runtime
    for (let i = 0; i < n; i++) {
      // Golden-angle ring 4–10 m around the player: the same points every run.
      const a = i * 2.39996
      const r = 4 + (i % 7)
      const z = rt.spawnZombie({ x: at.x + Math.cos(a) * r, y: 0, z: at.z + Math.sin(a) * r })
      rt.events.queue('zombie:spawned', { id: z.id })
    }
    rt.events.flush()
  }, [n, AT])
  const clearZombies = () => page.evaluate(() => {
    const rt = window.__runtime
    for (const z of [...rt.zombies.values()]) rt.removeZombie(z.id)
    rt.events.flush()
  })

  for (const n of densities) {
    await clearZombies()
    await page.evaluate((at) => {
      const rt = window.__runtime
      rt.player.position = { ...at }
      rt.playerBody.setTranslation({ x: at.x, y: at.y + rt.config.player.height / 2 + 0.02, z: at.z }, true)
    }, AT)
    await spawnRing(n)
    await page.waitForTimeout(warmupMs)
    await page.evaluate(() => window.__runtime.perf.startFrameLog())
    await page.waitForTimeout(sampleMs)
    const log = await page.evaluate(() => window.__runtime.perf.takeFrameLog())
    const chars = await page.evaluate(characterCounts)
    const memory = await page.evaluate(() => ({ ...window.__gl.info.memory, programs: window.__gl.info.programs?.length ?? null }))
    const states = await page.evaluate(() => {
      const c = {}
      for (const z of window.__runtime.zombies.values()) c[z.ai] = (c[z.ai] ?? 0) + 1
      return c
    })
    await page.screenshot({ path: join(out, `bench-${n}.png`) })
    if (docsDir) await page.screenshot({ path: join(docsDir, `bench-${n}.jpg`), type: 'jpeg', quality: 85 })
    const entry = { zombies: n, ai: states, frameMs: stats(log.intervalMs), cpuMs: stats(log.cpuMs), animatorMs: stats(log.animatorMs ?? []), drawCalls: stats(log.drawCalls), triangles: stats(log.triangles), characters: chars, memory }
    report.densities.push(entry)
    console.log(`${String(n).padStart(3)} zombies | frame ${entry.frameMs?.median}/${entry.frameMs?.p95} ms | cpu ${entry.cpuMs?.median}/${entry.cpuMs?.p95} | anim ${entry.animatorMs?.median}/${entry.animatorMs?.p95} | calls ${entry.drawCalls?.median} | tris ${entry.triangles?.median} | char meshes ${chars.visibleMeshes} (${chars.characters} chars, ${chars.materials} mats) | ${JSON.stringify(states)}`)
  }

  // Lifecycle: 8 cycles of spawning 20 zombies and removing them; renderer memory must come back.
  await clearZombies()
  await page.waitForTimeout(800)
  const before = await page.evaluate(() => ({ ...window.__gl.info.memory, programs: window.__gl.info.programs?.length ?? null, heap: performance.memory?.usedJSHeapSize ?? null }))
  for (let i = 0; i < 8; i++) {
    await spawnRing(20)
    await page.waitForTimeout(700)
    await clearZombies()
    await page.waitForTimeout(300)
  }
  await page.waitForTimeout(800)
  const after = await page.evaluate(() => ({ ...window.__gl.info.memory, programs: window.__gl.info.programs?.length ?? null, heap: performance.memory?.usedJSHeapSize ?? null }))
  report.lifecycle = { cycles: 8, zombiesPerCycle: 20, before, after }
  console.log('lifecycle', JSON.stringify(report.lifecycle))
} finally {
  writeFileSync(join(out, 'bench.json'), JSON.stringify(report, null, 2))
  console.log(`report ${join(out, 'bench.json')} | errors ${errors.length}`)
  if (errors.length) console.log(errors.slice(0, 5))
  await browser.close()
}
