import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, loadWorld, REGISTERED_LOOT_TABLES } from '../content'
import { deepCheck } from '../analysis'
import { documentFiles, type MapDocument } from '../editor/document'
import { validateDocument } from '../editor/pack'
import { libraryCatalog } from '../editor/generator'
import { chunkIdOf, chunkIndex, chunkOrigin } from '../transform'
import { GameRuntime } from '../../game/core/runtime'
import { placeBuildings, setParcelPrefab } from './buildings'
import { checkEnvironment, DEFAULT_ENVIRONMENT, entrancePath, entrancePoint, environmentItems, type EnvItem, type PlacedPrefab } from './environment'
import { importGeoJsonLayout } from './importer'
import { buildLayoutWorld } from './layoutWorld'
import { planLayout } from './plan'
import { rectsOverlap } from './rects'
import type { LayoutPlan } from './schema'
import { area, gridStreets, imp, rect, road } from './testUtils'
import FIXTURE from '../../test/fixtures/layouts/wg1-town.geojson?raw'

/** WG5: environment details (§13) — kinds, rules (doors, paths, road clearance), density, determinism, ownership. */

const catalog = libraryCatalog(bundledWorldFiles('prefab-library'))!
const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
const lib = new Map(catalog.prefabs.map((p) => [p.entry.prefabId, p.doc]))
const placedOf = (plan: LayoutPlan) => {
  const m = new Map<string, PlacedPrefab>()
  for (const q of plan.parcels) if (q.build && q.build.prefabId !== null) m.set(q.id, { doc: lib.get(q.build.prefabId)!, build: q.build })
  return m
}
const town = importGeoJsonLayout(FIXTURE, { layoutId: 'wg5-town', name: 'WG5 town' })
const plan = placeBuildings(planLayout(town), catalog).plan
const items = environmentItems(plan, placedOf(plan))
const kindOf = (it: EnvItem) => (it.kind === 'tree' ? 'tree' : it.assetId)
const count = (list: readonly EnvItem[], k: string) => list.filter((it) => kindOf(it) === k).length

describe('WG5 environment on the fixture town', () => {
  it('has every kind: trees, bushes, grass, fences, bins, mailboxes, streetlights, parked and abandoned cars, litter', () => {
    for (const k of ['tree', 'decor/bush', 'decor/grass', 'outdoor/fence', 'outdoor/bin', 'outdoor/mailbox', 'outdoor/streetlight', 'outdoor/car']) expect(count(items, k), k).toBeGreaterThan(0)
    expect(items.some((it) => it.kind === 'container' && it.assetId === 'outdoor/car')).toBe(true)
    expect(items.some((it) => it.kind === 'prop' && it.assetId === 'outdoor/car')).toBe(true)
    expect(items.some((it) => it.kind === 'decor' && ['decor/papers', 'decor/cans', 'decor/oil-stain', 'decor/tires'].includes(it.assetId))).toBe(true)
  })

  it('keeps doors, entrance paths and buildings clear, cars at the kerb with a 3.5 m lane left', () => {
    expect(checkEnvironment(plan, placedOf(plan), items)).toEqual([])
    // Independently: every built lot's path from its entrance to the street is free of colliders.
    const placed = placedOf(plan)
    for (const q of plan.parcels) {
      const p = placed.get(q.id)
      if (!p) continue
      const path = entrancePath(q, entrancePoint(p)!)!
      for (const it of items) {
        if (it.kind === 'decor') continue
        const r = it.kind === 'tree' ? { minX: it.at.x - it.trunk, minZ: it.at.z - it.trunk, maxX: it.at.x + it.trunk, maxZ: it.at.z + it.trunk } : { minX: it.at.x - it.size[0] / 2, minZ: it.at.z - it.size[2] / 2, maxX: it.at.x + it.size[0] / 2, maxZ: it.at.z + it.size[2] / 2 }
        if (it.kind !== 'tree' && it.assetId === 'outdoor/mailbox') continue
        expect(rectsOverlap(r, path), `${it.name} trên lối vào ${q.id}`).toBe(false)
      }
    }
  })

  it('is deterministic; changing one lot changes only that lot’s details', () => {
    expect(environmentItems(plan, placedOf(plan))).toEqual(items)
    const q = plan.parcels.find((x) => x.build && x.build.prefabId !== null && items.some((it) => it.name.startsWith(`env-${x.id}-`)))!
    const cleared = setParcelPrefab(plan, catalog, q.id, null).plan
    const after = environmentItems(cleared, placedOf(cleared))
    const others = (list: readonly EnvItem[]) => list.filter((it) => !it.name.startsWith(`env-${q.id}-`) && !it.name.startsWith('street-'))
    expect(others(after)).toEqual(others(items))
  })

  it('follows the density and the switches', () => {
    expect(environmentItems(plan, placedOf(plan), { ...DEFAULT_ENVIRONMENT, density: 0 })).toEqual([])
    const sparse = environmentItems(plan, placedOf(plan), { ...DEFAULT_ENVIRONMENT, density: 0.2 })
    const dense = environmentItems(plan, placedOf(plan), { ...DEFAULT_ENVIRONMENT, density: 1 })
    expect(sparse.length).toBeLessThan(items.length)
    expect(dense.length).toBeGreaterThan(items.length)
    const noCars = environmentItems(plan, placedOf(plan), { ...DEFAULT_ENVIRONMENT, vehicles: false, streetlights: false })
    expect(count(noCars, 'outdoor/car') + count(noCars, 'outdoor/streetlight')).toBe(0)
    expect(checkEnvironment(plan, placedOf(plan), dense)).toEqual([])
  })
})

