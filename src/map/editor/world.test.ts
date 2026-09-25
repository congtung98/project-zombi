import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, loadWorld, REGISTERED_LOOT_TABLES } from '../content'
import { formatJson } from '../format'
import { ChunkLifecycle } from '../loader'
import { checkWorldDocuments, hasErrors } from '../validate'
import { GameRuntime } from '../../game/core/runtime'
import { nearestZone } from '../../game/systems/horde'
import type { ZoneDef } from '../../game/world/mapData'
import { zoneFor } from '../../game/world/zones'
import { addChunk, fittedPlayAreaSize, moveRecords, placeInstance, placeRecord, removeChunk, rotateRecords, updateRecord, updateWorld, type CommandResult } from './commands'
import { blankDocument, chunkStatuses, documentFiles, findRecord, resolvedRecords, worldAnchor, type MapDocument } from './document'
import { defaultLayers, isEditable, layerOf } from './layers'
import { documentFromFiles, exportPack, parsePack } from './pack'
import { pickRecord, recordsInRect } from './picking'
import { findPreset, presetPlacement, RECORD_PRESETS } from './presets'
import { applyCommand, initialEditState, undo } from './session'

const OPTS = { lootTables: REGISTERED_LOOT_TABLES }

function ok(r: CommandResult): Extract<CommandResult, { ok: true }> {
  if (!r.ok) throw new Error(r.error)
  return r
}

function neighbourhood(): MapDocument {
  const r = documentFromFiles(bundledWorldFiles('neighborhood-50'), OPTS)
  if (!r.ok) throw new Error(r.error)
  return r.doc
}

/** A new editor world (2 × 2 chunks, spawns) with the neighbourhood's prefab library. */
function blank(): MapDocument {
  const lib = neighbourhood()
  return blankDocument({ worldId: 'm4-test', name: 'M4', prefabs: lib.world.prefabs.map((entry) => ({ entry, doc: lib.prefabs.get(entry.prefabId)! })) })
}

function issuesOf(doc: MapDocument) {
  const files = new Map(documentFiles(doc))
  return checkWorldDocuments((p) => {
    if (!files.has(p)) throw new Error(`missing ${p}`)
    return files.get(p)
  }, OPTS).issues
}

const errorsOf = (doc: MapDocument) => issuesOf(doc).filter((i) => i.severity === 'error')

/** Export → import → runtime loader, the path an editor world takes into the game. */
function loadExported(doc: MapDocument) {
  const back = parsePack(exportPack(doc), OPTS)
  if (!back.ok) throw new Error(`${back.error}: ${JSON.stringify(back.issues)}`)
  const files = new Map(documentFiles(back.doc))
  return loadWorld((p) => {
    if (!files.has(p)) throw new Error(`missing ${p}`)
    return files.get(p)
  })
}

