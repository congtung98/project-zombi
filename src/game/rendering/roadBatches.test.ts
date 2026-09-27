import { describe, expect, it } from 'vitest'
import { loadBundledWorld, loadWorld, REGISTERED_LOOT_TABLES } from '../../map/content'
import { documentFiles } from '../../map/editor/document'
import { buildLayoutWorld } from '../../map/layout/layoutWorld'
import { planLayout } from '../../map/layout/plan'
import { gridStreets, imp } from '../../map/layout/testUtils'
import { roadY } from '../world/mapData'
import { ROAD_BATCH_CELL, roadBatches } from './roadBatches'

/** WG5: road records merged into a few meshes per 128 m cell and colour, drawing the same quads. */

describe('WG5 road batches', () => {
  it('draws every road once, at its own height, in far fewer meshes (dense 500 m town)', () => {
    const layout = imp(gridStreets(21, 25, 31, 0.6))
    const doc = buildLayoutWorld(layout, planLayout(layout), { worldId: 'dense', name: 'dense', validation: { lootTables: REGISTERED_LOOT_TABLES } })
    const files = new Map(documentFiles(doc))
    const roads = loadWorld((p) => files.get(p)).map.roads
    expect(roads.length).toBeGreaterThan(1000)
    const batches = roadBatches(roads)
    expect(batches.length).toBeLessThan(roads.length / 15)
    expect(batches.reduce((n, b) => n + b.roads, 0)).toBe(roads.length)
    // Same total area and the same set of heights (draw layers) as the separate planes.
    let area = 0
    const heights = new Set<number>()
    for (const b of batches) {
      for (let i = 0; i < b.roads; i++) {
        const p = b.positions.subarray(i * 12, i * 12 + 12)
        area += Math.abs(p[6] - p[0]) * Math.abs(p[5] - p[2])
        heights.add(Math.round(p[1] * 1e6))
        // Faces look up.
        expect([b.normals[i * 12 + 1], b.normals[i * 12 + 4]]).toEqual([1, 1])
      }
      expect(new Set(b.key.split('|')[1]).size).toBeGreaterThan(0)
    }
    // Float32 vertices: equal to a millionth of the total.
    expect(Math.abs(area / roads.reduce((a, r) => a + r.size[0] * r.size[1], 0) - 1)).toBeLessThan(1e-6)
    expect([...heights].sort()).toEqual([...new Set(roads.map((r) => Math.round(roadY(r) * 1e6)))].sort())
  })

  it('groups by cell and colour: one colour per batch, every road in the cell of its centre', () => {
    const roads = loadBundledWorld('neighborhood-50').map.roads
    for (const b of roadBatches(roads)) {
      const [cell, color] = b.key.split('|')
      expect(b.color.toLowerCase()).toBe(color)
      const [ci, cj] = cell.split(',').map(Number)
      for (let i = 0; i < b.roads; i++) {
        const p = b.positions.subarray(i * 12, i * 12 + 12)
        const cx = (p[0] + p[6]) / 2
        const cz = (p[2] + p[5]) / 2
        expect(Math.floor(cx / ROAD_BATCH_CELL)).toBe(ci)
        expect(Math.floor(cz / ROAD_BATCH_CELL)).toBe(cj)
      }
    }
  })
})
