import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, loadWorld, REGISTERED_LOOT_TABLES } from '../content'
import { deepCheck } from '../analysis'
import { checkWorldDocuments } from '../validate'
import { distanceToOutline, insideOutline, normalizeOutline, outlineArea, outlineBounds, outlineCentre, outlineProblem, outlineRects, pointInOutline, rectOutline } from '../polygon'
import type { Rect, XZ } from '../schema'
import { rotateXZ } from '../transform'
import { GameRuntime } from '../../game/core/runtime'
import { buildingPieces, collectStaticItems } from '../../game/rendering/staticBatchData'
import { pickRoomSlots } from '../../game/rendering/roomSlots'
import { isInsideBuilding } from '../../game/world/buildings'
import { drawItems } from '../../editor/drawItems'
import { placeInstance, type CommandResult } from './commands'
import { blankDocument, documentFiles, resolvedRecords, type MapDocument } from './document'
import { dragPrefabHandle, FOOTPRINT_KEY, prefabItemHandles } from './handles'
import { cutOutlineCorner, dragOutlineEdge, dragOutlineVertex, notchOutlineEdge, turnOutline } from './outlines'
import { documentFromFiles, exportPack, parsePack } from './pack'
import { buildOutlineWalls, createPrefab, duplicatePrefabItems, fitFootprint, movePrefabItems, pickPrefabItem, prefabItems, rotatePrefabItems, updatePrefab, updatePrefabItem } from './prefabCommands'

const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
const P = 'building/l-house'

function ok(r: CommandResult): Extract<CommandResult, { ok: true }> {
  if (!r.ok) throw new Error(r.error)
  return r
}

function library(): MapDocument {
  const r = documentFromFiles(bundledWorldFiles('neighborhood-50'), OPTS)
  if (!r.ok) throw new Error(r.error)
  return r.doc
}

function blank(): MapDocument {
  const lib = library()
  return blankDocument({ worldId: 'm11a-test', name: 'M11a', prefabs: lib.world.prefabs.map((entry) => ({ entry, doc: lib.prefabs.get(entry.prefabId)! })) })
}

/** A blank world with a 10 × 8 L house (north-east quarter cut away) at (10, 10), turned `q`. */
function world(q: 0 | 1 | 2 | 3 = 0): MapDocument {
  let doc = ok(createPrefab(blank(), { prefabId: P, name: 'Nhà L', width: 10, depth: 8, shape: 'L' })).doc
  doc = ok(placeInstance(doc, P, { x: 10, z: 10 }, q)).doc
  return doc
}

function issuesOf(doc: MapDocument) {
  const files = new Map(documentFiles(doc))
  return checkWorldDocuments((p) => files.get(p), OPTS).issues
}

function mapOf(doc: MapDocument) {
  const files = new Map(documentFiles(doc))
  return loadWorld((p) => files.get(p)).map
}

const area = (r: Rect) => (r.maxX - r.minX) * (r.maxZ - r.minZ)
const L: XZ[] = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 4 }, { x: 0, z: 4 }]
const U: XZ[] = [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 4 }, { x: 4, z: 4 }, { x: 4, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 4 }, { x: 0, z: 4 }]

