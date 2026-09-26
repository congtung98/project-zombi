import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../core/runtime'
import { NEIGHBORHOOD_MAP, mapChunkSize } from '../world/mapData'
import { buildStressMap } from '../world/stressMap'
import { collectStaticItems, groupByChunk } from './staticBatchData'
import { installIndoorShading } from './indoorShading'
import { MeshStandardMaterial } from 'three'

describe('static render batches (R3b)', () => {
  it('draws every wall, container body, floor and roof once, grouped into the map chunks', () => {
    const rt = new GameRuntime(NEIGHBORHOOD_MAP)
    const items = collectStaticItems(rt.map, rt.staticColliders)
    const walls = rt.map.walls.length
    // G2: per building a floor, an eaves board and a hipped roof, plus the drawn-only details.
    const base = items.filter((i) => !i.detail)
    expect(base).toHaveLength(walls + rt.map.containers.length + rt.map.buildings.length * 3)
    expect(items.filter((i) => i.detail).every((i) => i.buildingId)).toBe(true)
    const chunks = groupByChunk(items, mapChunkSize(rt.map))
    expect([...chunks.keys()].sort()).toEqual(['-1,-1', '-1,0', '0,-1', '0,0', 'wide'])
    // M10: the 52 m boundary fence spans more than a chunk: always mounted.
    expect(chunks.get('wide')!.every((i) => Math.max(i.size[0], i.size[2]) > mapChunkSize(rt.map))).toBe(true)
    expect([...chunks.values()].reduce((n, l) => n + l.length, 0)).toBe(items.length)
    // Tall walls and roofs fade; low props, containers and floors never do.
    expect(items.filter((i) => i.roofOf)).toHaveLength(6)
    expect(items.filter((i) => i.shape === 'hip')).toHaveLength(3)
    const tallWalls = rt.map.walls.filter((w) => w.size[1] >= 1.5).length
    expect(base.filter((i) => i.occluder)).toHaveLength(tallWalls + 6)
    // Door frames fade with their doorway (their anchor), nothing else of the details does.
    expect(items.filter((i) => i.detail && i.occluder).every((i) => i.role === 'opening' && i.anchor)).toBe(true)
    expect(items.filter((i) => i.shape === 'floor' && i.occluder)).toEqual([])
    const fence = items.find((i) => i.center.x === -14.5 && i.center.z === 6)!
    expect(fence.occluder).toBe(false)
  })

  it('the stress map needs one batch per non-empty chunk instead of one mesh per object', () => {
    const rt = new GameRuntime(buildStressMap(4))
    const items = collectStaticItems(rt.map, rt.staticColliders)
    const chunks = groupByChunk(items, mapChunkSize(rt.map))
    expect(items.length).toBeGreaterThan(1000)
    expect(chunks.size).toBeLessThanOrEqual(64)
  })

  it('the indoor lighting patch places batched and instanced vertices in world space', () => {
    installIndoorShading()
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: '#include <common>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <opaque_fragment>' }
    new MeshStandardMaterial().onBeforeCompile(shader as never, null as never)
    expect(shader.vertexShader).toContain('batchingMatrix * indoorLocal')
    expect(shader.vertexShader).toContain('instanceMatrix * indoorLocal')
  })
})
