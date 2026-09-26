import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, loadWorld, REGISTERED_LOOT_TABLES } from '../content'
import { formatJson } from '../format'
import { checkWorldDocuments, hasErrors } from '../validate'
import { GameRuntime } from '../../game/core/runtime'
import { deleteRecords, duplicateRecords, moveRecords, placeInstance, rotateRecords, updateRecord, updateWorld, type CommandResult } from './commands'
import { documentFiles, findRecord, recordAtPath, recordForEntity, resolvedRecords, worldAnchor, type MapDocument } from './document'
import { documentFromFiles, exportPack, parsePack, toPack } from './pack'
import { pickRecord, snap } from './picking'
import { applyCommand, initialEditState, redo, undo } from './session'

/** Content files as text, exactly as on disk. */
const RAW = import.meta.glob<string>('/src/test/fixtures/maps/neighborhood-50/**/*.json', { query: '?raw', import: 'default', eager: true })
const OPTS = { lootTables: REGISTERED_LOOT_TABLES }

function open(): MapDocument {
  const r = documentFromFiles(bundledWorldFiles('neighborhood-50'), OPTS)
  if (!r.ok) throw new Error(r.error)
  return r.doc
}

function ok(r: CommandResult): Extract<CommandResult, { ok: true }> {
  if (!r.ok) throw new Error(r.error)
  return r
}

/** Full validation of a document through the same reader contract as the runtime. */
function issuesOf(doc: MapDocument) {
  const files = new Map(documentFiles(doc))
  return checkWorldDocuments((p) => {
    if (!files.has(p)) throw new Error(`missing ${p}`)
    return files.get(p)
  }, OPTS).issues
}

/** Where a house fits in the neighbourhood (west yard, clear of spawns). */
const FREE_SPOT = { x: -15, z: 12 }

describe('map editor document (M3)', () => {
  it('opens the bundled neighbourhood with its migrations kept as extra files', () => {
    const doc = open()
    expect(doc.world.worldId).toBe('neighborhood-50')
    expect([...doc.extras.keys()]).toEqual(['migrations/legacy-v7-ids.json', 'migrations/legacy-v7-map.json'])
    expect(issuesOf(doc)).toEqual([])
  })

  it('exports every file formatted exactly like the content on disk (stable, reviewable diffs)', () => {
    const doc = open()
    for (const [path, value] of documentFiles(doc)) {
      const disk = RAW[`/src/test/fixtures/maps/neighborhood-50/${path}`].replace(/\r\n/g, '\n')
      // Frozen migration files predate formatJson: same data (unpack leaves unchanged files alone).
      if (doc.extras.has(path)) expect(value, path).toEqual(JSON.parse(disk))
      else expect(formatJson(value), path).toBe(disk)
    }
    expect(exportPack(doc)).toBe(exportPack(open()))
  })

  it('export → import keeps IDs, transforms, metadata and references', () => {
    const edited = ok(placeInstance(open(), 'building/house', FREE_SPOT, 1)).doc
    const back = parsePack(exportPack(edited), OPTS)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(documentFiles(back.doc)).toEqual(documentFiles(edited))
    expect(toPack(back.doc)).toEqual(toPack(edited))
  })

  it('rejects broken packs without producing a document', () => {
    const doc = open()
    expect(parsePack('{ nope', OPTS).ok).toBe(false)
    expect(parsePack(JSON.stringify({ format: 'other', files: {} }), OPTS).ok).toBe(false)
    const pack = toPack(doc)
    const bad = structuredClone(pack)
    ;(bad.files['chunks/c0_0.json'] as { instances: { position: { x: number } }[] }).instances[0].position.x = 40
    const r = parsePack(JSON.stringify(bad), OPTS)
    expect(r.ok).toBe(false)
    expect(r.issues.map((i) => i.code)).toContain('owner-mismatch')
    const escape = structuredClone(pack)
    escape.files['../evil.json'] = {}
    expect(parsePack(JSON.stringify(escape), OPTS).ok).toBe(false)
  })

  it('imports reject world-level errors; drafts may keep them', () => {
    const doc = open()
    // A zombie spawn moved into the safehouse wall: a content error, not a broken document.
    const spawn = findRecord(doc, 'c0_-1/spawns/zombie-5')!
    const wall = resolvedRecords(doc).find((r) => r.id === 'c-1_-1/safehouse')!.parts.walls![0]
    const at = worldAnchor(doc, spawn)
    const blocked = ok(moveRecords(doc, ['c0_-1/spawns/zombie-5'], { x: wall.position.x - at.x, z: wall.position.z - at.z })).doc
    const text = exportPack(blocked)
    expect(parsePack(text, OPTS).ok).toBe(false)
    const draft = parsePack(text, { ...OPTS, allowContentErrors: true })
    expect(draft.ok).toBe(true)
    expect(draft.issues.some((i) => i.code === 'spawn-blocked')).toBe(true)
  })
})

