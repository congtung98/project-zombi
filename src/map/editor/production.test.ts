import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, loadWorld, REGISTERED_LOOT_TABLES } from '../content'
import { deepCheck } from '../analysis'
import { checkWorldDocuments } from '../validate'
import { GameRuntime } from '../../game/core/runtime'
import { GENERATOR_NAME, GENERATOR_VERSION, generateTown, type Catalog } from '../tools/generator'
import { moveRecords, placeInstance, placeRecord, updateRecord, type CommandResult } from './commands'
import { blankDocument, documentFiles, findRecord, forkDocument, resolvedRecords, statefulEntityIds, worldAnchor, type MapDocument } from './document'
import { documentFromFiles, exportPack, parsePack } from './pack'
import { playPointProblem, playtestFiles } from './playtest'
import { updatePrefabItem } from './prefabCommands'

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

function catalog(): Catalog {
  const doc = neighbourhood()
  return { id: 'neighborhood-50@1', prefabs: doc.world.prefabs.map((entry) => ({ entry, doc: doc.prefabs.get(entry.prefabId)! })) }
}

function blank(): MapDocument {
  return blankDocument({ worldId: 'm6-test', name: 'M6', prefabs: catalog().prefabs })
}

function issuesOf(doc: MapDocument) {
  const files = new Map(documentFiles(doc))
  return checkWorldDocuments((p) => files.get(p), OPTS).issues
}

const codes = (doc: MapDocument) => deepCheck(doc).issues.map((i) => i.code)
const gen = (seed: number, blocksX = 2, blocksZ = 2) => generateTown({ worldId: `gen-${seed}`, name: `Gen ${seed}`, seed, blocksX, blocksZ }, catalog(), OPTS)

describe('offline generator (M6)', () => {
  it('is deterministic for the same seed, catalog and version, and differs across seeds', () => {
    const a = exportPack(gen(42))
    expect(exportPack(gen(42))).toBe(a)
    expect(exportPack(gen(43))).not.toBe(a)
    const g = gen(42).world.generator!
    expect(g).toEqual({ name: GENERATOR_NAME, version: GENERATOR_VERSION, seed: 42, params: { blocksX: 2, blocksZ: 2, layout: 'grid', trees: 0.5 }, catalog: 'neighborhood-50@1' })
  })

  it('produces valid worlds of every size with no deep-check warnings', () => {
    for (const [seed, bx, bz] of [
      [1, 1, 1],
      [2, 2, 1],
      [3, 2, 2],
      [4, 3, 2],
      [5, 4, 4],
      [6, 1, 3],
    ]) {
      const doc = gen(seed, bx, bz)
      expect(issuesOf(doc).filter((i) => i.severity === 'error'), `seed ${seed}`).toEqual([])
      expect(deepCheck(doc).issues, `seed ${seed}`).toEqual([])
      expect(resolvedRecords(doc).filter((r) => r.category === 'instances').length).toBeGreaterThan(0)
    }
    expect(() => generateTown({ worldId: 'x', name: 'x', seed: 1, blocksX: 17, blocksZ: 1 }, catalog())).toThrow()
  })

  it('turns every building so its door faces the street of its lot', () => {
    const doc = gen(9, 3, 3)
    for (const r of resolvedRecords(doc)) {
      const b = r.parts.buildings?.[0]
      if (!b) continue
      const door = r.parts.doors![0]
      const north = Number(r.id.split('/').pop()!.split('-').pop()) < 2
      expect(north ? door.center.z < b.center.z : door.center.z > b.center.z, r.id).toBe(true)
    }
  })

  it('a generated world opens in the editor, can be edited, and plays in the game', () => {
    const back = parsePack(exportPack(gen(42)), OPTS)
    if (!back.ok) throw new Error(back.error)
    const house = resolvedRecords(back.doc).find((r) => r.category === 'instances')!
    const edited = ok(moveRecords(back.doc, [house.id], { x: 0.5, z: 0 })).doc
    expect(issuesOf(edited).filter((i) => i.severity === 'error')).toEqual([])
    const files = new Map(documentFiles(edited))
    const { map } = loadWorld((p) => files.get(p))
    const rt = new GameRuntime(map)
    rt.newGame(3)
    rt.pathBudget.maxPathMs = Infinity
    rt.setLineOfSightOverride(null)
    for (let i = 0; i < 900; i++) rt.tick(1 / 60)
    expect(rt.zombies.size).toBeGreaterThan(0)
    expect([...rt.world.containers.values()].some((c) => c.items.slots.some(Boolean))).toBe(true)
    expect(rt.player.alive).toBe(true)
  })
})

