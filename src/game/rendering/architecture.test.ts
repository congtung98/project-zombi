import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { BUNDLED_FILES } from '../../map/bundledFiles'
import { loadBundledWorld } from '../../map/content'
import { GameRuntime } from '../core/runtime'
import { GAME_CONFIG } from '../core/config'
import type { MapData } from '../world/mapData'
import { collectStaticItems, type StaticItem } from './staticBatchData'
import { BASEBOARD, PLINTH, roomFloorDetails, STOOP, TRIM } from './architecture'
import { CutawayState, pieceShow } from './cutaway'
import { hipGeometry } from './unitShapes'
import { unpackSurface } from './surfaces/catalog'

/**
 * G2: architectural details (door and window frames, sills, baseboards, plinths, per-room floors,
 * stoops, hipped roofs) on the graphics lab and the four-rotation world.
 */

const world = (id: string): MapData => ({ ...loadBundledWorld(id).map, zombieSpawns: [] })
const setup = (id: string) => {
  const rt = new GameRuntime(world(id))
  return { rt, items: collectStaticItems(rt.map, rt.staticColliders) }
}
const A = 'c0_0/house-a'
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

describe('architectural details (G2)', () => {
  const { rt, items } = setup('graphics-lab')
  const details = (buildingId: string) => items.filter((i) => i.detail && i.buildingId === buildingId)

  it('frames every door and window, sills the windows, stoops only the doors that lead outside', () => {
    const doors = rt.map.doors.filter((d) => d.buildingId === A)
    const windows = (rt.map.windows ?? []).filter((w) => w.buildingId === A)
    const openings = details(A).filter((i) => i.role === 'opening')
    // Door: 3 linings + 2 × 3 casing parts; window: 4 frame members, 2 bars, 1 sill.
    expect(openings).toHaveLength(doors.length * 9 + windows.length * 7)
    // Front and back door lead outside (a stoop each); the inner doors do not.
    const stoops = details(A).filter((i) => i.role === 'floor' && i.shape === 'box')
    expect(stoops).toHaveLength(2)
    for (const s of stoops) {
      expect(near(s.size[1], STOOP.height)).toBe(true)
      expect(rt.buildingAt({ x: s.center.x, z: s.center.z })).toBeNull()
    }
    // Every opening detail is anchored to its opening (the door or pane box).
    for (const o of openings) expect(o.anchor).toBeDefined()
  })

  it('baseboards inside, a plinth outside on the ground storey only, none on lintels', () => {
    const walls = details(A).filter((i) => i.role === 'wall')
    const baseboards = walls.filter((i) => near(i.size[1], BASEBOARD.height))
    const plinths = walls.filter((i) => near(i.size[1], PLINTH.height))
    expect(baseboards.length + plinths.length).toBe(walls.length)
    expect(baseboards.length).toBeGreaterThan(20)
    for (const p of plinths) {
      expect(near(p.center.y, PLINTH.height / 2)).toBe(true)
      // Outside the footprint (standing proud of the outer face).
      expect(rt.buildingAt({ x: p.center.x, z: p.center.z })).toBeNull()
    }
    // Both storeys have baseboards, each at its floor.
    expect(new Set(baseboards.map((b) => Math.round(b.center.y - BASEBOARD.height / 2))).size).toBe(2)
    // Casings stand proud of the wall face by their own depth.
    expect(details(A).some((i) => near(Math.min(i.size[0], i.size[2]), TRIM.casingProud))).toBe(true)
  })

  it('the kitchen is tiled, the upstairs bedroom carpeted, other rooms keep the wooden floor', () => {
    const floors = details(A).filter((i) => i.shape === 'floor')
    expect(floors.map((f) => [f.id, unpackSurface(f.surface).a, f.color]).sort()).toEqual([
      [`${A}/bedroom-2`, 'fabric', '#7a7268'],
      [`${A}/kitchen`, 'tile', '#c2bcae'],
    ])
    const up = floors.find((f) => f.id === `${A}/bedroom-2`)!
    expect(near(up.center.y, 3.003)).toBe(true)
  })

  it('an upper room floor leaves the stair hole open', () => {
    const b = rt.map.buildings.find((x) => x.id === A)!
    const stairs = rt.map.stairs!.filter((s) => s.buildingId === A)
    const hole = stairs[0].rect
    const room = { id: 'r', name: 'r', buildingId: A, bounds: { minX: b.center.x - 6, maxX: b.center.x + 6, minZ: b.center.z - 4.5, maxZ: b.center.z + 4.5 }, height: 3, floorY: 3, lamp: null, visual: { floor: 'tile' } }
    const pieces = roomFloorDetails(room, b, stairs, 0.02)
    expect(pieces.length).toBeGreaterThan(1)
    const area = pieces.reduce((n, p) => n + p.size[0] * p.size[2], 0)
    expect(area).toBeCloseTo(12 * 9 - (hole.maxX - hole.minX) * (hole.maxZ - hole.minZ), 6)
    const inHole = (x: number, z: number) => x > hole.minX && x < hole.maxX && z > hole.minZ && z < hole.maxZ
    for (const p of pieces) expect(inHole(p.center.x, p.center.z)).toBe(false)
  })

  it('hipped roofs: ridge along the longer side, every slope equally steep', () => {
    const hips = items.filter((i) => i.shape === 'hip' && i.buildingId === A)
    expect(hips).toHaveLength(1)
    const hip = hips[0]
    expect(hip.hip!.axis).toBe(hip.size[0] >= hip.size[2] ? 'x' : 'z')
    const g = hipGeometry(hip.hip!)
    const pos = g.getAttribute('position')
    const nor = g.getAttribute('normal')
    // Slope of each sloping face once scaled (tan = horizontal normal / vertical normal, scaled back).
    const slopes = new Set<number>()
    for (let i = 0; i < nor.count; i++) {
      const n = new Vector3(nor.getX(i) / hip.size[0], nor.getY(i) / hip.size[1], nor.getZ(i) / hip.size[2])
      if (n.y <= 0) continue
      slopes.add(Math.round((Math.hypot(n.x, n.z) / n.y) * 100) / 100)
      expect(pos.getY(i)).toBeGreaterThanOrEqual(-0.5)
    }
    // Two slopes (long sides, hip ends) equal within the ridge rounding.
    const [s1, s2] = [...slopes]
    expect(Math.abs(s1 - s2) / s1).toBeLessThan(0.06)
  })

  it('details are cut and hidden with their wall or opening, not by their own box', () => {
    const state = new CutawayState()
    state.attach((p, margin) => {
      const id = rt.buildingAt(p, margin)
      return id ? rt.map.buildings.find((b) => b.id === id)! : null
    }, GAME_CONFIG.camera.offset)
    // In A's living room: the front door is in the camera-side (south) wall.
    state.update({ x: 13, y: 0, z: 13.5 }, [], 0)
    const show = (i: StaticItem) => {
      const box = { min: i.center.clone().sub(new Vector3(...i.size).multiplyScalar(0.5)), max: i.center.clone().add(new Vector3(...i.size).multiplyScalar(0.5)) }
      return pieceShow(box, state.limit(i.buildingId, i.anchor ?? box, i.role ?? 'prop'))
    }
    const front = rt.map.doors.find((d) => d.id === `${A}/door`)!
    const casings = details(A).filter((i) => i.role === 'opening' && i.anchor && near(i.anchor.min.x, front.center.x - front.width / 2) && i.center.y < 3)
    expect(casings.length).toBe(9)
    // Cut with the wall: the parts standing on the floor are cut down like the leaf, the head is gone.
    for (const c of casings) expect(show(c), c.center.toArray().join()).toBe(c.center.y - c.size[1] / 2 < 0.5 ? 'cut' : 'hidden')
    // Upstairs details are hidden; the ground storey's baseboards stay.
    expect(new Set(details(A).filter((i) => i.center.y > 3).map(show))).toEqual(new Set(['hidden']))
    expect(new Set(details(A).filter((i) => i.role === 'wall' && near(i.size[1], BASEBOARD.height) && i.center.y < 1).map(show))).toEqual(new Set(['full']))
  })
})