describe('map editor commands (M3)', () => {
  it('places a prefab instance with a new stable ID in the owner chunk', () => {
    const r = ok(placeInstance(open(), 'building/house', FREE_SPOT, 0))
    expect(r.selection).toEqual(['c-1_0/house-1'])
    const loc = findRecord(r.doc, 'c-1_0/house-1')!
    expect(loc.chunkId).toBe('c-1_0')
    expect(worldAnchor(r.doc, loc)).toEqual(FREE_SPOT)
    const ids = resolvedRecords(r.doc).find((x) => x.id === 'c-1_0/house-1')!.entityIds
    expect(ids).toContain('c-1_0/house-1/door')
    expect(issuesOf(r.doc).filter((i) => i.severity === 'error')).toEqual([])
  })

  it('refuses to place outside the chunks of the world', () => {
    const doc = open()
    expect(placeInstance(doc, 'building/house', { x: 70, z: 0 }, 0).ok).toBe(false)
    expect(placeInstance(doc, 'building/nope', FREE_SPOT, 0).ok).toBe(false)
  })

  it('moves inside a chunk and across a chunk line without changing the ID', () => {
    const doc = open()
    const inside = ok(moveRecords(doc, ['c0_0/objects/house-scrap'], { x: 0, z: 1 }))
    expect(findRecord(inside.doc, 'c0_0/objects/house-scrap')!.chunkId).toBe('c0_0')
    expect(inside.note).toBeUndefined()

    // World (20.5, 12) → (-4.5, 12): the owner becomes c-1_0, the ID keeps its identity chunk.
    const across = ok(moveRecords(doc, ['c0_0/objects/house-scrap'], { x: -25, z: 0 }))
    const loc = findRecord(across.doc, 'c0_0/objects/house-scrap')!
    expect(loc.chunkId).toBe('c-1_0')
    expect(loc.record.position).toEqual({ x: 27.5, y: 0.4, z: 12 })
    expect(across.note).toContain('c0_0 → c-1_0')
    expect(across.doc.chunks.get('c0_0')!.objects.some((o) => o.objectId === 'c0_0/objects/house-scrap')).toBe(false)
    expect(issuesOf(across.doc).filter((i) => i.severity === 'error')).toEqual([])
    // Untouched chunks are shared, not copied.
    expect(across.doc.chunks.get('c0_-1')).toBe(doc.chunks.get('c0_-1'))
  })

  it('moving a building over a chunk line updates the external references', () => {
    const doc = ok(placeInstance(open(), 'building/house', FREE_SPOT, 0)).doc
    // Footprint ±4.5 m: at x = −3 the house reaches into c0_0.
    const moved = ok(moveRecords(doc, ['c-1_0/house-1'], { x: 12, z: 0 })).doc
    expect(moved.chunks.get('c0_0')!.externalRefs).toContainEqual({ id: 'c-1_0/house-1', ownerChunkId: 'c-1_0' })
    expect(issuesOf(moved).some((i) => i.code === 'missing-external-ref' || i.code === 'stale-external-ref')).toBe(false)
  })

  it('blocks a move that would leave the world, leaving the document as it was', () => {
    const doc = open()
    const r = moveRecords(doc, ['c0_0/house', 'c0_0/objects/house-scrap'], { x: 40, z: 0 })
    expect(r.ok).toBe(false)
  })

  it('rotates instances about their pivot, keeping IDs', () => {
    const doc = open()
    const r = ok(rotateRecords(doc, ['c0_0/house'], 1))
    expect(findRecord(r.doc, 'c0_0/house')!.record.quarterTurns).toBe(1)
    const back = ok(rotateRecords(r.doc, ['c0_0/house'], 3))
    expect(findRecord(back.doc, 'c0_0/house')!.record.quarterTurns).toBe(0)
    expect(rotateRecords(doc, ['c0_0/objects/pillar-1'], 1).ok).toBe(false)
  })

  it('delete retires the ID; new records never get it back', () => {
    const placed = ok(placeInstance(open(), 'building/house', FREE_SPOT, 0)).doc
    const deleted = ok(deleteRecords(placed, ['c-1_0/house-1'])).doc
    expect(deleted.world.retiredIds).toEqual(['c-1_0/house-1'])
    expect(ok(placeInstance(deleted, 'building/house', FREE_SPOT, 0)).selection).toEqual(['c-1_0/house-2'])
    expect(deleteRecords(deleted, [deleted.world.playerSpawn]).ok).toBe(false)
    // Hand-reusing a retired ID is a validation error.
    const reused = { ...deleted, world: { ...deleted.world, retiredIds: ['c0_0/house'] } }
    expect(issuesOf(reused).map((i) => i.code)).toContain('retired-id-reused')
  })

  it('duplicate creates new identities next to the originals', () => {
    const doc = open()
    const r = ok(duplicateRecords(doc, ['c0_0/objects/pillar-1', 'c0_0/objects/pillar-2'], { x: 0, z: 2 }))
    expect(r.selection).toEqual(['c0_0/objects/pillar-3', 'c0_0/objects/pillar-4'])
    expect(findRecord(r.doc, 'c0_0/objects/pillar-1')).not.toBeNull()
    expect(findRecord(r.doc, 'c0_0/objects/pillar-3')!.record.position).toEqual({ x: 2, y: 1, z: 22 })
  })

  it('edits properties through the same command path; IDs and horizontal anchors are protected', () => {
    const doc = open()
    const r = ok(updateRecord(doc, 'c0_0/objects/house-scrap', { name: 'Đống sắt', lootTableId: undefined }))
    const rec = findRecord(r.doc, 'c0_0/objects/house-scrap')!.record
    expect(rec.name).toBe('Đống sắt')
    expect('lootTableId' in rec).toBe(false)
    expect(updateRecord(doc, 'c0_0/objects/house-scrap', { objectId: 'c0_0/objects/x' }).ok).toBe(false)
    expect(updateRecord(doc, 'c0_0/objects/house-scrap', { position: { x: 1, y: 0.4, z: 12 } }).ok).toBe(false)
    expect(ok(updateRecord(doc, 'c0_0/objects/house-scrap', { position: { x: 20.5, y: 0.6, z: 12 } })).doc).not.toBe(doc)
    expect(updateWorld(doc, { playerSpawn: 'c0_-1/spawns/zombie-5' }).ok).toBe(false)
    expect(ok(updateWorld(doc, { contentVersion: 2 })).doc.world.contentVersion).toBe(2)
  })
})

