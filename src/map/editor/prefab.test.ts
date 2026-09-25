import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, loadWorld, REGISTERED_LOOT_TABLES } from '../content'
import { checkWorldDocuments } from '../validate'
import { resolveInstance, wallRunBoxes } from '../resolve'
import type { QuarterTurns, WallRunObject } from '../schema'
import { GameRuntime } from '../../game/core/runtime'
import { validateSaveGame } from '../../game/systems/save'
import { DOOR_HEIGHT } from '../../game/world/buildings'
import { placeInstance, type CommandResult } from './commands'
import { blankDocument, documentFiles, instancesOf, statefulEntityIds, type MapDocument } from './document'
import { documentFromFiles, exportPack, parsePack } from './pack'
import {
  createPrefab,
  deletePrefab,
  deletePrefabItems,
  duplicatePrefab,
  duplicatePrefabItems,
  fitFootprint,
  movePrefabItems,
  pickPrefabItem,
  placePrefabItem,
  prefabItems,
  rotatePrefabItems,
  starterHouse,
  updatePrefab,
  updatePrefabItem,
} from './prefabCommands'
import { applyCommand, initialEditState, undo } from './session'

const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
const P = 'building/test-house'

function ok(r: CommandResult): Extract<CommandResult, { ok: true }> {
  if (!r.ok) throw new Error(r.error)
  return r
}

function blank(): MapDocument {
  const lib = documentFromFiles(bundledWorldFiles('neighborhood-50'), OPTS)
  if (!lib.ok) throw new Error(lib.error)
  return blankDocument({ worldId: 'm5-test', name: 'M5', prefabs: lib.doc.world.prefabs.map((entry) => ({ entry, doc: lib.doc.prefabs.get(entry.prefabId)! })) })
}

function issuesOf(doc: MapDocument) {
  const files = new Map(documentFiles(doc))
  return checkWorldDocuments((p) => {
    if (!files.has(p)) throw new Error(`missing ${p}`)
    return files.get(p)
  }, OPTS).issues
}
const errorsOf = (doc: MapDocument) => issuesOf(doc).filter((i) => i.severity === 'error')

function loadExported(doc: MapDocument) {
  const back = parsePack(exportPack(doc), OPTS)
  if (!back.ok) throw new Error(`${back.error}: ${JSON.stringify(back.issues.slice(0, 3))}`)
  const files = new Map(documentFiles(back.doc))
  return loadWorld((p) => {
    if (!files.has(p)) throw new Error(`missing ${p}`)
    return files.get(p)
  })
}

/**
 * The house the browser check also builds, entirely through prefab commands: starter walls and
 * door, a window in the north wall, a kitchen container, a bed, and a second room.
 */
function builtHouse(): MapDocument {
  let doc = ok(createPrefab(blank(), { prefabId: P, name: 'Nhà thử', width: 8, depth: 6 })).doc
  doc = ok(placePrefabItem(doc, P, 'opening/window', { x: -1.5, z: -3.2 })).doc
  doc = ok(placePrefabItem(doc, P, 'container/kitchen', { x: -2.5, z: 2.4 })).doc
  doc = ok(placePrefabItem(doc, P, 'furniture/bed', { x: 2.5, z: -1.5 })).doc
  doc = ok(placePrefabItem(doc, P, 'structure/wall-run', { x: 1, z: -3 }, { x: 1.2, z: 0 })).doc
  return doc
}

