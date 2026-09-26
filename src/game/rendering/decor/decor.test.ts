import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, loadBundledWorld, REGISTERED_LOOT_TABLES } from '../../../map/content'
import { checkWorldDocuments } from '../../../map/validate'
import { documentFiles, type MapDocument } from '../../../map/editor/document'
import { documentFromFiles } from '../../../map/editor/pack'
import { placePrefabItem, rotatePrefabItems, updatePrefab, updatePrefabItem } from '../../../map/editor/prefabCommands'
import { PREFAB_PRESETS } from '../../../map/editor/prefabPresets'
import type { CommandResult } from '../../../map/editor/commands'
import { statefulIds } from '../../../map/contentMigration'
import { GameRuntime } from '../../core/runtime'
import type { MapData } from '../../world/mapData'
import { collectStaticItems, itemBounds } from '../staticBatchData'
import { ROOM_FLOOR_LIFT } from '../architecture'
import { DECOR, DECOR_IDS } from './catalog'
import { decorParts } from './assets'
import { resolveVariant, stableHash, variantColor, VARIANT_IDS } from '../variants'

/**
 * G3b: decor (drawn only), clusters placed from the editor, and house variants. Decor stays inside
 * its registered size, never becomes a collider, sight blocker or saved state; a variant only changes
 * looks and is stable for an instance; the lab shows one prefab lived-in and abandoned.
 */

const LAB = 'graphics-lab'
const A = 'c0_0/house-a'
const B = 'c0_0/house-b'
const world = (id: string): MapData => ({ ...loadBundledWorld(id).map, zombieSpawns: [] })
const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
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
const issues = (doc: MapDocument) => {
  const files = new Map(documentFiles(doc))
  return checkWorldDocuments((p) => files.get(p), OPTS).issues
}

describe('decor assets (G3b)', () => {
  it('every asset stays inside its registered size, parts turned or not', () => {
    const outside: string[] = []
    for (const id of DECOR_IDS) {
      const [w, h, d] = DECOR[id].size
      const parts = decorParts(id)
      expect(parts.length, id).toBeGreaterThan(0)
      expect(new Set(parts.map((p) => p.name)).size).toBe(parts.length)
      for (const p of parts) {
        const b = itemBounds({ center: { x: p.center[0], y: p.center[1], z: p.center[2] } as never, size: p.size, shape: 'box', yaw: p.yaw })
        const e = 1e-9
        if (b.min.x < -w / 2 - e || b.max.x > w / 2 + e || b.min.z < -d / 2 - e || b.max.z > d / 2 + e || b.min.y < -e || b.max.y > h + e) {
          outside.push(`${id} ${p.name}: x ${b.min.x.toFixed(3)}…${b.max.x.toFixed(3)} y …${b.max.y.toFixed(3)} z ${b.min.z.toFixed(3)}…${b.max.z.toFixed(3)}`)
        }
      }
    }
    expect(outside).toEqual([])
  })
})

describe('house variants (G3b)', () => {
  it('a seed of instance ID and prefab version: stable, spread, overridden by a valid choice', () => {
    expect(stableHash('c0_0/house-a@1')).toBe(stableHash('c0_0/house-a@1'))
    const offered = ['intact', 'lived-in', 'abandoned']
    const picks = new Set(Array.from({ length: 40 }, (_, i) => resolveVariant(offered, undefined, `c0_0/house-${i}`, 1)))
    expect(picks).toEqual(new Set(offered))
    expect(resolveVariant(offered, 'abandoned', 'x', 1)).toBe('abandoned')
    // A choice the prefab does not offer falls back to the seed; no variants offered: none.
    expect(resolveVariant(['lived-in'], 'abandoned', 'x', 1)).toBe('lived-in')
    expect(resolveVariant(undefined, 'abandoned', 'x', 1)).toBeUndefined()
    // The lived-in palette is the content colour; the abandoned one is duller and darker.
    expect(variantColor('#b9a58c', 'lived-in')).toBe('#b9a58c')
    expect(variantColor('#b9a58c', 'abandoned')).not.toBe('#b9a58c')
    expect(VARIANT_IDS).toEqual(['intact', 'lived-in', 'abandoned'])
  })
})

