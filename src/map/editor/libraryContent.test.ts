import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, loadWorld, REGISTERED_LOOT_TABLES } from '../content'
import { deepCheck } from '../analysis'
import { GameRuntime } from '../../game/core/runtime'
import { checkWorldDocuments } from '../validate'
import { MAX_STOREYS } from '../schema'
import { addChunk, fittedPlayArea, moveRecords, placeInstance, updateWorld, type CommandResult } from './commands'
import { blankDocument, documentFiles, type MapDocument } from './document'
import { importPrefab, libraryFromFiles, placeCompound } from './library'
import { documentFromFiles } from './pack'

/**
 * Prefab library P2–P5 content: every library prefab and compound on its own in an empty world must
 * validate without errors and pass the deep check without a warning: every door, container, lamp
 * switch and curtain reachable from the street, every flight usable, no container outside a room, no
 * two records colliding. Storeys stay within `MAX_STOREYS` (D4) and loot tables are registered (D5).
 */

const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
const lib = libraryFromFiles(bundledWorldFiles('prefab-library'), OPTS)!

function ok(r: CommandResult): Extract<CommandResult, { ok: true }> {
  if (!r.ok) throw new Error(r.error)
  return r
}

/** An empty 256 m world, the player spawn in a far corner. */
function empty(): MapDocument {
  let doc = blankDocument({ worldId: 'library-check', name: 'Library check', prefabs: [] })
  for (let cz = -4; cz <= 3; cz++) for (let cx = -4; cx <= 3; cx++) if (!doc.chunks.has(`c${cx}_${cz}`)) doc = ok(addChunk(doc, cx, cz)).doc
  doc = ok(updateWorld(doc, { playArea: fittedPlayArea(doc.world) })).doc
  doc = ok(moveRecords(doc, ['c0_0/spawns/player-start'], { x: -122, z: -122 })).doc
  return ok(moveRecords(doc, ['c-1_-1/spawns/zombie-1'], { x: -100, z: -100 })).doc
}

function check(doc: MapDocument) {
  const files = new Map(documentFiles(doc))
  const checked = checkWorldDocuments((p) => files.get(p), OPTS)
  const errors = checked.issues.filter((i) => i.severity === 'error')
  const warnings = checked.issues.filter((i) => i.severity === 'warning' && i.code !== 'outside-play-area')
  const deep = checked.docs ? deepCheck(checked.docs).issues : []
  return { errors: errors.map((i) => `${i.code} ${i.path}: ${i.message}`), warnings: warnings.map((i) => `${i.code} ${i.path}: ${i.message}`), deep: deep.map((i) => `${i.code} ${i.entityId}: ${i.message}`) }
}

describe('library content (P2–P5)', () => {
  it('the library world itself opens without errors', () => {
    const r = documentFromFiles(bundledWorldFiles('prefab-library'), OPTS)
    expect(r.ok && r.issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it.each([...lib.prefabs.keys()])('prefab %s passes validation and the deep check alone', (id) => {
    const p = lib.prefabs.get(id)!
    expect(p.building?.storeys ?? 1).toBeLessThanOrEqual(MAX_STOREYS)
    let doc = ok(importPrefab(empty(), lib, id)).doc
    doc = ok(placeInstance(doc, id, { x: 0, z: 0 }, 0)).doc
    expect(check(doc)).toEqual({ errors: [], warnings: [], deep: [] })
  })

  it.each([...lib.compounds.keys()])('compound %s passes validation and the deep check alone', (id) => {
    const doc = ok(placeCompound(empty(), lib, id, { x: 0, z: 0 }, 0)).doc
    expect(check(doc)).toEqual({ errors: [], warnings: [], deep: [] })
  })
})

describe('storeys of neighbouring buildings (M11b fix found by P2)', () => {
  it('each building storey keeps its own doors: a 3.2 m and a 3 m two-storey house side by side are both reachable upstairs', () => {
    let doc = ok(importPrefab(empty(), lib, 'house/villa')).doc
    doc = ok(importPrefab(doc, lib, 'house/suburban')).doc
    doc = ok(placeInstance(doc, 'house/villa', { x: 0, z: 0 }, 0)).doc
    doc = ok(placeInstance(doc, 'house/suburban', { x: 40, z: 0 }, 0)).doc
    expect(check(doc).deep).toEqual([])
    const files = new Map(documentFiles(doc))
    const map = loadWorld((p) => files.get(p)).map
    const rt = new GameRuntime(map)
    for (const d of map.doors) rt.navWorld.setDoorState(d.id, 'open')
    const at = (x: number, y: number, z: number) => rt.navWorld.componentAt({ x, y, z })
    const home = at(map.playerSpawn.x, 0, map.playerSpawn.z)
    // Upstairs rooms of both houses (behind their upper doors), one component with the street.
    expect(at(-4, 3.2, 3)).toBe(home)
    expect(at(36, 3, 3)).toBe(home)
  })
})
