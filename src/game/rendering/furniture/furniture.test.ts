import { describe, expect, it } from 'vitest'
import { loadBundledWorld, bundledWorldFiles, REGISTERED_LOOT_TABLES } from '../../../map/content'
import { checkWorldDocuments } from '../../../map/validate'
import { documentFiles, type MapDocument } from '../../../map/editor/document'
import { documentFromFiles } from '../../../map/editor/pack'
import { rotatePrefabItems, updatePrefabItem } from '../../../map/editor/prefabCommands'
import type { CommandResult } from '../../../map/editor/commands'
import type { QuarterTurns } from '../../../map/schema'
import { GameRuntime } from '../../core/runtime'
import type { MapData } from '../../world/mapData'
import { collectStaticItems } from '../staticBatchData'
import { FURNITURE, FURNITURE_IDS, type FurnitureId } from './catalog'
import { furnitureParts } from './assets'
import { autoFacing, placeFurniture, type WorldBox } from './placement'
import { PREFAB_PRESETS } from '../../../map/editor/prefabPresets'

/**
 * G3a: the furniture registry. Assets stay inside the box they dress (collider, nav, sight and
 * interaction unchanged), turn exactly with their facing, face away from the wall when the content
 * leaves the facing out, and the lab house wears them without touching IDs, loot or colliders.
 */

const LAB = 'graphics-lab'
const A = 'c0_0/house-a'
const B = 'c0_0/house-b'
const world = (id: string): MapData => ({ ...loadBundledWorld(id).map, zombieSpawns: [] })
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): WorldBox => ({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } })

/** Sizes [w, h, d] every asset is tried at: the content's and the palette's, small and large. */
const SIZES: Record<FurnitureId, [number, number, number][]> = {
  'furniture/bed': [[1.6, 0.55, 2], [1, 0.5, 2], [1.8, 0.6, 2.1]],
  'furniture/sofa': [[2.2, 0.8, 0.9], [0.85, 0.8, 0.85], [2, 0.8, 0.9]],
  'furniture/table': [[1.4, 0.75, 0.9], [1, 0.45, 0.6], [0.6, 0.7, 0.6]],
  'furniture/desk': [[1.4, 0.75, 0.7], [1, 0.72, 0.5]],
  'furniture/chair': [[0.45, 0.9, 0.45], [0.4, 0.85, 0.4]],
  'furniture/counter': [[3, 0.9, 0.6], [1.4, 1, 0.6], [0.6, 0.9, 0.6]],
  'furniture/cabinet': [[1.2, 1, 0.6], [4, 1, 0.8], [0.5, 0.6, 0.9]],
  'furniture/fridge': [[0.8, 1.8, 0.7], [0.8, 1.8, 0.8]],
  'furniture/wardrobe': [[1.2, 1.9, 0.6], [0.6, 1.8, 1.4], [1.8, 2, 0.6]],
  'furniture/nightstand': [[0.45, 0.55, 0.5], [0.5, 0.7, 0.5]],
  'furniture/bookshelf': [[1.2, 2, 0.5], [0.8, 1.2, 0.3]],
  'furniture/shelving': [[1.4, 1.8, 0.5], [2, 1.6, 0.6], [2, 1.6, 0.6]],
  'furniture/crate': [[1, 1, 1], [0.5, 0.6, 0.9]],
}

/** A record without its furniture look. */
function withoutLook<T extends { visual?: unknown }>(o: T): T {
  const copy = { ...o }
  delete copy.visual
  return copy
}

function ok(r: CommandResult): Extract<CommandResult, { ok: true }> {
  if (!r.ok) throw new Error(r.error)
  return r
}

