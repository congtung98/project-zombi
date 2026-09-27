import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, loadWorld, REGISTERED_LOOT_TABLES } from '../content'
import { checkWorldDocuments } from '../validate'
import { surfaceBlockRects } from '../resolve'
import { GameRuntime } from '../../game/core/runtime'
import { collectStaticItems } from '../../game/rendering/staticBatchData'
import { ELLIPSE_SEGMENTS, surfaceBatches } from '../../game/rendering/roadBatches'
import { roadY, surfaceY } from '../../game/world/mapData'
import { validateSaveGame } from '../../game/systems/save'
import { drawItems } from '../../editor/drawItems'
import { placeInstance, placeRecord, rotateRecords, updateRecord, type CommandResult } from './commands'
import { blankDocument, documentFiles, resolvedRecords, type MapDocument } from './document'
import { layerOf } from './layers'
import { documentFromFiles, exportPack, parsePack } from './pack'
import { createPrefab, placePrefabItem, rotatePrefabItems, updatePrefabItem } from './prefabCommands'
import { dragRecordHandle } from './handles'
import { SURFACE_DEFAULTS, surfaceMaterialPatch } from './surfaces'
import type { Rect } from '../schema'

/** Prefab library P1: surface objects (yards, lawns, paths, ponds) in chunks and prefabs. */

const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
const DT = 1 / 60

function ok(r: CommandResult): Extract<CommandResult, { ok: true }> {
  if (!r.ok) throw new Error(r.error)
  return r
}

function blank(): MapDocument {
  const r = documentFromFiles(bundledWorldFiles('neighborhood-50'), OPTS)
  if (!r.ok) throw new Error(r.error)
  return blankDocument({ worldId: 'p1-surfaces', name: 'P1', prefabs: r.doc.world.prefabs.map((entry) => ({ entry, doc: r.doc.prefabs.get(entry.prefabId)! })) })
}

function issuesOf(doc: MapDocument) {
  const files = new Map(documentFiles(doc))
  return checkWorldDocuments((p) => files.get(p), OPTS).issues
}
const errors = (doc: MapDocument) => issuesOf(doc).filter((i) => i.severity === 'error')
const mapOf = (doc: MapDocument) => {
  const files = new Map(documentFiles(doc))
  return loadWorld((p) => files.get(p)).map
}
const covers = (rects: readonly Rect[], x: number, z: number) => rects.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ)