describe('map editor history (M3)', () => {
  it('undo/redo restore documents, identities and selection; a new command drops redo', () => {
    const start = open()
    let s = initialEditState(start)
    s = applyCommand(s, 'place', placeInstance(s.doc, 'building/house', FREE_SPOT, 0)).state
    const afterPlace = s.doc
    s = applyCommand(s, 'move', moveRecords(s.doc, s.selection, { x: 1, z: 1 })).state
    s = applyCommand(s, 'rotate', rotateRecords(s.doc, s.selection, 1)).state
    s = applyCommand(s, 'delete', deleteRecords(s.doc, s.selection)).state
    const end = s.doc
    expect(s.past.map((e) => e.label)).toEqual(['place', 'move', 'rotate', 'delete'])
    expect(s.selection).toEqual([])

    s = undo(s) // delete
    expect(s.selection).toEqual(['c-1_0/house-1'])
    expect(findRecord(s.doc, 'c-1_0/house-1')!.record.quarterTurns).toBe(1)
    s = undo(undo(undo(s)))
    expect(s.doc).toBe(start)
    expect(s.selection).toEqual([])
    s = redo(s)
    expect(s.doc).toBe(afterPlace)
    expect(s.selection).toEqual(['c-1_0/house-1'])
    s = redo(redo(redo(s)))
    expect(s.doc).toBe(end)
    expect(redo(s)).toBe(s)

    s = undo(undo(s))
    const failed = applyCommand(s, 'bad', moveRecords(s.doc, ['c-1_0/house-1'], { x: 99, z: 0 }))
    expect(failed.error).toBeTruthy()
    expect(failed.state).toBe(s)
    s = applyCommand(s, 'dup', duplicateRecords(s.doc, s.selection, { x: 0, z: 0 })).state
    expect(s.future).toEqual([])
  })
})

