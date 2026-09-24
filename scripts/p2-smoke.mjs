// Start a fresh Vite process on 5173 and isolated headless Chrome with --remote-debugging-port=9223.
// This script uses only that Chrome profile, never the user's normal browser data.
// P2-S1 regression (migration/backup/door physics). Since P2-S3: schema v4 and New Game goes through
// character creation; since P2-S2 New Game is unarmed and
// the S1 fixture is frozen (no longer rewritten). BASE_URL overrides the dev/preview origin.
// S2 weapon checks live in scripts/p2-s2-browser.mjs (Playwright).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'

const pages = await (await fetch('http://127.0.0.1:9223/json/list')).json()
const page = pages.find((p) => p.type === 'page')
assert(page, 'Open an isolated Chrome page first')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
let nextId = 1
const pending = new Map()
const errors = []
let loads = 0
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data)
  if (message.method === 'Page.loadEventFired') loads++
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
  if (message.id && pending.has(message.id)) {
    const { resolve, reject, timer } = pending.get(message.id)
    clearTimeout(timer)
    pending.delete(message.id)
    if (message.error) reject(new Error(JSON.stringify(message.error)))
    else resolve(message.result)
  }
}
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)) }, 30000)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
const base = process.env.BASE_URL
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(expression) {
  for (let i = 0; i < 100; i++) {
    try { if (await evaluate(expression)) return } catch { /* page may be navigating */ }
    await sleep(200)
  }
  throw new Error(`Timed out waiting for ${expression}`)
}
async function navigate(url) {
  const before = loads
  await send('Page.navigate', { url })
  for (let i = 0; i < 150 && loads === before; i++) await sleep(200)
  assert(loads > before, `Page did not load: ${url}`)
  await until("document.readyState === 'complete' && document.querySelector('h1')?.textContent === 'Zombie Outbreak'")
}
await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })

try {
  if (process.argv.includes('--production')) {
    const click = (label) => evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(label)})?.click()`)
    const key = async (code, key) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key })
    }
    await navigate(`${base ?? 'http://127.0.0.1:5199'}/?lab=doors`)
    assert.equal(await evaluate('typeof window.__runtime'), 'undefined')
    await click('New Game')
    await until("document.body.textContent.includes('Tạo nhân vật')")
    await click('Bắt đầu')
    await sleep(300)
    await click('Xóa bản lưu và bắt đầu')
    await until("!document.querySelector('h1') && !document.body.textContent.includes('Đang tải…')")
    assert.equal(await evaluate("document.body.textContent.includes('Phòng thử cửa')"), false)
    await key('KeyI', 'i')
    await until("document.body.textContent.includes('Tay không')")
    assert.equal(await evaluate("document.querySelectorAll('.inv-panel .slot-filled').length"), 0)
    await key('Escape', 'Escape')
    await key('Escape', 'Escape')
    await until("document.body.textContent.includes('Tạm dừng')")
    await click('Lưu và về menu')
    await until("document.querySelector('h1')?.textContent === 'Zombie Outbreak'")
    const saved = await evaluate(`new Promise((resolve,reject) => {
      const req = indexedDB.open('zombie-outbreak',1)
      req.onsuccess = () => { const db=req.result; const tx=db.transaction('saves'); const read=tx.objectStore('saves').get('slot-1'); read.onsuccess=()=>resolve(read.result); tx.oncomplete=()=>db.close() }
      req.onerror=()=>reject(req.error)
    })`)
    assert.equal(saved.schemaVersion, 4)
    assert.equal(saved.player.inventory.slots.filter((i) => i?.kind === 'weapon').length, 0)
    assert.equal(saved.player.equipment.weaponInstanceId, null)
    await navigate(`${base ?? 'http://127.0.0.1:5199'}/`)
    await until("Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Continue' && !b.disabled)")
    await click('Continue')
    await until("!document.querySelector('h1') && !document.body.textContent.includes('Đang tải…')")
    await key('KeyI', 'i')
    await until("document.body.textContent.includes('Tay không')")
    assert.equal(errors.length, 0, JSON.stringify(errors))
    console.log('PASS: production unarmed New Game, inventory, save, reload, Continue; dev lab disabled; no uncaught exceptions')
  } else {
  await navigate(`${base ?? 'http://127.0.0.1:5173'}/`)
  const legacy = JSON.parse(readFileSync('src/game/systems/fixtures/phase1-v1.json', 'utf8'))
  const result = await evaluate(`(async () => {
    const { useUiStore } = await import('/src/stores/uiStore.ts')
    const { runtime } = await import('/src/game/core/runtime.ts')
    if (runtime !== window.__runtime) throw new Error('Restart Vite before this smoke test to clear HMR module URLs.')
    const storage = await import('/src/game/systems/saveStorage.ts')
    const { addItem } = await import('/src/game/systems/inventory.ts')
    const { validateSaveGame } = await import('/src/game/systems/save.ts')
    const original = ${JSON.stringify(legacy)}
    await storage.deleteSave(storage.LEGACY_BACKUP_SLOT)
    await storage.deleteSave('slot-lab')
    await storage.writeSave(original)
    await useUiStore.getState().refreshSaveSlot()
    const ready = useUiStore.getState().saveSlot.kind
    const unchangedOnPreview = JSON.stringify((await storage.readSave()).value) === JSON.stringify(original)
    await useUiStore.getState().continueGame()
    useUiStore.getState().pause()
    const migrated = (await storage.readSave()).value
    const backup = (await storage.readSave(storage.LEGACY_BACKUP_SLOT)).value
    addItem(runtime.player.inventory, 'baseball_bat', 1)
    const bats = runtime.player.inventory.slots.filter(i => i?.kind === 'weapon')
    bats[0].condition = 10; bats[1].condition = 70
    runtime.equipItem(bats[1].id)
    const saved = await useUiStore.getState().saveGame()
    await useUiStore.getState().continueGame()
    useUiStore.getState().pause()
    const conditions = runtime.player.inventory.slots.filter(i => i?.kind === 'weapon').map(i => i.condition).sort((a,b) => a-b)
    const snapshot = runtime.createSnapshot()
    const current = (await storage.readSave()).value
    const conflict = await storage.commitMigratedSave(original, snapshot)
    const conflictKeptSlot = JSON.stringify((await storage.readSave()).value) === JSON.stringify(current)
    const full = structuredClone(original)
    full.player.inventory.slots = Array.from({length:12}, () => ({itemId:'medkit',quantity:1}))
    await storage.writeSave(full)
    await useUiStore.getState().continueGame()
    useUiStore.getState().pause()
    const fullDrop = runtime.world.containers.get('drop:legacy-bat')
    if (!fullDrop) throw new Error('Full inventory migration did not create the legacy bat drop')
    const fullState = { slots: runtime.player.inventory.slots.filter(Boolean).length, drop: fullDrop.items.slots[0], position: fullDrop.position }
    useUiStore.getState().toMenu()
    const bad = { ...original, schemaVersion: 99 }
    await storage.writeSave(bad)
    await useUiStore.getState().continueGame()
    const invalid = { screen: useUiStore.getState().screen, kind: useUiStore.getState().saveSlot.kind, kept: JSON.stringify((await storage.readSave()).value) === JSON.stringify(bad) }
    await storage.writeSave(snapshot)
    await useUiStore.getState().refreshSaveSlot()
    return { ready, unchangedOnPreview, version: migrated.schemaVersion, backupMatches: JSON.stringify(backup) === JSON.stringify(original), saved, conditions, equipped: snapshot.player.equipment.weaponInstanceId, valid: validateSaveGame(snapshot, runtime.map.id).ok, conflict: conflict.ok, conflictKeptSlot, fullState, invalid, snapshot }
  })()`)
  assert.equal(result.ready, 'ready')
  assert.equal(result.unchangedOnPreview, true)
  assert.equal(result.version, 4)
  assert.equal(result.backupMatches, true)
  assert.equal(result.saved, true)
  assert.deepEqual(result.conditions, [10, 70])
  assert.equal(result.valid, true)
  assert.equal(result.conflict, false)
  assert.equal(result.conflictKeptSlot, true)
  assert.equal(result.fullState.slots, 12)
  assert.equal(result.fullState.drop.condition, 80)
  assert.deepEqual(result.invalid, { screen: 'menu', kind: 'incompatible', kept: true })
  // phase2-s1-v2.json is the frozen S1 milestone fixture; S2's fixture comes from p2-s2-browser.mjs.
  delete result.snapshot
  console.log('INDEXEDDB / MIGRATION', JSON.stringify(result))
  await navigate(`${base ?? 'http://127.0.0.1:5173'}/?lab=doors`)
  await evaluate("document.querySelectorAll('button').forEach(b => { if (b.textContent === 'New Game') b.click() })")
  await until("document.body.textContent.includes('Tạo nhân vật')")
  await evaluate("document.querySelectorAll('button').forEach(b => { if (b.textContent === 'Bắt đầu') b.click() })")
  await until("document.body.textContent.includes('Phòng thử cửa') && !document.body.textContent.includes('Đang tải…')")
  // Exercise the actual DoorView unmount/remount and PhysicsBridge raycast.
  const door = await evaluate(`(async () => {
    const { runtime } = await import('/src/game/core/runtime.ts')
    const { useUiStore } = await import('/src/stores/uiStore.ts')
    const { readSave } = await import('/src/game/systems/saveStorage.ts')
    const normal = JSON.stringify((await readSave()).value)
    useUiStore.getState().resume()
    const states = []
    for (const state of ['closed','open','destroyed','closed']) {
      runtime.setDoorState('lab-door', state); runtime.events.flush()
      await new Promise(r => setTimeout(r, 300))
      const blocked = runtime.physics.isBlocked({x:0,y:1.2,z:5}, {x:0,y:1.2,z:1}, [])
      states.push({state, blocked, path: runtime.nav.findPath({x:0,y:0,z:5}, {x:0,y:0,z:1}) !== null})
    }
    runtime.setDoorState('lab-door', 'destroyed'); runtime.events.flush()
    const saved = await useUiStore.getState().saveGame()
    await useUiStore.getState().continueGame(); useUiStore.getState().pause()
    return {states, saved, restored: runtime.world.doors.get('lab-door').state, normalUnchanged: normal === JSON.stringify((await readSave()).value) }
  })()`)
  assert.deepEqual(door.states, [
    { state: 'closed', blocked: true, path: false }, { state: 'open', blocked: false, path: true },
    { state: 'destroyed', blocked: false, path: true }, { state: 'closed', blocked: true, path: false },
  ])
  assert.equal(door.saved, true)
  assert.equal(door.restored, 'destroyed')
  assert.equal(door.normalUnchanged, true)
  console.log('RENDER / PHYSICS', JSON.stringify(door))
  await evaluate("import('/src/stores/uiStore.ts').then(m => m.useUiStore.getState().resume())")
  await sleep(500)
  mkdirSync('node_modules/.tmp', { recursive: true })
  const screenshot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync('node_modules/.tmp/p2-door-lab.png', Buffer.from(screenshot.data, 'base64'))
  assert.equal(errors.length, 0, JSON.stringify(errors))
  console.log('PASS: browser smoke, no uncaught browser exceptions')
  }
} finally { ws.close() }