describe('wall runs (M5)', () => {
  it('cut gaps for doors and windows on them, with lintel, sill and header', () => {
    const run: WallRunObject = { kind: 'wallRun', localId: 'w', from: { x: -4, z: 0 }, to: { x: 4, z: 0 }, height: 3, thickness: 0.3, color: '#c4a484' }
    const { boxes, openings } = wallRunBoxes(run, [
      run,
      { kind: 'door', localId: 'd', name: 'D', position: { x: -1, z: 0 }, quarterTurns: 2, width: 1.2, openTowards: 1 },
      { kind: 'window', localId: 'v', name: 'V', position: { x: 2, z: 0.1 }, quarterTurns: 0, width: 1, sill: 0.9, head: 2.1, thickness: 0.3 },
      // Wrong axis and off the line: not openings of this run.
      { kind: 'door', localId: 'x', name: 'X', position: { x: 3, z: 0 }, quarterTurns: 1, width: 1, openTowards: 1 },
      { kind: 'window', localId: 'y', name: 'Y', position: { x: 0, z: 1 }, quarterTurns: 0, width: 1, sill: 0.9, head: 2.1, thickness: 0.3 },
    ])
    expect(openings.map((o) => o.localId)).toEqual(['d', 'v'])
    const byPart = Object.fromEntries(boxes.map((b) => [b.part, b]))
    expect(boxes.map((b) => b.part)).toEqual(['0', 'd-lintel', '1', 'v-sill', 'v-header', '2'])
    // Solid pieces cover [-4.15, -1.6], [-0.4, 1.5], [2.5, 4.15] along X.
    expect(byPart['0'].position.x - byPart['0'].size[0] / 2).toBeCloseTo(-4.15)
    expect(byPart['0'].position.x + byPart['0'].size[0] / 2).toBeCloseTo(-1.6)
    expect(byPart['1'].size[0]).toBeCloseTo(1.9)
    expect(byPart['d-lintel'].position.y - byPart['d-lintel'].size[1] / 2).toBeCloseTo(DOOR_HEIGHT)
    expect(byPart['v-sill'].size[1]).toBeCloseTo(0.9)
    expect(byPart['v-header'].position.y - byPart['v-header'].size[1] / 2).toBeCloseTo(2.1)
  })

  it('the starter house resolves with derived wall IDs outside the stable ID space', () => {
    const house = starterHouse(P, 'Nhà')
    const r = resolveInstance({ instanceId: 'c0_0/h-1', prefabId: P, position: { x: 0, y: 0, z: 0 }, quarterTurns: 0 }, house, { x: 0, z: 0 })
    expect(r.parts.walls!.every((w) => w.id.includes('#'))).toBe(true)
    expect(r.entityIds).toEqual(['c0_0/h-1', 'c0_0/h-1/wall-n', 'c0_0/h-1/wall-s', 'c0_0/h-1/wall-w', 'c0_0/h-1/wall-e', 'c0_0/h-1/door', 'c0_0/h-1/room-1', 'c0_0/h-1/lamp-1'])
    // No low wall piece stands in the door gap (x ∈ [-0.6, 0.6] on z = 3).
    const blocking = r.parts.walls!.filter((w) => Math.abs(w.position.z - 3) < 0.2 && w.position.y - w.size[1] / 2 < 1.6)
    expect(blocking.every((w) => w.position.x + w.size[0] / 2 <= -0.6 + 1e-9 || w.position.x - w.size[0] / 2 >= 0.6 - 1e-9)).toBe(true)
  })
})

