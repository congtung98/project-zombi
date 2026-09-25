import { describe, expect, it } from 'vitest'
import { summarizeSave, validateSaveGame } from './save'
import { addItem, totalQuantity } from './inventory'
import { GameRuntime } from '../core/runtime'
import { GAME_CONFIG } from '../core/config'
import { generateBuildingWalls, generateDoorPlacements, type BuildingDef } from '../world/buildings'
import type { MapData } from '../world/mapData'
import { SAVE_SCHEMA_VERSION, type SaveGame } from '../../types/save'
import { daylightAt } from '../rendering/daylight'

const hut: BuildingDef = {
  id: 'hut',
  name: 'Hut',
  center: { x: 0, z: 0 },
  size: { w: 6, d: 6 },
  height: 3,
  wallThickness: 0.3,
  wallColor: '#fff',
  roofColor: '#000',
  floorColor: '#888',
  doors: [{ id: 'door-hut', name: 'Cửa', side: 'S', offset: 0, width: 1.4 }],
  containers: [{ id: 'ct-hut', name: 'Tủ', position: { x: 0, y: 0.5, z: -2.5 }, size: [1, 1, 0.6], color: '#000', loot: 'safehouse-cabinet' }],
}

function makeMap(): MapData {
  return {
    id: 'test-map',
    size: 40,
    playerSpawn: { x: 0, y: 0, z: 0 },
    zombieSpawns: [
      { x: 18, y: 0, z: 0 },
      { x: -18, y: 0, z: 0 },
      { x: 0, y: 0, z: 18 },
    ],
    buildings: [hut],
    walls: generateBuildingWalls(hut),
    doors: generateDoorPlacements(hut),
    containers: hut.containers,
    roads: [],
  }
}

const DT = 1 / 60

