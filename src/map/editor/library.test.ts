import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, REGISTERED_LOOT_TABLES } from '../content'
import { checkWorldDocuments, validateCompoundDocument } from '../validate'
import type { CompoundDocument, SurfaceObject } from '../schema'
import { deleteRecords, duplicateRecords, moveRecords, placeInstance, placeRecord, rotateRecords, updateRecord, type CommandResult } from './commands'
import { blankDocument, documentFiles, findRecord, resolvedRecords, statefulEntityIds, worldAnchor, type MapDocument } from './document'
import { documentGroups, expandToGroups, fullGroups, GROUPS_FILE, modifiedMembers, turnAbout } from './groups'
import {
  compoundGroupOutdated,
  compoundPath,
  freePrefabId,
  groupMemberStates,
  groupRecords,
  importPrefab,
  libraryFromDocument,
  libraryFromFiles,
  linkPrefab,
  placeCompound,
  planCompoundUpdate,
  planPrefabUpdate,
  prefabHash,
  prefabStatus,
  saveCompound,
  ungroup,
  type CompoundUpdatePlan,
  type PrefabUpdatePlan,
  type SharedLibrary,
} from './library'
import { documentFromFiles, exportPack, parsePack } from './pack'
import { deletePrefabItems, movePrefabItems, updatePrefab } from './prefabCommands'
import { applyCommand, initialEditState, undo } from './session'
import { libraryCatalog } from './generator'
import { placeBuildings, STYLE_WEIGHT, styledWeight } from '../layout/buildings'
import { importGeoJsonLayout } from '../layout/importer'
import { planLayout } from '../layout/plan'
import type { PlanParams } from '../layout/schema'
import TOWN from '../../test/fixtures/layouts/wg1-town.geojson?raw'

/** Prefab library P1: copy-on-import, provenance and versions, previewed updates, compounds and groups. */

const OPTS = { lootTables: REGISTERED_LOOT_TABLES }

function ok(r: CommandResult): Extract<CommandResult, { ok: true }> {
  if (!r.ok) throw new Error(r.error)
  return r
}
function plan<T extends PrefabUpdatePlan | CompoundUpdatePlan>(r: T | string): T {
  if (typeof r === 'string') throw new Error(r)
  return r
}

function open(worldId: string): MapDocument {
  const r = documentFromFiles(bundledWorldFiles(worldId), OPTS)
  if (!r.ok) throw new Error(r.error)
  return r.doc
}
/** The library world as a document (tests change it to publish new versions). */
const libraryWorld = () => open('prefab-library')

function blank(): MapDocument {
  const n = open('neighborhood-50')
  return blankDocument({ worldId: 'p1-library', name: 'P1', prefabs: n.world.prefabs.map((entry) => ({ entry, doc: n.prefabs.get(entry.prefabId)! })) })
}

function issuesOf(doc: MapDocument) {
  const files = new Map(documentFiles(doc))
  return checkWorldDocuments((p) => files.get(p), OPTS).issues
}
const errors = (doc: MapDocument) => issuesOf(doc).filter((i) => i.severity === 'error')

/** A library compound: the clinic, a concrete yard, a pond, a fence and a tree, saved in the library world. */
function withCompound(lib: MapDocument): MapDocument {
  // An empty corner of the library world (chunk c1_-1, north of the showroom street).
  let d = ok(placeInstance(lib, 'library/clinic', { x: 52, z: -24 }, 0)).doc
  const clinic = d.chunks.get('c1_-1')!.instances.at(-1)!.instanceId
  d = ok(placeRecord(d, 'ground/yard', { x: 52, z: -12 })).doc
  d = ok(placeRecord(d, 'ground/pond', { x: 62, z: -12 })).doc
  d = ok(placeRecord(d, 'object/fence', { x: 52, z: -6 })).doc
  d = ok(placeRecord(d, 'object/tree', { x: 42, z: -12 })).doc
  const ids = [clinic, 'c1_-1/objects/yard-1', 'c1_-1/objects/pond-1', 'c1_-1/objects/fence-1', 'c1_-1/objects/tree-1']
  return ok(saveCompound(d, ids, { compoundId: 'compound/clinic-yard', name: 'Phòng khám có sân', catalog: { group: 'public', architectureStyle: 'vietnamese' } })).doc
}