describe('prefab commands (M5)', () => {
  it('creates a valid, playable prefab and lists it in the manifest', () => {
    const doc = ok(createPrefab(blank(), { prefabId: P, name: 'Nhà thử' })).doc
    expect(doc.world.prefabs.at(-1)).toEqual({ prefabId: P, contentVersion: 1, path: 'prefabs/test-house.json' })
    expect(issuesOf(doc)).toEqual([])
    expect(createPrefab(doc, { prefabId: P, name: 'x' }).ok).toBe(false)
    expect(createPrefab(doc, { prefabId: 'Bad Id', name: 'x' }).ok).toBe(false)
  })

  it('doors and windows snap onto the nearest wall run and face the inside', () => {
    const doc = builtHouse()
    const p = doc.prefabs.get(P)!
    const win = p.objects.find((o) => o.localId === 'win-1')!
    expect(win).toMatchObject({ kind: 'window', position: { x: -1.5, z: -3 }, quarterTurns: 0, thickness: 0.3 })
    let d = ok(placePrefabItem(doc, P, 'opening/door', { x: 3.7, z: 1 })).doc // east wall, inside is −X
    expect(d.prefabs.get(P)!.objects.find((o) => o.localId === 'door-1')).toMatchObject({ position: { x: 4, z: 1 }, quarterTurns: 3 })
    d = ok(placePrefabItem(d, P, 'opening/door', { x: -4.2, z: -1 })).doc // west wall, inside is +X
    expect(d.prefabs.get(P)!.objects.find((o) => o.localId === 'door-2')).toMatchObject({ position: { x: -4, z: -1 }, quarterTurns: 1 })
    // Far from any wall: placed as is with the requested turns.
    d = ok(placePrefabItem(d, P, 'opening/door', { x: -2, z: 1 }, null, 1)).doc
    expect(d.prefabs.get(P)!.objects.find((o) => o.localId === 'door-3')).toMatchObject({ position: { x: -2, z: 1 }, quarterTurns: 1 })
    // The partition wall run followed the drag's dominant axis.
    expect(doc.prefabs.get(P)!.objects.find((o) => o.localId === 'wall-1')).toMatchObject({ from: { x: 1, z: -3 }, to: { x: 1, z: 0 } })
    expect(errorsOf(doc)).toEqual([])
  })

  it('rooms come from a drag, with a lamp and a switch inside; moving a room carries its lamp', () => {
    let doc = ok(placePrefabItem(builtHouse(), P, 'room/lamp', { x: 1, z: -3 }, { x: 4, z: 0 })).doc
    const room = doc.prefabs.get(P)!.rooms.find((r) => r.localId === 'room-2')!
    expect(room.bounds).toEqual({ minX: 1, minZ: -3, maxX: 4, maxZ: 0 })
    expect(room.lamp).toMatchObject({ localId: 'lamp-2', switchAt: { x: 1.4, z: -2.6 } })
    doc = ok(movePrefabItems(doc, P, ['room-2'], { x: 0, z: 1 })).doc
    expect(doc.prefabs.get(P)!.rooms.find((r) => r.localId === 'room-2')!.lamp!.switchAt).toEqual({ x: 1.4, z: -1.6 })
    doc = ok(movePrefabItems(doc, P, ['lamp-2'], { x: 0.5, z: 0 })).doc
    const moved = doc.prefabs.get(P)!.rooms.find((r) => r.localId === 'room-2')!
    expect(moved.bounds.minZ).toBe(-2)
    expect(moved.lamp!.switchAt).toEqual({ x: 1.9, z: -1.6 })
    const dup = ok(duplicatePrefabItems(doc, P, ['room-2'], { x: -5, z: 0 }))
    expect(dup.selection).toEqual(['room-3'])
    expect(dup.doc.prefabs.get(P)!.rooms.find((r) => r.localId === 'room-3')!.lamp!.localId).toBe('lamp-3')
  })

  it('rotates doors, boxes, wall runs and rooms about their centres', () => {
    const doc = builtHouse()
    const r = ok(rotatePrefabItems(doc, P, ['door', 'bed-1', 'wall-1'], 1)).doc.prefabs.get(P)!
    expect(r.objects.find((o) => o.localId === 'door')).toMatchObject({ quarterTurns: 3 })
    expect(r.objects.find((o) => o.localId === 'bed-1')).toMatchObject({ size: [1.6, 0.6, 2] })
    expect(r.objects.find((o) => o.localId === 'wall-1')).toMatchObject({ from: { x: -0.5, z: -1.5 }, to: { x: 2.5, z: -1.5 } })
    expect(rotatePrefabItems(doc, P, ['lamp-1'], 1).ok).toBe(false)
  })

  it('delete and rename retire local IDs; reusing one is refused and a validation error', () => {
    let doc = builtHouse()
    doc = ok(deletePrefabItems(doc, P, ['kitchen-1', 'room-1'])).doc
    const p = doc.prefabs.get(P)!
    expect(p.retiredLocalIds).toEqual(['kitchen-1', 'lamp-1', 'room-1'])
    expect(p.rooms).toEqual([])
    doc = ok(placePrefabItem(doc, P, 'container/kitchen', { x: -2.5, z: 2.4 })).doc
    expect(doc.prefabs.get(P)!.objects.some((o) => o.localId === 'kitchen-2')).toBe(true)
    const renamed = ok(updatePrefabItem(doc, P, 'kitchen-2', { localId: 'pantry' }))
    expect(renamed.selection).toEqual(['pantry'])
    expect(renamed.doc.prefabs.get(P)!.retiredLocalIds).toContain('kitchen-2')
    expect(updatePrefabItem(renamed.doc, P, 'pantry', { localId: 'kitchen-1' }).ok).toBe(false)
    expect(updatePrefabItem(renamed.doc, P, 'pantry', { localId: 'door' }).ok).toBe(false)
    // Hand-edited content that reuses a retired ID fails validation.
    const hacked = new Map(renamed.doc.prefabs)
    hacked.set(P, { ...renamed.doc.prefabs.get(P)!, retiredLocalIds: ['door'] })
    expect(issuesOf({ ...renamed.doc, prefabs: hacked }).map((i) => i.code)).toContain('retired-id-reused')
  })

  it('room lamps can be removed and added from the inspector path', () => {
    let doc = builtHouse()
    doc = ok(updatePrefabItem(doc, P, 'room-1', { lamp: null, name: 'Phòng khách' })).doc
    let room = doc.prefabs.get(P)!.rooms[0]
    expect(room.lamp).toBeUndefined()
    expect(room.name).toBe('Phòng khách')
    expect(doc.prefabs.get(P)!.retiredLocalIds).toEqual(['lamp-1'])
    doc = ok(updatePrefabItem(doc, P, 'room-1', { lamp: {} })).doc
    room = doc.prefabs.get(P)!.rooms[0]
    expect(room.lamp!.localId).toBe('lamp-2')
    expect(errorsOf(doc)).toEqual([])
  })

  it('prefab properties: contentVersion follows the manifest, footprint fits the walls, variants and deletion', () => {
    let doc = builtHouse()
    doc = ok(updatePrefab(doc, P, { contentVersion: 2, name: 'Nhà thử 2', building: { wallColor: '#aabbcc' } })).doc
    expect(doc.prefabs.get(P)!.contentVersion).toBe(2)
    expect(doc.world.prefabs.find((e) => e.prefabId === P)!.contentVersion).toBe(2)
    expect(errorsOf(doc)).toEqual([])
    doc = ok(updatePrefab(doc, P, { footprint: { minX: -1, minZ: -1, maxX: 1, maxZ: 1 } })).doc
    doc = ok(fitFootprint(doc, P)).doc
    expect(doc.prefabs.get(P)!.footprint).toEqual({ minX: -4, minZ: -3, maxX: 4, maxZ: 3 })
    expect(updatePrefab(doc, P, { footprint: { minX: 1, minZ: 0, maxX: 0, maxZ: 1 } }).ok).toBe(false)

    const variant = ok(duplicatePrefab(doc, P, 'building/test-house-b', 'Biến thể')).doc
    expect(variant.world.prefabs.at(-1)).toEqual({ prefabId: 'building/test-house-b', contentVersion: 1, path: 'prefabs/test-house-b.json' })
    expect(variant.prefabs.get('building/test-house-b')!.retiredLocalIds).toBeUndefined()
    const placed = ok(placeInstance(variant, 'building/test-house-b', { x: 12, z: 12 }, 0)).doc
    expect(deletePrefab(placed, 'building/test-house-b').ok).toBe(false)
    expect(ok(deletePrefab(placed, P)).doc.world.prefabs.some((e) => e.prefabId === P)).toBe(false)
  })

  it('picks items in the prefab frame; rooms only at their outline or centre', () => {
    const items = prefabItems(builtHouse().prefabs.get(P)!)
    expect(pickPrefabItem(items, { x: 2.5, z: -1.5 })?.key).toBe('bed-1')
    expect(pickPrefabItem(items, { x: 0, z: 3 })?.key).toBe('door')
    expect(pickPrefabItem(items, { x: 1, z: 2.75 })?.key).toBe('lamp-1')
    expect(pickPrefabItem(items, { x: 0, z: 0 })?.key).toBe('room-1')
    expect(pickPrefabItem(items, { x: -2, z: -1 })).toBeNull()
  })

  it('every prefab edit is one history entry and undo restores the document exactly', () => {
    const start = blank()
    let s = initialEditState(start)
    s = applyCommand(s, 'create', createPrefab(s.doc, { prefabId: P, name: 'Nhà' })).state
    s = applyCommand(s, 'place', placePrefabItem(s.doc, P, 'furniture/table', { x: 0, z: 0 })).state
    s = applyCommand(s, 'move', movePrefabItems(s.doc, P, ['table-1'], { x: 1, z: 0 })).state
    expect(s.past).toHaveLength(3)
    s = undo(undo(undo(s)))
    expect(s.doc).toBe(start)
  })
})

