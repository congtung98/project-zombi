import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, loadWorld, REGISTERED_LOOT_TABLES } from '../content'
import { deepCheck } from '../analysis'
import { documentFiles, type MapDocument } from '../editor/document'
import { exportPack, parsePack } from '../editor/pack'
import { updatePrefab } from '../editor/prefabCommands'
import { checkWorldDocuments } from '../validate'
import { rotateRect } from '../transform'
import type { PrefabDocument, PrefabEntry, WorldDocument } from '../schema'
import { GameRuntime } from '../../game/core/runtime'
import { checkBuildings, DEFAULT_VACANCY, fitPrefab, placeBuildings, prefabCatalog, setParcelPrefab, type PrefabCatalog } from './buildings'
import { importGeoJsonLayout } from './importer'
import { buildLayoutWorld } from './layoutWorld'
import { parcelRect } from './parcels'
import { planLayout, replan } from './plan'
import { rectPolygon, rectsOverlap } from './rects'
import type { LayoutParcel, LayoutPlan, ParcelBuild, Side } from './schema'
import { area, gridStreets, imp, rect, road } from './testUtils'
import FIXTURE from '../../test/fixtures/layouts/wg1-town.geojson?raw'

/** WG3: prefab library, placement metadata, buildings on parcels, FULL worlds. */

const LIB = bundledWorldFiles('prefab-library')
const libWorld = LIB.get('world.json') as WorldDocument
const libPrefabs = libWorld.prefabs.map((entry: PrefabEntry) => ({ entry, doc: LIB.get(entry.path) as PrefabDocument }))
const catalog: PrefabCatalog = prefabCatalog(`${libWorld.worldId}@${libWorld.contentVersion}`, libPrefabs)
const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
const town = () => importGeoJsonLayout(FIXTURE, { layoutId: 'wg1-town', name: 'WG1 town' })
type Built = LayoutParcel & { build: Extract<ParcelBuild, { prefabId: string }> }
const builtOf = (p: LayoutPlan) => p.parcels.filter((q): q is Built => !!q.build && q.build.prefabId !== null)

describe('WG3 prefab library (hidden world)', () => {
  it('is a valid hidden world whose every prefab has placement metadata', () => {
    expect(libWorld.listed).toBe(false)
    const checked = checkWorldDocuments((p) => LIB.get(p), OPTS)
    expect(checked.issues).toEqual([])
    expect(deepCheck(loadWorld((p) => LIB.get(p)).docs).issues).toEqual([])
    // Prefab library P4–P5 (owner decision D6): large public buildings and landscape pieces (chapel,
    // kiosk, guard tower) are placed by hand only, alone or in their compounds.
    const manual = libPrefabs.filter((p) => !p.doc.placement)
    expect(manual.every((p) => (p.doc.catalog?.group === 'public' && p.entry.prefabId.startsWith('public/')) || (p.doc.catalog?.group === 'landscape' && p.entry.prefabId.startsWith('landscape/')))).toBe(true)
    expect(catalog.prefabs).toHaveLength(libPrefabs.length - manual.length)
  })

  it('covers every building zone, with the four placeholder prefabs and the existing houses', () => {
    const cats = new Set(catalog.prefabs.map((p) => p.placement.category))
    expect([...cats].sort()).toEqual(['house', 'industrial', 'outbuilding', 'public', 'shop'])
    for (const zone of ['residential', 'commercial', 'industrial', 'public'] as const) expect(catalog.prefabs.some((p) => p.placement.allowedZones.includes(zone))).toBe(true)
    const ids = catalog.prefabs.map((p) => p.entry.prefabId)
    expect(ids).toEqual(expect.arrayContaining(['library/corner-shop', 'library/warehouse', 'library/clinic', 'library/tube-house', 'building/house', 'building/store', 'building/two-storey']))
    // The house's first door is on its north wall; the two-storey house's on the west.
    expect(catalog.prefabs.find((p) => p.entry.prefabId === 'building/house')!.entrance).toBe('N')
    expect(catalog.prefabs.find((p) => p.entry.prefabId === 'building/two-storey')!.entrance).toBe('W')
  })

  it('validates placement metadata and edits it with the prefab command', () => {
    const files = new Map(LIB)
    const house = structuredClone(LIB.get('prefabs/house.json')) as PrefabDocument
    files.set('prefabs/house.json', { ...house, placement: { ...house.placement!, weight: 0, allowedZones: ['moon'], frontage: [10, 5] } })
    const codes = checkWorldDocuments((p) => files.get(p), OPTS).issues.filter((i) => i.path.includes('/placement')).map((i) => i.path)
    expect(codes).toEqual(expect.arrayContaining(['prefabs/house.json#/placement/weight', 'prefabs/house.json#/placement/allowedZones/0', 'prefabs/house.json#/placement/frontage']))
    const doc = loadWorld((p) => LIB.get(p)).docs
    const md: MapDocument = { world: doc.world, prefabs: doc.prefabs, chunks: doc.chunks, extras: new Map() }
    const bad = updatePrefab(md, 'building/house', { placement: { ...house.placement!, allowedZones: [] } })
    expect(bad.ok).toBe(false)
    const good = updatePrefab(md, 'building/house', { placement: { ...house.placement!, allowedZones: ['public', 'residential'] } })
    expect(good.ok && good.doc.prefabs.get('building/house')!.placement!.allowedZones).toEqual(['residential', 'public'])
    const cleared = updatePrefab(md, 'building/house', { placement: null })
    expect(cleared.ok && cleared.doc.prefabs.get('building/house')!.placement).toBeUndefined()
  })
})