describe('chunks (M4)', () => {
  it('adds a chunk at the end of the manifest, grows chunkBounds and validates', () => {
    const doc = blank()
    const r = ok(addChunk(doc, 1, 0))
    expect(r.doc.world.chunks.map((c) => c.chunkId)).toEqual(['c-1_-1', 'c0_-1', 'c-1_0', 'c0_0', 'c1_0'])
    expect(r.doc.world.chunks[4]).toEqual({ chunkId: 'c1_0', cx: 1, cz: 0, path: 'chunks/c1_0.json' })
    expect(r.doc.world.chunkBounds).toEqual({ minCx: -1, maxCx: 1, minCz: -1, maxCz: 0 })
    expect(r.doc.chunks.get('c1_0')!.instances).toEqual([])
    // Untouched chunks are shared.
    expect(r.doc.chunks.get('c0_0')).toBe(doc.chunks.get('c0_0'))
    expect(errorsOf(r.doc)).toEqual([])
    expect(addChunk(r.doc, 1, 0).ok).toBe(false)
    expect(addChunk(r.doc, 0.5, 0).ok).toBe(false)
  })

  it('removes only empty chunks, never the last one, and shrinks chunkBounds', () => {
    let doc = ok(addChunk(blank(), 1, 0)).doc
    doc = ok(placeRecord(doc, 'object/crate', { x: 40, z: 10 })).doc
    expect(removeChunk(doc, 'c1_0').ok).toBe(false)
    expect(removeChunk(doc, 'c9_9').ok).toBe(false)
    doc = ok(moveRecords(doc, ['c1_0/objects/crate-1'], { x: -20, z: 0 })).doc
    const r = ok(removeChunk(doc, 'c1_0'))
    expect(r.doc.world.chunks.map((c) => c.chunkId)).not.toContain('c1_0')
    expect(r.doc.world.chunkBounds).toEqual({ minCx: -1, maxCx: 0, minCz: -1, maxCz: 0 })
    expect(errorsOf(r.doc)).toEqual([])

    const single = ok(removeChunk(ok(removeChunk(ok(removeChunk(blankLonely(), 'c-1_-1')).doc, 'c0_-1')).doc, 'c-1_0')).doc
    expect(removeChunk(single, 'c0_0').ok).toBe(false)
  })

  it('placing and moving outside every chunk is refused until the chunk exists', () => {
    const doc = blank()
    expect(placeRecord(doc, 'object/crate', { x: 40, z: 5 }).ok).toBe(false)
    const grown = ok(addChunk(doc, 1, 0)).doc
    expect(ok(placeRecord(grown, 'object/crate', { x: 40, z: 5 })).selection).toEqual(['c1_0/objects/crate-1'])
  })

  it('undo of an added chunk restores the document exactly', () => {
    const start = blank()
    let s = initialEditState(start)
    s = applyCommand(s, 'add', addChunk(s.doc, 0, 1)).state
    s = applyCommand(s, 'place', placeRecord(s.doc, 'spawn/zombie', { x: 10, z: 40 })).state
    expect(findRecord(s.doc, 'c0_1/spawns/zombie-1')).not.toBeNull()
    s = undo(undo(s))
    expect(s.doc).toBe(start)
  })

  it('fits the centred play area to the chunks', () => {
    const doc = blank()
    expect(fittedPlayAreaSize(doc.world)).toBe(60)
    const grown = ok(addChunk(doc, 1, 0)).doc
    expect(fittedPlayAreaSize(grown.world)).toBe(124)
    const fitted = ok(updateWorld(grown, { playArea: { size: 124 } })).doc
    expect(fitted.world.playArea).toEqual({ size: 124 })
    expect(updateWorld(grown, { playArea: { size: 0 } }).ok).toBe(false)
    expect(updateWorld(grown, { boundary: { height: 0, thickness: 1 } }).ok).toBe(false)
    expect(ok(updateWorld(grown, { boundary: null })).doc.world.boundary).toBeNull()
  })

  it('reports per-chunk status: records, references, modified and issues', () => {
    const doc = ok(addChunk(blank(), 1, 0)).doc
    const edited = ok(placeInstance(doc, 'building/house', { x: 32, z: 10 }, 0)).doc
    const statuses = chunkStatuses(edited, doc, issuesOf(edited))
    const byId = Object.fromEntries(statuses.map((s) => [s.chunkId, s]))
    expect(byId['c1_0']).toMatchObject({ records: 1, refs: 0, modified: true, errors: 0 })
    expect(byId['c0_0']).toMatchObject({ records: 1, refs: 1, modified: true })
    expect(byId['c-1_-1']).toMatchObject({ modified: false })
    // A zombie spawn inside the house wall: the owning chunk is flagged invalid.
    const wall = resolvedRecords(edited).find((r) => r.id === 'c1_0/house-1')!.parts.walls!.find((w) => w.position.x > 33)!
    const blocked = ok(placeRecord(edited, 'spawn/zombie', { x: wall.position.x, z: wall.position.z })).doc
    const flagged = chunkStatuses(blocked, doc, issuesOf(blocked)).find((s) => s.chunkId === 'c1_0')!
    expect(flagged.errors).toBeGreaterThan(0)
  })
})

/** Blank world where only c0_0 owns records (for removing the other chunks). */
function blankLonely(): MapDocument {
  const doc = blank()
  return ok(moveRecords(doc, ['c-1_-1/spawns/zombie-1'], { x: 40, z: 40 })).doc
}