describe('furniture assets (G3a)', () => {
  it('every asset fills its box without reaching past it, at every size tried', () => {
    for (const id of FURNITURE_IDS) {
      for (const [w, h, d] of SIZES[id]) {
        const parts = furnitureParts(id, { w, h, d }, '#806040')
        expect(parts.clipped, `${id} ${w}×${h}×${d}`).toBeUndefined()
        expect(parts.length).toBeGreaterThan(3)
        expect(parts.length).toBeLessThanOrEqual(40)
        for (const p of parts) {
          for (let k = 0; k < 3; k++) expect(p.max[k] - p.min[k], `${id} ${p.name}`).toBeGreaterThanOrEqual(0.005)
        }
        // Names are unique (the debug and the tests find parts by name).
        expect(new Set(parts.map((p) => p.name)).size).toBe(parts.length)
        // The asset reaches the top of its box and stands on the floor.
        expect(Math.max(...parts.map((p) => p.max[1]))).toBeCloseTo(h, 6)
        expect(Math.min(...parts.map((p) => p.min[1]))).toBe(0)
      }
    }
  })

  it('counts follow the box: seats, doors, pillows, cabinet modules and a sink', () => {
    const names = (id: FurnitureId, w: number, h: number, d: number) => furnitureParts(id, { w, h, d }, '#806040').map((p) => p.name)
    const count = (list: string[], prefix: string) => list.filter((n) => n.startsWith(prefix) && !n.includes('handle')).length
    expect(count(names('furniture/sofa', 2.2, 0.8, 0.9), 'seat-')).toBe(3)
    expect(count(names('furniture/sofa', 0.85, 0.8, 0.85), 'seat-')).toBe(1)
    expect(count(names('furniture/wardrobe', 0.6, 1.9, 1.2), 'door-')).toBe(1)
    expect(count(names('furniture/wardrobe', 1.2, 1.9, 0.6), 'door-')).toBe(2)
    expect(count(names('furniture/wardrobe', 1.8, 2, 0.6), 'door-')).toBe(3)
    expect(count(names('furniture/bed', 1.6, 0.55, 2), 'pillow-')).toBe(2)
    expect(count(names('furniture/bed', 1, 0.5, 2), 'pillow-')).toBe(1)
    const counter = names('furniture/counter', 3, 0.9, 0.6)
    expect(count(counter, 'door-')).toBe(5)
    expect(counter).toContain('sink')
    expect(names('furniture/counter', 1.4, 1, 0.6)).not.toContain('sink')
  })

  it('a facing turns the parts exactly: facing q of a box is facing 0 of the box turned back', () => {
    for (const id of ['furniture/bed', 'furniture/wardrobe', 'furniture/counter', 'furniture/chair'] as const) {
      const [w, h, d] = SIZES[id][0]
      const key = (min: number[], max: number[]) => [...min, ...max].map((v) => Math.round(v * 1e4) / 1e4 + 0).join(',')
      const upright = placeFurniture(id, box(-w / 2, 0, -d / 2, w / 2, h, d / 2), 0, '#806040')
      for (const q of [1, 2, 3] as const) {
        // The world box of facing q: w across the front, so X and Z swap on odd turns.
        const [sx, sz] = q & 1 ? [d, w] : [w, d]
        const turned = placeFurniture(id, box(-sx / 2, 0, -sz / 2, sx / 2, h, sz / 2), q, '#806040')
        // Turn the upright parts by q (rotateXZ: (x, z) → (z, −x) per turn) and compare.
        const expected = upright.map((p) => {
          let [ax, az, bx, bz] = [p.min[0], p.min[2], p.max[0], p.max[2]]
          for (let k = 0; k < q; k++) [ax, az, bx, bz] = [az, -ax, bz, -bx]
          return `${p.name}|${key([Math.min(ax, bx), p.min[1], Math.min(az, bz)], [Math.max(ax, bx), p.max[1], Math.max(az, bz)])}`
        })
        expect(turned.map((p) => `${p.name}|${key(p.min, p.max)}`).sort(), `${id} q${q}`).toEqual(expected.sort())
      }
    }
  })

  it('automatic facing: back to the wall, the usual shape between two walls, the usual shape with none', () => {
    const north = box(-3, 0, -2.3, 3, 3, -2) // wall face at z = −2
    const east = box(2, 0, -3, 2.3, 3, 3) // wall face at x = 2
    // A wardrobe 1.2 wide against the north wall: front south.
    expect(autoFacing('furniture/wardrobe', box(-0.6, 0, -1.95, 0.6, 1.9, -1.35), [north, east])).toBe(0)
    // A bed head against the east wall (long along X): foot west.
    expect(autoFacing('furniture/bed', box(0, 0, -0.8, 1.95, 0.55, 0.8), [north, east])).toBe(3)
    // A fridge in the corner, 0.8 wide and 0.7 deep: its back on the north wall (east would make it deeper than wide).
    expect(autoFacing('furniture/fridge', box(1.15, 0, -1.95, 1.95, 1.8, -1.25), [north, east])).toBe(0)
    // Too far from any wall: the shape decides (a table longer along Z faces east).
    expect(autoFacing('furniture/table', box(-0.3, 0, -0.5, 0.3, 0.45, 0.5), [north, east])).toBe(1)
    // A wall only above the piece (a window head over a low cabinet) does not count: the cabinet at
    // a south wall faces north with the whole wall, keeps the default (south) with only its head.
    const cabinet = box(-0.6, 0, 1.35, 0.6, 0.8, 1.95)
    expect(autoFacing('furniture/cabinet', cabinet, [box(-3, 0, 2, 3, 3, 2.3)])).toBe(2)
    expect(autoFacing('furniture/cabinet', cabinet, [box(-3, 2.1, 2, 3, 3, 2.3)])).toBe(0)
    expect(FURNITURE['furniture/bed'].deep).toBe(true)
  })

  it('palette presets name registered assets that fit their default boxes', () => {
    const furnished = PREFAB_PRESETS.filter((p) => (p.template.visual as { assetId?: string } | undefined)?.assetId)
    expect(furnished.length).toBeGreaterThanOrEqual(12)
    for (const p of furnished) {
      const id = (p.template.visual as { assetId: FurnitureId }).assetId
      expect(FURNITURE_IDS).toContain(id)
      const [w, h, d] = p.template.size as number[]
      expect(furnitureParts(id, { w, h, d }, '#806040').clipped, p.id).toBeUndefined()
    }
  })
})

