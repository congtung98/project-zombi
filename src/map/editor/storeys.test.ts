import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, loadWorld, REGISTERED_LOOT_TABLES } from '../content'
import { checkWorldDocuments } from '../validate'
import { deepCheck } from '../analysis'
import type { PrefabDocument, QuarterTurns, StairsObject } from '../schema'
import { GameRuntime } from '../../game/core/runtime'
import { placeInstance, type CommandResult } from './commands'
import { blankDocument, documentFiles, type MapDocument } from './document'
import { documentFromFiles } from './pack'
import { createPrefab, itemsOnFloor, pickPrefabItem, placePrefabItem, prefabItems, TWO_STOREY_MIN, updatePrefab, updatePrefabItem } from './prefabCommands'
import { dragPrefabHandle, prefabItemHandles } from './handles'
import { climbDirection, defaultStairLength, levelOf, prefabFloorView, stairEnds, stairFromDrag } from './storeys'

/** M11c-2: storeys in the prefab editor (one storey at a time, flights by mouse, two-storey starter). */

const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
const P = 'building/m11c2-house'

function ok(r: CommandResult): Extract<CommandResult, { ok: true }> {
  if (!r.ok) throw new Error(r.error)
  return r
}

function blank(): MapDocument {
  const lib = documentFromFiles(bundledWorldFiles('neighborhood-50'), OPTS)
  if (!lib.ok) throw new Error(lib.error)
  return blankDocument({ worldId: 'm11c2-test', name: 'M11c-2', prefabs: lib.doc.world.prefabs.map((entry) => ({ entry, doc: lib.doc.prefabs.get(entry.prefabId)! })) })
}

function errorsOf(doc: MapDocument) {
  const files = new Map(documentFiles(doc))
  return checkWorldDocuments((p) => files.get(p), OPTS).issues.filter((i) => i.severity === 'error')
}

const twoStorey = (w = 10, d = 8) => ok(createPrefab(blank(), { prefabId: P, name: 'Nhà hai tầng', width: w, depth: d, shape: 'twoStorey' })).doc
const prefabOf = (doc: MapDocument): PrefabDocument => doc.prefabs.get(P)!

