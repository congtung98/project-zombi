// G0 (graphics plan) baseline: fixed screenshots and render measurements of the graphics lab
// (`?world=graphics-lab`), the same scenes every run so later sprints compare against them.
//   BASE_URL=http://127.0.0.1:5173 PLAYWRIGHT_MODULE=file:///.../playwright/index.mjs CHROMIUM_PATH=... \
//   node scripts/g0-graphics-baseline.mjs [options]
// Options:
//   --label=<name>     report/screenshot folder name (default "baseline")
//   --out=<dir>        output folder (default node_modules/.tmp/graphics/<label>)
//   --jpeg             JPEG screenshots (quality 88) instead of PNG
//   --gpu              real GPU through ANGLE D3D11; without it Chrome renders with SwiftShader (CPU):
//                      frame times are then NOT representative, draw calls/triangles/counts still are
//   --headed           visible browser window (frame pacing closer to a player's browser)
//   --shadows=high|low|off, --dpr=1|1.5|2   game settings (default: high, 1)
//   --warmup=<ms> --sample=<ms>              per scene (default 3000 / 6000)
//   --compare=<dir>    pixel difference of each screenshot against another run's (reproducibility,
//                      or before/after)
// Needs the dev server (window.__runtime, __scene, __gl). Against a production build (vite preview)
// it measures only the load (no scene hooks there).
//
// Fixed per run: viewport 1280×800, device scale = --dpr, camera zoom per scene, time of day, the
// player's position and facing, 8 zombies frozen at fixed points (natural spawns off), mouse never
// moved (no cursor aim). Frame time is the interval between rendered frames (R3F delta) logged for
// every frame of the sample (`runtime.perf.startFrameLog`), reported as median / p95 / p99 / max;
// CPU is first useFrame → end of gl.render. Draw calls and triangles include the shadow pass.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
const out = opt('out', `node_modules/.tmp/graphics/${label}`)
const format = flag('jpeg') ? 'jpeg' : 'png'
const gpu = flag('gpu')
const uncapped = flag('uncapped')
const headed = flag('headed')
const shadows = opt('shadows', 'high')
const dpr = Number(opt('dpr', '1'))
const warmupMs = Number(opt('warmup', '3000'))
const sampleMs = Number(opt('sample', '6000'))
const compareDir = opt('compare', null)
const VIEWPORT = { width: 1280, height: 800 }
const WORLD = 'graphics-lab'
const A = 'c0_0/house-a'

/** Zombies frozen for every scene (street, yard, A's kitchen, B's yard); see src/map/graphicsLab.test.ts. */
const ZOMBIES = [[20, 23.5], [26, 25], [30, 22.5], [9, 25.5], [18, 6.2], [20.3, 9.2], [41, 36], [36, 28]]
/**
 * Scenes: player feet (x, y, z), facing (rad, 0 = +Z), time of day, zoom, lamps switched on. Outside
 * the player faces the street (the zombies there are in sight; facing house A would look into it
 * through a window and cut it away, M11c-1B); inside it faces north.
 */
const SCENES = [
  { name: 'day-outside', at: [15, 0, 20.3], facing: Math.PI / 4, time: 0.5 },
  { name: 'day-inside', at: [13, 0, 13.5], facing: Math.PI, time: 0.5 },
  { name: 'day-upstairs', at: [15, 3, 13.5], facing: Math.PI, time: 0.5 },
  { name: 'day-wide', at: [24, 0, 24], facing: Math.PI / 4, time: 0.5, zoom: 14 },
  { name: 'night-outside', at: [15, 0, 20.3], facing: Math.PI / 4, time: 0.0 },
  { name: 'night-inside-lamp', at: [13, 0, 13.5], facing: Math.PI, time: 0.0, lamps: [`${A}/lamp-living`, `${A}/lamp-kitchen`] },
]

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const launchArgs = gpu
  ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
if (uncapped) launchArgs.push('--disable-frame-rate-limit', '--disable-gpu-vsync')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: !headed, args: launchArgs })
mkdirSync(out, { recursive: true })
const errors = []