describe('rectilinear outlines (M11a)', () => {
  it('geometry: validity, point tests, rectangles that tile the outline', () => {
    expect(outlineProblem(L)).toBeNull()
    expect(outlineProblem(U)).toBeNull()
    expect(outlineProblem([{ x: 0, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }, { x: 0, z: 2 }])).toContain('along X or Z')
    // An outline reaching past its first vertex is fine; one whose edges cross is not.
    expect(outlineProblem([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 2 }, { x: -2, z: 2 }, { x: -2, z: 1 }, { x: 0, z: 1 }])).toBeNull()
    expect(outlineProblem([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 2, z: 4 }, { x: 2, z: -2 }, { x: 0, z: -2 }])).toContain('cross')
    expect(outlineProblem([{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }])).toContain('4 vertices')
    expect(normalizeOutline([{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 4, z: 4 }, { x: 0, z: 4 }])).toHaveLength(4)
    expect(pointInOutline(L, 1, 1)).toBe(true)
    expect(pointInOutline(L, 3, 3)).toBe(false) // the notch
    expect(pointInOutline(L, 4, 1)).toBe(true) // on an edge
    expect(pointInOutline(U, 3, 3)).toBe(false)
    expect(insideOutline(L, 3, 3, 0.5)).toBe(false)
    expect(insideOutline(L, 2.3, 2.3, 0.5)).toBe(true)
    expect(insideOutline(L, 1, 1, -0.5)).toBe(true)
    expect(insideOutline(L, 1.9, 1, -0.5)).toBe(true)
    expect(insideOutline(L, 3.8, 1, -0.5)).toBe(false)
    expect(distanceToOutline(L, 3, 3)).toBe(1)
    for (const poly of [L, U, rectOutline({ minX: -1, minZ: -2, maxX: 3, maxZ: 5 })]) {
      const rects = outlineRects(poly)
      expect(rects.reduce((n, r) => n + area(r), 0)).toBe(outlineArea(poly))
      for (const r of rects) expect(pointInOutline(poly, (r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2)).toBe(true)
      for (const [i, a] of rects.entries()) for (const b of rects.slice(i + 1)) expect(a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ).toBe(false)
    }
    expect(outlineRects(rectOutline({ minX: -1, minZ: -2, maxX: 3, maxZ: 5 }))).toEqual([{ minX: -1, minZ: -2, maxX: 3, maxZ: 5 }])
    expect(outlineRects(U)).toHaveLength(3)
    expect(pointInOutline(L, outlineCentre(L).x, outlineCentre(L).z)).toBe(true)
  })

  it('editing: cut a corner (and fill it back), notch an edge, drag vertices and edges, rotate', () => {
    const rect = rectOutline({ minX: 0, minZ: 0, maxX: 4, maxZ: 4 })
    const cut = cutOutlineCorner(rect, 2)!
    expect(cut).toHaveLength(6)
    expect(outlineArea(cut)).toBe(12)
    expect(pointInOutline(cut, 3, 3)).toBe(false)
    // Cutting the notch's inner corner fills it back into the square.
    const inner = cut.findIndex((p) => p.x === 2 && p.z === 2)
    expect(outlineArea(cutOutlineCorner(cut, inner)!)).toBe(16)
    expect(cutOutlineCorner(cut, inner)).toHaveLength(4)
    // Cuts and notches land on the 0.25 m grid; a notch too shallow to fit is refused (no endless halving).
    expect(notchOutlineEdge(rectOutline({ minX: 0, minZ: 0, maxX: 5, maxZ: 5 }), 0)!.every((p) => (p.x * 4) % 1 === 0 && (p.z * 4) % 1 === 0)).toBe(true)
    expect(notchOutlineEdge(rectOutline({ minX: 0, minZ: 0, maxX: 5, maxZ: 0.2 }), 0)).toBeNull()
    expect(notchOutlineEdge(rectOutline({ minX: 0, minZ: 0, maxX: 0.5, maxZ: 3 }), 0)).toBeNull()
    const u = notchOutlineEdge(rectOutline({ minX: 0, minZ: 0, maxX: 6, maxZ: 3 }), 2)!
    expect(u).toHaveLength(8)
    expect(pointInOutline(u, 3, 2.9)).toBe(false)
    expect(pointInOutline(u, 0.5, 2.9)).toBe(true)
    // Vertex drag keeps every edge on its axis.
    const moved = dragOutlineVertex(L, 3, { x: 3, z: 3 })!
    expect(outlineProblem(moved)).toBeNull()
    expect(moved).toContainEqual({ x: 3, z: 3 })
    expect(outlineArea(moved)).toBe(4 * 4 - 1)
    // Edge drag moves one edge sideways; pushing it through the opposite side is refused.
    expect(outlineBounds(dragOutlineEdge(L, 1, { x: 5, z: 1 })!).maxX).toBe(5)
    expect(dragOutlineEdge(L, 1, { x: -1, z: 1 })).toBeNull()
    // Collapsing the notch merges vertices (normalized) instead of leaving zero-length edges.
    expect(dragOutlineVertex(L, 3, { x: 4, z: 4 })).toHaveLength(4)
    const turned = turnOutline(L, { x: 2, z: 2 }, 1)
    expect(outlineArea(turned)).toBe(outlineArea(L))
    expect(outlineProblem(turned)).toBeNull()
  })
})

