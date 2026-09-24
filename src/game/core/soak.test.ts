import { describe, expect, it } from 'vitest'
import { GameRuntime } from './runtime'
import { GAME_CONFIG } from './config'
import { NEIGHBORHOOD_MAP } from '../world/mapData'
import { computeMoveDirection } from '../systems/movement'
import { validateSaveGame } from '../systems/save'
import { getItemDef } from '../entities/items'
import type { NavGrid } from '../world/navigation'
import type { Vec3 } from '../../types'

/**
 * "Playtest" tự động 30 phút thời gian game (cổng cuối tuần 5/6 của kế hoạch):
 * một bot đi loot theo lộ trình, mở cửa, đánh/đẩy zombie, ăn uống khi cần.
 * Body giả bám lưới điều hướng thay cho Rapier. Mục tiêu: không lỗi, bất biến
 * giữ vững (ID duy nhất, số zombie bị chặn, snapshot hợp lệ mỗi phút) và ghi
 * số liệu cân bằng để chỉnh `config.ts`.
 */

const DT = 1 / 20
const SESSION_SEC = 30 * 60

function fakeBody(nav: NavGrid, x: number, z: number) {
  const pos = { x, y: 0.9, z }
  let vel = { x: 0, y: 0, z: 0 }
  let enabled = true
  return {
    translation: () => ({ ...pos }),
    linvel: () => ({ ...vel }),
    setLinvel: (v: { x: number; y: number; z: number }) => {
      vel = { ...v }
    },
    setTranslation: (p: { x: number; y: number; z: number }) => {
      pos.x = p.x
      pos.z = p.z
    },
    setEnabled: (e: boolean) => {
      enabled = e
    },
    step: (dt: number) => {
      if (!enabled) return
      const nx = pos.x + vel.x * dt
      const nz = pos.z + vel.z * dt
      if (nav.isWalkable(nx, nz)) {
        pos.x = nx
        pos.z = nz
      } else if (nav.isWalkable(nx, pos.z)) pos.x = nx
      else if (nav.isWalkable(pos.x, nz)) pos.z = nz
    },
  }
}
type FakeBody = ReturnType<typeof fakeBody>
const asBody = (b: FakeBody) => b as unknown as Parameters<GameRuntime['registerPlayerBody']>[0]

const MOVE_KEYS = ['KeyW', 'KeyS', 'KeyA', 'KeyD']
const COMBOS = [['KeyW'], ['KeyS'], ['KeyA'], ['KeyD'], ['KeyW', 'KeyA'], ['KeyW', 'KeyD'], ['KeyS', 'KeyA'], ['KeyS', 'KeyD']]

interface Metrics {
  survivedSec: number
  minHealth: number
  minHunger: number
  minThirst: number
  kills: number
  spawned: number
  damageTaken: number
  itemsUsed: Record<string, number>
  lootTaken: number
  maxZombies: number
  snapshotsChecked: number
  containersLooted: number
}