describe('storeys in the prefab editor (M11c-2)', () => {
  it('the two-storey starter is valid and plays: both storeys reachable through its flight, at every turn', () => {
    const doc = twoStorey()
    const prefab = prefabOf(doc)
    expect(prefab.building?.storeys).toBe(2)
    expect(errorsOf(doc)).toEqual([])
    expect(prefab.objects.filter((o) => o.kind === 'stairs')).toHaveLength(1)
    expect(prefab.rooms.map((r) => [r.localId, levelOf(r), !!r.lamp])).toEqual([
      ['room-1', 0, true],
      ['room-2', 1, true],
    ])
    for (const q of [0, 1, 2, 3] as QuarterTurns[]) {
      const placed = ok(placeInstance(doc, P, { x: 12, z: 12 }, q)).doc
      expect(errorsOf(placed)).toEqual([])
      // Deep check: the flight is usable and every door, lamp switch and curtain is in reach.
      expect(deepCheck(placed).issues, `turn ${q}`).toEqual([])
    }
    const files = new Map(documentFiles(ok(placeInstance(doc, P, { x: 12, z: 12 }, 0)).doc))
    const rt = new GameRuntime(loadWorld((p) => files.get(p)).map)
    expect([rt.navWorld.layers.length, rt.navWorld.stairs.length]).toEqual([2, 1])
  })

  it('the two-storey starter needs room for its flight', () => {
    expect(TWO_STOREY_MIN).toEqual({ width: 8, depth: 6 })
    expect(errorsOf(twoStorey(8, 6))).toEqual([])
    const small = createPrefab(blank(), { prefabId: P, name: 'Nhỏ', width: 7, depth: 6, shape: 'twoStorey' })
    expect(small.ok ? '' : small.error).toContain('8 × 6')
  })

  it('places on the active storey: walls, doors snapping to walls of that storey only, furniture, rooms', () => {
    let doc = twoStorey()
    // A partition upstairs, then a door on it: the door snaps to it (not to the ground walls).
    doc = ok(placePrefabItem(doc, P, 'structure/wall-run', { x: -5, z: 0 }, { x: 5, z: 0 }, 0, 1)).doc
    const wall = prefabOf(doc).objects.at(-1)!
    expect([wall.kind, levelOf(wall)]).toEqual(['wallRun', 1])
    doc = ok(placePrefabItem(doc, P, 'opening/door', { x: 2, z: 0.3 }, null, 0, 1)).doc
    const door = prefabOf(doc).objects.at(-1)!
    expect([door.kind, levelOf(door), 'position' in door && door.position]).toEqual(['door', 1, { x: 2, z: 0 }])
    // On the ground floor there is no wall at z 0: the door stays where it was clicked.
    doc = ok(placePrefabItem(doc, P, 'opening/door', { x: 2, z: 0.3 }, null, 0, 0)).doc
    const ground = prefabOf(doc).objects.at(-1)!
    expect([levelOf(ground), 'position' in ground && ground.position]).toEqual([0, { x: 2, z: 0.3 }])
    // Furniture and rooms take the storey; a ground-floor item has no `level` field at all.
    doc = ok(placePrefabItem(doc, P, 'container/wardrobe', { x: 3, z: 3 }, null, 0, 1)).doc
    expect(levelOf(prefabOf(doc).objects.at(-1)!)).toBe(1)
    doc = ok(placePrefabItem(doc, P, 'room/plain', { x: -4, z: 1 }, { x: 0, z: 4 }, 0, 1)).doc
    expect(levelOf(prefabOf(doc).rooms.at(-1)!)).toBe(1)
    doc = ok(placePrefabItem(doc, P, 'furniture/table', { x: 0, z: 2 }, null, 0, 0)).doc
    expect('level' in prefabOf(doc).objects.at(-1)!).toBe(false)
    // Trees only on the ground; no storey past the top.
    expect(placePrefabItem(doc, P, 'furniture/tree', { x: 0, z: 2 }, null, 0, 1).ok).toBe(false)
    expect(placePrefabItem(doc, P, 'furniture/table', { x: 0, z: 2 }, null, 0, 2).ok).toBe(false)
  })

  it('one storey at a time: its items are picked and listed, the flights reaching it show in its view', () => {
    const prefab = prefabOf(twoStorey())
    const items = prefabItems(prefab)
    expect(itemsOnFloor(items, 1).map((i) => i.key).sort()).toEqual(['lamp-2', 'room-2', 'wall-e-2', 'wall-n-2', 'wall-s-2', 'wall-w-2', 'win-2'])
    expect(itemsOnFloor(items, 0).map((i) => i.key)).toContain('stairs')
    // The same point picks the ground wall on storey 0 and the upper wall on storey 1.
    expect(pickPrefabItem(itemsOnFloor(items, 0), { x: 0, z: -4 })?.key).toBe('wall-n')
    expect(pickPrefabItem(itemsOnFloor(items, 1), { x: 0, z: -4 })?.key).toBe('wall-n-2')
    const upper = prefabFloorView(prefab, 1)
    expect(upper.objects.map((o) => o.localId).sort()).toEqual(['stairs', 'wall-e-2', 'wall-n-2', 'wall-s-2', 'wall-w-2', 'win-2'])
    expect(upper.rooms.map((r) => r.localId)).toEqual(['room-2'])
    expect(prefabFloorView(prefab, 0).objects.every((o) => levelOf(o) === 0)).toBe(true)
  })

  it('a flight by drag: from its foot towards its top, any direction; a click takes the default run', () => {
    for (const [to, dir] of [
      [{ x: 5, z: 0 }, { x: 1, z: 0 }],
      [{ x: -5, z: 0.5 }, { x: -1, z: 0 }],
      [{ x: 0.5, z: 5 }, { x: 0, z: 1 }],
      [{ x: 0, z: -5 }, { x: 0, z: -1 }],
    ] as const) {
      const s = stairFromDrag({ x: 0, z: 0 }, to, 3)
      expect(climbDirection(s.quarterTurns)).toEqual(dir)
      expect(s.length).toBe(5)
      expect(stairEnds(s).foot).toEqual({ x: 0, z: 0 })
    }
    expect(stairFromDrag({ x: 1, z: 1 }, null, 3)).toEqual({ position: { x: 3, z: 1 }, quarterTurns: 0, length: 4 })
    expect(defaultStairLength(3)).toBe(4)
    // Never steeper than 45° (at least the storey height), never longer than 12 m.
    expect(stairFromDrag({ x: 0, z: 0 }, { x: 2, z: 0 }, 3).length).toBe(3)
    expect(stairFromDrag({ x: 0, z: 0 }, { x: 30, z: 0 }, 3).length).toBe(12)
  })

  it('places flights with the mouse on storeys that have one above; drags their ends', () => {
    let doc = twoStorey()
    doc = ok(placePrefabItem(doc, P, 'structure/stairs', { x: 3, z: 3 }, { x: 3, z: -1 }, 0, 0)).doc
    const flight = prefabOf(doc).objects.at(-1) as StairsObject
    expect([flight.kind, levelOf(flight), flight.width, flight.length]).toEqual(['stairs', 0, 1.2, 4])
    expect(stairEnds(flight)).toEqual({ foot: { x: 3, z: 3 }, top: { x: 3, z: -1 } })
    expect(placePrefabItem(doc, P, 'structure/stairs', { x: 0, z: 0 }, null, 0, 1).ok).toBe(false) // top storey
    const single = ok(createPrefab(blank(), { prefabId: P, name: 'Một tầng' })).doc
    expect(placePrefabItem(single, P, 'structure/stairs', { x: 0, z: 0 }, null, 0, 0).ok).toBe(false)
    // Handles on both ends: the other end stays.
    expect(prefabItemHandles(prefabOf(doc), flight.localId).map((h) => [h.key, h.at])).toEqual([
      ['from', { x: 3, z: 3 }],
      ['to', { x: 3, z: -1 }],
    ])
    doc = ok(dragPrefabHandle(doc, P, flight.localId, 'to', { x: 3.4, z: -2 })).doc
    let moved = prefabOf(doc).objects.find((o) => o.localId === flight.localId) as StairsObject
    expect(stairEnds(moved)).toEqual({ foot: { x: 3, z: 3 }, top: { x: 3, z: -2 } })
    doc = ok(dragPrefabHandle(doc, P, flight.localId, 'from', { x: 3, z: 0 })).doc // too short: 3 m at least
    moved = prefabOf(doc).objects.find((o) => o.localId === flight.localId) as StairsObject
    expect([stairEnds(moved), moved.length]).toEqual([{ foot: { x: 3, z: 1 }, top: { x: 3, z: -2 } }, 3])
  })

  it('storeys: added freely, removed only when empty; tall enough; one storey drops the field', () => {
    let doc = twoStorey()
    doc = ok(updatePrefab(doc, P, { building: { storeys: 3 } })).doc
    expect(prefabOf(doc).building?.storeys).toBe(3)
    expect(errorsOf(doc)).toEqual([])
    const blocked = updatePrefab(doc, P, { building: { storeys: 1 } })
    expect(blocked.ok ? '' : blocked.error).toContain('tầng 2')
    expect(updatePrefab(doc, P, { building: { storeys: 5 } }).ok).toBe(false)
    expect(updatePrefab(doc, P, { building: { height: 2.4 } }).ok).toBe(false)
    // Emptied (ground-floor-only house): back to one storey, `storeys` dropped from the file.
    const single = ok(createPrefab(blank(), { prefabId: P, name: 'Một tầng' })).doc
    const two = ok(updatePrefab(single, P, { building: { storeys: 2 } })).doc
    const back = ok(updatePrefab(two, P, { building: { storeys: 1 } })).doc
    expect('storeys' in prefabOf(back).building!).toBe(false)
    // An item moved to another storey (Inspector "Tầng").
    const moved = ok(updatePrefabItem(twoStorey(), P, 'room-1', { level: 1 })).doc
    expect(levelOf(prefabOf(moved).rooms.find((r) => r.localId === 'room-1')!)).toBe(1)
  })
})
