import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, loadBundledWorld, loadWorld, REGISTERED_LOOT_TABLES } from '../content'
import { checkWorldDocuments, loadWorldDocuments, resolveAll } from '../validate'
import { GameRuntime } from '../../game/core/runtime'
import { collectStaticItems, itemBounds } from '../../game/rendering/staticBatchData'
import { drawItems } from '../../editor/drawItems'
import { validateSaveGame } from '../../game/systems/save'
import type { MapData } from '../../game/world/mapData'
import { duplicateRecords, placeInstance, updateRecord, type CommandResult } from './commands'
import { documentFiles, findRecord, type MapDocument } from './document'
import { documentFromFiles } from './pack'
import { createPrefab, duplicatePrefabItems, placePrefabItem, updatePrefab } from './prefabCommands'

/**
 * G5 (graphics plan §9): the data contract of the looks. The editor draws furniture and decor with the
 * game's own factories; duplicating keeps looks under new IDs; export/import keeps every look field; a
 * house built in the editor with the new modules loads and plays; a save of the lab before its garage
 * (content v1) still loads with its doors, containers and player.
 */

const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
const LAB = 'graphics-lab'
const A = 'c0_0/house-a'
const P = 'building/lab-house'

function ok(r: CommandResult): Extract<CommandResult, { ok: true }> {
  if (!r.ok) throw new Error(r.error)
  return r
}
const labDoc = (): MapDocument => {
  const r = documentFromFiles(bundledWorldFiles(LAB), OPTS)
  if (!r.ok) throw new Error(r.error)
  return r.doc
}
const filesOf = (doc: MapDocument) => new Map(documentFiles(doc))
const errorsOf = (doc: MapDocument) => {
  const files = filesOf(doc)
  return checkWorldDocuments((p) => files.get(p), OPTS).issues.filter((i) => i.severity === 'error')
}
const mapOf = (doc: MapDocument): MapData => {
  const files = filesOf(doc)
  return loadWorld((p) => {
    if (!files.has(p)) throw new Error(`missing ${p}`)
    return files.get(p)
  }).map
}
const near = (a: readonly number[], b: readonly number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6)

describe('looks: editor and game agree (G5)', () => {
  it('the editor draws every furniture part and table-top decor of house A where the game does', () => {
    const files = bundledWorldFiles(LAB)
    const { docs } = loadWorldDocuments((p) => files.get(p), OPTS)
    const record = resolveAll(docs!).find((r) => r.id === A)!
    const drawn = drawItems(record)
    const rt = new GameRuntime({ ...loadBundledWorld(LAB).map, zombieSpawns: [] })
    const game = collectStaticItems(rt.map, rt.staticColliders).filter((i) => i.buildingId === A)
    const furniture = game.filter((i) => i.furniture)
    expect(furniture.length).toBeGreaterThan(150)
    const missing = furniture.filter((i) => !drawn.some((d) => d.geometry === 'box' && near(d.position, i.center.toArray()) && near(d.scale, i.size) && Math.abs(d.rotationY - (i.yaw ?? 0)) < 1e-9))
    expect(missing.map((i) => `${i.id} ${i.furniture!.part}`)).toEqual([])
    // Decor on tables and counters stands at the same place (on the floor the lifts differ by a few mm).
    const onTop = new Set((rt.map.decor ?? []).filter((d) => d.position.y - d.floorY > 0.3).map((d) => d.id))
    const raised = game.filter((i) => i.decor && onTop.has(i.id!) && itemBounds(i).min.y > 0.3)
    expect(raised.length).toBeGreaterThan(5)
    for (const i of raised) expect(drawn.some((d) => near(d.position, i.center.toArray()) && near(d.scale, i.size)), `${i.id} ${i.decor!.part}`).toBe(true)
  })

  it('duplicating keeps the looks under new IDs; export and import keep every look field', () => {
    let doc = labDoc()
    const dup = ok(duplicatePrefabItems(doc, P, ['chair-2', 'cup-1', 'rug-living'], { x: 0.5, z: 0 }))
    doc = dup.doc
    const objects = doc.prefabs.get(P)!.objects
    const copy = (id: string) => objects.find((o) => o.localId === id)!
    const pick = (base: string) => copy(dup.selection.find((k) => k.startsWith(base))!)
    const [chair, cup, rug] = [pick('chair'), pick('cup'), pick('rug')]
    expect(dup.selection.some((k) => ['chair-2', 'cup-1', 'rug-living'].includes(k))).toBe(false)
    expect(chair).toMatchObject({ kind: 'prop', visual: { assetId: 'furniture/chair', facing: 0, yaw: 25 } })
    expect(cup).toMatchObject({ kind: 'decor', assetId: 'decor/cup', variants: ['lived-in'] })
    expect(rug).toMatchObject({ kind: 'decor', assetId: 'decor/rug', yaw: 90 })
    const world = ok(duplicateRecords(doc, ['c0_0/objects/car', 'c0_0/objects/bush-a-1'], { x: 0, z: 1 }))
    doc = world.doc
    const records = world.selection.map((id) => findRecord(doc, id)!.record)
    expect(records.map((r) => r.visual ?? r.assetId)).toEqual([{ assetId: 'outdoor/car' }, 'decor/bush'])
    doc = ok(updateRecord(doc, 'c0_0/house-a', { visual: { variantId: 'intact' } })).doc
    // Export → import: every prefab object, room and instance comes back the same.
    const again = documentFromFiles(filesOf(doc), OPTS)
    if (!again.ok) throw new Error(again.error)
    for (const [id, prefab] of doc.prefabs) expect(again.doc.prefabs.get(id)).toEqual(prefab)
    expect([...again.doc.chunks.values()].flatMap((c) => c.instances)).toEqual([...doc.chunks.values()].flatMap((c) => c.instances))
    expect([...again.doc.chunks.values()].flatMap((c) => c.objects)).toEqual([...doc.chunks.values()].flatMap((c) => c.objects))
  })
})