/** A 20 × 30 m lot fronting a street on `side` (the long side away from it). */
function lot(side: Side, frontage = 20, depth = 30): LayoutParcel {
  const alongX = side === 'N' || side === 'S'
  const r = alongX ? { minX: 0, minZ: 0, maxX: frontage, maxZ: depth } : { minX: 0, minZ: 0, maxX: depth, maxZ: frontage }
  return { id: 'lot-test', block: 'block-test', polygon: rectPolygon(r), area: frontage * depth, zone: 'residential', kind: 'lot', access: { edge: 'e', side, frontage, roadClass: 'local' }, buildable: null, seed: 1, locked: false }
}

describe('WG3 fitting a prefab on a lot', () => {
  const house = catalog.prefabs.find((p) => p.entry.prefabId === 'building/house')!

  it('turns the entrance to the street on every side, keeps the setback and never scales', () => {
    for (const side of ['N', 'S', 'E', 'W'] as const) {
      const q = lot(side)
      const fit = fitPrefab(q, house)!
      expect(fit).not.toBeNull()
      const plan = { surfaces: [], parcels: [{ ...q, build: { prefabId: house.entry.prefabId, ...fit, source: 'generated' as const } }] } as unknown as LayoutPlan
      expect(checkBuildings(plan, catalog)).toEqual([])
      const rr = rotateRect(house.local, fit.quarterTurns)
      expect(fit.footprint.maxX - fit.footprint.minX).toBeCloseTo(rr.maxX - rr.minX, 9)
      expect(fit.footprint.maxZ - fit.footprint.minZ).toBeCloseTo(rr.maxZ - rr.minZ, 9)
      const r = parcelRect(q)
      const gap = { N: fit.footprint.minZ - r.minZ, S: r.maxZ - fit.footprint.maxZ, W: fit.footprint.minX - r.minX, E: r.maxX - fit.footprint.maxX }[side]
      // At the setback, or up to half a metre further in (the pivot sits on the 0.5 m grid).
      expect(gap).toBeGreaterThanOrEqual(house.placement.setback - 1e-6)
      expect(gap).toBeLessThanOrEqual(house.placement.setback + 0.5 + 1e-6)
      expect(fit.position.x % 0.5 === 0 && fit.position.z % 0.5 === 0).toBe(true)
    }
  })

  it('refuses a lot too narrow or too shallow, and honours the frontage range', () => {
    expect(fitPrefab(lot('N', 10.5), house)).toBeNull() // 9 m house + 2 × 1.5 m side gaps
    expect(fitPrefab(lot('N', 20, 10), house), 'shallow').toBeNull()
    const tube = catalog.prefabs.find((p) => p.entry.prefabId === 'library/tube-house')!
    expect(fitPrefab(lot('S', 5, 16), tube)).not.toBeNull()
    expect(fitPrefab(lot('S', 20, 16), tube)).toBeNull()
    // Row house: built to both lot lines of a 4 m lot, on the 0.5 m grid in a 4.5 m one.
    const f = fitPrefab(lot('S', 4, 16), tube)!
    expect([f.footprint.minX, f.footprint.maxX]).toEqual([0, 4])
    const g = fitPrefab(lot('S', 4.5, 16), tube)!
    expect(g.position.x % 0.5).toBe(0)
  })

  it('leaves parcels without a street alone', () => {
    expect(fitPrefab({ ...lot('N'), access: null, kind: 'interior' }, house)).toBeNull()
  })
})

