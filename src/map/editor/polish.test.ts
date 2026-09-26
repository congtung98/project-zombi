import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, loadWorld, REGISTERED_LOOT_TABLES } from '../content'
import { checkWorldDocuments, validateWorldDocument } from '../validate'
import { GameRuntime } from '../../game/core/runtime'
import { roadY } from '../../game/world/mapData'
import { buildBatches, drawItems } from '../../editor/drawItems'
import { addChunk, fittedPlayArea, placeInstance, placeRecord, updateRecord, updateWorld, type CommandResult } from './commands'
import { blankDocument, documentFiles, findRecord, resolvedChunks, resolvedRecords, statefulEntityIds, worldAnchor, type MapDocument } from './document'
import { dragEdge, dragPrefabHandle, dragRecordHandle, handleAt, handlesUsable, MIN_SIZE, prefabItemHandles, recordHandles } from './handles'
import { documentFromFiles } from './pack'
import { createPrefab, pickPrefabItem, prefabItems, updatePrefabItem } from './prefabCommands'
import { applyCommand, initialEditState, undo } from './session'
import type { WallRunObject } from '../schema'

const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
const P = 'building/m7-house'

function ok(r: CommandResult): Extract<CommandResult, { ok: true }> {
  if (!r.ok) throw new Error(r.error)
  return r
}

function neighbourhood(): MapDocument {
  const r = documentFromFiles(bundledWorldFiles('neighborhood-50'), OPTS)
  if (!r.ok) throw new Error(r.error)
  return r.doc
}

function blank(): MapDocument {
  const lib = neighbourhood()
  return blankDocument({ worldId: 'm7-test', name: 'M7', prefabs: lib.world.prefabs.map((entry) => ({ entry, doc: lib.prefabs.get(entry.prefabId)! })) })
}

function issuesOf(doc: MapDocument) {
  const files = new Map(documentFiles(doc))
  return checkWorldDocuments((p) => files.get(p), OPTS).issues
}
const codes = (doc: MapDocument, severity: 'error' | 'warning') => issuesOf(doc).filter((i) => i.severity === severity).map((i) => i.code)