describe('building across a chunk line (M4)', () => {
  // House footprint ±4.5 m around its pivot: at x = 32 it is owned by c1_0 and reaches into c0_0.
  const world = () => ok(placeInstance(ok(addChunk(blank(), 1, 0)).doc, 'building/house', { x: 32, z: 10 }, 1)).doc

  it('has one owner and a reference in the other chunk, no duplicate entities', () => {
    const doc = world()
    expect(findRecord(doc, 'c1_0/house-1')!.chunkId).toBe('c1_0')
    expect(doc.chunks.get('c0_0')!.externalRefs).toEqual([{ id: 'c1_0/house-1', ownerChunkId: 'c1_0' }])
    expect(doc.chunks.get('c1_0')!.externalRefs).toEqual([])
    expect(errorsOf(doc)).toEqual([])
    const map = loadExported(doc).map
    expect(map.doors.filter((d) => d.id === 'c1_0/house-1/door')).toHaveLength(1)
    expect(map.buildings.filter((b) => b.id === 'c1_0/house-1')).toHaveLength(1)
  })

  it('the chunk lifecycle keeps it while either chunk is loaded and never adds it twice', () => {
    const { docs } = loadExported(world())
    const added: string[] = []
    const removed: string[] = []
    const life = new ChunkLifecycle(docs, { added: (r) => added.push(r.id), removed: (r) => removed.push(r.id) })
    life.load('c0_0')
    expect(life.refCount('c1_0/house-1')).toBe(1)
    life.load('c1_0')
    expect(life.refCount('c1_0/house-1')).toBe(2)
    expect(life.records().filter((r) => r.id === 'c1_0/house-1')).toHaveLength(1)
    expect(life.toMapData().doors.filter((d) => d.id === 'c1_0/house-1/door')).toHaveLength(1)
    life.unload('c0_0')
    expect(life.refCount('c1_0/house-1')).toBe(1)
    life.unload('c1_0')
    expect(life.refCount('c1_0/house-1')).toBe(0)
    expect(added.filter((id) => id === 'c1_0/house-1')).toHaveLength(1)
    expect(removed.filter((id) => id === 'c1_0/house-1')).toHaveLength(1)
  })

  it('dragging it wholly into one chunk drops the reference; the ID stays', () => {
    const moved = ok(moveRecords(world(), ['c1_0/house-1'], { x: 10, z: 0 })).doc
    expect(moved.chunks.get('c0_0')!.externalRefs).toEqual([])
    // Pivot at x = 30 (turned house: ±3.5 m on X): owned by c0_0 now, still reaching into c1_0.
    const back = ok(moveRecords(moved, ['c1_0/house-1'], { x: -12, z: 0 }))
    expect(findRecord(back.doc, 'c1_0/house-1')!.chunkId).toBe('c0_0')
    expect(back.note).toContain('c1_0 → c0_0')
    expect(back.doc.chunks.get('c1_0')!.externalRefs).toEqual([{ id: 'c1_0/house-1', ownerChunkId: 'c0_0' }])
    expect(errorsOf(back.doc)).toEqual([])
  })
})