describe('30-minute automated survival loop', () => {
  it('runs without errors, keeps invariants and reports balance metrics', () => {
    const rt = new GameRuntime(NEIGHBORHOOD_MAP)
    rt.newGame(20260924)
    const nav = rt.nav
    const map = rt.map

    // Thay Rapier: body giả bám lưới; raycast = tầm đi trên lưới (tường/cửa đóng chắn).
    const playerBody = fakeBody(nav, rt.player.position.x, rt.player.position.z)
    rt.registerPlayerBody(asBody(playerBody))
    const zombieBodies = new Map<string, FakeBody>()
    const ensureZombieBodies = () => {
      for (const z of rt.zombies.values()) {
        if (!zombieBodies.has(z.id)) {
          const b = fakeBody(nav, z.position.x, z.position.z)
          zombieBodies.set(z.id, b)
          rt.registerZombieBody(z.id, asBody(b))
        }
      }
      for (const id of Array.from(zombieBodies.keys())) if (!rt.zombies.has(id)) zombieBodies.delete(id)
    }
    rt.registerPhysicsQuery({
      isBlocked: (from, to, ignore) => (ignore.length > 0 ? false : !nav.hasLineOfWalk(from, to)),
    })

    const combos = COMBOS.map((keys) => ({
      keys,
      dir: computeMoveDirection(
        { forward: keys.includes('KeyW'), back: keys.includes('KeyS'), left: keys.includes('KeyA'), right: keys.includes('KeyD') },
        rt.cameraBasis,
      ),
    }))
    const move = (dx: number, dz: number) => {
      for (const k of MOVE_KEYS) rt.input.simulateKey(k, false)
      const len = Math.hypot(dx, dz)
      if (len < 1e-3) return
      let best = combos[0]
      let bestDot = -Infinity
      for (const c of combos) {
        const dot = (c.dir.x * dx + c.dir.z * dz) / len
        if (dot > bestDot) {
          bestDot = dot
          best = c
        }
      }
      for (const k of best.keys) rt.input.simulateKey(k, true)
    }

    const m: Metrics = {
      survivedSec: 0,
      minHealth: 100,
      minHunger: 100,
      minThirst: 100,
      kills: 0,
      spawned: 0,
      damageTaken: 0,
      itemsUsed: {},
      lootTaken: 0,
      maxZombies: 0,
      snapshotsChecked: 0,
      containersLooted: 0,
    }
    rt.events.on('zombie:spawned', () => (m.spawned += 1))
    rt.events.on('player:damaged', (e) => (m.damageTaken += e.amount))
    rt.events.on('item:used', (e) => (m.itemsUsed[e.itemId] = (m.itemsUsed[e.itemId] ?? 0) + 1))

    // Lộ trình loot: nhà an toàn → cửa hàng → nhà dân → về nhà an toàn, rồi lặp tuần tra.
    const route = ['ct-safehouse-cabinet', 'ct-store-shelf-1', 'ct-store-shelf-2', 'ct-store-shelf-3', 'ct-store-fridge', 'ct-house-kitchen', 'ct-house-wardrobe']
    const looted = new Set<string>()
    const skipped: string[] = []
    const home: Vec3 = { ...map.playerSpawn }
    let goalPos: Vec3 | null = null
    let goalContainer: string | null = null
    let path: Vec3[] | null = null
    let pathIdx = 0
    let repathTimer = 0
    let stuckTimer = 0
    let lastPos = { ...rt.player.position }
    let patrolIdx = 0
    const patrol: Vec3[] = [home, { x: 0, y: 0, z: -1 }, { x: 13, y: 0, z: -8 }, { x: 0, y: 0, z: 10 }]

    const walkableNear = (p: Vec3): Vec3 => {
      const c = nav.nearestWalkableCell(p.x, p.z, 6)
      return c ? nav.cellToWorld(c.cx, c.cz) : { ...p }
    }
    const containerPos = (id: string) => map.containers.find((c) => c.id === id)!.position
    /** Điểm đứng trước cửa đóng gần nhất, ở phía người chơi tới được (thử hai bên theo pháp tuyến cửa). */
    const nearestClosedDoorApproach = (from: Vec3): Vec3 | null => {
      const doors = map.doors
        .filter((d) => rt.world.doors.get(d.id)?.state === 'closed')
        .sort((a, b) => Math.hypot(a.center.x - from.x, a.center.z - from.z) - Math.hypot(b.center.x - from.x, b.center.z - from.z))
      for (const d of doors) {
        const b = map.buildings.find((x) => x.id === d.buildingId)!
        const nx = d.center.x - b.center.x
        const nz = d.center.z - b.center.z
        const len = Math.hypot(nx, nz) || 1
        for (const sign of [1, -1]) {
          const cand = walkableNear({ x: d.center.x + (nx / len) * sign * 1.4, y: 0, z: d.center.z + (nz / len) * sign * 1.4 })
          if (nav.findPath(from, cand)) return cand
        }
      }
      return null
    }

    const pickGoal = () => {
      const next = route.find((id) => !looted.has(id))
      if (next) {
        goalContainer = next
        goalPos = walkableNear(containerPos(next))
      } else {
        goalContainer = null
        goalPos = walkableNear(patrol[patrolIdx % patrol.length])
        patrolIdx += 1
      }
      path = null
    }
    pickGoal()

    const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z)
    let mouseHeld = false
    let spaceHeld = false
    let autosaveClock = 0

    for (let t = 0; t < SESSION_SEC; t += DT) {
      if (!rt.player.alive) break
      const p = rt.player
      const pos = p.position

      // ---- Ăn uống / băng bó khi cần (gọi như UI click)
      const slotOf = (kind: 'food' | 'drink' | 'medical') => p.inventory.slots.findIndex((s) => s && getItemDef(s.itemId).kind === kind)
      if (p.hunger < 35 && slotOf('food') >= 0) rt.consumeItem(slotOf('food'))
      if (p.thirst < 35 && slotOf('drink') >= 0) rt.consumeItem(slotOf('drink'))
      if (p.health < 45 && slotOf('medical') >= 0) rt.consumeItem(slotOf('medical'))

      // ---- Combat: zombie gần nhất còn sống
      let nearest: { pos: Vec3; d: number } | null = null
      let nearCount = 0
      for (const z of rt.zombies.values()) {
        if (z.ai === 'DEAD') continue
        const d = dist(z.position, pos)
        if (d < 2.6) nearCount += 1
        if (!nearest || d < nearest.d) nearest = { pos: z.position, d }
      }
      if (mouseHeld) {
        rt.input.simulateKey('Mouse0', false)
        mouseHeld = false
      }
      if (spaceHeld) {
        rt.input.simulateKey('Space', false)
        spaceHeld = false
      }
      const fighting = nearest !== null && nearest.d < 2.0
      if (fighting) {
        rt.cursorWorld = { ...nearest!.pos }
        if (rt.uiOpen) rt.closeAllUi()
        if (nearCount >= 2 && p.pushCooldown <= 0 && p.stamina >= GAME_CONFIG.push.stamina) {
          rt.input.simulateKey('Space', true)
          spaceHeld = true
        } else if (p.attackCooldown <= 0 && p.attackTimer < 0) {
          rt.input.simulateKey('Mouse0', true)
          mouseHeld = true
        }
      }

      // ---- Cửa: gặp cửa đóng trước mặt thì mở
      const target = rt.currentInteractable
      if (target?.kind === 'door' && rt.world.doors.get(target.id)?.state === 'closed' && !fighting) {
        rt.interact(target)
      }

      // ---- Loot: tới tủ mục tiêu thì mở, lấy hết, đóng
      if (goalContainer && target?.kind === 'container' && target.id === goalContainer && !fighting) {
        rt.interact(target)
        const before = p.inventory.slots.filter(Boolean).reduce((n, s) => n + s!.quantity, 0)
        rt.takeAll()
        const after = p.inventory.slots.filter(Boolean).reduce((n, s) => n + s!.quantity, 0)
        m.lootTaken += after - before
        rt.closeAllUi()
        looted.add(goalContainer)
        m.containersLooted += 1
        pickGoal()
      }

      // ---- Di chuyển theo path (tìm lại định kỳ / khi kẹt / khi cửa đổi)
      if (goalPos && !fighting) {
        repathTimer -= DT
        if (dist(pos, lastPos) < 0.02) stuckTimer += DT
        else stuckTimer = 0
        lastPos = { ...pos }
        if (!path || repathTimer <= 0 || stuckTimer > 1.5) {
          repathTimer = 1
          stuckTimer = 0
          path = nav.findPath(pos, goalPos)
          pathIdx = 0
          if (!path) {
            // Bị cửa đóng chặn: đi tới cửa đóng gần nhất; tới nơi thì luật "mở cửa" ở trên xử lý.
            const door = nearestClosedDoorApproach(pos)
            path = door ? nav.findPath(pos, door) : null
            if (!path && goalContainer) {
              skipped.push(goalContainer)
              looted.add(goalContainer) // không tới được: bỏ qua để không kẹt cả phiên
              pickGoal()
            }
          }
        }
        if (path) {
          while (pathIdx < path.length - 1 && dist(pos, path[pathIdx]) < 0.4) pathIdx += 1
          const wp = path[Math.min(pathIdx, path.length - 1)]
          if (dist(pos, goalPos) < 0.6) {
            move(0, 0)
            if (!goalContainer) pickGoal()
          } else move(wp.x - pos.x, wp.z - pos.z)
        } else move(0, 0)
      } else move(0, 0)

      // ---- Tick + tích phân body giả
      ensureZombieBodies()
      rt.tick(DT)
      playerBody.step(DT)
      for (const b of zombieBodies.values()) b.step(DT)

      // ---- Số liệu và bất biến
      m.survivedSec = t
      m.minHealth = Math.min(m.minHealth, p.health)
      m.minHunger = Math.min(m.minHunger, p.hunger)
      m.minThirst = Math.min(m.minThirst, p.thirst)
      m.maxZombies = Math.max(m.maxZombies, rt.zombies.size)
      const alive = Array.from(rt.zombies.values()).filter((z) => z.ai !== 'DEAD').length
      expect(alive).toBeLessThanOrEqual(GAME_CONFIG.spawn.maxActive)
      expect(Number.isFinite(p.health) && Number.isFinite(p.hunger) && Number.isFinite(p.thirst)).toBe(true)
      expect(p.hunger).toBeGreaterThanOrEqual(0)
      expect(p.thirst).toBeGreaterThanOrEqual(0)
      for (const s of p.inventory.slots) if (s) expect(s.quantity).toBeGreaterThan(0)

      autosaveClock += DT
      if (autosaveClock >= 60) {
        autosaveClock = 0
        const snap = JSON.parse(JSON.stringify(rt.createSnapshot()))
        const v = validateSaveGame(snap, map.id)
        expect(v.ok).toBe(true)
        m.snapshotsChecked += 1
        // Load vào runtime khác phải cho cùng snapshot (trừ savedAt) — bản lưu tự nhất quán.
        const rt2 = new GameRuntime(NEIGHBORHOOD_MAP)
        rt2.loadSnapshot(snap)
        const snap2 = JSON.parse(JSON.stringify(rt2.createSnapshot()))
        expect({ ...snap2, savedAt: 0 }).toEqual({ ...snap, savedAt: 0 })
      }
    }
    m.kills = rt.player.kills

    const ids = Array.from(rt.zombies.keys())
    expect(new Set(ids).size).toBe(ids.length)
    expect(rt.zombies.size).toBeLessThanOrEqual(GAME_CONFIG.spawn.maxActive * 2)
    expect(m.snapshotsChecked).toBeGreaterThanOrEqual(Math.floor(m.survivedSec / 60))

    const report = {
      ...m,
      survivedMin: +(m.survivedSec / 60).toFixed(1),
      alive: rt.player.alive,
      endHealth: Math.round(rt.player.health),
      endHunger: Math.round(rt.player.hunger),
      endThirst: Math.round(rt.player.thirst),
      bag: rt.player.inventory.slots.filter(Boolean).map((s) => `${s!.itemId}x${s!.quantity}`),
      day: rt.clock.day,
      time: rt.clock.formatTime(),
      skipped,
    }
    console.log('SOAK REPORT ' + JSON.stringify(report))

    // Cổng cân bằng: vòng chơi 15–30 phút phải chơi được với loot đặt tay.
    expect(m.containersLooted).toBe(route.length)
    expect(skipped).toEqual([])
    expect(m.survivedSec).toBeGreaterThanOrEqual(15 * 60)
  }, 120_000)
})