describe('resize handles (M7)', () => {
  it('drag an edge or corner; the opposite side stays and the minimum size holds (no flipping)', () => {
    const r = { minX: 0, minZ: 0, maxX: 4, maxZ: 2 }
    expect(dragEdge(r, 'e', { x: 6, z: 9 }, 0.5)).toEqual({ minX: 0, minZ: 0, maxX: 6, maxZ: 2 })
    expect(dragEdge(r, 'nw', { x: 1, z: -1 }, 0.5)).toEqual({ minX: 1, minZ: -1, maxX: 4, maxZ: 2 })
    expect(dragEdge(r, 'w', { x: 10, z: 0 }, 0.5)).toEqual({ minX: 3.5, minZ: 0, maxX: 4, maxZ: 2 })
    expect(dragEdge(r, 's', { x: 0, z: -5 }, 0.5)).toEqual({ minX: 0, minZ: 0, maxX: 4, maxZ: 0.5 })
    expect(handleAt([{ key: 'e', at: { x: 4, z: 1 } }], { x: 4.2, z: 1.1 }, 0.3)?.key).toBe('e')
    expect(handleAt([{ key: 'e', at: { x: 4, z: 1 } }], { x: 5, z: 1 }, 0.3)).toBeNull()
    // Too small on screen (a 1 m crate at 20 px/m): no handles, a press moves it.
    const crate = [{ key: 'nw' as const, at: { x: 0, z: 0 } }, { key: 'se' as const, at: { x: 1, z: 1 } }, { key: 'ne' as const, at: { x: 1, z: 0 } }]
    expect(handlesUsable(crate, 20)).toBe(false)
    expect(handlesUsable(crate, 60)).toBe(true)
    expect(handlesUsable([{ key: 'fixture', at: { x: 0, z: 0 } }], 1)).toBe(true)
  })

  it('boxes, surfaces and rectangle zones have 8 handles, circle zones a radius, instances and spawns none', () => {
    let doc = blank()
    doc = ok(placeRecord(doc, 'object/block', { x: 2, z: 2 }, { x: 6, z: 4 })).doc
    doc = ok(placeRecord(doc, 'zone/circle', { x: -10, z: -10 })).doc
    const block = recordHandles(doc, 'c0_0/objects/block-1')
    expect(block.map((h) => h.key)).toEqual(['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'])
    expect(block.find((h) => h.key === 'se')!.at).toEqual({ x: 6, z: 4 })
    expect(recordHandles(doc, 'c-1_-1/zones/zone-1').map((h) => h.key)).toEqual(['radius'])
    expect(recordHandles(doc, doc.world.playerSpawn)).toEqual([])
    const withHouse = ok(placeRecord(doc, 'object/crate', { x: 10, z: 10 })).doc
    expect(recordHandles(withHouse, 'c0_0/objects/crate-1')).toHaveLength(8)
  })

  it('a handle drag is one command: new size, centre moved and re-homed across a chunk line, ID kept, undo exact', () => {
    let doc = blank()
    doc = ok(placeRecord(doc, 'surface/asphalt', { x: -6, z: 2 }, { x: -2, z: 18 })).doc
    const id = 'c-1_0/roads/road-1'
    const start = doc
    let s = initialEditState(doc)
    s = applyCommand(s, 'resize', dragRecordHandle(s.doc, id, 'e', { x: 4, z: 10 })).state
    const loc = findRecord(s.doc, id)!
    expect(loc.record.size).toEqual([10, 16])
    expect(worldAnchor(s.doc, loc)).toEqual({ x: -1, z: 10 })
    expect(loc.chunkId).toBe('c-1_0')
    // Past the chunk line x = 0 with the centre: re-homed, same ID.
    s = applyCommand(s, 'resize', dragRecordHandle(s.doc, id, 'w', { x: 1, z: 10 })).state
    expect(findRecord(s.doc, id)!.chunkId).toBe('c0_0')
    expect(worldAnchor(s.doc, findRecord(s.doc, id)!)).toEqual({ x: 2.5, z: 10 })
    expect(s.past).toHaveLength(2)
    expect(undo(undo(s)).doc).toBe(start)
    // Circle zone: radius from the centre, never below the minimum.
    doc = ok(placeRecord(start, 'zone/circle', { x: -10, z: -10 })).doc
    expect(findRecord(ok(dragRecordHandle(doc, 'c-1_-1/zones/zone-1', 'radius', { x: -3, z: -10 })).doc, 'c-1_-1/zones/zone-1')!.record.radius).toBe(7)
    expect(findRecord(ok(dragRecordHandle(doc, 'c-1_-1/zones/zone-1', 'radius', { x: -10, z: -10 })).doc, 'c-1_-1/zones/zone-1')!.record.radius).toBe(MIN_SIZE.radius)
    // Boxes keep their height.
    doc = ok(placeRecord(start, 'object/wall', { x: 2, z: 2 }, { x: 6, z: 2 })).doc
    const wall = findRecord(ok(dragRecordHandle(doc, 'c0_0/objects/wall-1', 'e', { x: 8, z: 2 })).doc, 'c0_0/objects/wall-1')!.record
    expect(wall.size).toEqual([6, 2.6, 0.2])
  })

  it('prefab items: wall-run ends slide on their axis, rooms resize, the lamp fixture stays in its room', () => {
    const doc = ok(createPrefab(blank(), { prefabId: P, name: 'Nhà', width: 8, depth: 6 })).doc
    const prefab = doc.prefabs.get(P)!
    const run = prefab.objects.find((o): o is WallRunObject => o.kind === 'wallRun' && o.from.z === o.to.z)!
    expect(prefabItemHandles(prefab, run.localId).map((h) => h.key)).toEqual(['from', 'to'])
    const longer = ok(dragPrefabHandle(doc, P, run.localId, 'to', { x: 7, z: 9 })).doc.prefabs.get(P)!
    const r2 = longer.objects.find((o) => o.localId === run.localId)!
    expect(r2.kind === 'wallRun' && r2.to).toEqual({ x: 7, z: run.to.z })
    const past = ok(dragPrefabHandle(doc, P, run.localId, 'to', { x: -20, z: 0 })).doc.prefabs.get(P)!.objects.find((o) => o.localId === run.localId)!
    expect(past.kind === 'wallRun' && past.to.x).toBe(run.from.x + MIN_SIZE.run)
    expect(prefabItemHandles(prefab, 'door')).toEqual([])

    const room = prefab.rooms[0]
    expect(prefabItemHandles(prefab, room.localId)).toHaveLength(8)
    const lampKey = room.lamp!.localId
    const centre = { x: (room.bounds.minX + room.bounds.maxX) / 2, z: (room.bounds.minZ + room.bounds.maxZ) / 2 }
    expect(prefabItemHandles(prefab, lampKey)).toEqual([{ key: 'fixture', at: centre }])
    const moved = ok(dragPrefabHandle(doc, P, lampKey, 'fixture', { x: 1.5, z: -1 })).doc
    expect(moved.prefabs.get(P)!.rooms[0].lamp!.at).toEqual({ x: 1.5, z: -1 })
    // Clamped into the room; dragged back to the centre drops `at` (the default) again.
    expect(ok(dragPrefabHandle(doc, P, lampKey, 'fixture', { x: 40, z: 0 })).doc.prefabs.get(P)!.rooms[0].lamp!.at).toEqual({ x: room.bounds.maxX, z: 0 })
    const back = ok(dragPrefabHandle(moved, P, lampKey, 'fixture', centre)).doc
    expect(back.prefabs.get(P)!.rooms[0].lamp).not.toHaveProperty('at')
    // A moved fixture also picks its lamp; the room centre still picks the room.
    const items = prefabItems(moved.prefabs.get(P)!)
    expect(pickPrefabItem(items, { x: 1.5, z: -1 })?.key).toBe(lampKey)
    expect(pickPrefabItem(prefabItems(prefab), centre)?.key).toBe(room.localId)
    // Handles never touch IDs: saves keep their state.
    expect(statefulEntityIds(moved)).toEqual(statefulEntityIds(doc))
    const outside = ok(updatePrefabItem(doc, P, lampKey, { at: { x: 30, z: 0 } })).doc
    expect(codes(outside, 'warning')).toContain('lamp-outside-room')
  })

  it('the lamp fixture position reaches the game, turned with the instance', () => {
    let doc = ok(createPrefab(blank(), { prefabId: P, name: 'Nhà', width: 8, depth: 6 })).doc
    const lampKey = doc.prefabs.get(P)!.rooms[0].lamp!.localId
    doc = ok(dragPrefabHandle(doc, P, lampKey, 'fixture', { x: 2, z: -1 })).doc
    doc = ok(placeInstance(doc, P, { x: 10, z: 10 }, 1)).doc
    expect(codes(doc, 'error')).toEqual([])
    const files = new Map(documentFiles(doc))
    const room = loadWorld((p) => files.get(p)).map.rooms!.find((r) => r.id.startsWith('c0_0/m7-house-1/'))!
    const resolved = resolvedRecords(doc).find((r) => r.id === 'c0_0/m7-house-1')!.parts.rooms!.find((r) => r.lamp)!.lamp!
    expect(room.lamp!.position).toEqual(resolved.position)
    // Turned a quarter (rotateXZ: (x, z) → (z, −x)): (2, −1) from the room centre becomes (−1, −2).
    expect(room.lamp!.position.x - (room.bounds.minX + room.bounds.maxX) / 2).toBeCloseTo(-1)
    expect(room.lamp!.position.z - (room.bounds.minZ + room.bounds.maxZ) / 2).toBeCloseTo(-2)
  })
})