describe('palette records (M4)', () => {
  it('every preset places a valid record with a namespaced ID and content-file key order', () => {
    let doc = blank()
    const spots = RECORD_PRESETS.map((_, i) => ({ x: 3 + (i % 5) * 5, z: 6 + Math.floor(i / 5) * 6 }))
    RECORD_PRESETS.forEach((p, i) => {
      const r = ok(placeRecord(doc, p.id, spots[i]))
      const id = r.selection[0]
      expect(id.startsWith(`c0_0/${p.category}/${p.name}-`), id).toBe(true)
      expect(worldAnchor(r.doc, findRecord(r.doc, id)!)).toEqual(spots[i])
      doc = r.doc
    })
    expect(errorsOf(doc)).toEqual([])
    const crate = findRecord(doc, 'c0_0/objects/crate-1')!.record
    expect(formatJson(crate)).toBe('{\n  "kind": "prop",\n  "objectId": "c0_0/objects/crate-1",\n  "position": { "x": 13, "y": 0.5, "z": 6 },\n  "size": [1, 1, 1],\n  "color": "#a67c52"\n}\n')
    expect(Object.keys(findRecord(doc, 'c0_0/objects/scrap-1')!.record)).toEqual(['kind', 'objectId', 'name', 'position', 'size', 'color', 'lootTableId'])
    expect(Object.keys(findRecord(doc, 'c0_0/zones/zone-1')!.record)).toEqual(['zoneId', 'kind', 'name', 'shape', 'center', 'size'])
    expect(Object.keys(findRecord(doc, 'c0_0/spawns/player-1')!.record)).toEqual(['spawnId', 'kind', 'position'])
    // The template is copied, never shared with the document.
    expect(findRecord(doc, 'c0_0/objects/crate-1')!.record.size).not.toBe(findPreset('object/crate')!.template.size)
  })

  it('a drag sizes walls along the dominant axis, rectangles and zone radii', () => {
    const wall = findPreset('object/wall')!
    expect(presetPlacement(wall, { x: 4, z: 4 }, { x: 10, z: 4.5 })).toEqual({ at: { x: 7, z: 4 }, fields: { size: [6, 2.6, 0.2] } })
    expect(presetPlacement(wall, { x: 4, z: 4 }, { x: 4.5, z: 0 })).toEqual({ at: { x: 4, z: 2 }, fields: { size: [0.2, 2.6, 4] } })
    expect(presetPlacement(findPreset('surface/asphalt')!, { x: 6, z: 12 }, { x: 2, z: 2 })).toEqual({ at: { x: 4, z: 7 }, fields: { size: [4, 10] } })
    expect(presetPlacement(findPreset('object/block')!, { x: 0, z: 0 }, { x: 3, z: 0 })).toEqual({ at: { x: 1.5, z: 0 }, fields: { size: [3, 1, 0.25] } })
    expect(presetPlacement(findPreset('zone/circle')!, { x: 5, z: 5 }, { x: 8, z: 9 })).toEqual({ at: { x: 5, z: 5 }, fields: { radius: 5 } })
    expect(presetPlacement(findPreset('object/crate')!, { x: 5, z: 5 }, { x: 9, z: 9 })).toEqual({ at: { x: 5, z: 5 }, fields: {} })
    expect(presetPlacement(wall, { x: 5, z: 5 }, { x: 5, z: 5 })).toEqual({ at: { x: 5, z: 5 }, fields: {} })
    const road = ok(placeRecord(blank(), 'surface/asphalt', { x: 2, z: 2 }, { x: 6, z: 20 }))
    expect(findRecord(road.doc, road.selection[0])!.record).toEqual({ roadId: 'c0_0/roads/road-1', position: { x: 4, z: 11 }, size: [4, 18], color: '#3a3a3f' })
  })

  it('rotates boxes, surfaces and rectangle zones by swapping X/Z; square boxes and spawns are skipped', () => {
    let doc = blank()
    doc = ok(placeRecord(doc, 'object/car', { x: 10, z: 10 })).doc
    doc = ok(placeRecord(doc, 'zone/rect', { x: 16, z: 16 })).doc
    doc = ok(placeRecord(doc, 'object/crate', { x: 4, z: 20 })).doc
    const r = ok(rotateRecords(doc, ['c0_0/objects/car-1', 'c0_0/zones/zone-1', 'c0_0/objects/crate-1'], 1))
    expect(findRecord(r.doc, 'c0_0/objects/car-1')!.record.size).toEqual([2, 1.4, 4])
    expect(findRecord(r.doc, 'c0_0/zones/zone-1')!.record.size).toEqual([12, 16])
    expect(findRecord(r.doc, 'c0_0/objects/crate-1')!.record).toBe(findRecord(doc, 'c0_0/objects/crate-1')!.record)
    expect(rotateRecords(doc, ['c0_0/objects/crate-1', 'c0_0/spawns/player-start'], 1).ok).toBe(false)
    // A half turn leaves an axis-aligned box as it was.
    expect(rotateRecords(doc, ['c0_0/objects/car-1'], 2).ok).toBe(false)
  })
})