describe('decor and variants in the lab (G3b)', () => {
  const rt = new GameRuntime(world(LAB))
  const items = collectStaticItems(rt.map, rt.staticColliders)
  const decorOf = (b: string) => (rt.map.decor ?? []).filter((d) => d.id.startsWith(`${b}/`)).map((d) => d.id.slice(b.length + 1)).sort()

  it('each house shows its variant\'s decor, the rug in both, the garage its own', () => {
    expect(decorOf(A)).toContain('plate-1')
    expect(decorOf(A)).not.toContain('carton-1')
    expect(decorOf(B)).toContain('carton-1')
    expect(decorOf(B)).not.toContain('plate-1')
    for (const b of [A, B]) expect(decorOf(b)).toContain('rug-living')
    expect(decorOf('c0_0/garage')).toEqual(['jerrycan-1', 'jerrycan-2', 'oil-stain', 'oil-stain-2', 'tires', 'toolbox'])
  })

  it('decor is drawn only: colliders, sight blockers, containers and saved IDs are those without it', () => {
    const bare = world(LAB)
    delete bare.decor
    const plain = new GameRuntime(bare)
    expect(rt.staticColliders.list('wall').map((c) => c.id)).toEqual(plain.staticColliders.list('wall').map((c) => c.id))
    expect(rt.visionOccluders.all.map((o) => o.id)).toEqual(plain.visionOccluders.all.map((o) => o.id))
    expect(statefulIds([rt.map])).toEqual(statefulIds([plain.map]))
    // No decor ID is a stateful one or a collider.
    const colliderIds = new Set(rt.staticColliders.list('wall').map((c) => c.id))
    for (const d of rt.map.decor ?? []) expect(colliderIds.has(d.id)).toBe(false)
    expect(items.filter((i) => i.decor).every((i) => !i.occluder && i.anchor)).toBe(true)
  })

  it('the variant never changes loot, colliders or the house pieces, only their colours and furniture looks', () => {
    const swapped = world(LAB)
    swapped.buildings = swapped.buildings.map((b) => (b.variant ? { ...b, variant: b.variant === 'abandoned' ? 'lived-in' : 'abandoned' } : b))
    const other = new GameRuntime(swapped)
    expect(other.map.containers).toEqual(rt.map.containers)
    expect(other.staticColliders.list('wall').map((c) => [c.id, c.min, c.max])).toEqual(rt.staticColliders.list('wall').map((c) => [c.id, c.min, c.max]))
    // Abandoned: unmade beds (one pillow), emptied shelves.
    const parts = (id: string) => items.filter((i) => i.id === id).map((i) => i.furniture!.part)
    expect(parts(`${A}/bed`).filter((p) => p.startsWith('pillow'))).toHaveLength(2)
    expect(parts(`${B}/bed`).filter((p) => p.startsWith('pillow'))).toHaveLength(1)
    expect(parts(`${B}/bookshelf`).filter((p) => p.startsWith('books')).length).toBeLessThan(parts(`${A}/bookshelf`).filter((p) => p.startsWith('books')).length)
    // An explicit look wins over the house: the garage rack holds tools.
    expect(items.filter((i) => i.id === 'c0_0/garage/tool-rack' && i.furniture?.part.startsWith('goods')).map((i) => i.color)).toContain('#a3322a')
  })

  it('decor on the floor sits above the floor layers; on a table at the table top; turned with its house', () => {
    const lowest = (id: string) => Math.min(...items.filter((i) => i.id === id).map((i) => itemBounds(i).min.y))
    // Ground floor rug: above the building floor (0.02) and a room floor (+ lift).
    expect(lowest(`${A}/rug-living`)).toBeGreaterThan(0.02 + ROOM_FLOOR_LIFT)
    expect(lowest(`${A}/rug-living`)).toBeLessThan(0.03)
    // Upper storey (3 m): above the slab top and its room floor.
    expect(lowest(`${A}/schoolbag`)).toBeGreaterThan(3 + ROOM_FLOOR_LIFT)
    expect(lowest(`${A}/plate-1`)).toBeCloseTo(0.75, 6)
    // House B is turned 180°: the same rug, turned by π more.
    const yaw = (b: string) => (rt.map.decor ?? []).find((d) => d.id === `${b}/rug-living`)!.yaw
    expect(Math.abs(Math.cos(yaw(B) - yaw(A) - Math.PI) - 1)).toBeLessThan(1e-9)
  })

  it('the askew chair turns inside its collider box', () => {
    const chair = items.filter((i) => i.id === `${A}/chair-2`)
    expect(chair.every((i) => Math.abs(i.yaw! - (25 * Math.PI) / 180) < 1e-9)).toBe(true)
    const c = rt.staticColliders.get(`${A}/chair-2`)!
    for (const i of chair) {
      const b = itemBounds(i)
      expect(b.min.x).toBeGreaterThanOrEqual(c.min.x - 1e-6)
      expect(b.max.x).toBeLessThanOrEqual(c.max.x + 1e-6)
      expect(b.min.z).toBeGreaterThanOrEqual(c.min.z - 1e-6)
      expect(b.max.z).toBeLessThanOrEqual(c.max.z + 1e-6)
    }
  })
})