describe('WG3 buildings on the fixture town', () => {
  const l = town()
  const plan = planLayout(l)
  const { plan: p1, issues } = placeBuildings(plan, catalog)

  it('builds on most lots, keeps some empty on purpose, and never on open or interior land', () => {
    const built = builtOf(p1)
    expect(built.length).toBeGreaterThan(60)
    expect(p1.parcels.some((q) => q.build?.prefabId === null && q.build.reason === 'vacant')).toBe(true)
    expect(p1.parcels.filter((q) => q.kind !== 'lot').every((q) => q.build === null)).toBe(true)
    expect(p1.catalog).toBe(catalog.id)
    expect(issues.find((i) => i.code === 'buildings')).toBeTruthy()
  })

  it('keeps every building inside its lot, off the streets, apart, facing its street, in an allowed zone', () => {
    expect(checkBuildings(p1, catalog)).toEqual([])
    for (const q of builtOf(p1)) {
      const p = catalog.prefabs.find((x) => x.entry.prefabId === q.build.prefabId)!
      expect(p.placement.allowedZones).toContain(q.zone)
      for (const s of p1.surfaces) expect(rectsOverlap(s.rect, q.build.footprint)).toBe(false)
    }
    expect(new Set(builtOf(p1).map((q) => q.zone))).toEqual(new Set(['residential', 'commercial', 'public']))
  })

  it('is deterministic; a salt changes buildings but never streets or parcels', () => {
    expect(JSON.stringify(placeBuildings(plan, catalog).plan)).toBe(JSON.stringify(p1))
    const salted = placeBuildings(plan, catalog, { salt: 3 }).plan
    expect(salted.surfaces).toEqual(p1.surfaces)
    expect(salted.parcels.map((q) => q.polygon)).toEqual(p1.parcels.map((q) => q.polygon))
    expect(salted.parcels.map((q) => q.build?.prefabId)).not.toEqual(p1.parcels.map((q) => q.build?.prefabId))
  })

  it('regenerates selected parcels only (SELECTIVE_REGENERATION), never locked ones', () => {
    const built = builtOf(p1)
    const [a, b, c] = [built[0], built[5], built[10]]
    const locked = { ...p1, parcels: p1.parcels.map((q) => (q.id === c.id ? { ...q, locked: true } : q)) }
    const again = placeBuildings(locked, catalog, { parcels: [a.id, b.id, c.id], salt: 9 })
    for (const q of again.plan.parcels) if (q.id !== a.id && q.id !== b.id) expect(q).toEqual(locked.parcels.find((x) => x.id === q.id))
    expect(again.issues.find((i) => i.code === 'parcel-locked')?.ids).toEqual([c.id])
    expect(checkBuildings(again.plan, catalog)).toEqual([])
  })

  it('regenerates by chunk, skipping hand-chosen buildings', () => {
    const q = builtOf(p1)[3]
    const c = { x: (parcelRect(q).minX + parcelRect(q).maxX) / 2, z: (parcelRect(q).minZ + parcelRect(q).maxZ) / 2 }
    const chunk = `c${Math.floor(c.x / 32)}_${Math.floor(c.z / 32)}`
    const manual = setParcelPrefab(p1, catalog, q.id, null).plan
    const again = placeBuildings(manual, catalog, { chunks: [chunk], salt: 5 }).plan
    expect(again.parcels.find((x) => x.id === q.id)!.build).toEqual({ prefabId: null, reason: 'cleared', source: 'manual' })
    const outside = (p: LayoutPlan) => p.parcels.filter((x) => { const r = parcelRect(x); return `c${Math.floor((r.minX + r.maxX) / 64)}_${Math.floor((r.minZ + r.maxZ) / 64)}` !== chunk })
    expect(outside(again)).toEqual(outside(manual))
  })

  it('replaces a prefab by hand: must fit, zone mismatch is a warning, streets never change', () => {
    const home = builtOf(p1).find((q) => q.zone === 'residential' && q.access!.frontage >= 14)!
    const r1 = setParcelPrefab(p1, catalog, home.id, 'building/store')
    expect(r1.issues.map((i) => i.code)).toEqual(['zone-mismatch'])
    const b = r1.plan.parcels.find((q) => q.id === home.id)!.build as Built['build']
    expect(b).toMatchObject({ prefabId: 'building/store', source: 'manual' })
    expect(r1.plan.surfaces).toBe(p1.surfaces)
    expect(checkBuildings(r1.plan, catalog)).toEqual([])
    expect(setParcelPrefab(p1, catalog, home.id, 'library/warehouse').issues[0].code).toBe('prefab-does-not-fit')
    expect(setParcelPrefab(p1, catalog, home.id, 'nope/nope').issues[0].code).toBe('unknown-prefab')
    const locked = { ...p1, parcels: p1.parcels.map((q) => (q.id === home.id ? { ...q, locked: true } : q)) }
    expect(setParcelPrefab(locked, catalog, home.id, null).issues[0].code).toBe('parcel-locked')
  })

  it('keeps hand-chosen buildings through a replan with another seed', () => {
    const home = builtOf(p1)[2]
    const chosen = setParcelPrefab(p1, catalog, home.id, null).plan
    const next = replan(l, chosen, { seed: 4 })
    expect(next.parcels.find((q) => q.id === home.id)).toEqual(chosen.parcels.find((q) => q.id === home.id))
    expect(next.catalog).toBe(catalog.id)
    const filled = placeBuildings(next, catalog).plan
    expect(checkBuildings(filled, catalog)).toEqual([])
  })

  it('puts tube houses on vn-urban lots', () => {
    const big = imp([road('way/n', [[-100, 80], [0, 80], [100, 80]]), road('way/s', [[-100, -80], [0, -80], [100, -80]]), road('way/w', [[-100, -80], [-100, 80]]), road('way/e', [[100, -80], [100, 80]]), road('way/c', [[0, -80], [0, 80]]), area('way/lu', [rect(-130, -110, 130, 110)], { landuse: 'residential' })], { normalize: { alignment: 0 } })
    const vn = placeBuildings(planLayout(big, { profile: 'vn-urban' }), catalog).plan
    const built = builtOf(vn)
    expect(built.length).toBeGreaterThan(200)
    // Only the narrow houses fit vn-urban lots (P2 added the 4 m and 5 m tube houses and the shophouse).
    const narrow = new Set(['library/tube-house', 'house/tube-4x16', 'house/tube-5x18', 'house/shophouse'])
    expect([...new Set(built.map((q) => q.build.prefabId))].filter((id) => !narrow.has(id!))).toEqual([])
    expect(built.some((q) => q.build.prefabId === 'library/tube-house')).toBe(true)
    expect(checkBuildings(vn, catalog)).toEqual([])
  })

  it('has sensible vacancy defaults (every lot of a non-building zone stays open)', () => {
    expect(DEFAULT_VACANCY.forest).toBe(1)
    expect(DEFAULT_VACANCY.residential).toBeLessThan(0.2)
  })
})