describe('a GUI-made house in the game, in all four rotations (M5)', () => {
  for (const q of [0, 1, 2, 3] as QuarterTurns[]) {
    it(`quarter turn ${q}: door and collision, loot, rooms, window and lamp work`, () => {
      const doc = ok(placeInstance(builtHouse(), P, { x: 12, z: 12 }, q)).doc
      expect(errorsOf(doc)).toEqual([])
      const { map } = loadExported(doc)
      const id = 'c0_0/test-house-1'
      expect(map.doors.map((d) => d.id)).toContain(`${id}/door`)
      expect(map.buildings.some((b) => b.id === id)).toBe(true)

      const rt = new GameRuntime(map)
      rt.newGame(5)
      rt.pathBudget.maxPathMs = Infinity
      rt.setLineOfSightOverride(null)
      const inside = { x: 12, y: 0, z: 12 }
      // 5 m out through the door side: the door's local (0, 3) + 2 m, turned with the instance.
      const doorOut = [
        { x: 0, z: 5 },
        { x: 5, z: 0 },
        { x: 0, z: -5 },
        { x: -5, z: 0 },
      ][q]
      const outside = { x: 12 + doorOut.x, y: 0, z: 12 + doorOut.z }
      expect(rt.nav.isWalkable(inside.x, inside.z)).toBe(true)
      expect(rt.nav.isWalkable(outside.x, outside.z)).toBe(true)
      expect(rt.nav.componentAt(inside.x, inside.z)).not.toBe(rt.nav.componentAt(outside.x, outside.z))
      rt.setDoorState(`${id}/door`, 'open')
      expect(rt.nav.componentAt(inside.x, inside.z)).toBe(rt.nav.componentAt(outside.x, outside.z))
      expect(rt.nav.findPath(outside, inside)).not.toBeNull()

      // Loot seeded into the kitchen; the player walks into the building (roof/indoor tests).
      expect(rt.world.containers.get(`${id}/kitchen-1`)!.items.slots.some((s) => s !== null)).toBe(true)
      expect(rt.buildingAt(inside)).toBe(id)

      // The window lights its room; the lamp adds artificial light.
      for (let i = 0; i < 5; i++) rt.tick(1 / 60)
      const room = rt.lighting.getRoomLight(`${id}/room-1`)!
      expect(room.windowLight).toBeGreaterThan(0)
      rt.setLamp(`${id}/lamp-1`, true)
      for (let i = 0; i < 5; i++) rt.tick(1 / 60)
      expect(rt.lighting.getRoomLight(`${id}/room-1`)!.artificialLight).toBeGreaterThan(0)
    })
  }
})

