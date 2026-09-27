import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, loadWorld, REGISTERED_LOOT_TABLES } from '../content'
import { deepCheck } from '../analysis'
import { deleteRecords, moveRecords, placeInstance, updateRecord } from '../editor/commands'
import { documentFiles, findRecord, type MapDocument } from '../editor/document'
import { exportPack, parsePack, validateDocument } from '../editor/pack'
import type { InstanceRecord, PrefabDocument, PrefabEntry, WorldDocument } from '../schema'
import { placeBuildings, prefabCatalog, type PrefabCatalog } from './buildings'
import { importGeoJsonLayout } from './importer'
import { parcelRect } from './parcels'
import { planLayout } from './plan'
import type { WorldLayout } from './schema'
import { gridStreets, imp } from './testUtils'
import { createLayoutWorld, documentLayout, generatorStatus, LAYOUT_FILE, parcelAt, parcelChunk, prefabChoices, recordHash, syncGenerated, withLayout, type SyncRequest } from './worldSync'
import FIXTURE from '../../test/fixtures/layouts/wg1-town.geojson?raw'

/** WG4: the layout stored with the world, generated / modified / locked / manual records, regeneration that protects hand edits. */

const LIB = bundledWorldFiles('prefab-library')
const libWorld = LIB.get('world.json') as WorldDocument
const catalog: PrefabCatalog = prefabCatalog(`${libWorld.worldId}@${libWorld.contentVersion}`, libWorld.prefabs.map((entry: PrefabEntry) => ({ entry, doc: LIB.get(entry.path) as PrefabDocument })))
const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
const CTX = { catalog, validation: OPTS }

function townWorld(mode: 'full' | 'layout-only' = 'full'): MapDocument {
  const l = importGeoJsonLayout(FIXTURE, { layoutId: 'wg4-town', name: 'WG4 town' })
  let plan = planLayout(l)
  if (mode === 'full') plan = placeBuildings(plan, catalog).plan
  return createLayoutWorld({ ...l, plan }, { worldId: 'wg4-town', name: 'WG4 town', mode, catalog, validation: OPTS })
}

const layoutOf = (doc: MapDocument) => documentLayout(doc).layout!
const statusOf = (doc: MapDocument) => generatorStatus(doc, layoutOf(doc))
const errorsOf = (doc: MapDocument) => validateDocument(doc, OPTS).filter((i) => i.severity === 'error')
const instances = (doc: MapDocument) => [...doc.chunks.values()].flatMap((c) => c.instances)
const sync = (doc: MapDocument, req: SyncRequest) => {
  const r = syncGenerated(doc, req, CTX)
  if (!r.ok) throw new Error(r.error)
  return r
}
/** A built parcel's instance record and a 0.5 m move that keeps it inside the parcel. */
function movable(doc: MapDocument, skip = 0) {
  const l = layoutOf(doc)
  const found = l.plan!.parcels.filter((q) => q.build && q.build.prefabId !== null)
  let n = 0
  for (const q of found) {
    const b = q.build as { footprint: { minX: number; maxX: number; minZ: number; maxZ: number } }
    const r = parcelRect(q)
    const delta = r.maxX - b.footprint.maxX >= 0.5 ? { x: 0.5, z: 0 } : b.footprint.minX - r.minX >= 0.5 ? { x: -0.5, z: 0 } : r.maxZ - b.footprint.maxZ >= 0.5 ? { x: 0, z: 0.5 } : null
    if (!delta || n++ < skip) continue
    return { parcel: q.id, id: statusOf(doc).instances.get(q.id)!, delta }
  }
  throw new Error('no movable building')
}
const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error((r as unknown as { error: string }).error)
  return r as Extract<T, { ok: true }>
}