describe('snapshot round trip', () => {
  it('restores clock, player, inventory, doors, container contents and zombies without duplication', () => {
    const rt = new GameRuntime(makeMap())
    rt.newGame(2024)
    // Thay đổi thế giới: đi, mở cửa, lấy đồ, đánh zombie, trôi thời gian.
    for (let i = 0; i < 120; i++) rt.tick(DT)
    const door = rt.interactables.find((i) => i.id === 'door-hut')!
    rt.interact(door)
    const box = rt.world.containers.get('ct-hut')!
    const lootBefore = totalQuantity(box.items)
    rt.player.position = { x: 0, y: 0.9, z: -1.5 }
    rt.tick(DT)
    rt.interact(rt.interactables.find((i) => i.id === 'ct-hut')!)
    rt.takeFromContainer(0)
    rt.closeAllUi()
    rt.player.health = 63
    rt.player.thirst = 41
    rt.player.facing = 1.2
    const z1 = rt.zombies.get('zombie-1')!
    z1.health = 20
    z1.ai = 'CHASE'
    rt.tick(DT)

    const snap = rt.createSnapshot()
    expect(snap.schemaVersion).toBe(SAVE_SCHEMA_VERSION)
    expect(snap.zombies.map((z) => z.id)).toEqual(['zombie-1', 'zombie-2', 'zombie-3'])
    expect(totalQuantity(snap.player.inventory) + totalQuantity(snap.containers[0].items)).toBe(lootBefore)

    // Bản lưu là dữ liệu thuần: qua JSON không mất gì.
    const json = JSON.parse(JSON.stringify(snap)) as unknown
    const v = validateSaveGame(json, 'test-map')
    expect(v.ok).toBe(true)
    if (!v.ok) return

    const rt2 = new GameRuntime(makeMap())
    const sessionBefore = rt2.sessionId
    rt2.loadSnapshot(v.save)
    expect(rt2.sessionId).toBe(sessionBefore + 1)
    expect(rt2.world.seed).toBe(2024)
    expect(rt2.clock.elapsed).toBeCloseTo(rt.clock.elapsed)
    expect(rt2.clock.timeOfDay).toBeCloseTo(rt.clock.timeOfDay)
    expect(rt2.clock.day).toBe(rt.clock.day)
    expect(rt2.player.position).toEqual(rt.player.position)
    expect(rt2.player.facing).toBe(1.2)
    expect(rt2.player.health).toBe(rt.player.health)
    expect(rt2.player.thirst).toBe(rt.player.thirst)
    expect(rt2.player.inventory).toEqual(rt.player.inventory)
    expect(rt2.world.doors.get('door-hut')?.state).toBe('open')
    expect(rt2.nav.findPath({ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 5 })).not.toBeNull()
    expect(rt2.world.containers.get('ct-hut')!.items).toEqual(box.items)
    expect(rt2.world.containers.get('ct-hut')!.opened).toBe(true)
    expect(rt2.zombies.size).toBe(3)
    expect(rt2.zombies.get('zombie-1')?.health).toBe(20)
    expect(rt2.zombies.get('zombie-1')?.ai).toBe(z1.ai)
    expect(rt2.uiOpen).toBe(false)

    // Load lại nhiều lần không nhân đôi zombie hay loot.
    rt2.loadSnapshot(v.save)
    rt2.loadSnapshot(v.save)
    expect(rt2.zombies.size).toBe(3)
    expect(totalQuantity(rt2.world.containers.get('ct-hut')!.items)).toBe(totalQuantity(box.items))
    // Snapshot của bản đã load giống bản gốc (trừ savedAt).
    const snap2 = rt2.createSnapshot()
    expect({ ...snap2, savedAt: 0 }).toEqual({ ...snap, savedAt: 0 })
  })

  it('does not save corpses and keeps zombie ids unique after load + spawn', () => {
    const rt = new GameRuntime(makeMap())
    rt.newGame(5)
    const z = rt.zombies.get('zombie-2')!
    z.health = 0
    rt.tick(DT)
    expect(z.ai).toBe('DEAD')
    const snap = rt.createSnapshot()
    expect(snap.zombies.map((s) => s.id)).toEqual(['zombie-1', 'zombie-3'])
    expect(snap.spawn.nextZombieId).toBe(4)

    const rt2 = new GameRuntime(makeMap())
    rt2.loadSnapshot(snap)
    const spawned = rt2.spawnZombie({ x: 18, y: 0, z: 0 })
    expect(spawned.id).toBe('zombie-4')
  })

  it('rejects invalid inventory before mutating the live runtime (never truncates items)', () => {
    const rt = new GameRuntime(makeMap())
    const snap = rt.createSnapshot()
    snap.player.health = 999
    snap.player.hunger = -5
    addItem(snap.player.inventory, 'water', 5)
    snap.player.inventory.slots[0]!.quantity = 99
    snap.player.inventory.slots.push(null, null, null)
    const before = rt.createSnapshot()
    expect(() => rt.loadSnapshot(snap)).toThrow('Invalid save')
    expect(rt.createSnapshot().player).toEqual(before.player)
  })
})

describe('validateSaveGame', () => {
  function good(): SaveGame {
    const rt = new GameRuntime(makeMap())
    return JSON.parse(JSON.stringify(rt.createSnapshot()))
  }

  it('accepts a fresh snapshot', () => {
    expect(validateSaveGame(good(), 'test-map').ok).toBe(true)
  })

  it('rejects other schema versions as incompatible, not corrupt', () => {
    const s = good()
    s.schemaVersion = SAVE_SCHEMA_VERSION + 1
    const v = validateSaveGame(s, 'test-map')
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('incompatible')
  })

  it('rejects a save for another map', () => {
    const v = validateSaveGame(good(), 'other-map')
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('wrong-map')
  })

  it('rejects garbage, missing fields, NaN and unknown items', () => {
    expect(validateSaveGame(null, 'test-map').ok).toBe(false)
    expect(validateSaveGame('x', 'test-map').ok).toBe(false)
    expect(validateSaveGame({}, 'test-map').ok).toBe(false)

    const a = good()
    ;(a.player as unknown as Record<string, unknown>).health = 'full'
    expect(validateSaveGame(a, 'test-map').ok).toBe(false)

    const b = good()
    b.clock.timeOfDay = Number.NaN
    expect(validateSaveGame(b, 'test-map').ok).toBe(false)

    const c = good()
    c.player.inventory.slots[0] = { id: 'bad:1', kind: 'stack', itemId: 'wood' as never, quantity: 1 }
    expect(validateSaveGame(c, 'test-map').ok).toBe(false)

    const d = good()
    d.zombies[0].ai = 'FLY' as never
    expect(validateSaveGame(d, 'test-map').ok).toBe(false)

    const e = good()
    e.zombies[1].id = e.zombies[0].id
    const ve = validateSaveGame(e, 'test-map')
    expect(ve.ok).toBe(false)
    if (!ve.ok) expect(ve.detail).toContain('trùng')
  })

  it('summarizes day/time for the menu', () => {
    const s = good()
    s.clock.day = 3
    s.clock.timeOfDay = 0.5
    const sum = summarizeSave(s)
    expect(sum.day).toBe(3)
    expect(sum.timeLabel).toBe('12:00')
  })
})

