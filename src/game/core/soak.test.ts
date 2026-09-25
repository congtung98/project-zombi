import { describe, expect, it } from 'vitest'
import { GameRuntime } from './runtime'
import { GAME_CONFIG } from './config'
import { NEIGHBORHOOD_MAP } from '../world/mapData'
import { computeMoveDirection } from '../systems/movement'
import { validateSaveGame } from '../systems/save'
import { getItemDef } from '../entities/items'
import { equippedWeapon } from '../systems/equipment'
import { meleeStats } from '../systems/weapons'
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
  /** P2-S2: seconds until the unarmed bot first equips a looted weapon. */
  firstWeaponSec: number
  swingsHit: number
  swingsMissed: number
  wear: number
  broken: number
  weaponsFound: string[]
  /** P2-S5: unaware zombies alerted by sight / by footsteps or a blow, sieges started, door hits. */
  sightAlerts: number
  noiseAlerts: number
  sieges: number
  doorHits: number
  doorsDestroyed: string[]
  migrations: number
  maxBashersPerSide: number
}

/**
 * `shelter`: loot the whole route, then go home, close the safehouse door and rest like a
 * cautious player (pass/fail gate). `patrol`: keep walking past spawn points and fighting
 * everything forever (metrics for later balance; no survival gate, only invariants).
 * P2-S2 measured that the Phase 1 bot stood ~1545 s of 1800 s in one cell by the safehouse
 * door (8-direction keys pushing into a wall corner), so its "30 min, 11 kills" was not a
 * combat measurement. Movement now slides around corners; see docs/phase2-s2.md.
 */