describe('L-shaped buildings and rooms (M11a)', () => {
  it('the starter L house is valid content and resolves with its outline in every rotation', () => {
    for (const q of [0, 1, 2, 3] as const) {
      const doc = world(q)
      expect(issuesOf(doc).filter((i) => i.severity === 'error')).toEqual([])
      const map = mapOf(doc)
      const b = map.buildings.find((x) => x.id.endsWith('l-house-1') || x.name === 'Nhà L')!
      expect(b.outline).toHaveLength(6)
      expect(outlineArea(b.outline!)).toBe(80 - 20)
      // The cut-away quarter (north-east at q = 0) turns with the house.
      const at = (x: number, z: number) => {
        const [rx, rz] = rotateXZ(x, z, q)
        return { x: 10 + rx, z: 10 + rz }
      }
      const notch = at(2.5, -2)
      const arm = at(-2.5, 2)
      expect(isInsideBuilding(b, notch.x, notch.z)).toBe(false)
      expect(isInsideBuilding(b, arm.x, arm.z)).toBe(true)
      const room = map.rooms!.find((r) => r.buildingId === b.id)!
      expect(room.outline).toEqual(b.outline)
      expect(pointInOutline(room.outline!, room.lamp!.position.x, room.lamp!.position.z)).toBe(true)
    }
  })

  it('game: indoor tests, roof and floor pieces, lighting slots, a run of ticks', () => {
    const map = mapOf(world())
    const rt = new GameRuntime(map)
    const b = map.buildings.find((x) => x.outline)!
    // North-east quarter (x 10..15, z 6..10) is outdoors; the arms are indoors.
    expect(rt.buildingAt({ x: 13, z: 8 })).toBeNull()
    expect(rt.buildingAt({ x: 7, z: 8 })).toBe(b.id)
    expect(rt.buildingAt({ x: 13, z: 12 })).toBe(b.id)
    const pieces = buildingPieces(b)
    expect(pieces.reduce((n, p) => n + area(p), 0)).toBe(outlineArea(b.outline!))
    const items = collectStaticItems(map, rt.staticColliders)
    const roofs = items.filter((i) => i.roofOf === b.id)
    const floors = items.filter((i) => i.shape === 'floor' && Math.abs(i.center.x - 10) < 6 && Math.abs(i.center.z - 10) < 5)
    expect(roofs).toHaveLength(pieces.length)
    expect(floors).toHaveLength(pieces.length)
    // Roof pieces never overlap (no z-fighting) and none covers the notch.
    const roofRects = roofs.map((r) => ({ minX: r.center.x - r.size[0] / 2, maxX: r.center.x + r.size[0] / 2, minZ: r.center.z - r.size[2] / 2, maxZ: r.center.z + r.size[2] / 2 }))
    for (const [i, a] of roofRects.entries()) for (const c of roofRects.slice(i + 1)) expect(a.minX < c.maxX - 1e-9 && c.minX < a.maxX - 1e-9 && a.minZ < c.maxZ - 1e-9 && c.minZ < a.maxZ - 1e-9).toBe(false)
    expect(roofRects.some((r) => 13 > r.minX && 13 < r.maxX && 8 > r.minZ && 8 < r.maxZ)).toBe(false)
    // Lighting: the notch belongs to no room; the L room takes one shader slot per piece.
    expect(rt.lighting.getRoomAtPosition({ x: 13, y: 1, z: 8 })).toBeNull()
    expect(rt.lighting.getRoomAtPosition({ x: 13, y: 1, z: 12 })?.id).toBe(map.rooms!.find((r) => r.outline)!.id)
    const slots = pickRoomSlots(map.rooms!, 0, 0, 16)
    expect(slots.filter((s) => s.room.outline)).toHaveLength(outlineRects(map.rooms!.find((r) => r.outline)!.outline!).length)
    expect(pickRoomSlots(map.rooms!, 0, 0, 1)).toHaveLength(0) // an L room is never cut in half
    rt.newGame(4)
    for (let i = 0; i < 300; i++) rt.tick(1 / 60)
    expect(rt.player.alive).toBe(true)
  })

  it('validator and deep check follow the outline', () => {
    let doc = world()
    const prefab = () => doc.prefabs.get(P)!
    const set = (patch: object) => {
      const next = new Map(doc.prefabs)
      next.set(P, { ...prefab(), ...patch })
      doc = { ...doc, prefabs: next }
    }
    const codes = () => issuesOf(doc).map((i) => i.code)
    const good = prefab()
    set({ outline: [{ x: 0, z: 0 }, { x: 2, z: 2 }, { x: 0, z: 2 }, { x: 0, z: 1 }] })
    expect(codes()).toContain('invalid-outline')
    set({ outline: good.outline, footprint: { ...good.footprint, maxX: 9 } })
    expect(codes()).toContain('outline-bounds')
    // A container in the notch lies outside the footprint; a lamp there hangs outside its room.
    set({ ...good, objects: [...good.objects, { kind: 'container', localId: 'crate', name: 'Thùng', position: { x: 3, y: 0.4, z: -2 }, size: [0.8, 0.8, 0.8], color: '#806040' }] })
    expect(codes()).toContain('outside-footprint')
    set({ ...good, rooms: [{ ...good.rooms[0], lamp: { ...good.rooms[0].lamp!, at: { x: 3, z: -2 } } }] })
    expect(codes()).toContain('lamp-outside-room')
    set(good)
    expect(issuesOf(doc).filter((i) => i.severity === 'error')).toEqual([])
    // Deep check: a zombie spawn in the notch is outdoors, not "inside a building".
    const files = new Map(documentFiles(doc))
    const loaded = loadWorld((p) => files.get(p)).docs
    const chunks = new Map(loaded.chunks)
    const chunk = chunks.get('c0_0')!
    chunks.set('c0_0', { ...chunk, spawns: [...chunk.spawns, { spawnId: 'c0_0/spawns/notch', kind: 'zombie', position: { x: 13, z: 8 } }] })
    const docs = { ...loaded, chunks }
    expect(deepCheck(docs).issues.filter((i) => i.entityId === 'c0_0/spawns/notch').map((i) => i.code)).not.toContain('spawn-indoors')
  })

  it('pack round trip keeps outlines byte for byte; the editor floors an L piece by piece', () => {
    const doc = world(1)
    const text = exportPack(doc)
    const back = parsePack(text, OPTS)
    if (!back.ok) throw new Error(back.error)
    expect(exportPack(back.doc)).toBe(text)
    expect(back.doc.prefabs.get(P)!.outline).toEqual(doc.prefabs.get(P)!.outline)
    const record = resolvedRecords(doc).find((r) => r.parts.buildings?.some((b) => b.outline))!
    expect(drawItems(record).filter((d) => d.geometry === 'plane')).toHaveLength(outlineRects(record.parts.buildings![0].outline!).length)
  })
})

