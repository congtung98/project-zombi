// C0 (character plan): screenshots of the dev character lab (`/?lab=characters`, src/lab/CharacterLab.tsx),
// the same fixed poses every run, at gameplay zoom (28 px/m) and close up, to compare sprints.
//   BASE_URL=http://127.0.0.1:5173 PLAYWRIGHT_MODULE=file:///.../playwright/index.mjs CHROMIUM_PATH=... \
//   node scripts/c0-character-lab.mjs [--label=c0] [--out=dir] [--gpu] [--compare=<dir>] [--docs=<dir>] [--only=close-z200,...]
// Output: <out>/<set>-z<zoom>.png (+ diff shares against --compare; --docs also writes JPEG copies
// there for the sprint notes). Needs the dev server.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const label = opt('label', 'baseline')
const out = opt('out', `node_modules/.tmp/character/${label}`)
const compareDir = opt('compare', null)
const gpu = args.includes('--gpu')
const docsDir = opt('docs', null)
const ONLY = opt('only', null)?.split(',')
const ALL_SHOTS = [
  { set: 'lineup', zoom: 28, size: [700, 300] },
  { set: 'lineup', zoom: 100, size: [1300, 520] },
  { set: 'states', zoom: 28, size: [900, 480] },
  { set: 'states', zoom: 80, size: [1600, 1000] },
  { set: 'turn', zoom: 28, size: [900, 480] },
  { set: 'turn', zoom: 80, size: [1600, 1000] },
  { set: 'close', zoom: 200, size: [1800, 700] },
  { set: 'outfits', zoom: 28, size: [600, 400] },
  { set: 'outfits', zoom: 170, size: [1400, 1200] },
  { set: 'combat', zoom: 28, size: [700, 420] },
  { set: 'combat', zoom: 110, size: [1700, 1100] },
]
const SHOTS = ONLY ? ALL_SHOTS.filter((s) => ONLY.includes(`${s.set}-z${s.zoom}`)) : ALL_SHOTS

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: gpu ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
mkdirSync(out, { recursive: true })
if (docsDir) mkdirSync(docsDir, { recursive: true })
const errors = []
const report = { label, date: new Date().toISOString(), shots: [], errors }
try {
  for (const s of SHOTS) {
    const page = await browser.newPage({ viewport: { width: s.size[0], height: s.size[1] } })
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    await page.goto(`${base}/?lab=characters&set=${s.set}&zoom=${s.zoom}`)
    await page.waitForFunction(() => window.__labReady === true, null, { timeout: 60000 })
    await page.waitForTimeout(300)
    const file = join(out, `${s.set}-z${s.zoom}.png`)
    await page.screenshot({ path: file })
    if (docsDir) await page.screenshot({ path: join(docsDir, `${s.set}-z${s.zoom}.jpg`), type: 'jpeg', quality: 85 })
    const shot = { file, ...s }
    const other = compareDir ? join(compareDir, `${s.set}-z${s.zoom}.png`) : null
    if (other && existsSync(other)) {
      shot.diff = await page.evaluate(async ([ua, ub]) => {
        const load = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src })
        const [a, b] = await Promise.all([load(ua), load(ub)])
        if (a.width !== b.width || a.height !== b.height) return { sameSize: false }
        const read = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data }
        const da = read(a)
        const db = read(b)
        let changed = 0
        for (let i = 0; i < da.length; i += 4) if (Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2])) > 24) changed++
        return { sameSize: true, changedShare: Math.round((changed / (da.length / 4)) * 10000) / 100 }
      }, [`data:image/png;base64,${readFileSync(file).toString('base64')}`, `data:image/png;base64,${readFileSync(other).toString('base64')}`])
    }
    report.shots.push(shot)
    console.log(`${s.set} z${s.zoom}`.padEnd(16), shot.diff ? JSON.stringify(shot.diff) : file)
    await page.close()
  }
} finally {
  await browser.close()
}
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
if (errors.length) {
  console.log('page errors:', errors)
  process.exitCode = 1
}