const stats = (values) => {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  const mean = s.reduce((n, v) => n + v, 0) / s.length
  const r = (v) => Math.round(v * 100) / 100
  return { n: s.length, mean: r(mean), median: r(q(0.5)), p95: r(q(0.95)), p99: r(q(0.99)), max: r(s[s.length - 1]) }
}

/** Renderer, scene and memory counts in the page (dev hooks). Texture memory is an estimate: see the doc. */
function pageResources() {
  const gl = window.__gl
  const scene = window.__scene
  const ctx = gl.getContext()
  const channels = { 1023: 4, 1028: 1, 1029: 1, 1030: 2, 1026: 1, 1027: 1 }
  const bytesPerChannel = { 1009: 1, 1012: 2, 1014: 4, 1015: 4, 1016: 2, 1020: 4 }
  const MIPMAP = new Set([1004, 1005, 1007, 1008])
  const textures = new Map()
  const addTex = (t, source) => {
    if (!t || !t.isTexture || textures.has(t.uuid)) return
    const w = t.image?.width ?? 0
    const h = t.image?.height ?? 0
    const texel = t.type === 1020 ? 4 : (channels[t.format] ?? 4) * (bytesPerChannel[t.type] ?? 1)
    const mip = t.generateMipmaps && MIPMAP.has(t.minFilter) ? 4 / 3 : 1
    textures.set(t.uuid, { source, w, h, bytes: Math.round(w * h * texel * mip) })
  }
  const geometries = new Set()
  const materials = new Set()
  const c = { objects: 0, meshes: 0, visibleMeshes: 0, batchedMeshes: 0, batchedInstances: 0, instancedMeshes: 0, lights: 0, shadowLights: 0, shadowCasters: 0, transparentMeshes: 0 }
  scene.traverse((o) => {
    c.objects += 1
    if (o.isLight) {
      c.lights += 1
      if (o.castShadow && o.shadow) {
        c.shadowLights += 1
        const sm = o.shadow.map
        if (sm) {
          addTex(sm.texture, 'shadow-map')
          addTex(sm.depthTexture, 'shadow-depth')
        }
      }
    }
    if (!o.isMesh && !o.isLine && !o.isPoints) return
    c.meshes += 1
    let visible = true
    for (let p = o; p; p = p.parent) if (!p.visible) visible = false
    if (visible) c.visibleMeshes += 1
    if (o.isBatchedMesh) {
      c.batchedMeshes += 1
      c.batchedInstances += o.instanceCount ?? 0
      addTex(o._matricesTexture, 'batch-matrices')
      addTex(o._colorsTexture, 'batch-colors')
      addTex(o._indirectTexture, 'batch-indirect')
    }
    if (o.isInstancedMesh) c.instancedMeshes += 1
    if (o.castShadow) c.shadowCasters += 1
    if (o.geometry) geometries.add(o.geometry)
    for (const m of [o.material].flat()) {
      if (!m) continue
      materials.add(m)
      if (m.transparent && visible) c.transparentMeshes += 1
      for (const v of Object.values(m)) addTex(v, 'material')
      if (m.uniforms) for (const u of Object.values(m.uniforms)) addTex(u?.value, 'uniform')
    }
  })
  for (const t of window.__g0ExtraTextures ?? []) addTex(t, 'indoor-mask')
  let geometryBytes = 0
  for (const g of geometries) {
    for (const a of Object.values(g.attributes)) geometryBytes += a.array?.byteLength ?? 0
    geometryBytes += g.index?.array?.byteLength ?? 0
  }
  const samples = ctx.getParameter(ctx.SAMPLES)
  const fb = ctx.drawingBufferWidth * ctx.drawingBufferHeight
  const texList = [...textures.values()]
  const bySource = {}
  for (const t of texList) bySource[t.source] = (bySource[t.source] ?? 0) + t.bytes
  return {
    counts: { ...c, uniqueGeometries: geometries.size, uniqueMaterials: materials.size, uniqueTextures: textures.size },
    rendererMemory: { geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, programs: gl.info.programs?.length ?? null },
    estimateBytes: {
      textures: texList.reduce((n, t) => n + t.bytes, 0),
      texturesBySource: bySource,
      // Colour + depth/stencil, 4 bytes each per sample, plus the resolved colour buffer.
      framebuffer: fb * 8 * Math.max(1, samples) + fb * 4,
      geometry: geometryBytes,
    },
    jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
  }
}

