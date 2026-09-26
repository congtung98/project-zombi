// M11c-1A (building cutaway on storeys) browser check with Playwright (fresh isolated context, dev
// server: it reads the game through window.__runtime and window.__cutaway).
//   BASE_URL=http://127.0.0.1:5174 node scripts/m11c1a-cutaway-browser.mjs
//   BASELINE=1 … only takes the screenshots (no assertions): the "before" pictures.
//   SHADOW_MAP=1 … also prints the shadow maps of the grass grid (debug).
// Set PLAYWRIGHT_MODULE (file:// URL of playwright/index.mjs) and CHROMIUM_PATH when needed.
// On the lab world `cutaway-lab` (`?world=cutaway-lab`: three copies of a two-storey house with two
// ground rooms split by a solid wall, a camera-side window, enclosed stairs, upstairs furniture):
// far away, outside by the window, inside the ground floor, on the stairs, upstairs, at night and
// next to the neighbouring copy. Screenshots in node_modules/.tmp/m11c1a-<scene>-<before|after>.png.
// Then (not in BASELINE): which building/storey is cut in each scene; what is drawn on the ground
// floor (upstairs door, lamps and panes hidden, camera-side door cut, far door whole); real keys in
// and out of the front door and up and down the flight with the view sampled every frame (one
// change each way, no flicker); the sun shadow of the cut storey still on the grass; lights and
// room light identical inside and outside; the F6 cutaway label and per-storey room labels.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const baseline = process.env.BASELINE === '1'
const phase = baseline ? 'before' : 'after'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const tmp = 'node_modules/.tmp'
mkdirSync(tmp, { recursive: true })
const log = (label, value) => console.log(label.padEnd(30), typeof value === 'string' ? value : JSON.stringify(value))
const errors = []
const A = 'c0_0/house-a'
const B = 'c0_0/house-b'

/**
 * A new game on the lab in a fresh context (`overlay: false` switches the vision overlay off
 * through the saved settings, for the shadow measurement). The helpers below use the current one.
 */
async function newGame({ overlay = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  if (!overlay) await context.addInitScript(() => localStorage.setItem('zombie-outbreak.settings.v1', JSON.stringify({ visionOverlay: false })))
  const pg = await context.newPage()
  pg.on('pageerror', (e) => errors.push(e.message))
  pg.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await pg.goto(`${base}/?world=cutaway-lab`).catch(() => pg.goto(`${base}/?world=cutaway-lab`))
  await pg.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 60000 })
  await pg.getByRole('button', { name: 'New Game', exact: true }).click()
  await pg.waitForFunction(() => document.body.innerText.includes('Tạo nhân vật'))
  await pg.getByRole('button', { name: 'Bắt đầu', exact: true }).click()
  await pg.waitForFunction(() => !document.querySelector('h1') && document.querySelector('.hud') && window.__runtime?.playerBody, null, { timeout: 60000 })
  await pg.evaluate(([a, b]) => {
    const rt = window.__runtime
    rt.spawnTimer = 1e9
    for (const z of rt.zombies.values()) z.health = 0
    rt.setDoorState(`${a}/door`, 'open')
    rt.setDoorState(`${b}/door`, 'open')
    rt.clock.restore(rt.clock.elapsed, 0.5, rt.clock.day)
  }, [A, B])
  return pg
}
let page = null

/** Put the player's body (and the simulation) on the floor at (x, y, z), facing `facing`. */
const teleport = (x, y, z, facing = Math.PI) => page.evaluate(([x, y, z, facing]) => {
  const rt = window.__runtime
  rt.player.position = { x, y, z }
  rt.player.facing = facing
  rt.playerBody.setTranslation({ x, y: y + rt.config.player.height / 2 + 0.02, z }, true)
  rt.playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
}, [x, y, z, facing])
const player = () => page.evaluate(() => ({ ...window.__runtime.player.position }))
async function hold(keys, ms) {
  for (const k of keys) await page.keyboard.down(k)
  await page.waitForTimeout(ms)
  for (const k of keys) await page.keyboard.up(k)
  await page.waitForTimeout(150)
}
const setTime = (timeOfDay) => page.evaluate((t) => window.__runtime.clock.restore(window.__runtime.clock.elapsed, t, window.__runtime.clock.day), timeOfDay)
const shot = (name) => page.screenshot({ path: `${tmp}/m11c1a-${name}-${phase}.png` })
/** The composer's view (after the change) or null (before it). */
const view = () => page.evaluate(() => window.__cutaway?.debugState() ?? null)

