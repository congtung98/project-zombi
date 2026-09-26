import { describe, expect, it } from 'vitest'
import legacyV1 from '../../game/systems/fixtures/phase1-v1.json'
import lightFixture from '../../game/systems/fixtures/phase2-light-v7.json'
import { bundledWorldFiles, loadWorld, REGISTERED_LOOT_TABLES } from '../content'
import { checkWorldDocuments } from '../validate'
import { contentMigrationPath, planContentMigration, statefulIds, type ContentMigration } from '../contentMigration'
import { GameRuntime } from '../../game/core/runtime'
import { GAME_CONFIG } from '../../game/core/config'
import { generateContainerLoot } from '../../game/systems/loot'
import { LOOT_TABLES } from '../../game/world/lootTables'
import { mapStatefulIds, validateSaveGame } from '../../game/systems/save'
import { backupSlotFor } from '../../game/systems/saveStorage'
import { NEIGHBORHOOD_MAP, type MapData } from '../../game/world/mapData'
import { SAVE_SCHEMA_VERSION, type SaveGame } from '../../types/save'
import { deleteRecords, placeInstance, updateWorld, type CommandResult } from './commands'
import { documentFiles, type MapDocument } from './document'
import { contentChanges, documentStatefulIds, migrationOf, setMigrationRename, suggestRenames, writeContentMigration } from './migration'
import { documentFromFiles } from './pack'
import { updatePrefabItem } from './prefabCommands'

const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
const ID = 'neighborhood-50'

function ok(r: CommandResult): Extract<CommandResult, { ok: true }> {
  if (!r.ok) throw new Error(r.error)
  return r
}

function neighbourhood(): MapDocument {
  const r = documentFromFiles(bundledWorldFiles(ID), OPTS)
  if (!r.ok) throw new Error(r.error)
  return r.doc
}

function issuesOf(doc: MapDocument) {
  const files = new Map(documentFiles(doc))
  return checkWorldDocuments((p) => {
    if (!files.has(p)) throw new Error(`missing ${p}`)
    return files.get(p)
  }, OPTS).issues
}

function mapOf(doc: MapDocument): MapData {
  const files = new Map(documentFiles(doc))
  return loadWorld((p) => {
    if (!files.has(p)) throw new Error(`missing ${p}`)
    return files.get(p)
  }).map
}

/** A free spot for one more house in the neighbourhood (no validation error, no overlap). */
function withNewHouse(doc: MapDocument): { doc: MapDocument; id: string } {
  for (const at of [{ x: 8, z: 14 }, { x: -6, z: 16 }, { x: 16, z: -8 }, { x: 6, z: 4 }, { x: -18, z: 6 }]) {
    const r = placeInstance(doc, 'building/house', at, 0)
    if (!r.ok) continue
    const errors = issuesOf(r.doc).filter((i) => i.severity === 'error')
    if (!errors.length) return { doc: r.doc, id: r.selection[0] }
  }
  throw new Error('no free spot for a house')
}

/**
 * Content v2 of the neighbourhood: one more house (door, containers, windows, lamps), the scrap
 * pile (a looted container) removed, the west zone removed, the house's living-room lamp renamed.
 */
function editedNeighbourhood() {
  const baseline = neighbourhood()
  let doc = baseline
  const house = withNewHouse(doc)
  doc = house.doc
  doc = ok(deleteRecords(doc, ['c0_0/objects/house-scrap', 'c-1_-1/zones/west'])).doc
  doc = ok(updatePrefabItem(doc, 'building/house', 'lamp-living', { localId: 'lamp-lounge' })).doc
  return { baseline, doc, house: house.id }
}

