const { chromium } = await import(process.env.PLAYWRIGHT_MODULE)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 400)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 400)) })
const t = Date.now()
await page.goto(`${process.env.BASE_URL}/?perf=1&stress=4`)
try { await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Zombie Outbreak', null, { timeout: 30000 }); console.log('menu after', Date.now() - t, 'ms') } catch { console.log('no menu; body:', (await page.evaluate(() => document.body.innerText)).slice(0, 400)) }
console.log(errors.slice(0, 6).join('\n'))
await browser.close()