describe('WG4 layout stored with the world', () => {
  const doc = townWorld()

  it('keeps the layout, plan and manifest in layout/world-layout.json: a file the game never loads', () => {
    const l = documentLayout(doc)
    expect(l.issues).toEqual([])
    expect(l.layout!.plan).toBeTruthy()
    expect(l.layout!.generated).toMatchObject({ version: 1, mode: 'full', catalog: catalog.id, locked: [], rolls: 0 })
    expect(errorsOf(doc)).toEqual([])
    // The game loads only world.json, prefabs and chunks: same world with or without the layout file.
    const files = new Map(documentFiles(doc))
    expect(files.has(LAYOUT_FILE)).toBe(true)
    const withIt = loadWorld((p) => files.get(p)).map
    files.delete(LAYOUT_FILE)
    expect(loadWorld((p) => files.get(p)).map.doors.length).toBe(withIt.doors.length)
  })

  it('lists every generated record with its hash: all generated, none manual', () => {
    const s = statusOf(doc)
    expect(s.counts).toMatchObject({ manual: 0, modified: 0, locked: 0, deleted: 0 })
    expect(s.counts.generated).toBe(layoutOf(doc).generated!.records.length)
    for (const inst of instances(doc)) expect(s.records.get(inst.instanceId)!.parcel).toBe(inst.instanceId.split('/')[1])
    expect([...s.parcels.values()]).toEqual(expect.arrayContaining(['generated', 'empty', 'open']))
  })

  it('survives a content pack and an editor draft unchanged (hashes stable through JSON)', () => {
    const back = ok(parsePack(exportPack(doc), OPTS)).doc
    expect(statusOf(back).counts).toEqual(statusOf(doc).counts)
    expect(exportPack(back)).toBe(exportPack(doc))
  })

  it('reports a broken layout file instead of acting on it', () => {
    const broken = { ...doc, extras: new Map([[LAYOUT_FILE, { format: 'nope' }]]) }
    expect(documentLayout(broken).layout).toBeNull()
    expect(documentLayout(broken).issues[0].severity).toBe('error')
    const r = syncGenerated(broken, { kind: 'world' }, CTX)
    expect(r.ok).toBe(false)
  })

  it('finds the parcel under a point and the chunk that owns it', () => {
    const l = layoutOf(doc)
    const q = l.plan!.parcels[7]
    const r = parcelRect(q)
    expect(parcelAt(l, { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 })!.id).toBe(q.id)
    expect(parcelChunk(q)).toMatch(/^c-?\d+_-?\d+$/)
  })
})

describe('WG4 generated / modified / locked / manual', () => {
  const doc = townWorld()

  it('flags a moved building as modified and back as generated when moved back', () => {
    const m = movable(doc)
    const moved = ok(moveRecords(doc, [m.id], m.delta)).doc
    expect(statusOf(moved).records.get(m.id)).toMatchObject({ state: 'modified', modified: 'edited', parcel: m.parcel })
    expect(statusOf(moved).parcels.get(m.parcel)).toBe('modified')
    const back = ok(moveRecords(moved, [m.id], { x: -m.delta.x, z: -m.delta.z })).doc
    expect(statusOf(back).records.get(m.id)!.state).toBe('generated')
  })

  it('flags a deleted building, keeps hand-placed records apart as manual', () => {
    const m = movable(doc)
    const gone = ok(deleteRecords(doc, [m.id])).doc
    expect(statusOf(gone).records.get(m.id)).toMatchObject({ state: 'modified', modified: 'deleted' })
    expect(statusOf(gone).counts.deleted).toBe(1)
    const placed = ok(placeInstance(doc, 'building/house', { x: 0, z: 0 }, 0))
    expect(statusOf(placed.doc).records.get(placed.selection[0])!.state).toBe('manual')
  })

  it('locks a building through its parcel and a street record by itself; modified is not locked', () => {
    const m = movable(doc)
    const road = layoutOf(doc).generated!.records.find((r) => r.id.includes('/roads/'))!.id
    const locked = sync(doc, { kind: 'lock', ids: [m.id, road], locked: true }).doc
    expect(locked.chunks).toBe(doc.chunks)
    expect(layoutOf(locked).plan!.parcels.find((q) => q.id === m.parcel)!.locked).toBe(true)
    expect(layoutOf(locked).generated!.locked).toEqual([road])
    expect(statusOf(locked).records.get(m.id)).toMatchObject({ state: 'locked', modified: null })
    expect(statusOf(locked).records.get(road)!.state).toBe('locked')
    const unlocked = sync(locked, { kind: 'lock', ids: [m.parcel, road], locked: false }).doc
    expect(statusOf(unlocked).records.get(m.id)!.state).toBe('generated')
    const manual = ok(placeInstance(doc, 'building/house', { x: 0, z: 0 }, 0))
    expect(syncGenerated(manual.doc, { kind: 'lock', ids: manual.selection, locked: true }, CTX).ok).toBe(false)
  })
})