async function environment(page) {
  const pageEnv = await page.evaluate(() => {
    const probe = document.createElement('canvas').getContext('webgl2')
    const ext = probe?.getExtension('WEBGL_debug_renderer_info')
    const gl = window.__gl
    const ctx = gl?.getContext()
    const toneMapping = { 0: 'None', 1: 'Linear', 2: 'Reinhard', 3: 'Cineon', 4: 'ACESFilmic', 5: 'Custom', 6: 'AgX', 7: 'Neutral' }
    const shadowType = { 0: 'Basic', 1: 'PCF', 2: 'PCFSoft', 3: 'VSM' }
    return {
      userAgent: navigator.userAgent,
      gpuRenderer: ext ? probe.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown',
      gpuVendor: ext ? probe.getParameter(ext.UNMASKED_VENDOR_WEBGL) : 'unknown',
      devicePixelRatio: window.devicePixelRatio,
      renderer: gl
        ? {
            pixelRatio: gl.getPixelRatio(),
            drawingBuffer: [ctx.drawingBufferWidth, ctx.drawingBufferHeight],
            msaaSamples: ctx.getParameter(ctx.SAMPLES),
            maxTextureSize: ctx.getParameter(ctx.MAX_TEXTURE_SIZE),
            toneMapping: toneMapping[gl.toneMapping] ?? gl.toneMapping,
            toneMappingExposure: gl.toneMappingExposure,
            outputColorSpace: gl.outputColorSpace,
            shadowMap: { enabled: gl.shadowMap.enabled, type: shadowType[gl.shadowMap.type] ?? gl.shadowMap.type },
          }
        : null,
      camera: window.__runtime ? { offset: window.__runtime.config.camera.offset, zoomDefault: window.__runtime.config.camera.zoomDefault, projection: 'orthographic (px per m = zoom)' } : null,
    }
  })
  let three = null
  try {
    three = JSON.parse(readFileSync('node_modules/three/package.json', 'utf8')).version
  } catch {
    // Not run from the repo root.
  }
  return {
    machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryGB: Math.round(os.totalmem() / 2 ** 30), os: `${os.platform()} ${os.release()}` },
    browser: { version: browser.version(), headless: !headed, gpuMode: gpu ? 'ANGLE D3D11 (hardware)' : 'SwiftShader (software)', args: launchArgs },
    server: base,
    three,
    viewport: VIEWPORT,
    deviceScaleFactor: dpr,
    settings: { shadows, maxPixelRatio: dpr, visionOverlay: true },
    warmupMs,
    sampleMs,
    zombies: ZOMBIES.length,
    ...pageEnv,
  }
}

/** Screenshot of the page, the other run's copy, both decoded in the page: share of pixels that differ. */
async function pixelDiff(page, a, b) {
  const mime = (p) => (p.endsWith('.png') ? 'image/png' : 'image/jpeg')
  const urlA = `data:${mime(a)};base64,${readFileSync(a).toString('base64')}`
  const urlB = `data:${mime(b)};base64,${readFileSync(b).toString('base64')}`
  return page.evaluate(async ([ua, ub]) => {
    const load = (src) => new Promise((ok, fail) => {
      const img = new Image()
      img.onload = () => ok(img)
      img.onerror = fail
      img.src = src
    })
    const [ia, ib] = await Promise.all([load(ua), load(ub)])
    if (ia.width !== ib.width || ia.height !== ib.height) return { sameSize: false }
    const read = (img) => {
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      return g.getImageData(0, 0, c.width, c.height).data
    }
    const da = read(ia)
    const db = read(ib)
    let changed = 0
    let sum = 0
    const n = da.length / 4
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]))
      sum += d
      if (d > 24) changed += 1
    }
    return { sameSize: true, changedShare: Math.round((changed / n) * 10000) / 100, meanAbsDiff: Math.round((sum / n) * 100) / 100 }
  }, [urlA, urlB])
}