describe('a house built in the editor with the new modules (G5)', () => {
  it('creates, furnishes, dresses and places it; the export loads and plays with its looks', () => {
    let doc = ok(createPrefab(labDoc(), { prefabId: 'building/g5-house', name: 'Nhà G5', width: 8, depth: 6 })).doc
    const H = 'building/g5-house'
    // Furniture from the palette (assets set by the presets), a kitchen corner and a dinner cluster.
    doc = ok(placePrefabItem(doc, H, 'container/wardrobe', { x: -2.9, z: -2.4 })).doc
    doc = ok(placePrefabItem(doc, H, 'furniture/bed', { x: 1.8, z: -1.6 })).doc
    doc = ok(placePrefabItem(doc, H, 'cluster/kitchen', { x: -2.4, z: 2.4 })).doc
    doc = ok(placePrefabItem(doc, H, 'cluster/evacuation', { x: 2.6, z: 2.2 })).doc
    doc = ok(updatePrefab(doc, H, { variants: ['lived-in', 'abandoned'] })).doc
    const placed = ok(placeInstance(doc, H, { x: 9, z: 38 }, 1))
    doc = ok(updateRecord(placed.doc, placed.selection[0], { visual: { variantId: 'abandoned' } })).doc
    expect(errorsOf(doc)).toEqual([])
    const map = mapOf(doc)
    const id = placed.selection[0]
    expect(map.buildings.find((b) => b.id === id)?.variant).toBe('abandoned')
    const rt = new GameRuntime({ ...map, zombieSpawns: [] })
    const items = collectStaticItems(rt.map, rt.staticColliders).filter((i) => i.buildingId === id)
    const assets = new Set(items.map((i) => i.furniture?.assetId ?? i.decor?.assetId).filter(Boolean))
    for (const a of ['furniture/wardrobe', 'furniture/bed', 'furniture/counter', 'decor/pot', 'decor/carton', 'furniture/chair']) expect(assets.has(a as never), a).toBe(true)
    // The wardrobe is a real container with its loot; the game runs.
    expect(rt.map.containers.some((c) => c.id.startsWith(`${id}/wardrobe`) && c.loot === 'house-wardrobe')).toBe(true)
    for (let i = 0; i < 30; i++) rt.tick(1 / 60)
  })
})

describe('saves across the looks (G5)', () => {
  it('a save of the lab before its garage (content v1) loads into v2: doors, containers and player kept, the garage new', () => {
    const v2 = loadBundledWorld(LAB).map
    // Content v1 = v2 without the garage (its only stateful change), as the migration file lists.
    const v1: MapData = {
      ...v2,
      contentVersion: 1,
      buildings: v2.buildings.filter((b) => b.id !== 'c0_0/garage'),
      walls: v2.walls.filter((w) => !w.id.startsWith('c0_0/garage')),
      doors: v2.doors.filter((d) => !d.id.startsWith('c0_0/garage')),
      containers: v2.containers.filter((c) => !c.id.startsWith('c0_0/garage')),
      windows: (v2.windows ?? []).filter((w) => !w.id.startsWith('c0_0/garage')),
      rooms: (v2.rooms ?? []).filter((r) => !r.id.startsWith('c0_0/garage')),
    }
    const old = new GameRuntime({ ...v1, zombieSpawns: [] })
    const door = old.world.doors.get(`${A}/door`)!
    door.state = 'open'
    old.player.position = { x: 14, y: 0, z: 13 }
    const save = old.createSnapshot()
    const counter = save.containers.find((c) => c.id === `${A}/counter`)!
    const v = validateSaveGame(save, LAB, v2)
    if (!v.ok) throw new Error(v.detail)
    expect(v).toMatchObject({ migrated: true, contentFrom: 1 })
    expect(v.save.doors.find((d) => d.id === `${A}/door`)!.state).toBe('open')
    expect(v.save.containers.find((c) => c.id === `${A}/counter`)!.items).toEqual(counter.items)
    expect(v.save.containers.some((c) => c.id === 'c0_0/garage/tool-rack')).toBe(true)
    expect(v.save.player.position).toMatchObject({ x: 14, z: 13 })
    const rt = new GameRuntime(v2)
    rt.loadSnapshot(v.save)
    expect(rt.world.doors.get(`${A}/door`)!.state).toBe('open')
  })
})