describe('WG4 regeneration protects hand edits', () => {
  const doc = townWorld()

  it('changes nothing when regenerated with the same seed', () => {
    const r = sync(doc, { kind: 'world' })
    expect(r.report).toMatchObject({ replaced: 0, added: 0, removed: 0, keptModified: [], keptLocked: [], conflicts: [] })
    expect(exportPack(r.doc)).toBe(exportPack(doc))
  })

  it('same seed after a lock: the same parcels, nothing changes (a replan would cut the block differently)', () => {
    const k = movable(doc, 2)
    const locked = sync(doc, { kind: 'lock', ids: [k.parcel], locked: true }).doc
    const r = sync(locked, { kind: 'world' })
    expect(r.report).toMatchObject({ replaced: 0, added: 0, removed: 0 })
    expect(layoutOf(r.doc).plan!.parcels.map((q) => q.id)).toEqual(layoutOf(doc).plan!.parcels.map((q) => q.id))
  })

  it('new seed: keeps modified and locked records exactly, replaces the rest, stays valid and playable', () => {
    const m = movable(doc)
    const k = movable(doc, 4)
    let d = ok(moveRecords(doc, [m.id], m.delta)).doc
    d = sync(d, { kind: 'lock', ids: [k.id], locked: true }).doc
    const movedRec = findRecord(d, m.id)!.record
    const lockedRec = findRecord(d, k.id)!.record
    const r = sync(d, { kind: 'world', params: { seed: 7 } })
    expect(findRecord(r.doc, m.id)!.record).toEqual(movedRec)
    expect(findRecord(r.doc, k.id)!.record).toEqual(lockedRec)
    expect(r.report.replaced + r.report.added + r.report.removed).toBeGreaterThan(20)
    const l = layoutOf(r.doc)
    expect(l.plan!.params.seed).toBe(7)
    expect(l.plan!.parcels.find((q) => q.id === m.parcel)).toBeTruthy()
    expect(l.plan!.parcels.find((q) => q.id === k.parcel)!.locked).toBe(true)
    const s = statusOf(r.doc)
    expect(s.records.get(m.id)!.state).toBe('modified')
    expect(s.records.get(k.id)!.state).toBe('locked')
    expect(errorsOf(r.doc)).toEqual([])
    const files = new Map(documentFiles(r.doc))
    const deep = deepCheck(loadWorld((p) => files.get(p)).docs).issues
    expect(deep.filter((i) => ['interaction-unreachable', 'spawn-unreachable', 'collider-overlap', 'start-not-walkable'].includes(i.code))).toEqual([])
  })

  it('keeps a hand-placed record and reports a new building on top of it', () => {
    const l = layoutOf(doc)
    const q = l.plan!.parcels.find((x) => x.build && x.build.prefabId !== null)!
    const f = (q.build as { footprint: { minX: number; minZ: number } }).footprint
    const shed = ok(placeInstance(doc, 'building/house', { x: f.minX + 1, z: f.minZ + 1 }, 0))
    const r = sync(shed.doc, { kind: 'parcels', parcels: [q.id] })
    expect(findRecord(r.doc, shed.selection[0])).toBeTruthy()
    const hit = r.report.issues.find((i) => i.code === 'manual-overlap')
    if (r.report.parcels.includes(q.id) && layoutOf(r.doc).plan!.parcels.find((x) => x.id === q.id)!.build?.prefabId) expect(hit?.ids).toContain(shed.selection[0])
  })

  it('overwrite: hand edits replaced by the new generation, locked ones still kept', () => {
    const m = movable(doc)
    const k = movable(doc, 4)
    let d = ok(moveRecords(doc, [m.id, k.id], m.delta)).doc
    d = sync(d, { kind: 'lock', ids: [k.id], locked: true }).doc
    const lockedRec = findRecord(d, k.id)!.record
    const r = sync(d, { kind: 'world', overwrite: true })
    expect(findRecord(r.doc, m.id)!.record).toEqual(findRecord(doc, m.id)!.record)
    expect(findRecord(r.doc, k.id)!.record).toEqual(lockedRec)
    // The locked parcel's building and its environment details (WG5) stay locked; nothing is left modified.
    const lockedCount = layoutOf(r.doc).generated!.records.filter((x) => x.parcel === k.parcel).length
    expect(statusOf(r.doc).counts).toMatchObject({ modified: 0, locked: lockedCount })
  })

  it('never brings back a building deleted by hand, unless restored explicitly', () => {
    const m = movable(doc)
    const gone = ok(deleteRecords(doc, [m.id])).doc
    expect(gone.world.retiredIds).toContain(m.id)
    const kept = sync(gone, { kind: 'world' })
    expect(findRecord(kept.doc, m.id)).toBeNull()
    expect(kept.report.keptModified).toEqual([m.id])
    const back = sync(gone, { kind: 'revert', ids: [m.id] })
    expect(findRecord(back.doc, m.id)!.record).toEqual(findRecord(doc, m.id)!.record)
    expect(back.doc.world.retiredIds ?? []).not.toContain(m.id)
    expect(errorsOf(back.doc)).toEqual([])
  })

  it('restores an edited record to what the generator wrote', () => {
    const m = movable(doc)
    const moved = ok(moveRecords(doc, [m.id], m.delta)).doc
    const back = sync(moved, { kind: 'revert', ids: [m.id] })
    expect(back.report.replaced).toBe(1)
    expect(findRecord(back.doc, m.id)!.record).toEqual(findRecord(doc, m.id)!.record)
    const locked = sync(moved, { kind: 'lock', ids: [m.id], locked: true }).doc
    expect(syncGenerated(locked, { kind: 'revert', ids: [m.id] }, CTX).ok).toBe(false)
  })

  it('reports a hand-placed record holding an ID the generator wants, and leaves it alone', () => {
    const m = movable(doc)
    const l = layoutOf(doc)
    // Forget that the generator wrote it and edit it: to the generator it is now a record placed by hand.
    const orphan = withLayout(doc, { ...l, generated: { ...l.generated!, records: l.generated!.records.filter((r) => r.id !== m.id) } })
    const edited = ok(updateRecord(orphan, m.id, { quarterTurns: ((findRecord(orphan, m.id)!.record as unknown as InstanceRecord).quarterTurns + 2) % 4 })).doc
    const r = sync(edited, { kind: 'world', overwrite: true })
    expect(r.report.conflicts).toEqual([m.id])
    expect(findRecord(r.doc, m.id)!.record).toEqual(findRecord(edited, m.id)!.record)
    // Identical to the generator's output: adopted as generated again.
    const adopted = sync(orphan, { kind: 'world' })
    expect(statusOf(adopted.doc).records.get(m.id)!.state).toBe('generated')
  })

  it('never changes the document it was given (undo keeps the old one)', () => {
    const before = exportPack(doc)
    sync(doc, { kind: 'world', params: { seed: 3 } })
    expect(exportPack(doc)).toBe(before)
  })
})