describe('four quarter turns of one prefab (G2)', () => {
  it('the rotation world copies the lab prefab exactly', () => {
    expect(BUNDLED_FILES['/content/maps/graphics-rotations/prefabs/lab-house.json']).toEqual(BUNDLED_FILES['/content/maps/graphics-lab/prefabs/lab-house.json'])
  })

  it('every drawn piece of each turned copy is the same piece, turned', () => {
    const { rt, items } = setup('graphics-rotations')
    // Upper slabs are tiled round the stair hole in an order that depends on the turn (M11b): the
    // same area, split differently. They are compared by area; every other piece one by one.
    const slabArea = (b: string) => items.filter((i) => i.buildingId === b && i.role === 'slab').reduce((n, i) => n + i.size[0] * i.size[2], 0)
    const local = (b: string) => {
      const building = rt.map.buildings.find((x) => x.id === b)!
      const q = Number(b.slice(-1))
      return items
        .filter((i) => i.buildingId === b && i.role !== 'slab')
        .map((i) => {
          // Undo the quarter turns about the building centre (rotateXZ: q1 maps local +Z to +X).
          let x = i.center.x - building.center.x
          let z = i.center.z - building.center.z
          let [sx, sz] = [i.size[0], i.size[2]]
          for (let k = 0; k < q; k++) {
            ;[x, z] = [-z, x]
            ;[sx, sz] = [sz, sx]
          }
          const r = (v: number) => Math.round(v * 1000) / 1000 + 0
          const axis = i.hip ? (q % 2 === 1 ? (i.hip.axis === 'x' ? 'z' : 'x') : i.hip.axis) : ''
          return `${i.role}|${i.shape}|${axis}|${r(x)},${r(i.center.y)},${r(z)}|${r(sx)},${r(i.size[1])},${r(sz)}|${unpackSurface(i.surface).a}`
        })
        .sort()
    }
    const q0 = local('c0_0/house-q0')
    expect(q0.length).toBeGreaterThan(200)
    for (const b of ['c0_0/house-q1', 'c0_0/house-q2', 'c0_0/house-q3']) {
      expect(local(b), b).toEqual(q0)
      expect(slabArea(b)).toBeCloseTo(slabArea('c0_0/house-q0'), 6)
    }
  })
})
