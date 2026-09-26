import { describe, expect, it } from 'vitest'
import { loadBundledWorld } from '../../map/content'
import type { MapData } from '../world/mapData'
import { buildContactMap, type ContactMap } from './contactShade'

/**
 * G4: the contact map. A box standing on a storey floor darkens its own storey's channel around it
 * with a soft falloff; boxes that do not touch a floor (lintels, window headers) and other storeys
 * are untouched.
 */

const lab = (): MapData => ({ ...loadBundledWorld('graphics-lab').map, zombieSpawns: [] })
const wall = (id: string, x: number, y: number, z: number, size: [number, number, number]) => ({ id, position: { x, y, z }, size })

/** Channel value (0..1) of storey `level` at a world point. */
function at(m: ContactMap, x: number, z: number, level = 0): number {
  const c = Math.floor((x - m.x0) / m.cell)
  const r = Math.floor((z - m.z0) / m.cell)
  return m.data[(r * m.width + c) * 4 + level] / 255
}

describe('contact map (G4)', () => {
  it('a wall on the ground darkens the ground channel next to it, fading within half a metre', () => {
    const map = { ...lab(), walls: [wall('w', 20, 1.5, 20, [4, 3, 0.2])], containers: [] }
    const m = buildContactMap(map)
    expect(at(m, 20, 20)).toBeGreaterThan(0.3)
    const near = at(m, 20, 20.25)
    const mid = at(m, 20, 20.45)
    expect(near).toBeGreaterThan(0.1)
    expect(mid).toBeLessThan(near)
    expect(at(m, 20, 21)).toBe(0)
    // Other storeys untouched.
    for (const level of [1, 2, 3]) expect(at(m, 20, 20.25, level)).toBe(0)
  })

  it('upper-storey boxes go to their storey; boxes off the floor are left out', () => {
    const map = { ...lab(), walls: [wall('upper', 10, 3.95, 10, [1.2, 1.9, 0.6]), wall('lintel', 30, 2.5, 30, [1.2, 0.8, 0.3])], containers: [] }
    const m = buildContactMap(map)
    expect(at(m, 10, 10, 1)).toBeGreaterThan(0.5)
    expect(at(m, 10, 10, 0)).toBe(0)
    expect(at(m, 30, 30, 0)).toBe(0)
    expect(at(m, 30, 30, 1)).toBe(0)
  })

  it('the lab: containers count, the map covers the ground and stays small', () => {
    const map = lab()
    const m = buildContactMap(map)
    expect(m.width * m.height).toBeLessThanOrEqual(2048 * 2048)
    // Next to house A's ground-floor wardrobe (world 17.1, 16; front at z 15.7) and its upstairs one.
    expect(at(m, 17.1, 15.55)).toBeGreaterThan(0)
    expect(at(m, 10.6, 11.5, 1)).toBeGreaterThan(0)
    // Out on the street, far from anything: nothing.
    expect(at(m, 24, 24)).toBe(0)
  })
})