try {
  page = await newGame()
  const setup = await page.evaluate(() => {
    const rt = window.__runtime
    return { world: rt.map.id, buildings: rt.map.buildings.map((x) => x.id), floors: rt.map.floors.length, stairs: rt.map.stairs.length }
  })
  log('world', setup)
  assert.equal(setup.world, 'cutaway-lab')
  await page.waitForTimeout(800)

  // House A spans x 7..17, z 8..16: living room x 7..13 (window in the south wall at x 9.5), store
  // room x 13..17 behind a solid wall; the flight climbs +X along z 8.9 from x 8.8 to 12.8.
  const scenes = [
    ['far', 24, 0, 21, Math.PI],
    ['window', 9.5, 0, 17.3, Math.PI],
    ['ground', 9, 0, 11.5, Math.PI],
    ['stairs', 10.8, 1.5, 8.9, Math.PI / 2],
    ['upstairs', 11, 3, 14, Math.PI],
    ['landing', 14.2, 3, 9.2, -Math.PI / 2],
    ['beside-b', 22.6, 0, 12, Math.PI / 2],
  ]
  const expected = { far: [null, null], window: [null, null], ground: [A, 0], stairs: [A, 0], upstairs: [A, 1], landing: [A, 1], 'beside-b': [null, null] }
  for (const [name, x, y, z, facing] of scenes) {
    await teleport(x, y, z, facing)
    await page.waitForTimeout(700)
    const state = await view()
    log(name, { player: await page.evaluate(() => window.__runtime.player.position), view: state })
    await shot(name)
    if (baseline) continue
    // Outside, the player is in no building (M11c-1B may still cut one it looks into: `peeks`).
    assert.deepEqual([state.building, state.level], expected[name], name)
    if (state.building) assert.equal(state.shadows, state.hidden + state.cut, `${name}: every cut or hidden piece keeps its shadow`)
  }
  // Night inside the ground floor, lamps off then the living room lamp on.
  await teleport(9, 0, 11.5, Math.PI)
  await setTime(0.0)
  await page.waitForTimeout(900)
  await shot('night-off')
  await page.evaluate((a) => window.__runtime.setLamp(`${a}/lamp-living`, true), A)
  await page.waitForTimeout(900)
  await shot('night-on')
  await setTime(0.5)

  if (!baseline) {
    // 1. Ground floor pieces (the composer's own record) and what the scene draws.
    await teleport(9, 0, 11.5, Math.PI)
    await page.waitForTimeout(600)
    const pieces = await page.evaluate(([a, b]) => ({ a: window.__cutaway.pieces(a), b: window.__cutaway.pieces(b) }), [A, B])
    const upper = pieces.a.filter((p) => p.min[1] >= 2.79 && p.role !== 'stairs')
    log('ground floor: upper pieces', { count: upper.length, shows: [...new Set(upper.map((p) => p.show))] })
    assert.ok(upper.length > 10 && upper.every((p) => p.show === 'hidden'), 'roof, upper slab, walls and furniture hidden')
    const byId = (prefix) => [...new Set(pieces.a.filter((p) => p.id?.startsWith(`${A}/${prefix}`)).map((p) => p.show))].sort()
    assert.deepEqual(byId('wall-n#'), ['full'])
    assert.deepEqual(byId('wall-w#'), ['full'])
    assert.deepEqual(byId('wall-s#'), ['cut', 'hidden'])
    assert.deepEqual(byId('wall-mid#'), ['cut'])
    assert.ok(pieces.b.every((p) => p.show === 'full'), 'the other copy of the prefab is whole')
    const drawn = await page.evaluate(() => {
      const out = { leaves: [], panes: [], fixtures: [], switches: [] }
      const scene = window.__scene
      scene.updateMatrixWorld(true)
      const shown = (o) => {
        for (let x = o; x; x = x.parent) if (!x.visible) return false
        return true
      }
      scene.traverse((o) => {
        const g = o.geometry?.parameters
        if (!o.isMesh || !g) return
        const p = o.getWorldPosition(o.position.clone())
        const height = (g.height ?? 0) * o.getWorldScale(o.position.clone()).y
        const at = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 100) / 100, z: Math.round(p.z * 10) / 10, shown: shown(o), height: Math.round(height * 100) / 100 }
        if (g.depth === 0.12 && g.height >= 1.9) out.leaves.push(at)
        if ((g.depth === 0.04 || g.width === 0.04) && o.material?.transparent) out.panes.push(at)
        if (g.width === 0.55 && g.height === 0.06) out.fixtures.push(at)
        if (g.width === 0.1 && g.height === 0.14 && g.depth === 0.1) out.switches.push(at)
      })
      return out
    })
    const inA = (o) => o.x >= 6.5 && o.x <= 17.5 && o.z >= 7.5 && o.z <= 16.5
    for (const k of Object.keys(drawn)) drawn[k] = drawn[k].filter(inA)
    log('ground floor: drawn', drawn)
    const leafAt = (x, z) => drawn.leaves.find((l) => Math.abs(l.x - x) < 0.8 && Math.abs(l.z - z) < 0.8)
    // Front door (west wall, faces away): whole; store door (east wall, faces the camera): cut down
    // with its wall; bedroom door (upstairs): hidden.
    assert.ok(leafAt(7, 13)?.shown && leafAt(7, 13).height > 2, `front door whole: ${JSON.stringify(leafAt(7, 13))}`)
    assert.ok(leafAt(17, 14)?.shown && leafAt(17, 14).height < 0.7, `store door cut: ${JSON.stringify(leafAt(17, 14))}`)
    assert.ok(leafAt(15, 11) && !leafAt(15, 11).shown, 'bedroom door hidden')
    // Panes: the south (camera-side) and upstairs ones hidden, the store's north window drawn.
    assert.deepEqual(drawn.panes.filter((p) => p.shown).map((p) => [p.x, p.z]), [[15, 8]])
    // Ceiling lamps: the ground floor's drawn, the upper floor's hidden. Switches: on the west (far)
    // wall drawn where it is; on the east (camera-side) wall, cut to 0.6 m, drawn on the wall's top
    // (x 16.85..17.15, y 0.6 + 0.07); upstairs hidden.
    assert.deepEqual(drawn.fixtures.filter((f) => f.shown).map((f) => f.y < 3), [true, true])
    const switches = drawn.switches.filter((s) => s.shown)
    assert.equal(switches.length, 2, JSON.stringify(drawn.switches))
    assert.deepEqual([switches[0].x, switches[0].y, switches[0].z], [7.4, 1.3, 14.4])
    assert.ok(switches[1].x >= 16.8 && switches[1].x <= 17.2 && Math.abs(switches[1].y - 0.67) < 0.01 && switches[1].z === 12.8, `store switch on the cut wall: ${JSON.stringify(switches[1])}`)
    assert.ok(drawn.switches.filter((s) => s.y > 3).every((s) => !s.shown), 'upstairs switches hidden')

    // 2. Real keys through the front door (S + D walks +X, W + A walks −X), the view sampled every frame.
    const trace = async (keys, ms) => {
      await page.evaluate(() => {
        const t = (window.__trace = [])
        const loop = () => {
          if (window.__trace !== t) return
          const s = window.__cutaway.debugState()
          const key = `${s.building}|${s.level}`
          if (t[t.length - 1]?.key !== key) t.push({ key, x: +window.__runtime.player.position.x.toFixed(2), y: +window.__runtime.player.position.y.toFixed(2) })
          requestAnimationFrame(loop)
        }
        loop()
      })
      await hold(keys, ms)
      return page.evaluate(() => {
        const t = window.__trace
        window.__trace = null
        return t
      })
    }
    await teleport(5.6, 0, 13, Math.PI / 2)
    await page.waitForTimeout(400)
    const walkIn = await trace(['KeyS', 'KeyD'], 1100)
    const walkOut = await trace(['KeyW', 'KeyA'], 1300)
    log('front door in / out', { walkIn, walkOut })
    assert.deepEqual(walkIn.map((t) => t.key), ['null|null', `${A}|0`])
    assert.deepEqual(walkOut.map((t) => t.key), [`${A}|0`, 'null|null'])
    assert.ok(walkIn[1].x > 7, 'cut once past the wall line')
    // Up and down the flight (its foot is at x 7.9, z 8.9; it climbs +X).
    await teleport(7.9, 0, 8.9, Math.PI / 2)
    await page.waitForTimeout(400)
    const up = await trace(['KeyS', 'KeyD'], 2400)
    const top = await player()
    await teleport(13.9, 3, 8.9, -Math.PI / 2)
    await page.waitForTimeout(400)
    const down = await trace(['KeyW', 'KeyA'], 2200)
    log('stairs up / down', { up, top, down })
    assert.equal(top.y, 3, 'walked up the flight')
    assert.deepEqual(up.map((t) => t.key), [`${A}|0`, `${A}|1`])
    assert.ok(up[1].y > 2 && up[1].y < 3, `storey switched near the top of the flight: ${up[1].y}`)
    assert.deepEqual(down.map((t) => t.key), [`${A}|1`, `${A}|0`])
    assert.ok(down[1].y < 1, `storey switched near the foot of the flight: ${down[1].y}`)

    // 3. Shadows. The sun shines from the camera's side, so house A's shadow falls behind it (NW).
    // Grass around the house (a grid off the road) is sampled with the house whole (player outside)
    // and cut away (player on the ground floor). (a) Grass the whole house does not hide from the camera is shaded the same in
    // both pictures. (b) Cut away, the shadow-only proxies are what keeps the storey's shadow: with
    // them off (dev switch) the grass behind the house lights up.
    const patches = async (points) => {
    // The follow camera lags the player (a lot at a few frames per second): let it settle first, or
    // the points are projected with a camera that has moved by the time of the screenshot.
    await page.waitForFunction(() => {
      let cam = null
      window.__scene.traverse((o) => { if (o.isCamera && !cam) cam = o })
      const p = window.__runtime.player.position
      const o = window.__runtime.config.camera.offset
      return Math.abs(cam.position.x - p.x - o.x) < 0.01 && Math.abs(cam.position.z - p.z - o.z) < 0.01 && Math.abs(cam.position.y - p.y - o.y) < 0.01
    }, null, { timeout: 20000 })
      const coords = await page.evaluate((points) => {
        let cam = null
        window.__scene.traverse((o) => { if (o.isCamera && !cam) cam = o })
        cam.updateMatrixWorld()
        const v = cam.position.clone()
        return points.map(([x, y, z]) => {
          v.set(x, y, z).project(cam)
          return [Math.round((v.x + 1) / 2 * window.innerWidth), Math.round((1 - v.y) / 2 * window.innerHeight)]
        })
      }, points)
      const png = await page.screenshot()
      return page.evaluate(async ({ b64, coords }) => {
        const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
        const c = new OffscreenCanvas(img.width, img.height)
        const g = c.getContext('2d')
        g.drawImage(img, 0, 0)
        const scale = img.width / window.innerWidth
        const W = window.innerWidth
        const H = window.innerHeight
        return coords.map(([px, py]) => {
          // Off screen or under the HUD panels: not measured.
          if (px < 10 || py < 90 || px > W - 10 || py > H - 60 || (px < 290 && py > H - 160)) return null
          const { data } = g.getImageData(Math.round(px * scale) - 2, Math.round(py * scale) - 2, 5, 5)
          let sum = 0
          for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
          return +(sum / (data.length / 4)).toFixed(1)
        })
      }, { b64: png.toString('base64'), coords })
    }
    // Cell centres of the ground's 1 m grid lines (a line under a patch reads as shade).
    const grid = []
    for (let x = 1.5; x <= 22; x += 1) {
      for (let z = 2.5; z <= 18.5; z += 1) {
        if (x > 6.4 && x < 17.6 && z > 7.4 && z < 16.6) continue
        grid.push([x, 0.03, z])
      }
    }
    // In shadow: ≥ 20 % darker than the sunlit grass (the picture's upper quartile).
    const shaded = (lums) => {
      const valid = lums.filter((l) => l !== null).sort((a, b) => a - b)
      const sunlit = valid[Math.floor(valid.length * 0.75)]
      return lums.map((l) => (l === null ? null : l < 0.8 * sunlit))
    }
    const lights = () => page.evaluate((a) => {
      const out = []
      window.__scene.traverse((o) => { if (o.isLight) out.push(+o.intensity.toFixed(3)) })
      const room = window.__runtime.lighting.getRoomLight(`${a}/living`)
      return { lights: out, room: +room.finalLightLevel.toFixed(3) }
    }, A)
    // The vision overlay (a perception shade that follows the player) is off in this game: only
    // the sun's shadow should differ between the pictures.
    const main = page
    page = await newGame({ overlay: false })
    assert.equal(await page.evaluate(() => { let n = 0; window.__scene.traverse((o) => { if (o.material?.uniforms?.uSectors) n++ }); return n }), 0, 'overlay off')
    await teleport(4, 0, 19.5, Math.PI)
    await setTime(0.5)
    await page.waitForTimeout(900)
    const whole = { view: (await view()).building, grass: shaded(await patches(grid)), ...(await lights()) }
    await shot('shadow-whole')
    await teleport(9, 0, 11.5, Math.PI)
    await setTime(0.5)
    await page.waitForTimeout(900)
    const cut = { view: (await view()).building, grass: shaded(await patches(grid)), ...(await lights()) }
    await shot('shadow-kept')
    await page.evaluate(() => window.__cutaway.setShadowProxies(false))
    await setTime(0.5)
    await page.waitForTimeout(500)
    const noProxy = { grass: shaded(await patches(grid)) }
    await shot('shadow-no-proxies')
    await page.evaluate(() => window.__cutaway.setShadowProxies(true))
    await page.context().close()
    page = main
    if (process.env.SHADOW_MAP) {
      for (const st of [whole, cut, noProxy]) {
        const rows = new Map()
        grid.forEach(([, , z], i) => rows.set(z, (rows.get(z) ?? '') + (st.grass[i] === null ? ' ' : st.grass[i] ? '#' : '.')))
        console.log([...rows.values()].join('\n') + '\n----')
      }
    }
    // A ray from a ground point along `dir` meets the box? (slab test, t ≥ 0)
    const hits = ([x, y, z], dir, box) => {
      let t0 = 0
      let t1 = Infinity
      for (const [k, o] of [[0, x], [1, y], [2, z]]) {
        const a = (box.min[k] - o) / dir[k]
        const b = (box.max[k] - o) / dir[k]
        t0 = Math.max(t0, Math.min(a, b))
        t1 = Math.min(t1, Math.max(a, b))
      }
      return t0 <= t1
    }
    const SUN = [18, 32, 12]
    const CAMERA = [20, 24, 20]
    // House A whole (roof overhang included), and what is left of it on screen when cut away.
    const HOUSE = { min: [6.7, 0, 7.7], max: [17.3, 6.2, 16.3] }
    const LEFT = { min: [6.7, 0, 7.7], max: [17.3, 3, 16.3] }
    const GROUND_STOREY = { min: [6.7, 0, 7.7], max: [17.3, 3, 16.3] }
    // (a) North-west of house A (its shadow side, clear of house B), grass the cut-away house does
    // not hide from the camera is shaded exactly where the whole house's shadow falls; some of it
    // only by the storey above the ground floor (the part that is not drawn).
    const region = grid.map((p, i) => [p, i]).filter(([p, i]) => (p[0] < 7 || p[2] < 7.7) && p[0] < 17 && !hits(p, CAMERA, LEFT) && cut.grass[i] !== null)
    const predicted = (p) => hits(p, SUN, HOUSE)
    const upperOnly = (p) => predicted(p) && !hits(p, SUN, GROUND_STOREY)
    const a = {
      measured: region.length,
      predicted: region.filter(([p]) => predicted(p)).length,
      agree: region.filter(([p, i]) => predicted(p) === cut.grass[i]).length,
      upperOnly: region.filter(([p]) => upperOnly(p)).length,
      upperOnlyShaded: region.filter(([p, i]) => upperOnly(p) && cut.grass[i]).length,
    }
    if (process.env.SHADOW_MAP) console.log('disagree', JSON.stringify(region.filter(([p, i]) => predicted(p) !== cut.grass[i]).map(([p, i]) => [p[0], p[2], cut.grass[i] ? 'shaded' : 'lit'])))
    // (b) All grass visible in the cut-away pictures, with and without the shadow proxies.
    const seen = grid.map((_, i) => i).filter((i) => cut.grass[i] !== null && noProxy.grass[i] !== null)
    const b = { measured: seen.length, withProxies: seen.filter((i) => cut.grass[i]).length, without: seen.filter((i) => noProxy.grass[i]).length, lostWithout: seen.filter((i) => cut.grass[i] && !noProxy.grass[i]).length }
    // The grass shaded only by the storey that is not drawn: lit once its proxies are off.
    b.upperOnlyLitWithout = region.filter(([p, i]) => upperOnly(p) && noProxy.grass[i] === false).length
    log('shadow / lights', { cutAway: a, proxies: b, whole: { lights: whole.lights, room: whole.room }, cut: { lights: cut.lights, room: cut.room } })
    assert.deepEqual([whole.view, cut.view], [null, A])
    assert.ok(a.measured > 40 && a.predicted > 10, `the house shades some visible grass: ${JSON.stringify(a)}`)
    assert.ok(a.agree >= a.measured * 0.9, `shaded where the whole house's shadow falls: ${JSON.stringify(a)}`)
    assert.ok(a.upperOnly >= 5 && a.upperOnlyShaded >= a.upperOnly * 0.8, `the hidden storey still shades: ${JSON.stringify(a)}`)
    assert.ok(b.lostWithout >= 8 && b.upperOnlyLitWithout >= a.upperOnly * 0.8, `the proxies keep the cut storey's shadow: ${JSON.stringify({ a, b })}`)
    // Lighting never follows the cutaway: same lights, same room light.
    assert.deepEqual(cut.lights, whole.lights)
    assert.equal(cut.room, whole.room)

    // 4. F6: the cutaway label on the player, only the observed storey's room labels.
    await page.keyboard.press('F6')
    await page.waitForTimeout(800)
    const f6 = await page.evaluate(() => ({
      cutaway: document.querySelector('.cutaway-debug-label')?.textContent,
      labels: [...document.querySelectorAll('.lighting-debug-label:not(.cutaway-debug-label)')].map((e) => ({ text: e.textContent.split('\n')[0], shown: e.style.display !== 'none' })),
    }))
    const shownLabels = f6.labels.filter((l) => l.shown).map((l) => l.text)
    log('F6', { cutaway: f6.cutaway, shown: shownLabels.length, hidden: f6.labels.length - shownLabels.length })
    await shot('f6')
    assert.ok(f6.cutaway?.includes(`${A} · tầng 0`) && f6.cutaway.includes('phòng: Phòng khách'), 'cutaway label')
    // Rooms (3 houses × 2 upstairs), the bedroom doors and the upstairs windows: hidden.
    assert.ok(f6.labels.length - shownLabels.length >= 6 + 3 + 3, 'upper storey labels hidden')
    assert.ok(!shownLabels.some((t) => t.includes('tầng trên') || t.includes('phòng ngủ') || t.startsWith('Cửa phòng ngủ')), JSON.stringify(shownLabels))
    assert.ok(shownLabels.includes('Phòng khách') && shownLabels.includes('Phòng kho'), 'ground floor labels shown')
    await page.keyboard.press('F6')
  }

  assert.deepEqual(errors, [])
  console.log(`M11c-1A cutaway browser check (${phase}): PASS`)
} catch (e) {
  console.error(e)
  console.error('page errors', errors)
  process.exitCode = 1
} finally {
  await browser.close()
}