describe('zones (M4)', () => {
  const circle = (id: string, x: number, z: number, radius: number): ZoneDef => ({ id, name: id, center: { x, y: 0, z }, radius })
  const rect = (id: string, x: number, z: number, hx: number, hz: number): ZoneDef => ({ id, name: id, center: { x, y: 0, z }, radius: Math.hypot(hx, hz), halfSize: { x: hx, z: hz } })

  it('a point in rectangle zones belongs to the smallest; otherwise to the nearest centre', () => {
    const zones = [circle('a', 0, 0, 10), rect('big', 10, 0, 10, 10), rect('small', 12, 0, 2, 2)]
    expect(zoneFor({ x: 12, z: 1 }, zones)?.id).toBe('small')
    expect(zoneFor({ x: 3, z: 0 }, zones)?.id).toBe('big') // inside the rectangle, although a's centre is nearer
    expect(zoneFor({ x: -12, z: 0 }, zones)?.id).toBe('a')
    expect(nearestZone({ x: 12, y: 0, z: 1 }, zones)?.id).toBe('small')
    // Circle-only maps keep the S5 nearest-centre rule.
    const circles = [circle('a', 0, 0, 10), circle('b', 20, 0, 10)]
    expect(zoneFor({ x: 9, z: 0 }, circles)?.id).toBe('a')
    expect(zoneFor({ x: 11, z: 0 }, circles)?.id).toBe('b')
  })

  it('rectangle zones resolve with half extents and drive zombie wandering in the game', () => {
    let doc = blank()
    // Zombie spawn of the blank world stands at (-12, -12); a rectangle zone around it, one far away.
    doc = ok(placeRecord(doc, 'zone/rect', { x: -18, z: -16 }, { x: -6, z: -6 })).doc
    doc = ok(placeRecord(doc, 'zone/circle', { x: 16, z: 16 })).doc
    expect(errorsOf(doc)).toEqual([])
    const map = loadExported(doc).map
    const zone = map.zombieZones!.find((z) => z.id === 'c-1_-1/zones/zone-1')!
    expect(zone.center).toEqual({ x: -12, y: 0, z: -11 })
    expect(zone.halfSize).toEqual({ x: 6, z: 5 })

    const rt = new GameRuntime(map)
    rt.newGame(3)
    rt.pathBudget.maxPathMs = Infinity
    rt.setLineOfSightOverride(null)
    const [zombie] = [...rt.zombies.values()]
    expect(zombie.zoneId).toBe('c-1_-1/zones/zone-1')
    for (let i = 0; i < 40; i++) {
      const p = rt.pickWanderPoint(zombie)
      if (!p) continue
      expect(Math.abs(p.x - zone.center.x)).toBeLessThanOrEqual(zone.halfSize!.x + 0.5)
      expect(Math.abs(p.z - zone.center.z)).toBeLessThanOrEqual(zone.halfSize!.z + 0.5)
    }
    for (let i = 0; i < 600; i++) rt.tick(1 / 60)
    expect([...rt.zombies.values()].every((z) => z.zoneId === null || map.zombieZones!.some((x) => x.id === z.zoneId))).toBe(true)
  })

  it('warns when a zombie spawn stands in a zone it will not belong to', () => {
    let doc = blank()
    // The blank world's zombie spawn stands at (-12, -12). zone-1: radius 10 around (-20, -12), contains it;
    // zone-2: radius 8 around (-12, -10), nearer centre, also contains it → assigned to zone-2, fine.
    doc = ok(placeRecord(doc, 'zone/circle', { x: -20, z: -12 }, { x: -10, z: -12 })).doc
    doc = ok(placeRecord(doc, 'zone/circle', { x: -12, z: -10 })).doc
    expect(issuesOf(doc).some((i) => i.code === 'zone-assignment')).toBe(false)
    // Shrunk to 1 m, zone-2 no longer contains the spawn but still has the nearest centre.
    const far = ok(updateRecord(doc, 'c-1_-1/zones/zone-2', { radius: 1 })).doc
    const w = issuesOf(far).filter((i) => i.code === 'zone-assignment')
    expect(w).toHaveLength(1)
    expect(w[0].entityId).toBe('c-1_-1/spawns/zombie-1')
    expect(w[0].severity).toBe('warning')
  })

  it('warns about differently coloured surfaces that overlap', () => {
    let doc = blank()
    doc = ok(placeRecord(doc, 'surface/asphalt', { x: 5, z: 5 }, { x: 9, z: 25 })).doc
    doc = ok(placeRecord(doc, 'surface/asphalt', { x: 1, z: 10 }, { x: 25, z: 14 })).doc
    expect(issuesOf(doc).some((i) => i.code === 'surface-overlap')).toBe(false)
    doc = ok(placeRecord(doc, 'surface/dirt', { x: 6, z: 20 }, { x: 20, z: 24 })).doc
    const w = issuesOf(doc).filter((i) => i.code === 'surface-overlap')
    expect(w.map((i) => i.entityId)).toEqual(['c0_0/roads/dirt-1'])
  })
})