describe('shared prefab library: building prefabs (P1)', () => {
  it('reads the repo library world: its prefabs, no compounds yet, no issues', () => {
    const lib = libraryFromFiles(bundledWorldFiles('prefab-library'), OPTS)!
    expect(lib.worldId).toBe('prefab-library')
    expect([...lib.prefabs.keys()]).toContain('library/clinic')
    expect(lib.issues).toEqual([])
  })

  it('copy-on-import: stable ID, source library/version/hash, the manifest pins it, and it validates', () => {
    const lib = libraryFromDocument(libraryWorld(), OPTS)
    const doc = blank()
    expect(prefabStatus(doc, lib, 'library/clinic').state).toBe('absent')
    const r = ok(importPrefab(doc, lib, 'library/clinic'))
    const copy = r.doc.prefabs.get('library/clinic')!
    const lp = lib.prefabs.get('library/clinic')!
    expect(copy.source).toEqual({ library: 'prefab-library', id: 'library/clinic', version: lp.contentVersion, hash: prefabHash(lp) })
    expect(r.doc.world.prefabs.at(-1)).toEqual({ prefabId: 'library/clinic', contentVersion: lp.contentVersion, path: 'prefabs/clinic.json' })
    expect(prefabStatus(r.doc, lib, 'library/clinic').state).toBe('current')
    expect(errors(r.doc)).toEqual([])
    expect(importPrefab(r.doc, lib, 'library/clinic').ok).toBe(false)
    // The copy is the world's own: the library document is never referenced.
    expect(copy).not.toBe(lp)
    expect(copy.objects).not.toBe(lp.objects)
  })

  it('ID conflict: a different prefab with the library ID is never overwritten; import under a free ID or link an identical one', () => {
    const lib = libraryFromDocument(libraryWorld(), OPTS)
    const doc = blank()
    const st = prefabStatus(doc, lib, 'building/house')
    expect(st).toMatchObject({ state: 'id-taken', worldPrefabId: 'building/house', identical: false })
    expect(importPrefab(doc, lib, 'building/house').ok).toBe(false)
    expect(linkPrefab(doc, lib, 'building/house').ok).toBe(false)
    const as = freePrefabId(doc, 'building/house')
    expect(as).toBe('building/house-2')
    const r = ok(importPrefab(doc, lib, 'building/house', as))
    expect(r.doc.prefabs.get('building/house')).toBe(doc.prefabs.get('building/house'))
    expect(r.doc.prefabs.get(as)!.source!.id).toBe('building/house')
    expect(r.doc.world.prefabs.find((e) => e.prefabId === as)!.path).toBe('prefabs/house-2.json')
    expect(prefabStatus(r.doc, lib, 'building/house')).toMatchObject({ state: 'current', worldPrefabId: as })
    expect(errors(r.doc)).toEqual([])
    // A world prefab identical to the library one is linked (source recorded, nothing else changes).
    const same = ok(updatePrefab(doc, 'building/house', {})).doc
    const withLib = { ...same, prefabs: new Map(same.prefabs).set('building/house', { ...lib.prefabs.get('building/house')! }) }
    expect(prefabStatus(withLib, lib, 'building/house')).toMatchObject({ state: 'id-taken', identical: true })
    const linked = ok(linkPrefab(withLib, lib, 'building/house')).doc
    expect(prefabStatus(linked, lib, 'building/house').state).toBe('current')
  })

  it('library changes never reach a world by themselves; the update is detected, previewed and applied on request', () => {
    let libDoc = libraryWorld()
    const lib1 = libraryFromDocument(libDoc, OPTS)
    let doc = ok(importPrefab(blank(), lib1, 'library/clinic')).doc
    doc = ok(placeInstance(doc, 'library/clinic', { x: 10, z: 10 }, 1)).doc
    const inst = doc.chunks.get('c0_0')!.instances.at(-1)!.instanceId
    const beforeWorld = doc.prefabs.get('library/clinic')
    // The library moves a counter and publishes v2.
    const lp = libDoc.prefabs.get('library/clinic')!
    const movable = lp.objects.find((o) => o.kind === 'prop' || o.kind === 'container')!
    libDoc = ok(movePrefabItems(libDoc, 'library/clinic', [movable.localId], { x: 0.5, z: 0 })).doc
    libDoc = ok(updatePrefab(libDoc, 'library/clinic', { contentVersion: lp.contentVersion + 1 })).doc
    const lib2 = libraryFromDocument(libDoc, OPTS)
    expect(doc.prefabs.get('library/clinic')).toBe(beforeWorld)
    expect(prefabStatus(doc, lib2, 'library/clinic')).toMatchObject({ state: 'outdated', importedVersion: lp.contentVersion, libVersion: lp.contentVersion + 1 })
    const p = plan(planPrefabUpdate(doc, lib2, 'library/clinic'))
    expect(p).toMatchObject({ fromVersion: lp.contentVersion, toVersion: lp.contentVersion + 1, changed: [movable.localId], added: [], removed: [], removedStateful: [], blockers: [], instances: [inst], modifiedInWorld: false })
    const after = p.doc!
    expect(prefabStatus(after, lib2, 'library/clinic').state).toBe('current')
    expect(after.world.prefabs.find((e) => e.prefabId === 'library/clinic')!.contentVersion).toBe(lp.contentVersion + 1)
    // Stateful IDs of the instance stay: saves keep their state.
    expect(statefulEntityIds(after)).toEqual(statefulEntityIds(doc))
    expect(errors(after)).toEqual([])
    expect(planPrefabUpdate(after, lib2, 'library/clinic')).toMatch(/mới nhất/)
  })

  it('protects the world: an edited copy, dropped stateful IDs and reused retired IDs block the update', () => {
    let libDoc = libraryWorld()
    const lib1 = libraryFromDocument(libDoc, OPTS)
    let doc = ok(importPrefab(blank(), lib1, 'library/clinic')).doc
    doc = ok(placeInstance(doc, 'library/clinic', { x: 10, z: 10 }, 0)).doc
    const lp = libDoc.prefabs.get('library/clinic')!
    const door = lp.objects.find((o) => o.kind === 'door')!
    // The library drops a door (a save holds its state).
    libDoc = ok(deletePrefabItems(libDoc, 'library/clinic', [door.localId])).doc
    const lib2 = libraryFromDocument(libDoc, OPTS)
    const blocked = plan(planPrefabUpdate(doc, lib2, 'library/clinic'))
    expect(blocked.removedStateful).toEqual([door.localId])
    expect(blocked.blockers).toHaveLength(1)
    expect(blocked.doc).toBeNull()
    const accepted = plan(planPrefabUpdate(doc, lib2, 'library/clinic', { acceptStateChanges: true }))
    expect(accepted.blockers).toEqual([])
    expect(accepted.doc!.prefabs.get('library/clinic')!.retiredLocalIds).toContain(door.localId)
    // An edit in the world is never overwritten without asking.
    const edited = ok(updatePrefab(doc, 'library/clinic', { name: 'Phòng khám xã' })).doc
    expect(prefabStatus(edited, lib2, 'library/clinic').state).toBe('modified-outdated')
    const p = plan(planPrefabUpdate(edited, lib2, 'library/clinic', { acceptStateChanges: true }))
    expect(p.modifiedInWorld).toBe(true)
    expect(p.blockers).toHaveLength(1)
    expect(plan(planPrefabUpdate(edited, lib2, 'library/clinic', { acceptStateChanges: true, overwriteLocal: true })).doc).not.toBeNull()
    // The world retired an ID the library still uses: never allowed (old state could attach to it).
    const counter = lp.objects.find((o) => o.kind === 'prop')!
    const retired = ok(deletePrefabItems(doc, 'library/clinic', [counter.localId])).doc
    const reuse = plan(planPrefabUpdate(retired, lib2, 'library/clinic', { acceptStateChanges: true, overwriteLocal: true }))
    expect(reuse.reusedRetired).toEqual([counter.localId])
    expect(reuse.doc).toBeNull()
  })
})