describe('map editor viewport helpers (M3)', () => {
  it('picks the smallest record under the cursor and maps validator paths to records', () => {
    const doc = open()
    const records = resolvedRecords(doc)
    const scrap = worldAnchor(doc, findRecord(doc, 'c0_0/objects/house-scrap')!)
    expect(pickRecord(records, scrap)!.id).toBe('c0_0/objects/house-scrap')
    const house = worldAnchor(doc, findRecord(doc, 'c0_0/house')!)
    expect(pickRecord(records, house)!.id).toBe('c0_0/house')
    expect(pickRecord(records, house, (r) => r.id === 'c0_0/house')?.id).not.toBe('c0_0/house')
    expect(recordAtPath(doc, 'chunks/c0_0.json#/objects/2/position')).toBe('c0_0/objects/house-scrap')
    expect(recordForEntity(doc, 'c0_0/house/door')).toBe('c0_0/house')
    expect(snap(1.26, 0.25)).toBe(1.25)
    expect(snap(-0.2, 1)).toBe(0)
  })

  it('shares resolved records of unchanged chunks between documents', () => {
    const doc = open()
    const a = resolvedRecords(doc)
    const moved = ok(moveRecords(doc, ['c0_0/objects/pillar-1'], { x: 1, z: 0 })).doc
    const b = resolvedRecords(moved)
    expect(b.find((r) => r.id === 'c-1_-1/safehouse')).toBe(a.find((r) => r.id === 'c-1_-1/safehouse'))
    expect(b.find((r) => r.id === 'c0_0/objects/pillar-1')).not.toBe(a.find((r) => r.id === 'c0_0/objects/pillar-1'))
  })
})

describe('editor output runs in the game (M3)', () => {
  it('the runtime loads an edited, exported pack through the real loader and plays it', () => {
    let doc = open()
    doc = ok(placeInstance(doc, 'building/house', FREE_SPOT, 1)).doc
    doc = ok(moveRecords(doc, ['c0_0/objects/house-scrap'], { x: -25, z: 0 })).doc
    doc = ok(updateWorld(doc, { contentVersion: 2 })).doc
    const back = parsePack(exportPack(doc), OPTS)
    if (!back.ok) throw new Error(back.error)
    const files = new Map(documentFiles(back.doc))
    const loaded = loadWorld((p) => {
      if (!files.has(p)) throw new Error(`missing ${p}`)
      return files.get(p)
    })
    expect(hasErrors(loaded.issues)).toBe(false)
    const map = loaded.map
    expect(map.doors.some((d) => d.id === 'c-1_0/house-1/door')).toBe(true)
    expect(map.containers.find((c) => c.id === 'c0_0/objects/house-scrap')!.position).toEqual({ x: -4.5, y: 0.4, z: 12 })

    const rt = new GameRuntime(map)
    rt.newGame(7)
    rt.pathBudget.maxPathMs = Infinity
    rt.setLineOfSightOverride(null)
    for (let i = 0; i < 600; i++) rt.tick(1 / 60)
    expect(rt.world.doors.has('c-1_0/house-1/door')).toBe(true)
    expect(rt.world.containers.has('c0_0/objects/house-scrap')).toBe(true)
  })
})