describe('prefab edits and existing saves (M5)', () => {
  it('a compatible edit keeps local IDs and the saved door/loot state; adding a stateful item does not', () => {
    const doc = ok(placeInstance(builtHouse(), P, { x: 12, z: 12 }, 1)).doc
    const id = 'c0_0/test-house-1'
    const rt = new GameRuntime(loadExported(doc).map)
    rt.newGame(9)
    rt.setDoorState(`${id}/door`, 'open')
    const kitchen = rt.world.containers.get(`${id}/kitchen-1`)!
    kitchen.opened = true
    kitchen.items.slots = kitchen.items.slots.map(() => null)
    rt.setLamp(`${id}/lamp-1`, true)
    const save = rt.createSnapshot()

    // Compatible: recolour and thicken walls, move the kitchen and the bed, a new partition and prop.
    let edited = ok(updatePrefab(doc, P, { building: { wallColor: '#999999' } })).doc
    edited = ok(movePrefabItems(edited, P, ['kitchen-1', 'bed-1'], { x: 0.5, z: 0 })).doc
    edited = ok(updatePrefabItem(edited, P, 'wall-n', { thickness: 0.4, color: '#999999' })).doc
    edited = ok(placePrefabItem(edited, P, 'furniture/table', { x: -2, z: -1 })).doc
    expect(statefulEntityIds(edited)).toEqual(statefulEntityIds(doc))
    const map = loadExported(edited).map
    const check = validateSaveGame(JSON.parse(JSON.stringify(save)), map.id, map)
    expect(check.ok).toBe(true)
    const rt2 = new GameRuntime(map)
    rt2.newGame(1)
    if (check.ok) rt2.loadSnapshot(check.save)
    expect(rt2.world.doors.get(`${id}/door`)!.state).toBe('open')
    expect(rt2.world.containers.get(`${id}/kitchen-1`)!.opened).toBe(true)
    expect(rt2.world.containers.get(`${id}/kitchen-1`)!.items.slots.every((s) => s === null)).toBe(true)
    expect(rt2.world.lamps.get(`${id}/lamp-1`)).toBe(true)

    // Incompatible: a new container changes the stateful set; the old save is refused, not reset.
    const added = ok(placePrefabItem(edited, P, 'container/nightstand', { x: 3, z: 2 })).doc
    expect(statefulEntityIds(added)).not.toEqual(statefulEntityIds(doc))
    const map3 = loadExported(added).map
    expect(validateSaveGame(JSON.parse(JSON.stringify(save)), map3.id, map3).ok).toBe(false)
  })

  it('a prefab edit changes every instance of it', () => {
    let doc = ok(placeInstance(builtHouse(), P, { x: 12, z: 12 }, 0)).doc
    doc = ok(placeInstance(doc, P, { x: -12, z: 12 }, 2)).doc
    expect(instancesOf(doc, P)).toEqual(['c-1_0/test-house-1', 'c0_0/test-house-1'])
    doc = ok(placePrefabItem(doc, P, 'container/nightstand', { x: 3, z: 2 })).doc
    const map = loadExported(doc).map
    expect(map.containers.filter((c) => c.id.endsWith('/nightstand-1')).map((c) => c.id)).toEqual(['c-1_0/test-house-1/nightstand-1', 'c0_0/test-house-1/nightstand-1'])
  })
})