describe('decor in content and the editor (G3b)', () => {
  it('validation: unknown decor is a warning, bad variants errors, clutter warnings', () => {
    let doc = ok(updatePrefabItem(labDoc(), P, 'cup-1', { assetId: 'decor/teapot' })).doc
    expect(issues(doc).filter((i) => i.severity === 'error')).toEqual([])
    expect(issues(doc).filter((i) => i.code === 'unknown-asset')).toHaveLength(1)
    doc = ok(updatePrefabItem(labDoc(), P, 'cup-1', { variants: ['ruined'] })).doc
    expect(issues(doc).filter((i) => i.severity === 'error').map((i) => i.path.split('/').slice(-2).join('/'))).toEqual(['variants/0'])
    // A pot on the counter's loot marker, a bag in the front door's swing.
    doc = ok(updatePrefabItem(labDoc(), P, 'pot', { position: { x: 3.3, y: 0.9, z: -4 } })).doc
    doc = ok(updatePrefabItem(doc, P, 'backpack', { position: { x: -1.5, y: 0, z: 4 } })).doc
    expect(issues(doc).filter((i) => i.code.startsWith('decor-')).map((i) => i.code).sort()).toEqual(['decor-in-doorway', 'decor-on-container'])
    // Furniture yaw out of range is an error; an unknown look a warning.
    doc = ok(updatePrefabItem(labDoc(), P, 'bed', { visual: { assetId: 'furniture/bed', yaw: 60, variantId: 'burnt' } })).doc
    expect(issues(doc).filter((i) => i.path.includes('/visual/')).map((i) => [i.severity, i.path.split('/').pop()])).toEqual([
      ['error', 'yaw'],
      ['warning', 'variantId'],
    ])
  })

  it('a cluster places its objects with their own IDs, turned by R, valid as placed', () => {
    const preset = PREFAB_PRESETS.find((p) => p.id === 'cluster/dinner')!
    let doc = labDoc()
    const r = ok(placePrefabItem(doc, P, 'cluster/dinner', { x: -3, z: -2.5 }, null, 1, 0))
    doc = r.doc
    expect(r.selection).toHaveLength(preset.cluster!.length)
    const placed = r.selection.map((k) => doc.prefabs.get(P)!.objects.find((o) => o.localId === k)!)
    expect(new Set(r.selection).size).toBe(r.selection.length)
    // Turned a quarter: the table's sides swap, the chairs' facings turn, the plates' offsets turn.
    const table = placed.find((o) => o.kind === 'prop' && o.visual?.assetId === 'furniture/table') as { size: number[] }
    expect(table.size).toEqual([0.9, 0.75, 1.4])
    const chairs = placed.filter((o) => o.kind === 'prop' && o.visual?.assetId === 'furniture/chair') as { visual: { facing: number } }[]
    expect(chairs.map((c) => c.visual.facing)).toEqual([3, 1])
    expect(issues(doc).filter((i) => i.severity === 'error')).toEqual([])
    // Placing it again gives new IDs.
    const again = ok(placePrefabItem(doc, P, 'cluster/dinner', { x: -3, z: 2.5 }, null, 0, 0))
    expect(again.selection.some((k) => r.selection.includes(k))).toBe(false)
  })

  it('decor turns with R; the prefab lists its variants; an instance picks one', () => {
    let doc = ok(rotatePrefabItems(labDoc(), P, ['rug-living'], 1)).doc
    expect((doc.prefabs.get(P)!.objects.find((o) => o.localId === 'rug-living') as { yaw: number }).yaw).toBe(180)
    doc = ok(updatePrefab(doc, P, { variants: ['abandoned', 'intact', 'abandoned'] })).doc
    expect(doc.prefabs.get(P)!.visual).toEqual({ variants: ['intact', 'abandoned'] })
    // House A chose "lived-in", no longer offered: a warning, a seeded variant is shown.
    expect(issues(doc).filter((i) => i.code === 'variant-not-offered').map((i) => i.entityId)).toEqual([A])
    doc = ok(updatePrefab(doc, P, { variants: null })).doc
    expect(doc.prefabs.get(P)!.visual).toBeUndefined()
  })
})