describe('road draw layers (M7)', () => {
  it('an overlap warns only on the same layer; layers are 0…4 and reach the game 1 mm apart', () => {
    let doc = blank()
    doc = ok(placeRecord(doc, 'surface/asphalt', { x: -20, z: 8 }, { x: -2, z: 12 })).doc
    doc = ok(placeRecord(doc, 'surface/sidewalk', { x: -12, z: 4 }, { x: -8, z: 20 })).doc
    expect(codes(doc, 'warning')).toContain('surface-overlap')
    const layered = ok(updateRecord(doc, 'c-1_0/roads/sidewalk-1', { layer: 1 })).doc
    expect(codes(layered, 'warning')).not.toContain('surface-overlap')
    const layerErrors = (layer: number) => issuesOf(ok(updateRecord(doc, 'c-1_0/roads/sidewalk-1', { layer })).doc).filter((i) => i.severity === 'error' && i.path.endsWith('/layer'))
    expect(layerErrors(5)).toHaveLength(1)
    expect(layerErrors(1.5)).toHaveLength(1)
    expect(layerErrors(4)).toEqual([])
    const files = new Map(documentFiles(layered))
    const { map } = loadWorld((p) => files.get(p))
    const [road, walk] = [map.roads.find((r) => r.id === 'c-1_0/roads/road-1')!, map.roads.find((r) => r.id === 'c-1_0/roads/sidewalk-1')!]
    expect(road).not.toHaveProperty('layer')
    expect(walk.layer).toBe(1)
    expect(roadY(walk) - roadY(road)).toBeCloseTo(0.001)
    expect(roadY({ layer: 4 })).toBeLessThan(0.02)
    // Layer 0 is the default: the file keeps no `layer` field.
    expect(findRecord(ok(updateRecord(layered, 'c-1_0/roads/sidewalk-1', { layer: undefined })).doc, 'c-1_0/roads/sidewalk-1')!.record).not.toHaveProperty('layer')
  })
})