describe('layers, picking and box select (M4)', () => {
  it('maps records to layers and skips hidden/locked ones when picking', () => {
    const doc = neighbourhood()
    const records = resolvedRecords(doc)
    const layerOfId = (id: string) => layerOf(records.find((r) => r.id === id)!)
    expect(layerOfId('c0_0/house')).toBe('buildings')
    expect(layerOfId('c0_0/objects/pillar-1')).toBe('props')
    expect(layerOfId('c0_0/objects/house-scrap')).toBe('containers')
    expect(layerOfId('c-1_0/roads/ns')).toBe('surfaces')
    expect(layerOfId('c0_0/zones/east')).toBe('zones')
    expect(layerOfId('c0_0/spawns/zombie-2')).toBe('zombies')
    expect(layerOfId('c-1_-1/spawns/player-start')).toBe('players')

    const layers = defaultLayers()
    const scrap = worldAnchor(doc, findRecord(doc, 'c0_0/objects/house-scrap')!)
    expect(pickRecord(records, scrap, (r) => !isEditable(r, layers))?.id).toBe('c0_0/objects/house-scrap')
    layers.containers.locked = true
    expect(pickRecord(records, scrap, (r) => !isEditable(r, layers))?.id).not.toBe('c0_0/objects/house-scrap')
    layers.containers = { hidden: true, locked: false }
    expect(pickRecord(records, scrap, (r) => !isEditable(r, layers))?.id).not.toBe('c0_0/objects/house-scrap')
  })

  it('zones are picked at their outline or centre only', () => {
    let doc = blank()
    doc = ok(placeRecord(doc, 'zone/rect', { x: 16, z: 16 })).doc // 16 × 12 around (16, 16)
    doc = ok(placeRecord(doc, 'zone/circle', { x: -16, z: 16 })).doc // radius 8
    const records = resolvedRecords(doc)
    const at = (x: number, z: number) => pickRecord(records, { x, z })?.id ?? null
    expect(at(16, 16)).toBe('c0_0/zones/zone-1')
    expect(at(24, 14)).toBe('c0_0/zones/zone-1')
    expect(at(20, 19)).toBeNull()
    expect(at(-16, 16)).toBe('c-1_0/zones/zone-1')
    expect(at(-8.2, 16)).toBe('c-1_0/zones/zone-1')
    expect(at(-12, 16)).toBeNull()
  })

  it('box select takes records entirely inside the rectangle', () => {
    let doc = blank()
    doc = ok(placeRecord(doc, 'object/crate', { x: 5, z: 5 })).doc
    doc = ok(placeRecord(doc, 'object/crate', { x: 8, z: 5 })).doc
    doc = ok(placeRecord(doc, 'object/car', { x: 12, z: 5 })).doc
    const records = resolvedRecords(doc)
    const ids = (r: { minX: number; minZ: number; maxX: number; maxZ: number }) => recordsInRect(records, r).map((x) => x.id)
    expect(ids({ minX: 3, minZ: 3, maxX: 11, maxZ: 7 })).toEqual(['c0_0/objects/crate-1', 'c0_0/objects/crate-2'])
    expect(ids({ minX: 11, minZ: 7, maxX: 3, maxZ: 1 })).toEqual(['c0_0/objects/crate-1', 'c0_0/objects/crate-2'])
    expect(ids({ minX: 0, minZ: 0, maxX: 15, maxZ: 7 })).toEqual(['c0_0/spawns/player-start', 'c0_0/objects/crate-1', 'c0_0/objects/crate-2', 'c0_0/objects/car-1'].sort((a, b) => order(records, a) - order(records, b)))
    expect(recordsInRect(records, { minX: 3, minZ: 3, maxX: 11, maxZ: 7 }, (r) => r.id.endsWith('crate-2')).map((x) => x.id)).toEqual(['c0_0/objects/crate-1'])
  })
})