describe('spawn in runtime', () => {
  it('spawns up to maxActive at points far from the player and replaces the dead', () => {
    const rt = new GameRuntime(makeMap())
    rt.newGame(11)
    const spawned: string[] = []
    rt.events.on('zombie:spawned', (e) => spawned.push(e.id))
    // Giữ zombie đứng yên để không tới gần: tường chắn → IDLE. Mọi điểm spawn đang có zombie đứng,
    // nên chỉ sau khi một con chết (xác không chiếm chỗ) mới có điểm hợp lệ.
    rt.setLineOfSightOverride({ isBlocked: () => true })
    rt.zombies.get('zombie-1')!.health = 0
    const max = GAME_CONFIG.spawn.maxActive
    for (let t = 0; t < GAME_CONFIG.spawn.intervalDay * (max + 2); t += 0.1) rt.tick(0.1)
    const alive = Array.from(rt.zombies.values()).filter((z) => z.ai !== 'DEAD')
    expect(alive.length).toBeLessThanOrEqual(max)
    expect(spawned.length).toBeGreaterThan(0)
    for (const id of spawned) {
      const z = rt.zombies.get(id)!
      expect(Math.hypot(z.position.x - rt.player.position.x, z.position.z - rt.player.position.z)).toBeGreaterThanOrEqual(
        GAME_CONFIG.spawn.minDistance,
      )
    }
    const ids = Array.from(rt.zombies.keys())
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('removes corpses after corpseLifetime and emits zombie:removed', () => {
    const rt = new GameRuntime(makeMap())
    rt.newGame(12)
    rt.setLineOfSightOverride({ isBlocked: () => true })
    const removed: string[] = []
    rt.events.on('zombie:removed', (e) => removed.push(e.id))
    rt.zombies.get('zombie-1')!.health = 0
    rt.tick(DT)
    expect(rt.zombies.get('zombie-1')?.ai).toBe('DEAD')
    for (let t = 0; t < GAME_CONFIG.spawn.corpseLifetime + 1; t += 0.1) rt.tick(0.1)
    expect(rt.zombies.has('zombie-1')).toBe(false)
    expect(removed).toEqual(['zombie-1'])
  })

  it('does not spawn while the player is dead', () => {
    const rt = new GameRuntime(makeMap())
    rt.newGame(13)
    rt.player.alive = false
    rt.player.health = 0
    let spawned = 0
    rt.events.on('zombie:spawned', () => (spawned += 1))
    for (let t = 0; t < GAME_CONFIG.spawn.intervalNight * 5; t += 0.1) rt.tick(0.1)
    expect(spawned).toBe(0)
  })

  it('autosave flag fires once per interval at the tick boundary', () => {
    const rt = new GameRuntime(makeMap())
    expect(rt.consumeAutosave()).toBe(false)
    const ticks = Math.round(GAME_CONFIG.save.autosaveInterval / 0.1)
    for (let i = 0; i < ticks - 1; i++) rt.tick(0.1)
    expect(rt.consumeAutosave()).toBe(false)
    rt.tick(0.1)
    rt.tick(0.1)
    expect(rt.consumeAutosave()).toBe(true)
    expect(rt.consumeAutosave()).toBe(false)
  })
})

describe('daylightAt', () => {
  it('is 1 at noon, 0 at midnight and monotonic through dawn', () => {
    expect(daylightAt(0.5)).toBe(1)
    expect(daylightAt(0)).toBe(0)
    expect(daylightAt(0.95)).toBe(0)
    let prev = -1
    for (let t = 0.15; t <= 0.3; t += 0.01) {
      const d = daylightAt(t)
      expect(d).toBeGreaterThanOrEqual(prev)
      prev = d
    }
  })
})