describe('content migrations: editor (M8)', () => {
  it('diffs the stateful IDs, suggests the prefab rename and writes the migration with contentVersion + 1', () => {
    const { baseline, doc, house } = editedNeighbourhood()
    const diff = contentChanges(baseline, doc)
    expect(diff.removed.containers).toEqual(['c0_0/objects/house-scrap'])
    expect(diff.removed.zones).toEqual(['c-1_-1/zones/west'])
    // Both instances of building/house rename their lamp; the new instance only adds.
    expect(diff.removed.lamps).toEqual(['c0_0/house/lamp-living'])
    expect(diff.added.lamps).toEqual(expect.arrayContaining(['c0_0/house/lamp-lounge', `${house}/lamp-lounge`, `${house}/lamp-bedroom`]))
    expect(diff.added.doors).toEqual([`${house}/door`, `${house}/door-bedroom`])
    const renames = suggestRenames(diff)
    expect(renames).toEqual({ 'c0_0/house/lamp-living': 'c0_0/house/lamp-lounge' })
    expect(issuesOf(doc).filter((i) => i.severity === 'error')).toEqual([])

    const migrated = ok(writeContentMigration(doc, baseline, renames)).doc
    expect(migrated.world.contentVersion).toBe(2)
    const file = migrationOf(migrated, 1)!
    expect(file).toMatchObject({ format: 'zombie-outbreak/content-migration', fromVersion: 1, toVersion: 2, renamed: renames })
    expect(file.ids).toEqual(documentStatefulIds(baseline))
    expect(file.ids).toEqual(mapStatefulIds(NEIGHBORHOOD_MAP))
    const issues = issuesOf(migrated)
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(issues.map((i) => i.code)).not.toContain('content-migration-missing')
    // Written again (e.g. after more edits): same step, same version.
    expect(ok(writeContentMigration(migrated, baseline, {})).doc.world.contentVersion).toBe(2)
    expect(migrationOf(ok(setMigrationRename(migrated, 1, 'c0_0/house/lamp-living', null)).doc, 1)!.renamed).toEqual({})
  })

  it('rejects renames that do not fit: kept IDs, other kinds, unknown targets, one target twice', () => {
    const { baseline, doc, house } = editedNeighbourhood()
    expect(writeContentMigration(doc, baseline, { 'c0_0/house/door': `${house}/lamp-lounge` }).ok).toBe(false)
    expect(writeContentMigration(doc, baseline, { 'c0_0/objects/house-scrap': `${house}/lamp-lounge` }).ok).toBe(false)
    expect(writeContentMigration(doc, baseline, { 'c0_0/house/lamp-living': 'c9_9/nowhere' }).ok).toBe(false)
    const migrated = ok(writeContentMigration(doc, baseline, { 'c0_0/house/lamp-living': 'c0_0/house/lamp-lounge' })).doc
    // Hand-edited file: the validator reports what the editor refuses.
    const bad = { ...migrationOf(migrated, 1)!, renamed: { 'c0_0/house/lamp-living': 'c0_0/house/lamp-bedroom' } }
    const broken = { ...migrated, extras: new Map(migrated.extras).set(contentMigrationPath(1), bad) }
    expect(issuesOf(broken).filter((i) => i.severity === 'error').map((i) => i.code)).toContain('content-migration-rename')
    // A version bump without a migration: saves of v1 will not load (warning).
    expect(issuesOf(ok(updateWorld(doc, { contentVersion: 2 })).doc).map((i) => i.code)).toContain('content-migration-missing')
  })
})