function runSoak(policy: 'shelter' | 'patrol') {
    const rt = new GameRuntime(NEIGHBORHOOD_MAP)
    rt.newGame(20260924)
    // Deterministic: the pathfinding queue keeps its per-tick count budget but no wall-clock budget.
    rt.pathBudget.maxPathMs = Infinity
    const nav = rt.nav
    const map = rt.map

    // Thay Rapier: body giả bám lưới cho người chơi; raycast = tầm đi trên lưới (tường/cửa đóng chắn).
    // R2: zombies are moved by the simulation itself (no zombie bodies).
    const playerBody = fakeBody(nav, rt.player.position.x, rt.player.position.z)
    rt.registerPlayerBody(asBody(playerBody))
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
    // 8-direction keys like a player; prefer the best-aligned combo whose next step is walkable,
    // so the bot slides around wall corners instead of pushing into them forever.
    const move = (dx: number, dz: number) => {
      for (const k of MOVE_KEYS) rt.input.simulateKey(k, false)
      const len = Math.hypot(dx, dz)
      if (len < 1e-3) return
      const pos = rt.player.position
      const ranked = combos
        .map((c) => ({ c, dot: (c.dir.x * dx + c.dir.z * dz) / len }))
        .filter((r) => r.dot > 0)
        .sort((a, b) => b.dot - a.dot)
      const best = ranked.find((r) => nav.isWalkable(pos.x + r.c.dir.x * 0.3, pos.z + r.c.dir.z * 0.3)) ?? ranked[0]
      if (best) for (const k of best.c.keys) rt.input.simulateKey(k, true)
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
      firstWeaponSec: -1,
      swingsHit: 0,
      swingsMissed: 0,
      wear: 0,
      broken: 0,
      weaponsFound: [],
      sightAlerts: 0,
      noiseAlerts: 0,
      sieges: 0,
      doorHits: 0,
      doorsDestroyed: [],
      migrations: 0,
      maxBashersPerSide: 0,
    }
    const unaware = new Set(['IDLE', 'WANDER', 'MIGRATE'])
    rt.events.on('zombie:stateChanged', (e) => {
      if (unaware.has(e.from) && e.to === 'CHASE') m.sightAlerts += 1
      if (unaware.has(e.from) && e.to === 'SEARCH') m.noiseAlerts += 1
      if (e.to === 'APPROACH_STRUCTURE') m.sieges += 1
    })
    rt.events.on('door:damaged', () => (m.doorHits += 1))
    rt.events.on('door:destroyed', (e) => m.doorsDestroyed.push(`${e.id}@${Math.round(m.survivedSec)}s`))
    rt.events.on('horde:migrated', () => (m.migrations += 1))
    rt.events.on('zombie:spawned', () => (m.spawned += 1))
    rt.events.on('player:damaged', (e) => (m.damageTaken += e.amount))
    rt.events.on('item:used', (e) => (m.itemsUsed[e.itemId] = (m.itemsUsed[e.itemId] ?? 0) + 1))
    rt.events.on('player:attacked', (e) => (e.hitIds.length > 0 ? (m.swingsHit += 1) : (m.swingsMissed += 1)))
    rt.events.on('weapon:worn', () => (m.wear += 1))
    rt.events.on('weapon:broken', (e) => {
      m.broken += 1
      // Broken weapons stay owned (never deleted), they are only weaker.
      expect(rt.player.inventory.slots.some((i) => i?.id === e.id && i.kind === 'weapon' && i.condition === 0)).toBe(true)
    })
    /** Bot policy: keep the best usable weapon (damage per second of cooldown) in hand. */
    const equipBest = () => {
      const current = equippedWeapon(rt.player.inventory, rt.player.equipment)
      if (current && current.condition > 0) return
      let best: { id: string; score: number } | null = null
      for (const item of rt.player.inventory.slots) {
        if (item?.kind !== 'weapon' || item.condition <= 0) continue
        const s = meleeStats(item.itemId)
        const score = s.damage / s.cooldown
        if (!best || score > best.score) best = { id: item.id, score }
      }
      if (best && rt.equipItem(best.id) && m.firstWeaponSec < 0) m.firstWeaponSec = +m.survivedSec.toFixed(1)
    }

    // Lộ trình loot: nhà an toàn (vũ khí khởi đầu trước) → cửa hàng → nhà dân → công viên, rồi lặp tuần tra.
    const route = [
      'ct-safehouse-closet', 'ct-safehouse-cabinet',
      'ct-store-shelf-1', 'ct-store-shelf-2', 'ct-store-shelf-3', 'ct-store-fridge', 'ct-store-tools',
      'ct-house-kitchen', 'ct-house-wardrobe', 'ct-house-nightstand', 'ct-park-toolbox',
    ]
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
      } else if (policy === 'shelter') {
        goalContainer = null
        goalPos = walkableNear(home)
      } else {
        goalContainer = null
        goalPos = walkableNear(patrol[patrolIdx % patrol.length])
        patrolIdx += 1
      }
      path = null
    }
    pickGoal()

    const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z)
    const safehouse = map.buildings.find((b) => b.id === 'safehouse')!
    const insideSafehouse = (q: Vec3) =>
      Math.abs(q.x - safehouse.center.x) < safehouse.size.w / 2 - 0.3 && Math.abs(q.z - safehouse.center.z) < safehouse.size.d / 2 - 0.3
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

      if (p.attackTimer < 0) equipBest()

      // ---- Cửa: gặp cửa đóng trước mặt thì mở; shelter đã loot xong thì vào nhà và đóng cửa
      const target = rt.currentInteractable
      const sheltering = policy === 'shelter' && goalContainer === null && insideSafehouse(pos)
      const zombieInside = Array.from(rt.zombies.values()).some((z) => z.ai !== 'DEAD' && insideSafehouse(z.position))
      if (target?.kind === 'door' && !fighting) {
        const state = rt.world.doors.get(target.id)?.state
        if (sheltering && state === 'open' && target.id === 'door-safehouse' && !zombieInside) rt.interact(target)
        else if (!sheltering && state === 'closed') rt.interact(target)
      }

      // ---- Loot: tới tủ mục tiêu thì mở, lấy hết, đóng
      if (goalContainer && target?.kind === 'container' && target.id === goalContainer && !fighting) {
        rt.interact(target)
        const before = p.inventory.slots.filter(Boolean).reduce((n, s) => n + s!.quantity, 0)
        for (const item of rt.openContainer!.items.slots) if (item?.kind === 'weapon') m.weaponsFound.push(`${item.itemId}@${item.condition}`)
        rt.takeAll()
        equipBest()
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

      // ---- Tick + tích phân body giả của người chơi
      rt.tick(DT)
      playerBody.step(DT)

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
      // Plan §10.4: at most two zombies in contact with one side of a door.
      const bashers = new Map<string, number>()
      for (const z of rt.zombies.values()) {
        if (z.ai !== 'ATTACK_STRUCTURE') continue
        const key = `${z.structureTargetId}:${z.structureSide}`
        bashers.set(key, (bashers.get(key) ?? 0) + 1)
      }
      for (const n of bashers.values()) m.maxBashersPerSide = Math.max(m.maxBashersPerSide, n)
      expect(m.maxBashersPerSide).toBeLessThanOrEqual(2)

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
      bag: rt.player.inventory.slots.filter(Boolean).map((s) => (s!.kind === 'weapon' ? `${s!.itemId}@${s!.condition}` : `${s!.itemId}x${s!.quantity}`)),
      equipped: equippedWeapon(rt.player.inventory, rt.player.equipment)?.itemId ?? null,
      day: rt.clock.day,
      time: rt.clock.formatTime(),
      skipped,
      policy,
    }
    console.log(`SOAK REPORT ${policy} ` + JSON.stringify(report))
    expect(m.wear).toBeLessThanOrEqual(m.swingsHit)
    return { m, report, route, skipped }
}

describe('30-minute automated survival loop', () => {
  it('shelter policy: loots every container, finds the starting melee in time and survives 30 minutes', () => {
    const { m, route, skipped } = runSoak('shelter')
    // Cổng: vòng chơi Phase 2 (tay không → tìm vũ khí → loot → trú ẩn) chơi được với loot đặt tay.
    expect(m.containersLooted).toBe(route.length)
    expect(skipped).toEqual([])
    // Unarmed start: the guaranteed starting melee is found and equipped within the plan's 1–3 minutes.
    expect(m.firstWeaponSec).toBeGreaterThanOrEqual(0)
    expect(m.firstWeaponSec).toBeLessThanOrEqual(180)
    expect(m.survivedSec).toBeGreaterThanOrEqual(SESSION_SEC - 1)
  }, 120_000)

  it('patrol policy: fights continuously; reports time-to-death and wear without a survival gate', () => {
    const { m } = runSoak('patrol')
    expect(m.firstWeaponSec).toBeGreaterThanOrEqual(0)
    expect(m.swingsHit).toBeGreaterThan(0)
    expect(m.snapshotsChecked).toBeGreaterThanOrEqual(1)
  }, 120_000)
})