describe('deep checks (M6)', () => {
  it('the neighbourhood has no deep-check warnings', () => {
    const r = deepCheck(neighbourhood())
    expect(r.issues).toEqual([])
    expect(r.ms).toBeLessThan(2000)
  })

  it('flags a container walled in, a fenced-off spawn and zone, overlaps and an indoor spawn', () => {
    let doc = blank()
    // A scrap pile at (10, 10) boxed in by four walls: not reachable within interaction range.
    doc = ok(placeRecord(doc, 'object/scrap', { x: 10, z: 10 })).doc
    for (const [from, to] of [
      [{ x: 8, z: 8 }, { x: 12, z: 8 }],
      [{ x: 8, z: 12 }, { x: 12, z: 12 }],
      [{ x: 8, z: 8 }, { x: 8, z: 12 }],
      [{ x: 12, z: 8 }, { x: 12, z: 12 }],
    ]) doc = ok(placeRecord(doc, 'object/wall', from, to)).doc
    // A zombie spawn and a zone in another walled pen.
    for (const [from, to] of [
      [{ x: 16, z: 16 }, { x: 24, z: 16 }],
      [{ x: 16, z: 24 }, { x: 24, z: 24 }],
      [{ x: 16, z: 16 }, { x: 16, z: 24 }],
      [{ x: 24, z: 16 }, { x: 24, z: 24 }],
    ]) doc = ok(placeRecord(doc, 'object/wall', from, to)).doc
    doc = ok(placeRecord(doc, 'spawn/zombie', { x: 20, z: 20 })).doc
    doc = ok(placeRecord(doc, 'zone/circle', { x: 20, z: 21 })).doc
    // A house with a crate pushed into its wall, and a zombie spawn in its living room.
    doc = ok(placeInstance(doc, 'building/house', { x: -12, z: 12 }, 0)).doc
    const wall = resolvedRecords(doc).find((r) => r.id === 'c-1_0/house-1')!.parts.walls!.find((w) => w.id.endsWith('/wall-s-0'))!
    doc = ok(placeRecord(doc, 'object/crate', { x: wall.position.x + 2, z: wall.position.z + 0.3 })).doc
    doc = ok(placeRecord(doc, 'spawn/zombie', { x: -14, z: 12 })).doc
    expect(issuesOf(doc).filter((i) => i.severity === 'error')).toEqual([])

    const found = deepCheck(doc).issues
    const by = (code: string) => found.filter((i) => i.code === code).map((i) => i.entityId)
    expect(by('interaction-unreachable')).toEqual(['c0_0/objects/scrap-1'])
    expect(by('spawn-unreachable')).toEqual(['c0_0/spawns/zombie-1'])
    expect(by('zone-unreachable')).toEqual(['c0_0/zones/zone-1'])
    expect(by('spawn-indoors')).toEqual(['c-1_0/spawns/zombie-1'])
    expect(by('collider-overlap')).toHaveLength(1)
    expect(found.find((i) => i.code === 'collider-overlap')!.message).toContain('c-1_0/objects/crate-1')
    expect(found.every((i) => i.severity === 'warning' && i.path.includes('#/'))).toBe(true)
  })

  it('flags a building container outside every room of its building', () => {
    let doc = ok(placeInstance(blank(), 'building/house', { x: 12, z: 12 }, 0)).doc
    expect(codes(doc)).toEqual([])
    doc = ok(updatePrefabItem(doc, 'building/house', 'room-living', { bounds: { minX: -4.5, minZ: -3.5, maxX: 1, maxZ: 2 } })).doc
    const found = deepCheck(doc).issues.filter((i) => i.code === 'container-outside-room')
    expect(found.map((i) => i.entityId)).toEqual(['c0_0/house-1/kitchen'])
  })
})

