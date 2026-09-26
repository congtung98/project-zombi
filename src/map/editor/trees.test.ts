import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, loadWorld, REGISTERED_LOOT_TABLES } from '../content'
import { deepCheck } from '../analysis'
import { checkWorldDocuments } from '../validate'
import { GameRuntime } from '../../game/core/runtime'
import { collectStaticItems } from '../../game/rendering/staticBatchData'
import { treeProfile, trunkWall } from '../../game/world/trees'
import { buildBatches, drawItems } from '../../editor/drawItems'
import { DEFAULT_TREES, generateTown, type Catalog, type GeneratorOptions } from '../tools/generator'
import { placeInstance, placeRecord, rotateRecords, updateRecord, type CommandResult } from './commands'
import { blankDocument, documentFiles, findRecord, resolvedRecords, type MapDocument } from './document'
import { dragPrefabHandle, dragRecordHandle, prefabItemHandles, recordHandles } from './handles'
import { layerOf } from './layers'
import { documentFromFiles, exportPack, parsePack } from './pack'
import { createPrefab, placePrefabItem, resolvePrefab, rotatePrefabItems } from './prefabCommands'
import type { Rect, StandaloneObject } from '../schema'

const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
const P = 'building/garden-house'

function ok(r: CommandResult): Extract<CommandResult, { ok: true }> {
  if (!r.ok) throw new Error(r.error)
  return r
}

function library(): MapDocument {
  const r = documentFromFiles(bundledWorldFiles('neighborhood-50'), OPTS)
  if (!r.ok) throw new Error(r.error)
  return r.doc
}

function catalog(): Catalog {
  const doc = library()
  return { id: 'neighborhood-50@1', prefabs: doc.world.prefabs.map((entry) => ({ entry, doc: doc.prefabs.get(entry.prefabId)! })) }
}

function blank(): MapDocument {
  return blankDocument({ worldId: 'm9-test', name: 'M9', prefabs: catalog().prefabs })
}

function issuesOf(doc: MapDocument) {
  const files = new Map(documentFiles(doc))
  return checkWorldDocuments((p) => files.get(p), OPTS).issues
}
const errors = (doc: MapDocument) => issuesOf(doc).filter((i) => i.severity === 'error')

function mapOf(doc: MapDocument) {
  const files = new Map(documentFiles(doc))
  return loadWorld((p) => files.get(p)).map
}

const gen = (o: Partial<GeneratorOptions> & { seed: number }) => generateTown({ worldId: `gen-${o.seed}`, name: 'Gen', blocksX: 2, blocksZ: 2, ...o }, catalog(), OPTS)
const overlapsRect = (a: Rect, b: Rect) => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ

describe('trees (M9)', () => {
  it('a tree is a trunk wall (collider, nav, sight) plus a drawn canopy; validated ranges', () => {
    let doc = ok(placeRecord(blank(), 'object/tree', { x: 6, z: 6 })).doc
    doc = ok(placeRecord(doc, 'object/pine', { x: 12, z: 6 })).doc
    expect(errors(doc)).toEqual([])
    const tree = resolvedRecords(doc).find((r) => r.id === 'c0_0/objects/tree-1')!
    expect(layerOf(tree)).toBe('vegetation')
    expect(tree.parts.trees).toEqual([{ id: 'c0_0/objects/tree-1', position: { x: 6, z: 6 }, height: 6, canopy: 2.5, trunk: 0.25, color: '#3f6b35', style: 'round' }])
    expect(tree.parts.walls).toEqual([trunkWall(tree.parts.trees![0])])
    expect(tree.bounds).toEqual({ minX: 3.5, minZ: 3.5, maxX: 8.5, maxZ: 8.5 })
    const f = treeProfile({ height: 6, canopy: 2.5, style: 'round' })
    expect(f.canopyTop).toBe(6)
    expect(f.canopyBottom).toBeGreaterThan(0)
    expect(f.trunkHeight).toBeGreaterThan(f.canopyBottom)
    // Bad values are errors; a spawn on the trunk is blocked.
    const bad = (patch: Record<string, unknown>) => errors(ok(updateRecord(doc, 'c0_0/objects/tree-1', patch)).doc).map((i) => i.path.split('#')[1])
    expect(bad({ trunk: 3 })).toContain('/objects/0/trunk')
    expect(bad({ height: 40 })).toContain('/objects/0/height')
    expect(bad({ style: 'palm' })).toContain('/objects/0/style')
    expect(errors(ok(placeRecord(doc, 'spawn/zombie', { x: 6, z: 6 })).doc).map((i) => i.code)).toContain('spawn-blocked')
    // Standing under the canopy is fine.
    expect(errors(ok(placeRecord(doc, 'spawn/zombie', { x: 7.5, z: 6 })).doc)).toEqual([])
    // No rotation; a radius handle sizes the canopy, never below the trunk.
    expect(rotateRecords(doc, ['c0_0/objects/tree-1'], 1).ok).toBe(false)
    expect(recordHandles(doc, 'c0_0/objects/tree-1')).toEqual([{ key: 'radius', at: { x: 8.5, z: 6 } }])
    const wider = ok(dragRecordHandle(doc, 'c0_0/objects/tree-1', 'radius', { x: 10, z: 6 })).doc
    expect(findRecord(wider, 'c0_0/objects/tree-1')!.record.canopy).toBe(4)
    expect(findRecord(ok(dragRecordHandle(doc, 'c0_0/objects/tree-1', 'radius', { x: 6, z: 6 })).doc, 'c0_0/objects/tree-1')!.record.canopy).toBe(0.5)
    // Round-trips through a pack.
    const back = parsePack(exportPack(doc), OPTS)
    expect(back.ok && (back.doc.chunks.get('c0_0')!.objects as StandaloneObject[]).filter((o) => o.kind === 'tree')).toHaveLength(2)
  })

  it('the game blocks the trunk, draws trees instead of boxes, and the canopy fades like a roof', () => {
    const doc = ok(placeRecord(blank(), 'object/tree', { x: 6, z: 6 })).doc
    const map = mapOf(doc)
    expect(map.trees).toHaveLength(1)
    expect(map.walls.some((w) => w.id === 'c0_0/objects/tree-1')).toBe(true)
    const rt = new GameRuntime(map)
    rt.newGame(1)
    expect(rt.nav.isWalkable(6, 6)).toBe(false)
    expect(rt.nav.isWalkable(7.8, 6)).toBe(true)
    const items = collectStaticItems(map, rt.staticColliders)
    expect(items.filter((i) => i.shape === 'box' && i.center.x === 6 && i.center.z === 6)).toEqual([])
    const trunk = items.find((i) => i.shape === 'trunk')!
    const crown = items.find((i) => i.shape === 'crown')!
    expect(trunk).toMatchObject({ occluder: false })
    expect(crown).toMatchObject({ occluder: true, color: '#3f6b35', size: [5, expect.any(Number), 5] })
    // Worlds without trees keep their MapData shape.
    expect(mapOf(blank())).not.toHaveProperty('trees')
  })

  it('editor draws trunk + translucent canopy (no box) and batches mixed shapes', () => {
    const doc = ok(placeRecord(ok(placeRecord(blank(), 'object/tree', { x: 6, z: 6 })).doc, 'object/pine', { x: 12, z: 6 })).doc
    const items = resolvedRecords(doc).flatMap(drawItems)
    expect(items.filter((i) => i.geometry === 'box')).toEqual([])
    expect(items.map((i) => `${i.geometry}:${i.pass}`).sort()).toEqual(expect.arrayContaining(['cone:glass', 'crown:glass', 'trunk:solid']))
    const batches = buildBatches(items)
    expect(batches.reduce((n, m) => n + m.instanceCount, 0)).toBe(items.length)
    for (const m of batches) m.dispose()
  })

  it('prefab trees: placed from the palette, resolved with the instance turn, radius handle, no rotation', () => {
    let doc = ok(createPrefab(blank(), { prefabId: P, name: 'Nhà vườn', width: 8, depth: 6 })).doc
    doc = ok(placePrefabItem(doc, P, 'furniture/tree', { x: 2, z: 5 })).doc
    const prefab = doc.prefabs.get(P)!
    const tree = prefab.objects.find((o) => o.kind === 'tree')!
    expect(tree).toMatchObject({ kind: 'tree', localId: 'tree-1', position: { x: 2, z: 5 }, style: 'round' })
    expect(prefabItemHandles(prefab, 'tree-1').map((h) => h.key)).toEqual(['radius'])
    expect(ok(dragPrefabHandle(doc, P, 'tree-1', 'radius', { x: 5, z: 5 })).doc.prefabs.get(P)!.objects.find((o) => o.localId === 'tree-1')).toMatchObject({ canopy: 3 })
    expect(rotatePrefabItems(doc, P, ['tree-1'], 1).ok).toBe(false)
    // Turned a quarter: (2, 5) from the pivot → (5, −2).
    const turned = resolvePrefab(prefab, 1).parts.trees![0]
    expect(turned.position).toEqual({ x: 5, z: -2 })
    doc = ok(placeInstance(doc, P, { x: 10, z: 10 }, 0)).doc
    expect(errors(doc)).toEqual([])
    expect(mapOf(doc).trees!.map((t) => t.id)).toEqual(['c0_0/garden-house-1/tree-1'])
  })
})