describe('compound prefabs and groups (P1)', () => {
  const libDoc = withCompound(libraryWorld())
  const lib = libraryFromDocument(libDoc, OPTS)

  it('a compound saved in the library world: members relative to the pivot, footprint, catalog; the library lists it', () => {
    const c = lib.compounds.get('compound/clinic-yard')!
    expect(c).toMatchObject({ compoundId: 'compound/clinic-yard', contentVersion: 1, name: 'Phòng khám có sân', catalog: { group: 'public', architectureStyle: 'vietnamese' } })
    expect(c.instances.map((i) => i.prefabId)).toEqual(['library/clinic'])
    expect(c.objects.map((o) => `${o.kind}:${o.member}`)).toEqual(['surface:yard', 'surface:pond', 'prop:fence', 'tree:tree'])
    expect(lib.compoundPaths.get('compound/clinic-yard')).toBe(compoundPath('compound/clinic-yard'))
    expect(lib.issues).toEqual([])
    expect(validateCompoundDocument(c, 'x.json', { prefabs: new Set(lib.prefabs.keys()) })).toEqual([])
    // The records in the library world became a group linked to the compound.
    const g = documentGroups(libDoc).find((x) => x.compoundId === 'compound/clinic-yard')!
    expect(g).toMatchObject({ compoundId: 'compound/clinic-yard', source: { library: 'prefab-library', version: 1 } })
    expect(modifiedMembers(libDoc, g)).toEqual([])
    // The library world itself still validates (the game ignores compounds and groups).
    expect(errors(libDoc)).toEqual([])
  })

  it('compound files are checked: unknown prefab, duplicate member, bad kind, no member', () => {
    const c = lib.compounds.get('compound/clinic-yard')!
    const codes = (x: unknown) => validateCompoundDocument(x, 'x.json', { prefabs: new Set(lib.prefabs.keys()) }).map((i) => i.code)
    expect(codes({ ...c, instances: [{ ...c.instances[0], prefabId: 'nope/x' }] })).toContain('unknown-prefab')
    expect(codes({ ...c, objects: [...c.objects, c.objects[0]] })).toContain('duplicate-id')
    expect(codes({ ...c, objects: [{ ...c.objects[0], kind: 'door' }] })).toContain('schema')
    expect(codes({ ...c, instances: [], objects: [] })).toContain('empty-compound')
  })

  it('placed in a world: prefabs imported, ordinary records, a group with the pinned version; turned about its pivot', () => {
    const at = { x: 0, z: 0 }
    const r = ok(placeCompound(blank(), lib, 'compound/clinic-yard', at, 1))
    const doc = r.doc
    expect(errors(doc)).toEqual([])
    expect(doc.prefabs.get('library/clinic')!.source!.id).toBe('library/clinic')
    const g = documentGroups(doc)[0]
    expect(g).toMatchObject({ groupId: 'clinic-yard-1', compoundId: 'compound/clinic-yard', pivot: at, quarterTurns: 1, source: { version: 1 } })
    expect(r.selection).toEqual(g.members.map((m) => m.id))
    expect(g.members.map((m) => m.member)).toEqual(['clinic', 'yard', 'pond', 'fence', 'tree'])
    // Every member where the compound says, turned a quarter about the pivot.
    const c = lib.compounds.get('compound/clinic-yard')!
    for (const m of c.objects) {
      const id = g.members.find((x) => x.member === m.member)!.id
      expect(worldAnchor(doc, findRecord(doc, id)!)).toEqual(turnAbout({ x: m.position.x, z: m.position.z }, at, 1))
    }
    const yard = findRecord(doc, g.members.find((x) => x.member === 'yard')!.id)!.record as unknown as SurfaceObject
    const def = c.objects.find((o) => o.member === 'yard') as unknown as SurfaceObject
    expect(yard.size).toEqual([def.size[1], def.size[0]])
    expect(modifiedMembers(doc, g)).toEqual([])
    // The game sees plain records: the pond still blocks.
    expect(resolvedRecords(doc).flatMap((x) => x.parts.walls ?? []).some((w) => w.hidden)).toBe(true)
  })

  it('select, move, turn, duplicate and delete act on the whole group; edits of one member mark it modified', () => {
    let doc = ok(placeCompound(blank(), lib, 'compound/clinic-yard', { x: -12, z: 14 }, 0)).doc
    const g0 = documentGroups(doc)[0]
    const ids = g0.members.map((m) => m.id)
    expect(expandToGroups(doc, [ids[2]]).sort()).toEqual([...ids].sort())
    expect(fullGroups(doc, ids)).toHaveLength(1)
    // Move: the pivot follows, nothing counts as edited.
    doc = ok(moveRecords(doc, ids, { x: 3, z: -1 })).doc
    let g = documentGroups(doc)[0]
    expect(g.pivot).toEqual({ x: -9, z: 13 })
    expect(modifiedMembers(doc, g)).toEqual([])
    // Turn: members go around the pivot and turn themselves; still unmodified.
    const before = ids.map((id) => worldAnchor(doc, findRecord(doc, id)!))
    doc = ok(rotateRecords(doc, ids, 1)).doc
    g = documentGroups(doc)[0]
    expect(g.quarterTurns).toBe(1)
    ids.forEach((id, i) => expect(worldAnchor(doc, findRecord(doc, id)!)).toEqual(turnAbout(before[i], g.pivot, 1)))
    expect(modifiedMembers(doc, g)).toEqual([])
    expect(errors(doc)).toEqual([])
    // Duplicate: a second group with its own records.
    const dup = ok(duplicateRecords(doc, ids, { x: 20, z: 0 }))
    const groups = documentGroups(dup.doc)
    expect(groups.map((x) => x.groupId)).toEqual(['clinic-yard-1', 'clinic-yard-2'])
    expect(groups[1].members.map((m) => m.id)).toEqual(dup.selection)
    expect(groups[1].pivot).toEqual({ x: 11, z: 13 })
    expect(modifiedMembers(dup.doc, groups[1])).toEqual([])
    // One member edited by hand (Alt+click edits a child): modified.
    const edited = ok(updateRecord(doc, ids[3], { color: '#112233' })).doc
    expect(modifiedMembers(edited, documentGroups(edited)[0])).toEqual([ids[3]])
    expect(groupMemberStates(edited, documentGroups(edited)[0]).find((m) => m.id === ids[3])!.state).toBe('modified')
    // A member moved alone is modified; the group pivot stays.
    const nudged = ok(moveRecords(doc, [ids[4]], { x: 1, z: 0 })).doc
    expect(documentGroups(nudged)[0].pivot).toEqual(g.pivot)
    expect(modifiedMembers(nudged, documentGroups(nudged)[0])).toEqual([ids[4]])
    // Deleting a member drops it from the group; deleting all drops the group and the file.
    const less = ok(deleteRecords(doc, [ids[4]])).doc
    expect(documentGroups(less)[0].members.map((m) => m.id)).toEqual(ids.slice(0, 4))
    const none = ok(deleteRecords(doc, ids)).doc
    expect(documentGroups(none)).toEqual([])
    expect(none.extras.has(GROUPS_FILE)).toBe(false)
    // Ungroup: the records stay, the group goes.
    const loose = ok(ungroup(doc, 'clinic-yard-1')).doc
    expect(documentGroups(loose)).toEqual([])
    expect(ids.every((id) => findRecord(loose, id))).toBe(true)
  })

  it('undo restores the group with the records; groups and compounds survive a content pack', () => {
    const start = blank()
    let state = initialEditState(start)
    state = applyCommand(state, 'Đặt compound', placeCompound(start, lib, 'compound/clinic-yard', { x: 2, z: 2 }, 0)).state
    const placed = state.doc
    state = applyCommand(state, 'Xoay', rotateRecords(placed, documentGroups(placed)[0].members.map((m) => m.id), 1)).state
    expect(documentGroups(state.doc)[0].quarterTurns).toBe(1)
    state = undo(state)
    expect(state.doc).toBe(placed)
    expect(documentGroups(state.doc)[0].quarterTurns).toBe(0)
    state = undo(state)
    expect(documentGroups(state.doc)).toEqual([])
    const back = parsePack(exportPack(placed), OPTS)
    if (!back.ok) throw new Error(back.error)
    expect(documentGroups(back.doc)).toEqual(documentGroups(placed))
    const libBack = parsePack(exportPack(libDoc), OPTS)
    if (!libBack.ok) throw new Error(libBack.error)
    expect(libraryFromDocument(libBack.doc, OPTS).compounds.get('compound/clinic-yard')).toEqual(lib.compounds.get('compound/clinic-yard'))
  })

  it('Ctrl+G groups a selection; a group can be saved as a compound (version bumps on change)', () => {
    let doc = ok(placeRecord(blank(), 'ground/lawn', { x: 8, z: 8 })).doc
    doc = ok(placeRecord(doc, 'object/tree', { x: 8, z: 8 })).doc
    const r = ok(groupRecords(doc, ['c0_0/objects/lawn-1', 'c0_0/objects/tree-1'], 'Góc vườn'))
    const g = documentGroups(r.doc)[0]
    expect(g).toMatchObject({ groupId: 'goc-vuon-1', name: 'Góc vườn', pivot: { x: 8, z: 8 }, quarterTurns: 0 })
    expect(groupRecords(r.doc, ['c0_0/objects/lawn-1'], 'x').ok).toBe(false)
    const saved = ok(saveCompound(r.doc, g.members.map((m) => m.id), { compoundId: 'compound/garden-corner', name: 'Góc vườn' })).doc
    const c = saved.extras.get(compoundPath('compound/garden-corner')) as CompoundDocument
    expect(c.contentVersion).toBe(1)
    expect(c.objects.map((o) => o.position)).toEqual([{ x: 0, z: 0 }, { x: 0, z: 0 }])
    expect(documentGroups(saved)[0]).toMatchObject({ groupId: 'goc-vuon-1', compoundId: 'compound/garden-corner' })
    const same = ok(saveCompound(saved, g.members.map((m) => m.id), { compoundId: 'compound/garden-corner', name: 'Góc vườn' })).doc
    expect((same.extras.get(compoundPath('compound/garden-corner')) as CompoundDocument).contentVersion).toBe(1)
    const moved = ok(moveRecords(saved, ['c0_0/objects/tree-1'], { x: 2, z: 0 })).doc
    const again = ok(saveCompound(moved, g.members.map((m) => m.id), { compoundId: 'compound/garden-corner', name: 'Góc vườn' })).doc
    expect((again.extras.get(compoundPath('compound/garden-corner')) as CompoundDocument).contentVersion).toBe(2)
    // Roads, zones and spawns are not compound members.
    expect(saveCompound(doc, ['c0_0/spawns/player-start'], { compoundId: 'compound/x', name: 'x' }).ok).toBe(false)
  })

  it('compound updates: unmodified members replaced in place, edits kept, new members added, dropped stateful IDs need consent', () => {
    let doc = ok(placeCompound(blank(), lib, 'compound/clinic-yard', { x: 2, z: 2 }, 0)).doc
    const g = documentGroups(doc)[0]
    const id = (m: string) => g.members.find((x) => x.member === m)!.id
    doc = ok(updateRecord(doc, id('fence'), { color: '#112233' })).doc
    expect(compoundGroupOutdated(g, lib)).toBe(false)
    // v2 in the library: the tree moves, a lawn is added.
    let lib2Doc = ok(moveRecords(libDoc, ['c1_-1/objects/tree-1'], { x: -2, z: 0 })).doc
    lib2Doc = ok(placeRecord(lib2Doc, 'ground/lawn', { x: 44, z: -20 })).doc
    const libGroup = documentGroups(lib2Doc).find((x) => x.compoundId === 'compound/clinic-yard')!
    lib2Doc = ok(saveCompound(lib2Doc, [...libGroup.members.map((m) => m.id), 'c1_-1/objects/lawn-1'], { compoundId: 'compound/clinic-yard', name: 'Phòng khám có sân' })).doc
    const lib2 = libraryFromDocument(lib2Doc, OPTS)
    expect(lib2.compounds.get('compound/clinic-yard')!.contentVersion).toBe(2)
    expect(compoundGroupOutdated(documentGroups(doc)[0], lib2)).toBe(true)
    const p = plan(planCompoundUpdate(doc, lib2, 'clinic-yard-1'))
    expect(p).toMatchObject({ fromVersion: 1, toVersion: 2, keptModified: ['fence'], added: ['lawn'], removed: [], removedStateful: [], blockers: [] })
    expect(p.replaced.sort()).toEqual(['clinic', 'pond', 'tree', 'yard'])
    const after = p.doc!
    expect(findRecord(after, id('fence'))!.record.color).toBe('#112233')
    expect(worldAnchor(after, findRecord(after, id('tree'))!).x).toBe(worldAnchor(doc, findRecord(doc, id('tree'))!).x - 2)
    const g2 = documentGroups(after)[0]
    expect(g2.source!.version).toBe(2)
    expect(g2.members.map((m) => m.member)).toContain('lawn')
    expect(statefulEntityIds(after)).toEqual(statefulEntityIds(doc))
    expect(errors(after)).toEqual([])
    // v3 drops the clinic: its doors and containers leave the world only with consent.
    const noClinic = ok(saveCompound(lib2Doc, documentGroups(lib2Doc).find((x) => x.compoundId === 'compound/clinic-yard')!.members.map((m) => m.id).filter((x) => x.includes('/objects/')), { compoundId: 'compound/clinic-yard', name: 'Sân' })).doc
    const lib3 = libraryFromDocument(noClinic, OPTS)
    const blocked = plan(planCompoundUpdate(after, lib3, 'clinic-yard-1'))
    expect(blocked.removed).toContain(g.members[0].member)
    expect(blocked.removedStateful.length).toBeGreaterThan(0)
    expect(blocked.doc).toBeNull()
    const accepted = plan(planCompoundUpdate(after, lib3, 'clinic-yard-1', { acceptStateChanges: true }))
    expect(findRecord(accepted.doc!, id('clinic'))).toBeNull()
    expect(accepted.doc!.world.retiredIds).toContain(id('clinic'))
  })
})