describe('prefab editor outline commands (M11a)', () => {
  it('footprint: outline sets the bounding box, the rectangle fields and fit are locked, walls follow the outline', () => {
    let doc = ok(createPrefab(blank(), { prefabId: P, name: 'Nhà', width: 8, depth: 6 })).doc
    expect(doc.prefabs.get(P)!.outline).toBeUndefined()
    const L8 = cutOutlineCorner(rectOutline(doc.prefabs.get(P)!.footprint), 0)!
    doc = ok(updatePrefab(doc, P, { outline: L8 })).doc
    expect(doc.prefabs.get(P)!.footprint).toEqual(outlineBounds(L8))
    expect(updatePrefab(doc, P, { footprint: { minX: -5, minZ: -3, maxX: 4, maxZ: 3 } }).ok).toBe(false)
    expect(fitFootprint(doc, P).ok).toBe(false)
    expect(updatePrefab(doc, P, { outline: [{ x: 0, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 1 }, { x: 0, z: 0.5 }] }).ok).toBe(false)
    // The starter's south and east walls already run along two outline edges; the two shortened
    // edges and the two notch edges get new runs (old walls are left alone); again adds nothing.
    const before = doc.prefabs.get(P)!.objects.filter((o) => o.kind === 'wallRun').length
    const built = ok(buildOutlineWalls(doc, P))
    expect(built.selection.length).toBe(4)
    expect(built.doc.prefabs.get(P)!.objects.filter((o) => o.kind === 'wallRun').length).toBe(before + 4)
    expect(buildOutlineWalls(built.doc, P).ok).toBe(false)
    // Handles: 6 vertices + 6 edges on the footprint; a drag goes through updatePrefab.
    expect(prefabItemHandles(doc.prefabs.get(P)!, FOOTPRINT_KEY)).toHaveLength(12)
    const dragged = ok(dragPrefabHandle(doc, P, FOOTPRINT_KEY, 'e1', { x: 1, z: -2 })).doc
    expect(dragged.prefabs.get(P)!.footprint).toEqual(doc.prefabs.get(P)!.footprint)
    expect(outlineArea(dragged.prefabs.get(P)!.outline!)).not.toBe(outlineArea(L8))
    expect(dragPrefabHandle(doc, P, FOOTPRINT_KEY, 'e1', { x: 9, z: 9 }).ok).toBe(false)
    // Back to a rectangle: the bounding box stays.
    const rect = ok(updatePrefab(doc, P, { outline: null })).doc.prefabs.get(P)!
    expect(rect.outline).toBeUndefined()
    expect(rect.footprint).toEqual(outlineBounds(L8))
  })

  it('rooms: convert, drag, pick, move, rotate, duplicate, clear; bounds always follow the outline', () => {
    let doc = world()
    const room = () => doc.prefabs.get(P)!.rooms[0]
    const key = room().localId
    expect(prefabItemHandles(doc.prefabs.get(P)!, key)).toHaveLength(12)
    doc = ok(dragPrefabHandle(doc, P, key, 'v0', { x: -4, z: -3 })).doc
    expect(room().bounds).toEqual(outlineBounds(room().outline!))
    expect(room().bounds.minX).toBe(-4)
    // Rectangle patches are refused while the room has an outline.
    expect(updatePrefabItem(doc, P, key, { bounds: { minX: 0, minZ: 0, maxX: 1, maxZ: 1 } }).ok).toBe(false)
    expect(updatePrefabItem(doc, P, key, { outline: [{ x: 0, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 1 }, { x: 0, z: 0.5 }] }).ok).toBe(false)
    // Picking: near an edge or the centre of the L, not in the notch.
    const items = prefabItems(doc.prefabs.get(P)!)
    expect(pickPrefabItem(items.filter((i) => i.kind === 'room'), { x: 2.5, z: -2 })).toBeNull()
    expect(pickPrefabItem(items.filter((i) => i.kind === 'room'), { x: 0, z: -1.9 })?.key).toBe(key)
    const moved = ok(movePrefabItems(doc, P, [key], { x: 1, z: 0 })).doc.prefabs.get(P)!.rooms[0]
    expect(moved.outline![0].x).toBe(room().outline![0].x + 1)
    const turned = ok(rotatePrefabItems(doc, P, [key], 2)).doc.prefabs.get(P)!.rooms[0]
    expect(outlineArea(turned.outline!)).toBe(outlineArea(room().outline!))
    expect(turned.bounds).toEqual(outlineBounds(turned.outline!))
    expect(turned.outline).not.toEqual(room().outline)
    const copies = ok(duplicatePrefabItems(doc, P, [key], { x: 0, z: 20 })).doc.prefabs.get(P)!.rooms
    expect(copies[1].outline![0].z).toBe(room().outline![0].z + 20)
    const cleared = ok(updatePrefabItem(doc, P, key, { outline: undefined })).doc.prefabs.get(P)!.rooms[0]
    expect(cleared.outline).toBeUndefined()
    expect(cleared.bounds).toEqual(room().bounds)
    // Converting a plain room: its rectangle's 4 corners.
    const plain = ok(createPrefab(blank(), { prefabId: 'building/plain', name: 'Plain' })).doc
    const r0 = plain.prefabs.get('building/plain')!.rooms[0]
    const conv = ok(updatePrefabItem(plain, 'building/plain', r0.localId, { outline: rectOutline(r0.bounds) })).doc.prefabs.get('building/plain')!.rooms[0]
    expect(conv.outline).toHaveLength(4)
    expect(conv.bounds).toEqual(r0.bounds)
  })
})