describe('generator layouts and trees (M9)', () => {
  it('varied towns are valid, deep-check clean and playable across sizes and seeds; some blocks are parks', () => {
    let parks = 0
    const widths = new Set<number>()
    for (const [seed, bx, bz] of [
      [11, 1, 1],
      [12, 2, 1],
      [13, 2, 2],
      [14, 3, 2],
      [15, 3, 3],
      [16, 4, 4],
      [17, 1, 4],
    ]) {
      const doc = gen({ seed, blocksX: bx, blocksZ: bz, layout: 'varied', trees: 0.8 })
      expect(errors(doc), `seed ${seed}`).toEqual([])
      expect(deepCheck(doc).issues, `seed ${seed}`).toEqual([])
      const records = resolvedRecords(doc)
      expect(records.filter((r) => r.category === 'instances').length, `seed ${seed}`).toBeGreaterThan(0)
      parks += records.filter((r) => r.parts.zones?.[0]?.name.startsWith('Công viên')).length
      for (const r of records.filter((x) => x.id.includes('/roads/road-x-'))) widths.add(r.bounds.minX)
      // Canopies never cover a roof; trunks never stand in a prop (deep check covers overlaps).
      const roofs = records.flatMap((r) => r.parts.buildings ?? []).map((b) => ({ minX: b.center.x - b.size.w / 2, minZ: b.center.z - b.size.d / 2, maxX: b.center.x + b.size.w / 2, maxZ: b.center.z + b.size.d / 2 }))
      for (const t of records.flatMap((r) => r.parts.trees ?? [])) {
        const canopy = { minX: t.position.x - t.canopy, minZ: t.position.z - t.canopy, maxX: t.position.x + t.canopy, maxZ: t.position.z + t.canopy }
        expect(roofs.some((f) => overlapsRect(canopy, f)), t.id).toBe(false)
      }
    }
    expect(parks).toBeGreaterThan(0)
    const rt = new GameRuntime(mapOf(gen({ seed: 15, blocksX: 3, blocksZ: 3, layout: 'varied' })))
    rt.newGame(2)
    rt.pathBudget.maxPathMs = Infinity
    for (let i = 0; i < 600; i++) rt.tick(1 / 60)
    expect(rt.player.alive).toBe(true)
    expect(rt.zombies.size).toBeGreaterThan(0)
  })

  it('varied block sizes and lot widths differ from the grid; the play area is the town rectangle', () => {
    const grid = gen({ seed: 21, blocksX: 3, blocksZ: 2 })
    const varied = gen({ seed: 21, blocksX: 3, blocksZ: 2, layout: 'varied' })
    const lots = (doc: MapDocument) => new Set(resolvedRecords(doc).filter((r) => r.parts.buildings?.length).map((r) => r.bounds.maxX - r.bounds.minX))
    expect(exportPack(varied)).not.toBe(exportPack(gen({ seed: 22, blocksX: 3, blocksZ: 2, layout: 'varied' })))
    expect(exportPack(varied)).toBe(exportPack(gen({ seed: 21, blocksX: 3, blocksZ: 2, layout: 'varied' })))
    expect(grid.world.playArea).toEqual({ size: 3 * 28 + 4 * 4, depth: 2 * 28 + 3 * 4 })
    expect(lots(varied).size).toBeGreaterThan(0)
    expect(varied.world.generator!.params).toEqual({ blocksX: 3, blocksZ: 2, layout: 'varied', trees: DEFAULT_TREES })
  })

  it('the tree density changes only the trees (own random stream); 0 plants none', () => {
    const strip = (doc: MapDocument) =>
      [...doc.chunks.values()].map((c) => ({ ...c, objects: c.objects.filter((o) => o.kind !== 'tree'), spawns: [], externalRefs: [] }))
    for (const layout of ['grid', 'varied'] as const) {
      const none = gen({ seed: 31, layout, trees: 0 })
      const dense = gen({ seed: 31, layout, trees: 1 })
      expect(resolvedRecords(none).flatMap((r) => r.parts.trees ?? [])).toEqual([])
      const trees = resolvedRecords(dense).flatMap((r) => r.parts.trees ?? [])
      expect(trees.length).toBeGreaterThan(4)
      expect(strip(dense)).toEqual(strip(none))
    }
    expect(() => gen({ seed: 1, trees: 2 })).toThrow()
    expect(() => gen({ seed: 1, layout: 'spiral' as never })).toThrow()
  })
})