describe('WG3 FULL world', () => {
  const l = town()
  const p = placeBuildings(planLayout(l), catalog).plan
  const doc = buildLayoutWorld(l, p, { worldId: 'wg3-town', name: 'WG3 town', mode: 'full', catalog, validation: OPTS })
  const files = new Map(documentFiles(doc))
  const instances = () => [...doc.chunks.values()].flatMap((c) => c.instances)
  const zones = () => [...doc.chunks.values()].flatMap((c) => c.zones)
  const spawns = () => [...doc.chunks.values()].flatMap((c) => c.spawns)

  it('holds one instance per building, the used prefabs only, zombie zones and spawns', () => {
    expect(checkWorldDocuments((path) => files.get(path), OPTS).issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(instances()).toHaveLength(builtOf(p).length)
    expect(new Set(doc.world.prefabs.map((e) => e.prefabId))).toEqual(new Set(builtOf(p).map((q) => q.build.prefabId)))
    expect(instances().every((i) => i.instanceId.split('/')[1].startsWith('lot-'))).toBe(true)
    expect(zones().length).toBeGreaterThanOrEqual(5)
    expect(spawns().filter((s) => s.kind === 'zombie').length).toBeGreaterThanOrEqual(zones().length)
    expect(doc.world.generator).toMatchObject({ params: { mode: 'full' }, catalog: catalog.id })
  })

  it('passes the deep check: every door, container and zombie spawn reachable, nothing overlapping', () => {
    const issues = deepCheck(loadWorld((path) => files.get(path)).docs).issues
    expect(issues.filter((i) => ['interaction-unreachable', 'spawn-unreachable', 'spawn-indoors', 'collider-overlap', 'start-not-walkable'].includes(i.code))).toEqual([])
  })

  it('plays: zombies spawn and walk the streets for ten seconds', () => {
    const map = loadWorld((path) => files.get(path)).map
    expect(map.doors.length).toBeGreaterThan(builtOf(p).length)
    const rt = new GameRuntime(map)
    for (let i = 0; i < 600; i++) rt.tick(1 / 60)
    expect(rt.zombies.size).toBeGreaterThan(0)
    expect(Number.isFinite(rt.player.position.x)).toBe(true)
  })

  it('keeps row houses (vn-urban tube houses built to the lot lines) enterable', () => {
    const big = imp([road('way/n', [[-60, 40], [60, 40]]), road('way/s', [[-60, -40], [60, -40]]), road('way/w', [[-60, -40], [-60, 40]]), road('way/e', [[60, -40], [60, 40]]), area('way/lu', [rect(-90, -70, 90, 70)], { landuse: 'residential' })], { normalize: { alignment: 0 } })
    const vp = placeBuildings(planLayout(big, { profile: 'vn-urban' }), catalog).plan
    expect(builtOf(vp).length).toBeGreaterThan(40)
    const vdoc = buildLayoutWorld(big, vp, { worldId: 'vn', name: 'vn', mode: 'full', catalog, validation: OPTS })
    const vf = new Map(documentFiles(vdoc))
    const deep = deepCheck(loadWorld((path) => vf.get(path)).docs).issues
    expect(deep.filter((i) => ['interaction-unreachable', 'spawn-unreachable', 'collider-overlap'].includes(i.code))).toEqual([])
  })

  it('round-trips through an editor content pack', () => {
    expect(parsePack(exportPack(doc), OPTS).ok).toBe(true)
  })

  it('builds a dense 500 × 500 m town quickly', () => {
    const dense = imp(gridStreets(21, 25, 31, 0.6))
    const t0 = performance.now()
    const dp = placeBuildings(planLayout(dense), catalog).plan
    const world = buildLayoutWorld(dense, dp, { worldId: 'dense', name: 'dense', mode: 'full', catalog, validation: OPTS })
    expect(performance.now() - t0).toBeLessThan(5000)
    expect([...world.chunks.values()].reduce((n, c) => n + c.instances.length, 0)).toBeGreaterThan(200)
  })
})