describe('off-centre play area (M7)', () => {
  it('validates depth and centre; a centred square keeps the M1 form', () => {
    const world = neighbourhood().world
    expect(validateWorldDocument(world)).toEqual([])
    expect(validateWorldDocument({ ...world, playArea: { size: 60, depth: 0 } }).map((i) => i.path)).toContain('world.json#/playArea/depth')
    expect(validateWorldDocument({ ...world, playArea: { size: 60, center: { x: 'a', z: 0 } } }).map((i) => i.path)).toContain('world.json#/playArea/center/x')
    expect(ok(updateWorld(neighbourhood(), { playArea: { size: 50, depth: 50, center: { x: 0, z: 0 } } })).doc.world.playArea).toEqual(world.playArea)
  })

  it('spawns outside the rectangle are errors, inside the off-centre part fine', () => {
    let doc = blank()
    doc = ok(addChunk(doc, 1, 0)).doc
    doc = ok(placeRecord(doc, 'spawn/zombie', { x: 50, z: 10 })).doc
    expect(codes(doc, 'error')).toContain('spawn-outside-play-area')
    doc = ok(updateWorld(doc, { playArea: fittedPlayArea(doc.world) })).doc
    expect(codes(doc, 'error')).toEqual([])
    const files = new Map(documentFiles(doc))
    const rt = new GameRuntime(loadWorld((p) => files.get(p)).map)
    rt.newGame(5)
    expect(rt.nav.isWalkable(50, 10)).toBe(true)
    expect(rt.nav.isWalkable(-40, 0)).toBe(false)
  })
})

describe('viewport batches (M7)', () => {
  it('resolves per chunk with stable lists and draws each chunk in at most three batches', () => {
    const doc = neighbourhood()
    const a = resolvedChunks(doc)
    expect(resolvedChunks(doc).map((c) => c.records)).toEqual(a.map((c) => c.records))
    expect(resolvedChunks(doc)[0].records).toBe(a[0].records)
    expect(a.flatMap((c) => c.records)).toEqual(resolvedRecords(doc))
    // Moving one record re-resolves only its chunk.
    const moved = ok(updateRecord(doc, 'c0_0/objects/house-scrap', { name: 'X' })).doc
    const b = resolvedChunks(moved)
    expect(b.filter((c, i) => c.records !== a[i].records).map((c) => c.chunkId)).toEqual(['c0_0'])
    let boxes = 0
    for (const c of a) {
      const items = c.records.flatMap(drawItems)
      boxes += items.length
      const batches = buildBatches(items)
      expect(batches.length).toBeLessThanOrEqual(3)
      expect(batches.reduce((n, m) => n + m.instanceCount, 0)).toBe(items.length)
      for (const m of batches) m.dispose()
    }
    expect(boxes).toBeGreaterThan(a.length * 3)
  })
})