describe('furniture in the lab house (G3a)', () => {
  const rt = new GameRuntime(world(LAB))
  const items = collectStaticItems(rt.map, rt.staticColliders)
  const furnished = [...rt.map.walls.filter((w) => w.visual), ...rt.map.containers.filter((c) => c.visual)]
  const partsOf = (id: string) => items.filter((i) => i.id === id)

  it('dresses every furnished prop and container of both houses, and nothing else', () => {
    expect(furnished.filter((f) => f.id.startsWith(`${A}/`))).toHaveLength(16)
    expect(furnished.filter((f) => f.id.startsWith(`${B}/`))).toHaveLength(16)
    for (const f of furnished) {
      const parts = partsOf(f.id)
      expect(parts.length, f.id).toBeGreaterThan(3)
      expect(parts.every((p) => p.furniture?.assetId === f.visual!.assetId)).toBe(true)
    }
    // Unfurnished props (the car, the mailbox, the bins outside) are still one plain box each.
    for (const id of ['c0_0/objects/car', 'c0_0/objects/mailbox']) expect(partsOf(id).map((p) => p.furniture)).toEqual([undefined])
  })

  it('parts stay in the collider box, anchored to it, with the piece role and building', () => {
    for (const f of furnished) {
      const collider = rt.staticColliders.get(f.id)
      // Colliders are the content boxes, unchanged (props from the registry, containers from the map).
      const min = collider ? collider.min : { x: f.position.x - f.size[0] / 2, y: f.position.y - f.size[1] / 2, z: f.position.z - f.size[2] / 2 }
      const max = collider ? collider.max : { x: f.position.x + f.size[0] / 2, y: f.position.y + f.size[1] / 2, z: f.position.z + f.size[2] / 2 }
      for (const p of partsOf(f.id)) {
        expect(p.anchor!.min.toArray()).toEqual([min.x, min.y, min.z])
        expect(p.anchor!.max.toArray()).toEqual([max.x, max.y, max.z])
        for (const [k, axis] of (['x', 'y', 'z'] as const).entries()) {
          expect(p.center[axis] - p.size[k] / 2).toBeGreaterThanOrEqual(min[axis] - 1e-6)
          expect(p.center[axis] + p.size[k] / 2).toBeLessThanOrEqual(max[axis] + 1e-6)
        }
        expect(p.buildingId, f.id).toBe(f.id.startsWith(A) ? A : B)
        expect(p.role).toBe('prop' in f && f.prop ? 'prop' : 'container')
        // Tall props fade together (every part registers the whole box); containers never did (unchanged).
        expect(p.occluder).toBe('prop' in f && !!f.prop && f.size[1] >= 1.5)
      }
    }
  })

  it('faces the way the content says, or away from the wall; the turned house turns them all', () => {
    const facings = (b: string) => Object.fromEntries(furnished.filter((f) => f.id.startsWith(`${b}/`)).map((f) => [f.id.slice(b.length + 1), partsOf(f.id)[0].furniture!.facing]))
    const expected: Record<string, QuarterTurns> = {
      sofa: 1, 'coffee-table': 1, armchair: 2, bookshelf: 1, counter: 0, fridge: 0, 'dining-table': 0, 'chair-1': 2, 'chair-2': 0,
      bed: 3, nightstand: 3, wardrobe: 2, 'bed-2': 1, desk: 2, 'wardrobe-2': 1, 'landing-shelf': 0,
    }
    expect(facings(A)).toEqual(expected)
    // House B is the same prefab turned 180°.
    expect(facings(B)).toEqual(Object.fromEntries(Object.entries(expected).map(([k, q]) => [k, (q + 2) % 4])))
  })

  it('loot, IDs, colliders and sight blockers are those of the plain boxes', () => {
    const plain = new GameRuntime({ ...world(LAB), walls: world(LAB).walls.map(withoutLook), containers: world(LAB).containers.map(withoutLook) })
    expect(rt.map.containers.map(withoutLook)).toEqual(plain.map.containers)
    expect(rt.staticColliders.list('wall').map((c) => [c.id, c.min, c.max])).toEqual(plain.staticColliders.list('wall').map((c) => [c.id, c.min, c.max]))
    expect(rt.visionOccluders.all.map((o) => [o.id, o.kind, o.min, o.max])).toEqual(plain.visionOccluders.all.map((o) => [o.id, o.kind, o.min, o.max]))
  })
})