describe('WG5 environment in FULL worlds', () => {
  const doc = buildLayoutWorld(town, plan, { worldId: 'wg5-town', name: 'WG5 town', mode: 'full', catalog, validation: OPTS })
  const files = new Map(documentFiles(doc))
  const objects = (d: MapDocument) => [...d.chunks.values()].flatMap((c) => c.objects.map((o) => ({ chunk: c, o })))

  it('validates without a warning: every tree canopy and object inside the play area', () => {
    expect(validateDocument(doc, OPTS)).toEqual([])
  })

  it('writes each item once, into the chunk that owns its position (no duplicate at chunk lines)', () => {
    const env = objects(doc).filter(({ o }) => o.objectId.includes('/objects/env-') || o.objectId.includes('/objects/street-'))
    expect(env).toHaveLength(items.length)
    expect(new Set(env.map(({ o }) => o.objectId)).size).toBe(env.length)
    for (const { chunk, o } of env) {
      const origin = chunkOrigin(chunk.cx, chunk.cz, 32)
      const p = o.position
      expect(chunkIdOf(chunkIndex(origin.x + p.x, 32), chunkIndex(origin.z + p.z, 32))).toBe(chunk.chunkId)
    }
  })

  it('passes the deep check with its trees, fences, cars and bins: every door, container and spawn reachable', () => {
    const issues = deepCheck(loadWorld((path) => files.get(path)).docs).issues
    expect(issues.filter((i) => ['interaction-unreachable', 'spawn-unreachable', 'spawn-indoors', 'collider-overlap', 'start-not-walkable', 'zone-unreachable'].includes(i.code))).toEqual([])
  })

  it('plays: loot in bins and wrecks, zombies walk the streets for ten seconds', () => {
    const map = loadWorld((path) => files.get(path)).map
    expect(map.containers.some((c) => c.name === 'Xe bỏ hoang')).toBe(true)
    const rt = new GameRuntime(map)
    for (let i = 0; i < 600; i++) rt.tick(1 / 60)
    expect(rt.zombies.size).toBeGreaterThan(0)
  })

  it('has no environment in LAYOUT_ONLY worlds', () => {
    const bare = buildLayoutWorld(town, plan, { worldId: 'wg5-bare', name: 'bare', mode: 'layout-only', validation: OPTS })
    expect(objects(bare)).toHaveLength(0)
  })

  it('stays within the rules on vn-urban rows and a dense 500 m town', () => {
    const big = imp([road('way/n', [[-60, 40], [60, 40]]), road('way/s', [[-60, -40], [60, -40]]), road('way/w', [[-60, -40], [-60, 40]]), road('way/e', [[60, -40], [60, 40]]), area('way/lu', [rect(-90, -70, 90, 70)], { landuse: 'residential' })], { normalize: { alignment: 0 } })
    const vp = placeBuildings(planLayout(big, { profile: 'vn-urban' }), catalog).plan
    expect(checkEnvironment(vp, placedOf(vp), environmentItems(vp, placedOf(vp)))).toEqual([])
    const dense = imp(gridStreets(21, 25, 31, 0.6))
    const dp = placeBuildings(planLayout(dense), catalog).plan
    const di = environmentItems(dp, placedOf(dp))
    expect(di.length).toBeGreaterThan(2000)
    expect(checkEnvironment(dp, placedOf(dp), di)).toEqual([])
  })
})
