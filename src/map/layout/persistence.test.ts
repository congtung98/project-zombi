import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, loadWorld, REGISTERED_LOOT_TABLES } from '../content'
import { documentFiles, type MapDocument } from '../editor/document'
import { libraryCatalog } from '../editor/generator'
import { exportPack, parsePack } from '../editor/pack'
import { GameRuntime } from '../../game/core/runtime'
import { totalQuantity } from '../../game/systems/inventory'
import { validateSaveGame } from '../../game/systems/save'
import { placeBuildings } from './buildings'
import { importGeoJsonLayout } from './importer'
import { planLayout } from './plan'
import { createLayoutWorld, documentLayout, LAYOUT_FILE, syncGenerated } from './worldSync'
import FIXTURE from '../../test/fixtures/layouts/wg1-town.geojson?raw'

/**
 * WG5 persistence (§14): a generated world plays and saves through the game's own IndexedDB save
 * format, the generator data (layout, seed, versions, placements, hand overrides, locks) stays apart
 * in the world folder, and a world regenerated after a save was made never takes that save silently.
 */

const catalog = libraryCatalog(bundledWorldFiles('prefab-library'))!
const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
const DT = 1 / 60

function world(): MapDocument {
  const l = importGeoJsonLayout(FIXTURE, { layoutId: 'wg5-save', name: 'WG5 save' })
  const plan = placeBuildings(planLayout(l), catalog).plan
  return createLayoutWorld({ ...l, plan }, { worldId: 'wg5-save', name: 'WG5 save', mode: 'full', catalog, validation: OPTS })
}
const mapOf = (doc: MapDocument) => {
  const files = new Map(documentFiles(doc))
  return loadWorld((p) => files.get(p)).map
}

describe('WG5 generated worlds and saves', () => {
  const doc = world()

  it('saves and loads a played generated world: loot taken from a wreck, doors, player, zombies', () => {
    const map = mapOf(doc)
    const rt = new GameRuntime(map)
    rt.newGame(7)
    for (let i = 0; i < 60; i++) rt.tick(DT)
    const wreck = map.containers.find((c) => c.name === 'Xe bỏ hoang')!
    // Stand next to the wreck (beside it, on the road) and loot it.
    rt.player.position = { x: wreck.position.x + wreck.size[0] / 2 + 0.6, y: 0.9, z: wreck.position.z }
    rt.tick(DT)
    const target = rt.interactables.find((i) => i.id === wreck.id)!
    rt.interact(target)
    const box = rt.world.containers.get(wreck.id)!
    const before = totalQuantity(box.items)
    if (before > 0) rt.takeFromContainer(rt.openContainer!.items.items[0].id)
    rt.closeAllUi()
    const door = map.doors[0]
    rt.interact(rt.interactables.find((i) => i.id === door.id)!)
    rt.tick(DT)

    const snap = JSON.parse(JSON.stringify(rt.createSnapshot())) as unknown
    const v = validateSaveGame(snap, map.id, map)
    expect(v.ok).toBe(true)
    if (!v.ok) return
    const rt2 = new GameRuntime(mapOf(doc))
    rt2.loadSnapshot(v.save)
    expect(rt2.world.containers.get(wreck.id)!.opened).toBe(true)
    expect(rt2.world.containers.get(wreck.id)!.items).toEqual(box.items)
    expect(totalQuantity(rt2.player.inventory)).toBe(totalQuantity(rt.player.inventory))
    expect(rt2.world.doors.get(door.id)?.state).toBe(rt.world.doors.get(door.id)?.state)
    expect(rt2.zombies.size).toBe(rt.zombies.size)
  })

  it('keeps the generator data in the world folder, never in the save: seed, versions, placements, overrides, locks', () => {
    const q = documentLayout(doc).layout!.plan!.parcels.find((x) => x.build && x.build.prefabId !== null)!
    const locked = syncGenerated(doc, { kind: 'lock', ids: [q.id], locked: true }, { catalog, validation: OPTS })
    if (!locked.ok) throw new Error(locked.error)
    const back = parsePack(exportPack(locked.doc), OPTS)
    if (!back.ok) throw new Error(back.error)
    const layout = documentLayout(back.doc).layout!
    expect(layout.plan!.params.seed).toBe(1)
    expect(layout.plan!.version).toBeGreaterThan(0)
    expect(layout.generated!.version).toBeGreaterThan(0)
    expect(layout.plan!.catalog).toBe(catalog.id)
    expect(layout.plan!.parcels.find((x) => x.id === q.id)!.locked).toBe(true)
    expect(back.doc.world.generator).toMatchObject({ name: 'world-layout', seed: 1 })
    // The game's save of this world holds runtime state only.
    const rt = new GameRuntime(mapOf(back.doc))
    rt.newGame(1)
    const save = JSON.stringify(rt.createSnapshot())
    expect(save).not.toContain(LAYOUT_FILE)
    expect(save).not.toContain('"parcels"')
  })

  it('refuses a save of the world before it was regenerated, instead of loading it into other buildings (Q3)', () => {
    const map = mapOf(doc)
    const rt = new GameRuntime(map)
    rt.newGame(3)
    const snap = JSON.parse(JSON.stringify(rt.createSnapshot())) as unknown
    const r = syncGenerated(doc, { kind: 'world', params: { seed: 9 } }, { catalog, validation: OPTS })
    if (!r.ok) throw new Error(r.error)
    const regenerated = mapOf(r.doc)
    const v = validateSaveGame(snap, regenerated.id, regenerated)
    expect(v.ok).toBe(false)
  })
})
