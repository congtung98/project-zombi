import { describe, expect, it } from 'vitest'
import { loadBundledWorld } from '../../map/content'
import { GameRuntime } from '../core/runtime'
import { roadY } from '../world/mapData'
import { collectStaticItems, KERB, ROAD_PAINT, roadDetails } from './staticBatchData'

/**
 * G4: street paint and kerbs worked out from the roads, planting and outdoor props in the lab. All
 * drawn only: the colliders are those of the plain map.
 */

const map = () => ({ ...loadBundledWorld('graphics-lab').map, zombieSpawns: [] })

describe('landscape (G4)', () => {
  it('a dashed centre line on the street, kerbs where the pavements meet it, none on the driveway', () => {
    const m = map()
    const items = roadDetails(m.roads)
    const street = m.roads.find((r) => r.id === 'c0_0/roads/street')!
    const dashes = items.filter((i) => i.id?.startsWith('c0_0/roads/street#paint-'))
    // 48 m street, 1.6 m dashes every 3.2 m.
    expect(dashes).toHaveLength(Math.floor((48 - ROAD_PAINT.gap) / (ROAD_PAINT.dash + ROAD_PAINT.gap)))
    for (const d of dashes) {
      expect(d.center.z).toBeCloseTo(street.position.z, 6)
      expect(d.center.y).toBeGreaterThan(roadY(street))
      expect(d.center.y + d.size[1] / 2).toBeLessThan(0.02) // under any building floor
    }
    const kerbs = items.filter((i) => i.id?.includes('#kerb-'))
    expect(kerbs.map((k) => k.id!.split('#')[0]).sort()).toEqual(['c0_0/roads/sidewalk-n', 'c0_0/roads/sidewalk-s'])
    for (const k of kerbs) {
      expect(k.size[0]).toBeCloseTo(48, 6)
      expect(k.size[1]).toBe(KERB.height)
      // On the pavement side of the edge it shares with the street (z 21 and z 27).
      expect([21 - KERB.width / 2, 27 + KERB.width / 2].some((z) => Math.abs(k.center.z - z) < 1e-6)).toBe(true)
    }
    expect(items.some((i) => i.id?.startsWith('c0_0/roads/driveway'))).toBe(false)
  })

  it('planting and paint are drawn only; outdoor props keep their colliders', () => {
    const rt = new GameRuntime(map())
    const bare = map()
    delete bare.decor
    bare.walls = bare.walls.map((w) => {
      const copy = { ...w }
      delete copy.visual
      return copy
    })
    const plain = new GameRuntime(bare)
    expect(rt.staticColliders.list('wall').map((c) => [c.id, c.min, c.max])).toEqual(plain.staticColliders.list('wall').map((c) => [c.id, c.min, c.max]))
    const items = collectStaticItems(rt.map, rt.staticColliders)
    const bushes = items.filter((i) => i.decor?.assetId === 'decor/bush')
    expect(bushes.length).toBeGreaterThan(8)
    expect(bushes.every((b) => b.shape === 'crown' && !b.buildingId)).toBe(true)
    expect(items.filter((i) => i.decor?.assetId === 'decor/grass').every((g) => g.shape === 'cone')).toBe(true)
  })
})