describe('WG4 selective regeneration and hand choices', () => {
  const doc = townWorld()
  const unchangedOutside = (a: MapDocument, b: MapDocument, parcel: string) => {
    const l = layoutOf(a)
    const block = l.plan!.parcels.find((q) => q.id === parcel)!.block
    const mine = new Set(l.generated!.records.filter((r) => r.parcel === parcel || r.block === block).map((r) => r.id))
    const keyed = (d: MapDocument) => [...d.chunks.values()].flatMap((c) => [...c.instances, ...c.roads, ...c.zones, ...c.spawns].map((r) => JSON.stringify(r))).filter((j) => ![...mine].some((id) => j.includes(`"${id}"`)))
    expect(keyed(b)).toEqual(keyed(a))
  }

  it('re-rolls one parcel until its building changes; the rest of the world stays', () => {
    const q = layoutOf(doc).plan!.parcels.find((x) => x.build && x.build.prefabId !== null && prefabChoices(layoutOf(doc), x.id, catalog).length > 2)!
    const r = sync(doc, { kind: 'parcels', parcels: [q.id] })
    expect(r.report.parcels).toEqual([q.id])
    // Asked for by name: another building, never an empty lot.
    const b = layoutOf(r.doc).plan!.parcels.find((x) => x.id === q.id)!.build!
    expect(b.prefabId).not.toBeNull()
    expect(layoutOf(r.doc).generated!.rolls).toBeGreaterThan(0)
    unchangedOutside(doc, r.doc, q.id)
    expect(errorsOf(r.doc)).toEqual([])
    // Same edits, same world.
    expect(exportPack(sync(doc, { kind: 'parcels', parcels: [q.id] }).doc)).toBe(exportPack(r.doc))
  })

  it('replaces the hand edit on the parcel it names, refuses a locked parcel', () => {
    const m = movable(doc)
    const moved = ok(moveRecords(doc, [m.id], m.delta)).doc
    const r = sync(moved, { kind: 'parcels', parcels: [m.parcel] })
    expect(statusOf(r.doc).parcels.get(m.parcel)).not.toBe('modified')
    const locked = sync(doc, { kind: 'lock', ids: [m.parcel], locked: true }).doc
    const refused = syncGenerated(locked, { kind: 'parcels', parcels: [m.parcel] }, CTX)
    expect(refused.ok).toBe(false)
  })

  it('regenerates a chunk: its unedited parcels only, hand edits and other chunks kept', () => {
    const m = movable(doc)
    const q = layoutOf(doc).plan!.parcels.find((x) => x.id === m.parcel)!
    const chunk = parcelChunk(q)
    const moved = ok(moveRecords(doc, [m.id], m.delta)).doc
    const r = sync(moved, { kind: 'chunks', chunks: [chunk] })
    expect(findRecord(r.doc, m.id)!.record).toEqual(findRecord(moved, m.id)!.record)
    const others = layoutOf(doc).plan!.parcels.filter((x) => parcelChunk(x) !== chunk)
    for (const x of others) expect(layoutOf(r.doc).plan!.parcels.find((y) => y.id === x.id)!.build).toEqual(x.build)
    expect(errorsOf(r.doc)).toEqual([])
  })

  it('replaces a prefab by hand (kept by later regenerations) and clears a lot', () => {
    const l = layoutOf(doc)
    const q = l.plan!.parcels.find((x) => x.build && x.build.prefabId !== null && prefabChoices(l, x.id, catalog).some((c) => c.prefabId !== (x.build as { prefabId: string }).prefabId))!
    const choice = prefabChoices(l, q.id, catalog).find((c) => c.prefabId !== (q.build as { prefabId: string }).prefabId)!
    const r = sync(doc, { kind: 'prefab', parcel: q.id, prefabId: choice.prefabId })
    const inst = statusOf(r.doc).instances.get(q.id)!
    expect((findRecord(r.doc, inst)!.record as unknown as InstanceRecord).prefabId).toBe(choice.prefabId)
    expect(statusOf(r.doc).records.get(inst)).toMatchObject({ state: 'modified', modified: 'chosen' })
    expect(r.doc.world.prefabs.some((p) => p.prefabId === choice.prefabId)).toBe(true)
    expect(errorsOf(r.doc)).toEqual([])
    const again = sync(r.doc, { kind: 'world', params: { seed: 11 } })
    expect((findRecord(again.doc, inst)!.record as unknown as InstanceRecord).prefabId).toBe(choice.prefabId)
    const cleared = sync(r.doc, { kind: 'prefab', parcel: q.id, prefabId: null })
    expect(findRecord(cleared.doc, inst)).toBeNull()
    expect(statusOf(cleared.doc).parcels.get(q.id)).toBe('modified')
    const big = catalog.prefabs.find((p) => p.entry.prefabId === 'library/warehouse')!
    if (!prefabChoices(l, q.id, catalog).some((c) => c.prefabId === big.entry.prefabId)) expect(syncGenerated(doc, { kind: 'prefab', parcel: q.id, prefabId: big.entry.prefabId }, CTX).ok).toBe(false)
  })

  it('switches LAYOUT_ONLY ↔ FULL: buildings added, then removed except hand-edited ones', () => {
    const bare = townWorld('layout-only')
    expect(instances(bare)).toHaveLength(0)
    const full = sync(bare, { kind: 'world', mode: 'full' })
    expect(instances(full.doc).length).toBeGreaterThan(60)
    expect(layoutOf(full.doc).generated!.mode).toBe('full')
    expect(errorsOf(full.doc)).toEqual([])
    const m = movable(full.doc)
    const moved = ok(moveRecords(full.doc, [m.id], m.delta)).doc
    const back = sync(moved, { kind: 'world', mode: 'layout-only' })
    expect(instances(back.doc).map((i) => i.instanceId)).toEqual([m.id])
    expect(syncGenerated(bare, { kind: 'parcels', parcels: ['lot-x'] }, CTX).ok).toBe(false)
  })

  it('hashes the owner chunk too: a record re-homed into another chunk is an edit', () => {
    const inst = instances(doc)[0]
    expect(recordHash('c0_0', inst)).not.toBe(recordHash('c1_0', inst))
    expect(recordHash('c0_0', { a: 1, b: 2 })).toBe(recordHash('c0_0', { b: 2, a: 1 }))
  })

  it('regenerates a dense 500 × 500 m town with a new seed quickly', { timeout: 30000 }, () => {
    const dense = imp(gridStreets(21, 25, 31, 0.6))
    const plan = placeBuildings(planLayout(dense), catalog).plan
    const world = createLayoutWorld({ ...dense, plan } as WorldLayout, { worldId: 'dense', name: 'dense', mode: 'full', catalog, validation: OPTS })
    const t0 = performance.now()
    const r = sync(world, { kind: 'world', params: { seed: 2 } })
    expect(performance.now() - t0).toBeLessThan(8000)
    expect(r.report.replaced + r.report.added).toBeGreaterThan(100)
  })
})