describe('surface objects (prefab library P1)', () => {
  it('a pond is a drawn water ellipse with a hidden barrier; it validates, spawns in it are blocked', () => {
    const doc = ok(placeRecord(blank(), 'ground/pond', { x: 10, z: 10 })).doc
    expect(errors(doc)).toEqual([])
    const r = resolvedRecords(doc).find((x) => x.id === 'c0_0/objects/pond-1')!
    expect(layerOf(r)).toBe('surfaces')
    expect(r.parts.surfaces).toEqual([{ id: 'c0_0/objects/pond-1', shape: 'ellipse', position: { x: 10, z: 10 }, size: [12, 8], surface: 'water', color: SURFACE_DEFAULTS.water.color, layer: 1 }])
    expect(r.bounds).toEqual({ minX: 4, minZ: 6, maxX: 16, maxZ: 14 })
    const walls = r.parts.walls!
    expect(walls.length).toBeGreaterThan(8)
    expect(walls.every((w) => w.hidden && w.id.startsWith('c0_0/objects/pond-1#solid-') && w.size[1] === 1)).toBe(true)
    expect(r.parts.navBlockers).toEqual([])
    // A spawn in the water is blocked; one on the bank is fine.
    expect(errors(ok(placeRecord(doc, 'spawn/zombie', { x: 10, z: 10 })).doc).map((i) => i.code)).toContain('spawn-blocked')
    expect(errors(ok(placeRecord(doc, 'spawn/zombie', { x: 10, z: 15 })).doc)).toEqual([])
  })

  it('ellipse strips cover the whole ellipse and stay within its bounding box', () => {
    const rects = surfaceBlockRects('ellipse', { x: 0, z: 0 }, [12, 8])
    for (let a = 0; a < 64; a++) {
      const t = (a / 64) * Math.PI * 2
      for (const k of [0, 0.5, 0.95]) expect(covers(rects, Math.cos(t) * 6 * k, Math.sin(t) * 4 * k)).toBe(true)
    }
    for (const q of rects) expect(q.minX >= -6 && q.maxX <= 6 && q.minZ >= -4 && q.maxZ <= 4).toBe(true)
    expect(covers(rects, 5.9, 3.9)).toBe(false)
    expect(surfaceBlockRects('rect', { x: 1, z: 2 }, [4, 2])).toEqual([{ minX: -1, minZ: 1, maxX: 3, maxZ: 3 }])
  })

  it('the game: water blocks navigation and collides, is never drawn as a box; a flowerbed only blocks navigation', () => {
    let doc = ok(placeRecord(blank(), 'ground/pond', { x: 10, z: 10 })).doc
    doc = ok(placeRecord(doc, 'ground/flowerbed', { x: 22, z: 22 })).doc
    doc = ok(placeRecord(doc, 'ground/lawn', { x: 22, z: 8 })).doc
    expect(errors(doc)).toEqual([])
    const map = mapOf(doc)
    expect(map.surfaces?.map((s) => s.id)).toEqual(['c0_0/objects/pond-1', 'c0_0/objects/flowerbed-1', 'c0_0/objects/lawn-1'])
    expect(map.navBlockers?.every((b) => b.id.startsWith('c0_0/objects/flowerbed-1#nav-'))).toBe(true)
    const rt = new GameRuntime(map)
    rt.newGame(1)
    expect(rt.nav.isWalkable(10, 10)).toBe(false)
    expect(rt.nav.isWalkable(10, 16)).toBe(true)
    expect(rt.nav.isWalkable(22, 22)).toBe(false)
    expect(rt.nav.isWalkable(22, 8)).toBe(true)
    // The barrier is a collider; the flowerbed has none (the player may step on it).
    const barrier = rt.staticColliders.list('wall').filter((w) => w.id.includes('#solid-'))
    expect(barrier.length).toBeGreaterThan(0)
    expect(rt.staticColliders.list('wall').some((w) => w.id.startsWith('c0_0/objects/flowerbed-1'))).toBe(false)
    const items = collectStaticItems(map, rt.staticColliders)
    expect(items.some((i) => i.id?.includes('#solid-'))).toBe(false)
    // Worlds without surfaces keep their MapData shape.
    const plain = mapOf(blank())
    expect(plain).not.toHaveProperty('surfaces')
    expect(plain).not.toHaveProperty('navBlockers')
  })

  it('surfaces are batched per surface and colour; an ellipse is a fan facing up, above a road of its layer', () => {
    const map = mapOf(ok(placeRecord(ok(placeRecord(blank(), 'ground/pond', { x: 10, z: 10 })).doc, 'ground/yard', { x: 22, z: 22 })).doc)
    const batches = surfaceBatches(map.surfaces!)
    expect(batches.map((b) => b.surface).sort()).toEqual(['concrete', 'water'])
    const water = batches.find((b) => b.surface === 'water')!
    expect(water.indices.length).toBe(ELLIPSE_SEGMENTS * 3)
    for (let i = 1; i < water.normals.length; i += 3) expect(water.normals[i]).toBe(1)
    // Triangle winding faces +Y.
    const p = water.positions
    const v = (k: number) => [p[k * 3], p[k * 3 + 1], p[k * 3 + 2]]
    for (let t = 0; t < water.indices.length; t += 3) {
      const [a, b, c] = [v(water.indices[t]), v(water.indices[t + 1]), v(water.indices[t + 2])]
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])
      expect(ny).toBeGreaterThan(0)
    }
    expect(surfaceY({ layer: 1 })).toBeGreaterThan(roadY({ layer: 1 }))
    expect(surfaceY({ layer: 1 })).toBeLessThan(roadY({ layer: 2 }))
  })

  it('validation: solid but walkable is an error, level is an error, overlapping colours on one layer warn', () => {
    const doc = ok(placeRecord(blank(), 'ground/pond', { x: 10, z: 10 })).doc
    const bad = (patch: Record<string, unknown>) => errors(ok(updateRecord(doc, 'c0_0/objects/pond-1', patch)).doc).map((i) => i.code)
    expect(bad({ navigation: 'walkable' })).toContain('surface-solid-walkable')
    expect(bad({ level: 1 })).toContain('level-not-allowed')
    expect(bad({ material: 'lava' })).toContain('schema')
    expect(bad({ shape: 'circle' })).toContain('schema')
    expect(bad({ layer: 9 })).toContain('out-of-range')
    // Lawn over the pond, same layer: they flicker.
    const lawn = ok(updateRecord(ok(placeRecord(doc, 'ground/lawn', { x: 10, z: 10 })).doc, 'c0_0/objects/lawn-1', { layer: 1 })).doc
    expect(issuesOf(lawn).filter((i) => i.code === 'surface-overlap')).toHaveLength(1)
    expect(issuesOf(ok(updateRecord(lawn, 'c0_0/objects/lawn-1', { layer: 0 })).doc).filter((i) => i.code === 'surface-overlap')).toEqual([])
  })

  it('turns and resizes like other axis-aligned records; a material change carries its defaults', () => {
    const doc = ok(placeRecord(blank(), 'ground/parking', { x: 12, z: 12 })).doc
    const turned = ok(rotateRecords(doc, ['c0_0/objects/parking-1'], 1)).doc
    expect(resolvedRecords(turned).find((r) => r.id === 'c0_0/objects/parking-1')!.parts.surfaces![0].size).toEqual([8, 12])
    const wider = ok(dragRecordHandle(turned, 'c0_0/objects/parking-1', 'e', { x: 18, z: 12 })).doc
    expect(resolvedRecords(wider).find((r) => r.id === 'c0_0/objects/parking-1')!.parts.surfaces![0].size).toEqual([10, 12])
    const water = surfaceMaterialPatch({ material: 'asphalt', color: SURFACE_DEFAULTS.asphalt.color, collision: 'none', navigation: 'walkable' }, 'water')
    expect(water).toEqual({ material: 'water', color: SURFACE_DEFAULTS.water.color, collision: 'solid', navigation: 'blocked' })
    // A customised colour stays.
    expect(surfaceMaterialPatch({ material: 'grass', color: '#123456', collision: 'none', navigation: 'walkable' }, 'dirt')).toEqual({ material: 'dirt', collision: 'none', navigation: 'walkable' })
  })

  it('in a prefab: placed from the palette, turned with the instance, ground storey only', () => {
    let doc = ok(createPrefab(blank(), { prefabId: 'landscape/garden', name: 'Vườn', width: 12, depth: 8 })).doc
    doc = ok(placePrefabItem(doc, 'landscape/garden', 'surface/pool', { x: 2, z: 0 }, null, 0, 0)).doc
    const prefab = doc.prefabs.get('landscape/garden')!
    const pool = prefab.objects.find((o) => o.kind === 'surface')!
    expect(pool).toMatchObject({ kind: 'surface', localId: 'pool-1', shape: 'rect', size: [8, 4], material: 'water', collision: 'solid', navigation: 'blocked' })
    expect(pool).not.toHaveProperty('level')
    const turnedItem = ok(rotatePrefabItems(doc, 'landscape/garden', ['pool-1'], 1)).doc
    expect(turnedItem.prefabs.get('landscape/garden')!.objects.find((o) => o.localId === 'pool-1')).toMatchObject({ size: [4, 8] })
    doc = ok(placeInstance(doc, 'landscape/garden', { x: 12, z: 12 }, 1)).doc
    expect(errors(doc)).toEqual([])
    const inst = resolvedRecords(doc).find((r) => r.category === 'instances')!
    // q = 1 maps (2, 0) to (0, −2): centre (12, 10), size swapped.
    expect(inst.parts.surfaces).toEqual([{ id: `${inst.id}/pool-1`, shape: 'rect', position: { x: 12, z: 10 }, size: [4, 8], surface: 'water', color: SURFACE_DEFAULTS.water.color, layer: 1 }])
    expect(inst.parts.walls!.filter((w) => w.hidden).map((w) => w.id)).toEqual([`${inst.id}/pool-1#solid-0`])
    expect(inst.entityIds).toContain(`${inst.id}/pool-1`)
    const bad = ok(updatePrefabItem(doc, 'landscape/garden', 'pool-1', { level: 1 })).doc
    expect(errors(bad).map((i) => i.code)).toContain('level-not-allowed')
    // The editor draws the surface (a plane), never the barrier.
    const items = drawItems(inst)
    expect(items.filter((i) => i.geometry === 'plane' && i.color === SURFACE_DEFAULTS.water.color)).toHaveLength(1)
    const barrier = inst.parts.walls!.find((w) => w.hidden)!
    expect(items.some((i) => i.geometry === 'box' && i.position[0] === barrier.position.x && i.position[2] === barrier.position.z && i.scale[1] === barrier.size[1])).toBe(false)
  })

  it('round-trips through a content pack, and a played world with a pond saves and loads (no saved state for surfaces)', () => {
    const doc = ok(placeRecord(ok(placeRecord(blank(), 'ground/pond', { x: 10, z: 10 })).doc, 'ground/path', { x: 20, z: 4 })).doc
    const back = parsePack(exportPack(doc), OPTS)
    if (!back.ok) throw new Error(back.error)
    expect(back.doc.chunks.get('c0_0')!.objects).toEqual(doc.chunks.get('c0_0')!.objects)
    const map = mapOf(doc)
    const rt = new GameRuntime(map)
    rt.newGame(3)
    for (let i = 0; i < 30; i++) rt.tick(DT)
    const snap = JSON.parse(JSON.stringify(rt.createSnapshot())) as unknown
    expect(JSON.stringify(snap)).not.toContain('pond-1')
    const v = validateSaveGame(snap, map.id, map)
    expect(v.ok).toBe(true)
    if (!v.ok) return
    const rt2 = new GameRuntime(mapOf(doc))
    rt2.loadSnapshot(v.save)
    expect(rt2.player.position).toEqual(rt.player.position)
  })
})