function order(records: ReturnType<typeof resolvedRecords>, id: string): number {
  return records.findIndex((r) => r.id === id)
}

describe('an editor-made multi-chunk world plays in the game (M4)', () => {
  it('two new adjacent chunks, a building across them, props, surfaces, zones and spawns', () => {
    let doc = blank()
    doc = ok(addChunk(doc, 1, -1)).doc
    doc = ok(addChunk(doc, 1, 0)).doc
    doc = ok(updateWorld(doc, { playArea: { size: fittedPlayAreaSize(doc.world) } })).doc
    doc = ok(placeInstance(doc, 'building/safehouse', { x: 32, z: -6 }, 0)).doc
    doc = ok(placeRecord(doc, 'surface/asphalt', { x: 44, z: -40 }, { x: 48, z: 40 })).doc
    doc = ok(placeRecord(doc, 'object/fence', { x: 50, z: 10 }, { x: 58, z: 10 })).doc
    doc = ok(placeRecord(doc, 'object/scrap', { x: 54, z: 20 })).doc
    doc = ok(placeRecord(doc, 'zone/rect', { x: 50, z: 14 }, { x: 60, z: 28 })).doc
    doc = ok(placeRecord(doc, 'spawn/zombie', { x: 56, z: 24 })).doc
    doc = ok(placeRecord(doc, 'zone/circle', { x: -14, z: -14 })).doc
    doc = ok(updateWorld(doc, { contentVersion: 2 })).doc
    expect(errorsOf(doc)).toEqual([])
    expect(findRecord(doc, 'c1_-1/safehouse-1')!.chunkId).toBe('c1_-1')
    expect(doc.chunks.get('c0_-1')!.externalRefs.map((r) => r.id)).toContain('c1_-1/safehouse-1')

    const { map } = loadExported(doc)
    expect(map.size).toBe(124)
    expect(map.doors.filter((d) => d.id === 'c1_-1/safehouse-1/door')).toHaveLength(1)
    expect(map.containers.some((c) => c.id === 'c1_0/objects/scrap-1' && c.loot === 'scrap-pile')).toBe(true)
    expect(map.walls.some((w) => w.id === 'c1_0/objects/fence-1')).toBe(true)
    expect(map.roads.map((r) => r.id)).toContain('c1_0/roads/road-1')
    expect(map.zombieSpawns).toContainEqual({ x: 56, y: 0, z: 24 })

    const rt = new GameRuntime(map)
    rt.newGame(11)
    rt.pathBudget.maxPathMs = Infinity
    rt.setLineOfSightOverride(null)
    const east = [...rt.zombies.values()].find((z) => z.home.x === 56 && z.home.z === 24)!
    expect(east.zoneId).toBe('c1_0/zones/zone-1')
    for (let i = 0; i < 900; i++) rt.tick(1 / 60)
    expect(rt.world.doors.has('c1_-1/safehouse-1/door')).toBe(true)
    expect(rt.world.containers.has('c1_0/objects/scrap-1')).toBe(true)
    expect(rt.world.containers.get('c1_0/objects/scrap-1')!.items.slots.some((s) => s !== null)).toBe(true)
    expect(hasErrors(loadExported(doc).issues)).toBe(false)
  })
})
