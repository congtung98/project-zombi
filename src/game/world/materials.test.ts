import { describe, expect, it } from 'vitest'
import { GAME_CONFIG } from '../core/config'
import { ITEMS, type ItemId } from '../entities/items'
import { countItem, type Inventory } from '../systems/inventory'
import { generateContainerLoot } from '../systems/loot'
import { INTERACT_RANGE } from '../systems/interaction'
import { LOOT_TABLES } from './lootTables'
import { CONTAINERS_ADDED_V3, CONTAINERS_ADDED_V5, NEIGHBORHOOD_MAP } from './mapData'
import { NavGrid } from './navigation'
import { isInsideBuilding } from './buildings'

const MATERIALS: ItemId[] = ['wood_plank', 'scrap_metal', 'duct_tape', 'nails']
const seeds = Array.from({ length: 400 }, (_, i) => (i * 2654435761) >>> 0)
const byId = new Map(NEIGHBORHOOD_MAP.containers.map((c) => [c.id, c]))
const loot = (id: string, seed: number): Inventory => generateContainerLoot(LOOT_TABLES[byId.get(id)!.loot!], seed, id, GAME_CONFIG.inventory.containerSlots)

describe('P2-S4 material loot', () => {
  it('every seed: starter kit in the safehouse, nails/wood/tape at the store, scrap behind the house', () => {
    const tape: number[] = []
    const wood: number[] = []
    for (const seed of seeds) {
      const kit = loot('ct-safehouse-toolbox', seed)
      expect([countItem(kit, 'wood_plank'), countItem(kit, 'duct_tape'), countItem(kit, 'scrap_metal')]).toEqual([1, 1, 1])
      const shelf = loot('ct-store-hardware', seed)
      expect(countItem(shelf, 'nails')).toBeGreaterThanOrEqual(6)
      expect(countItem(shelf, 'nails')).toBeLessThanOrEqual(12)
      expect(countItem(shelf, 'wood_plank')).toBeGreaterThanOrEqual(1)
      expect(countItem(shelf, 'duct_tape')).toBeGreaterThanOrEqual(1)
      const pile = loot('ct-house-scrap', seed)
      expect(countItem(pile, 'scrap_metal')).toBeGreaterThanOrEqual(1)
      const all = [kit, shelf, pile]
      tape.push(all.reduce((n, inv) => n + countItem(inv, 'duct_tape'), 0))
      wood.push(all.reduce((n, inv) => n + countItem(inv, 'wood_plank'), 0))
      for (const inv of all) for (const s of inv.slots) if (s) expect(s.quantity).toBeLessThanOrEqual(ITEMS[s.itemId].stackLimit)
    }
    // Recipes are reachable on every seed: at least two tape-using jobs (repair + repair, or a club).
    expect(Math.min(...tape)).toBeGreaterThanOrEqual(2)
    expect(Math.min(...wood)).toBeGreaterThanOrEqual(2)
    // Variety exists: some seeds give enough for a club and a repair.
    expect(seeds.filter((_, i) => tape[i] >= 3 && wood[i] >= 3).length).toBeGreaterThan(seeds.length / 4)
  })

  it('Phase 1 and P2-S2 containers never roll materials (their tables are unchanged)', () => {
    for (const seed of seeds.slice(0, 100)) {
      for (const c of NEIGHBORHOOD_MAP.containers) {
        if (CONTAINERS_ADDED_V5.has(c.id)) continue
        for (const m of MATERIALS) expect(countItem(loot(c.id, seed), m)).toBe(0)
      }
    }
  })
})

describe('P2-S4 container placement', () => {
  const overlaps = (a: { x: number; z: number; w: number; d: number }, b: { x: number; z: number; w: number; d: number }) =>
    Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2
  const box = (p: { x: number; z: number }, size: readonly number[]) => ({ x: p.x, z: p.z, w: size[0], d: size[2] })
  /** 2D segment vs box (slab test), used as a stand-in for the interaction raycast through walls. */
  const segmentHits = (a: { x: number; z: number }, b: { x: number; z: number }, r: { x: number; z: number; w: number; d: number }) => {
    let t0 = 0
    let t1 = 1
    for (const [p, q, c, h] of [[a.x, b.x, r.x, r.w / 2], [a.z, b.z, r.z, r.d / 2]] as const) {
      const d = q - p
      if (Math.abs(d) < 1e-9) {
        if (p < c - h || p > c + h) return false
        continue
      }
      let lo = (c - h - p) / d
      let hi = (c + h - p) / d
      if (lo > hi) [lo, hi] = [hi, lo]
      t0 = Math.max(t0, lo)
      t1 = Math.min(t1, hi)
      if (t0 > t1) return false
    }
    return true
  }

  it('new containers do not overlap walls, obstacles or other containers', () => {
    for (const id of CONTAINERS_ADDED_V5) {
      const c = byId.get(id)!
      const me = box(c.position, c.size)
      for (const w of NEIGHBORHOOD_MAP.walls) expect(overlaps(me, box(w.position, w.size)), `${id} vs ${w.id}`).toBe(false)
      for (const o of NEIGHBORHOOD_MAP.containers) if (o.id !== id) expect(overlaps(me, box(o.position, o.size)), `${id} vs ${o.id}`).toBe(false)
    }
    const inside = (id: string, building: string) => isInsideBuilding(NEIGHBORHOOD_MAP.buildings.find((b) => b.id === building)!, byId.get(id)!.position.x, byId.get(id)!.position.z)
    expect(inside('ct-safehouse-toolbox', 'safehouse')).toBe(true)
    expect(inside('ct-store-hardware', 'store')).toBe(true)
    expect(NEIGHBORHOOD_MAP.buildings.some((b) => isInsideBuilding(b, 20.5, 12, 0.5))).toBe(false)
    expect([...CONTAINERS_ADDED_V5].some((id) => CONTAINERS_ADDED_V3.has(id))).toBe(false)
  })

  it('each new container has a reachable standing spot in interaction range with no wall in between', () => {
    const nav = new NavGrid(NEIGHBORHOOD_MAP, GAME_CONFIG.nav)
    for (const d of NEIGHBORHOOD_MAP.doors) nav.setDoorState(d.id, 'open')
    const r = GAME_CONFIG.player.radius
    for (const id of CONTAINERS_ADDED_V5) {
      const c = byId.get(id)!
      const radius = Math.max(c.size[0], c.size[2]) / 2 + 0.3 // same as runtime buildInteractables
      const me = box(c.position, c.size)
      const spots: { x: number; z: number }[] = []
      for (let a = 0; a < 16; a++) {
        for (const dist of [0.6, 0.9, 1.2, 1.5]) {
          const p = { x: c.position.x + Math.sin((a / 16) * Math.PI * 2) * (c.size[0] / 2 + dist), z: c.position.z + Math.cos((a / 16) * Math.PI * 2) * (c.size[2] / 2 + dist) }
          if (!nav.isWalkable(p.x, p.z)) continue
          if (overlaps({ ...p, w: 2 * r, d: 2 * r }, me)) continue
          if (Math.hypot(p.x - c.position.x, p.z - c.position.z) > INTERACT_RANGE + radius) continue
          if (NEIGHBORHOOD_MAP.walls.some((w) => segmentHits(p, c.position, box(w.position, w.size)))) continue
          if (!nav.findPath({ ...NEIGHBORHOOD_MAP.playerSpawn }, { x: p.x, y: 0, z: p.z })) continue
          spots.push(p)
        }
      }
      expect(spots.length, id).toBeGreaterThan(0)
    }
  })
})