describe('play from here (M6)', () => {
  it('accepts free ground inside the play area and refuses colliders or points outside', () => {
    const doc = neighbourhood()
    const spawn = findRecord(doc, doc.world.playerSpawn)!
    expect(playPointProblem(doc, worldAnchor(doc, spawn))).toBeNull()
    expect(playPointProblem(doc, { x: 30, z: 0 })).toMatch(/ngoài vùng chơi/)
    const wall = resolvedRecords(doc).find((r) => r.id === 'c-1_-1/safehouse')!.parts.walls![0]
    expect(playPointProblem(doc, { x: wall.position.x, z: wall.position.z })).toMatch(/nằm trong c-1_-1\/safehouse/)
  })

  it('sends an immutable snapshot equal to the export', () => {
    const doc = neighbourhood()
    const files = playtestFiles(doc)
    expect(Object.entries(files)).toEqual(documentFiles(doc))
    ;(files['world.json'] as { name: string }).name = 'changed'
    expect(doc.world.name).toBe('Khu phố 50 m')
    // Editing a document never changes a snapshot already taken.
    const snap = playtestFiles(doc)
    const edited = ok(updateRecord(doc, 'c0_0/objects/house-scrap', { name: 'X' })).doc
    expect(JSON.stringify(snap)).not.toContain('"name":"X"')
    expect(edited).not.toBe(doc)
  })
})

describe('save as new world', () => {
  it('copies the content under a new worldId as an unpublished world and leaves the source alone', () => {
    const doc = neighbourhood()
    const before = exportPack(doc)
    const copy = forkDocument(doc, 'lab', 'Lab')
    expect(exportPack(doc)).toBe(before)
    expect(copy.world).toMatchObject({ worldId: 'lab', name: 'Lab', contentVersion: 1 })
    expect(copy.world.retiredIds).toEqual(doc.world.retiredIds)
    expect(copy.chunks).toBe(doc.chunks)
    expect(copy.prefabs).toBe(doc.prefabs)
    // The source's save migrations convert that world's old saves only.
    expect([...doc.extras.keys()].some((p) => p.startsWith('migrations/'))).toBe(true)
    expect([...copy.extras.keys()]).toEqual([])
    expect(statefulEntityIds(copy)).toEqual(statefulEntityIds(doc))
    expect(issuesOf(copy).filter((i) => i.severity === 'error')).toEqual([])
    const back = parsePack(exportPack(copy), OPTS)
    if (!back.ok) throw new Error(back.error)
    expect(back.doc.world.worldId).toBe('lab')
    const files = new Map(documentFiles(copy))
    expect(loadWorld((p) => files.get(p)).map.id).toBe('lab')
  })

  it('drops generator provenance, keeps an edited copy playable', () => {
    const src = gen(7)
    expect(src.world.generator).toBeDefined()
    const copy = forkDocument(src, 'gen-copy', 'Copy')
    expect(copy.world.generator).toBeUndefined()
    expect(src.world.generator).toBeDefined()
    const house = resolvedRecords(copy).find((r) => r.category === 'instances')!
    const edited = ok(moveRecords(copy, [house.id], { x: 0.5, z: 0 })).doc
    expect(issuesOf(edited).filter((i) => i.severity === 'error')).toEqual([])
    const files = new Map(documentFiles(edited))
    const rt = new GameRuntime(loadWorld((p) => files.get(p)).map)
    rt.newGame(3)
    expect(rt.player.alive).toBe(true)
  })
})