const report = { label, date: new Date().toISOString(), world: WORLD, environment: null, load: {}, scenes: [], lifecycle: null, errors }
try {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: dpr })
  await context.addInitScript(([s, r]) => localStorage.setItem('zombie-outbreak.settings.v1', JSON.stringify({ shadows: s, maxPixelRatio: r, visionOverlay: true, showHints: false })), [shadows, dpr])
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  // Load: cold (fresh context, empty cache) and warm (reload, HTTP cache) until the menu shows.
  const menu = async () => {
    const t0 = Date.now()
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 120000 })
    return Date.now() - t0
  }
  const transfer = () => page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const res = performance.getEntriesByType('resource')
    const sum = (k) => res.reduce((n, r) => n + (r[k] ?? 0), 0) + (nav?.[k] ?? 0)
    return { requests: res.length + 1, transferBytes: sum('transferSize'), encodedBytes: sum('encodedBodySize'), decodedBytes: sum('decodedBodySize'), domContentLoadedMs: Math.round(nav?.domContentLoadedEventEnd ?? 0), loadEventMs: Math.round(nav?.loadEventEnd ?? 0) }
  })
  const url = `${base}/?world=${WORLD}`
  let t = Date.now()
  await page.goto(url)
  await menu()
  report.load.cold = { menuMs: Date.now() - t, ...(await transfer()) }
  t = Date.now()
  await page.reload()
  await menu()
  report.load.warm = { menuMs: Date.now() - t, ...(await transfer()) }
  t = Date.now()
  await page.getByRole('button', { name: 'New Game', exact: true }).click()
  await page.waitForFunction(() => document.body.innerText.includes('Tạo nhân vật'))
  await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('h1') && document.querySelector('.hud'), null, { timeout: 120000 })
  const dev = await page.evaluate(() => !!window.__runtime)
  if (dev) await page.waitForFunction(() => window.__runtime.playerBody && window.__gl, null, { timeout: 60000 })
  report.load.startGameMs = Date.now() - t
  report.environment = await environment(page)
  if (!dev) {
    report.note = 'No dev hooks (production build): load only.'
  } else {
    // The indoor mask texture lives in a module uniform, not on a material: hand it to the counter.
    await page.evaluate(async () => {
      const { indoorUniforms } = await import('/src/game/rendering/indoorShading.ts')
      window.__g0ExtraTextures = [indoorUniforms.uVisMap.value]
    })
    await page.evaluate((zombies) => {
      const rt = window.__runtime
      rt.spawnTimer = 1e9
      for (const z of rt.zombies.values()) z.health = 0
      let i = 0
      for (const [x, zz] of zombies) {
        const z = rt.spawnZombie({ x, y: 0, z: zz })
        rt.events.queue('zombie:spawned', { id: z.id })
        z.staggerTimer = 1e9
        z.facing = (i++ * Math.PI) / 4
      }
      rt.events.flush()
    }, ZOMBIES)
    await page.waitForTimeout(1500)

    for (const scene of SCENES) {
      await page.evaluate((s) => {
        const rt = window.__runtime
        const [x, y, z] = s.at
        rt.player.position = { x, y, z }
        rt.player.facing = s.facing
        rt.playerBody.setTranslation({ x, y: y + rt.config.player.height / 2 + 0.02, z }, true)
        rt.playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
        rt.cameraZoom = s.zoom ?? rt.config.camera.zoomDefault
        for (const lamp of rt.map.rooms ?? []) if (lamp.lamp) rt.setLamp(lamp.lamp.id, (s.lamps ?? []).includes(lamp.lamp.id))
        rt.clock.restore(rt.clock.elapsed, s.time, rt.clock.day)
        rt.player.health = rt.config.player.maxHealth
        rt.player.hunger = 100
        rt.player.thirst = 100
      }, scene)
      await page.waitForTimeout(warmupMs)
      await page.evaluate(() => window.__runtime.perf.startFrameLog())
      await page.waitForTimeout(sampleMs)
      const log = await page.evaluate(() => window.__runtime.perf.takeFrameLog())
      // Time of day back to the scene's before the picture (the clock ran during the sample).
      await page.evaluate((time) => window.__runtime.clock.restore(window.__runtime.clock.elapsed, time, window.__runtime.clock.day), scene.time)
      await page.waitForTimeout(300)
      const file = join(out, `${scene.name}.${format === 'jpeg' ? 'jpg' : 'png'}`)
      await page.screenshot({ path: file, type: format, ...(format === 'jpeg' ? { quality: 88 } : {}) })
      const state = await page.evaluate(() => {
        const rt = window.__runtime
        return {
          player: { ...rt.player.position },
          zoom: rt.cameraZoom,
          timeOfDay: Math.round(rt.clock.timeOfDay * 1000) / 1000,
          zombiesAlive: [...rt.zombies.values()].filter((z) => z.ai !== 'DEAD').length,
          cutaway: window.__cutaway?.debugState() ?? null,
        }
      })
      const resources = await page.evaluate(pageResources)
      const entry = {
        scene: scene.name,
        screenshot: file,
        state,
        frameMs: stats(log.intervalMs),
        fpsFromMean: log.intervalMs.length ? Math.round((1000 / (log.intervalMs.reduce((n, v) => n + v, 0) / log.intervalMs.length)) * 10) / 10 : null,
        cpuMs: stats(log.cpuMs),
        drawCalls: stats(log.drawCalls),
        triangles: stats(log.triangles),
        ...resources,
      }
      if (compareDir) {
        const other = [`${scene.name}.png`, `${scene.name}.jpg`].map((f) => join(compareDir, f)).find((f) => existsSync(f))
        entry.compare = other ? { against: other, ...(await pixelDiff(page, file, other)) } : { against: null }
      }
      report.scenes.push(entry)
      console.log(`${scene.name.padEnd(18)} frame median ${entry.frameMs?.median} p95 ${entry.frameMs?.p95} ms | cpu median ${entry.cpuMs?.median} | calls ${entry.drawCalls?.median} | tris ${entry.triangles?.median} | textures ${resources.rendererMemory.textures} geometries ${resources.rendererMemory.geometries}${entry.compare ? ` | diff ${entry.compare.changedShare}%` : ''}`)
    }

    // Lifecycle: in and out of house A ten times, day and night; renderer counts must come back.
    const before = await page.evaluate(() => ({ ...window.__gl.info.memory, programs: window.__gl.info.programs?.length ?? null }))
    for (let i = 0; i < 10; i++) {
      for (const [x, y, z, time] of [[13, 0, 13.5, 0.5], [15, 3, 13.5, 0.0], [15, 0, 20.3, 0.5]]) {
        await page.evaluate(([x, y, z, time]) => {
          const rt = window.__runtime
          rt.player.position = { x, y, z }
          rt.playerBody.setTranslation({ x, y: y + rt.config.player.height / 2 + 0.02, z }, true)
          rt.clock.restore(rt.clock.elapsed, time, rt.clock.day)
        }, [x, y, z, time])
        await page.waitForTimeout(250)
      }
    }
    await page.waitForTimeout(500)
    const after = await page.evaluate(() => ({ ...window.__gl.info.memory, programs: window.__gl.info.programs?.length ?? null }))
    report.lifecycle = { cycles: 10, before, after }
    console.log('lifecycle', JSON.stringify(report.lifecycle))
  }
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`report ${join(out, 'report.json')} | errors ${errors.length}`)
  if (errors.length) console.log(errors.slice(0, 5))
  await browser.close()
}