describe('content migrations: saves (M8)', () => {
  const { baseline, doc, house } = editedNeighbourhood()
  const v2 = ok(writeContentMigration(doc, baseline, suggestRenames(contentChanges(baseline, doc)))).doc
  const mapV2 = mapOf(v2)

  function v1Save(): SaveGame {
    const rt = new GameRuntime(NEIGHBORHOOD_MAP)
    rt.newGame(7)
    rt.world.lamps.set('c0_0/house/lamp-living', true)
    rt.world.lamps.set('c0_0/house/lamp-bedroom', true)
    rt.setDoorState('c0_0/house/door', 'open')
    const snap = rt.createSnapshot()
    // A zombie of the zone that goes away, and one sieging a door that stays.
    snap.zombies[0].zoneId = 'c-1_-1/zones/west'
    return snap
  }

  it('keeps kept and renamed state, seeds what is new, drops removed containers on the ground, reassigns zones', () => {
    const before = v1Save()
    const scrap = before.containers.find((c) => c.id === 'c0_0/objects/house-scrap')!
    const scrapItems = scrap.items.slots.filter(Boolean)
    expect(scrapItems.length).toBeGreaterThan(0)
    const original = JSON.stringify(before)
    const v = validateSaveGame(before, ID, mapV2)
    expect(JSON.stringify(before)).toBe(original)
    if (!v.ok) throw new Error(v.detail)
    expect(v).toMatchObject({ migrated: true, fromVersion: SAVE_SCHEMA_VERSION, contentFrom: 1 })
    const save = v.save
    expect(save.contentVersion).toBe(2)
    const lamps = Object.fromEntries(save.lighting.lamps.map((l) => [l.id, l.on]))
    expect(lamps['c0_0/house/lamp-lounge']).toBe(true)
    expect(lamps['c0_0/house/lamp-bedroom']).toBe(true)
    expect(lamps['c0_0/house/lamp-living']).toBeUndefined()
    expect(lamps[`${house}/lamp-lounge`]).toBe(false)
    expect(save.doors.find((d) => d.id === 'c0_0/house/door')!.state).toBe('open')
    for (const d of mapV2.doors.filter((x) => x.id.startsWith(`${house}/`))) expect(save.doors.find((s) => s.id === d.id)).toMatchObject({ state: d.initialState ?? 'closed' })
    // New containers seeded exactly like New Game.
    for (const c of mapV2.containers.filter((x) => x.id.startsWith(`${house}/`))) {
      const want = generateContainerLoot(c.loot ? LOOT_TABLES[c.loot] : undefined, save.worldSeed, c.id, GAME_CONFIG.inventory.containerSlots)
      expect(save.containers.find((s) => s.id === c.id)!.items).toEqual(want)
    }
    // The scrap pile's items lie where it stood, one bag each, item IDs unchanged.
    expect(save.containers.some((c) => c.id === scrap.id)).toBe(false)
    const at = NEIGHBORHOOD_MAP.containers.find((c) => c.id === scrap.id)!.position
    for (const item of scrapItems) {
      const bag = save.containers.find((c) => c.id === `drop:${item!.id}`)!
      expect(bag.items.slots).toEqual([item])
      expect(Math.hypot(bag.position!.x - at.x, bag.position!.z - at.z)).toBeLessThan(2)
    }
    expect(save.zombies[0].zoneId).not.toBe('c-1_-1/zones/west')
    expect(mapV2.zombieZones!.some((z) => z.id === save.zombies[0].zoneId)).toBe(true)
    // It loads, plays, and saves again as a plain v2 save.
    const rt = new GameRuntime(mapV2)
    rt.loadSnapshot(save)
    for (let i = 0; i < 60; i++) rt.tick(1 / 60)
    const again = validateSaveGame(rt.createSnapshot(), ID, mapV2)
    expect(again).toMatchObject({ ok: true, migrated: false })
  })

  it('moves a player that a new wall covers beside it', () => {
    const s = v1Save()
    const wall = mapV2.walls.find((w) => w.id.startsWith(`${house}/`) && w.position.y - w.size[1] / 2 < 1)!
    s.player.position = { x: wall.position.x, y: s.player.position.y, z: wall.position.z }
    const v = validateSaveGame(s, ID, mapV2)
    if (!v.ok) throw new Error(v.detail)
    const p = v.save.player.position
    const inside = Math.abs(p.x - wall.position.x) < wall.size[0] / 2 && Math.abs(p.z - wall.position.z) < wall.size[2] / 2
    expect(inside).toBe(false)
  })

  it('a siege on a kept door stays; legacy saves (v1, v7) reach v2 through content v1', () => {
    const doorId = NEIGHBORHOOD_MAP.doors.find((d) => d.id.startsWith('c0_-1/'))!.id
    const s = v1Save()
    s.zombies[1] = { ...s.zombies[1], ai: 'ATTACK_STRUCTURE', structureTargetId: doorId, lastKnownTarget: { x: 0, y: 0.9, z: 0 }, memorySource: 'sight', memoryAge: 1 }
    const siege = validateSaveGame(s, ID, mapV2)
    if (!siege.ok) throw new Error(siege.detail)
    expect(siege.save.zombies[1]).toMatchObject({ ai: 'ATTACK_STRUCTURE', structureTargetId: doorId })

    for (const fixture of [legacyV1, lightFixture]) {
      const v = validateSaveGame(structuredClone(fixture), ID, mapV2)
      if (!v.ok) throw new Error(v.detail)
      expect(v.save.contentVersion).toBe(2)
      expect(v.contentFrom).toBe(1)
      expect(v.fromVersion).toBe((fixture as { schemaVersion: number }).schemaVersion)
      expect(v.save.lighting.lamps.some((l) => l.id === 'c0_0/house/lamp-lounge')).toBe(true)
    }
  })

  it('composes steps (v1 → v2 → v3) and refuses what it cannot map', () => {
    // v3: the store's door gets a new local ID and no rename is recorded: it counts as removed + added.
    const storeDoor = mapV2.doors.find((d) => d.id.startsWith('c0_-1/store/'))!.id
    const localId = storeDoor.split('/').pop()!
    let v3 = ok(updatePrefabItem(v2, 'building/store', localId, { localId: 'door-main' })).doc
    const published = v2
    v3 = ok(writeContentMigration(v3, published, {})).doc
    expect(v3.world.contentVersion).toBe(3)
    expect(migrationOf(v3, 1)).not.toBeNull()
    const mapV3 = mapOf(v3)
    const s = v1Save()
    s.zombies[1] = { ...s.zombies[1], ai: 'ATTACK_STRUCTURE', structureTargetId: storeDoor, lastKnownTarget: { x: 0, y: 0.9, z: 0 }, memorySource: 'sight', memoryAge: 1 }
    const v = validateSaveGame(s, ID, mapV3)
    if (!v.ok) throw new Error(v.detail)
    expect(v.contentFrom).toBe(1)
    expect(v.save.contentVersion).toBe(3)
    // Renamed in v2 and still there in v3.
    expect(v.save.lighting.lamps.find((l) => l.id === 'c0_0/house/lamp-lounge')!.on).toBe(true)
    // The door was not renamed in the v3 step: its siege becomes a search.
    expect(v.save.zombies[1]).toMatchObject({ ai: 'SEARCH', structureTargetId: null })
    expect(v.save.doors.some((d) => d.id === storeDoor)).toBe(false)

    // Plan: composed targets.
    const plan = planContentMigration(mapV3.contentMigrations!, 1, mapStatefulIds(mapV3), 3)!
    expect(plan.target.get('c0_0/house/lamp-living')).toBe('c0_0/house/lamp-lounge')
    expect(plan.target.get('c0_0/objects/house-scrap')).toBeNull()
    expect(plan.target.get(storeDoor)).toBeNull()
    expect(planContentMigration(mapV3.contentMigrations!, 3, mapStatefulIds(mapV3), 3)).toBeNull()

    // Refused: a save of a newer revision, a missing step, IDs that do not match the old revision.
    expect(validateSaveGame({ ...v1Save(), contentVersion: 4 }, ID, mapV3)).toMatchObject({ ok: false, reason: 'incompatible' })
    const noSteps: MapData = { ...mapV3, contentMigrations: mapV3.contentMigrations!.filter((m) => m.fromVersion !== 1) }
    expect(validateSaveGame(v1Save(), ID, noSteps)).toMatchObject({ ok: false, reason: 'incompatible' })
    const foreign = v1Save()
    foreign.doors.push({ id: 'c9_9/nowhere/door', state: 'closed', hp: 100 })
    expect(validateSaveGame(foreign, ID, mapV3)).toMatchObject({ ok: false, reason: 'corrupt' })
  })

  it('backs up the pre-migration save under its content revision', () => {
    expect(backupSlotFor('slot-1', 8, 1)).toBe('slot-1.backup-v8-content-v1')
    expect(backupSlotFor('slot-1', 7)).toBe('slot-1.backup-v7')
  })

  it('runtime MapData carries the steps; statefulIds sorts and matches the save-side view', () => {
    expect(mapV2.contentMigrations!.map((m: ContentMigration) => m.fromVersion)).toEqual([1])
    const ids = statefulIds([{ doors: [{ id: 'b' }, { id: 'a' }], containers: [{ id: 'z', position: { x: 1, z: 2 } }], rooms: [{ lamp: null }, { lamp: { id: 'l' } }] }])
    expect(ids).toEqual({ doors: ['a', 'b'], containers: [{ id: 'z', position: { x: 1, z: 2 } }], windows: [], lamps: ['l'], zones: [] })
    expect(mapStatefulIds(mapV2)).toEqual(documentStatefulIds(v2))
  })
})