describe('library content in the repo (P1)', () => {
  it('every library entry validates and a blank world takes every library prefab cleanly', () => {
    const lib: SharedLibrary = libraryFromFiles(bundledWorldFiles('prefab-library'), OPTS)!
    let doc = blank()
    for (const id of lib.prefabs.keys()) doc = ok(importPrefab(doc, lib, id, doc.prefabs.has(id) ? freePrefabId(doc, id) : id)).doc
    expect(errors(doc)).toEqual([])
    for (const c of lib.compounds.keys()) expect(placeCompound(doc, lib, c, { x: 0, z: 0 }, 0).ok).toBe(true)
  })
})

describe('architecture style in the generator (P1, D7)', () => {
  const lib = libraryFromFiles(bundledWorldFiles('prefab-library'), OPTS)!
  const catalog = libraryCatalog(bundledWorldFiles('prefab-library'))!
  const layout = importGeoJsonLayout(TOWN, { layoutId: 'p1-style', name: 'P1 style' })
  const styleOf = (id: string) => lib.prefabs.get(id)?.catalog?.architectureStyle ?? 'generic'
  const count = (params: Partial<PlanParams>) => {
    const plan = placeBuildings(planLayout(layout, { seed: 3, ...params }), catalog).plan
    const built = plan.parcels.flatMap((q) => (q.build?.prefabId ? [q.build.prefabId] : []))
    return { plan, built, vietnamese: built.filter((id) => styleOf(id) === 'vietnamese').length, american: built.filter((id) => styleOf(id) === 'american').length }
  }

  it('no style: the WG3 weights exactly; a style prefers its prefabs and never changes the parcels', () => {
    const none = count({})
    const vn = count({ architectureStyle: 'vietnamese' })
    const us = count({ architectureStyle: 'american' })
    expect(vn.plan.parcels.map((q) => q.id)).toEqual(none.plan.parcels.map((q) => q.id))
    expect(vn.vietnamese).toBeGreaterThan(none.vietnamese)
    expect(us.american).toBeGreaterThan(none.american)
    expect(vn.plan.params.architectureStyle).toBe('vietnamese')
    // Per zone: only the named zone follows it.
    const zoned = count({ styleByZone: { residential: 'american' } })
    expect(zoned.plan.parcels.filter((q) => q.zone !== 'residential').map((q) => q.build)).toEqual(none.plan.parcels.filter((q) => q.zone !== 'residential').map((q) => q.build))
  })

  it('weights: own style ×4, generic ×1, another style ×0.25', () => {
    const tube = catalog.prefabs.find((p) => p.entry.prefabId === 'library/tube-house')!
    const clinic = catalog.prefabs.find((p) => p.entry.prefabId === 'library/clinic')!
    expect(styledWeight(tube, undefined)).toBe(tube.placement.weight)
    expect(styledWeight(tube, 'vietnamese')).toBe(tube.placement.weight * STYLE_WEIGHT.match)
    expect(styledWeight(tube, 'american')).toBe(tube.placement.weight * STYLE_WEIGHT.other)
    expect(styledWeight(clinic, 'american')).toBe(clinic.placement.weight * STYLE_WEIGHT.generic)
  })
})

describe('saving compounds never breaks other groups (P1)', () => {
  it('a selection holding part of another group is refused', () => {
    const lib = libraryFromDocument(libraryWorld(), OPTS)
    let doc = ok(placeCompound(blank(), lib, 'compound/garden-house', { x: -10, z: 10 }, 0)).doc
    doc = ok(placeRecord(doc, 'object/tree', { x: 20, z: -20 })).doc
    const g = documentGroups(doc)[0]
    const r = saveCompound(doc, [g.members[0].id, 'c0_-1/objects/tree-1'], { compoundId: 'compound/x', name: 'x' })
    expect(r.ok).toBe(false)
    // The whole group plus a loose record: allowed, the tree joins the group.
    const all = ok(saveCompound(doc, [...g.members.map((m) => m.id), 'c0_-1/objects/tree-1'], { compoundId: 'compound/x', name: 'x' })).doc
    expect(documentGroups(all)).toHaveLength(1)
    expect(documentGroups(all)[0].members.map((m) => m.id)).toContain('c0_-1/objects/tree-1')
  })
})