describe('furniture looks in content and the editor (G3a)', () => {
  const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
  const P = 'building/lab-house'
  const lab = (): MapDocument => {
    const r = documentFromFiles(bundledWorldFiles(LAB), OPTS)
    if (!r.ok) throw new Error(r.error)
    return r.doc
  }
  const object = (doc: MapDocument, id: string) => doc.prefabs.get(P)!.objects.find((o) => o.localId === id)! as { visual?: { assetId: string; facing?: number }; size: number[] }
  const issues = (doc: MapDocument) => {
    const files = new Map(documentFiles(doc))
    return checkWorldDocuments((p) => files.get(p), OPTS).issues
  }

  it('an unknown asset is a warning and draws the plain box; a bad facing is an error', () => {
    let doc = ok(updatePrefabItem(lab(), P, 'sofa', { visual: { assetId: 'furniture/throne' } })).doc
    const found = issues(doc)
    expect(found.filter((i) => i.severity === 'error')).toEqual([])
    const sofa = `#/objects/${lab().prefabs.get(P)!.objects.findIndex((o) => o.localId === 'sofa')}/visual`
    expect(found.filter((i) => i.code === 'unknown-asset').map((i) => i.path.slice(i.path.indexOf('#')))).toEqual([`${sofa}/assetId`])
    // The runtime draws the plain box for it.
    const map = world(LAB)
    map.walls = map.walls.map((w) => (w.id === `${A}/sofa` ? { ...w, visual: { assetId: 'furniture/throne' } } : w))
    const odd = new GameRuntime(map)
    expect(collectStaticItems(odd.map, odd.staticColliders).filter((i) => i.id === `${A}/sofa`).map((i) => [i.shape, i.furniture, i.size])).toEqual([['box', undefined, [0.9, 0.8, 2.2]]])
    doc = ok(updatePrefabItem(lab(), P, 'sofa', { visual: { assetId: 'furniture/sofa', facing: 5 } })).doc
    expect(issues(doc).filter((i) => i.severity === 'error').map((i) => i.path.slice(i.path.indexOf('#')))).toEqual([`${sofa}/facing`])
  })

  it('turning a piece in the prefab editor turns a set facing with its box; an automatic one stays automatic', () => {
    let doc = lab()
    expect(object(doc, 'chair-1').visual).toEqual({ assetId: 'furniture/chair', facing: 2 })
    doc = ok(rotatePrefabItems(doc, P, ['chair-1', 'bed'], 1)).doc
    // A square chair box: only its facing turns.
    expect(object(doc, 'chair-1')).toMatchObject({ visual: { assetId: 'furniture/chair', facing: 3 }, size: [0.45, 0.9, 0.45] })
    expect(object(doc, 'bed')).toMatchObject({ visual: { assetId: 'furniture/bed' }, size: [1.6, 0.55, 2] })
    expect(object(doc, 'bed').visual!.facing).toBeUndefined()
    expect(issues(doc).filter((i) => i.severity === 'error')).toEqual([])
  })
})
