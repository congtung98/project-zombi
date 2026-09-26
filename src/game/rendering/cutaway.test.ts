import { describe, expect, it } from 'vitest'
import { loadBundledWorld } from '../../map/content'
import { GameRuntime } from '../core/runtime'
import { GAME_CONFIG } from '../core/config'
import type { MapData } from '../world/mapData'
import type { BuildingInfo } from '../world/buildings'
import { collectStaticItems, type StaticItem } from './staticBatchData'
import { CutawayState, observedLevel, pieceShow, viewFor, wallSide, WALL_CUT_HEIGHT, type PieceShow } from './cutaway'

/**
 * M11c-1A: building cutaway on the frozen `cutaway-lab` world (three copies of a two-storey house:
 * living room x 7..17 split by a solid wall at x 13 from the store room, south window, front door
 * in the west wall, store door in the east wall, flight along z 8.9 from x 8.8 to 12.8; house-b the
 * same 16 m east, house-c the same prefab turned a quarter).
 */

const lab = (): MapData => ({ ...loadBundledWorld('cutaway-lab').map, zombieSpawns: [] })
const CAMERA = { x: Math.sign(GAME_CONFIG.camera.offset.x), z: Math.sign(GAME_CONFIG.camera.offset.z) }
const A = 'c0_0/house-a'

function setup() {
  const rt = new GameRuntime(lab())
  const items = collectStaticItems(rt.map, rt.staticColliders)
  const building = (id: string) => rt.map.buildings.find((b) => b.id === id)!
  const state = new CutawayState()
  state.attach((p, margin) => {
    const id = rt.buildingAt(p, margin)
    return id ? building(id) : null
  }, GAME_CONFIG.camera.offset)
  return { rt, items, building, state }
}

const boxOf = (i: StaticItem) => {
  const h = i.shape === 'floor' ? 0 : i.size[1] / 2
  return {
    min: { x: i.center.x - i.size[0] / 2, y: i.center.y - h, z: i.center.z - i.size[2] / 2 },
    max: { x: i.center.x + i.size[0] / 2, y: i.center.y + h, z: i.center.z + i.size[2] / 2 },
  }
}
/** How the cutaway draws each item of the lab (`id` → show), under the state's current view. */
function shows(items: StaticItem[], state: CutawayState): Map<string, { show: PieceShow; limit: number }> {
  const out = new Map<string, { show: PieceShow; limit: number }>()
  for (const i of items) {
    if (!i.id) continue
    const limit = state.limit(i.buildingId, boxOf(i), i.role ?? 'prop')
    out.set(i.id, { show: limit === Infinity ? 'full' : pieceShow(boxOf(i), limit), limit })
  }
  return out
}
const showOf = (m: Map<string, { show: PieceShow }>, prefix: string) => [...new Set([...m].filter(([id]) => id.startsWith(prefix)).map(([, v]) => v.show))].sort()

describe('building cutaway (M11c-1A)', () => {
  it('every piece of a house knows its building and role; copies of one prefab stay apart', () => {
    const { items, rt } = setup()
    const of = (id: string) => items.find((i) => i.id === id)!
    expect([of(`${A}/wall-s#0`).buildingId, of(`${A}/wall-s#0`).role]).toEqual([A, 'wall'])
    expect([of(`${A}/table`).buildingId, of(`${A}/table`).role]).toEqual([A, 'prop'])
    expect([of(`${A}/wardrobe`).buildingId, of(`${A}/wardrobe`).role]).toEqual([A, 'container'])
    expect([of(`${A}#floor-1-0`).buildingId, of(`${A}#floor-1-0`).role]).toEqual([A, 'slab'])
    expect(of('c0_0/house-b/wall-s#0').buildingId).toBe('c0_0/house-b')
    // Roofs, ground floors and stair treads (no ID) belong to their building too.
    for (const b of rt.map.buildings) {
      const roles = new Set(items.filter((i) => i.buildingId === b.id).map((i) => i.role))
      expect([...roles].sort()).toEqual(['container', 'floor', 'prop', 'roof', 'slab', 'stairs', 'wall'])
    }
    // Nothing outside the houses (the play area's fence) is a building piece.
    expect(items.filter((i) => !i.buildingId && i.role)).toEqual([])
  })

  it('walls facing the camera and inner walls are cut, walls facing away stay (any quarter turn)', () => {
    const { items, building } = setup()
    const wall = (id: string) => boxOf(items.find((i) => i.id === id)!)
    const a = building(A)
    // The camera looks from +X +Z: south (+Z) and east (+X) outsides face it.
    expect(wallSide(a, wall(`${A}/wall-s#0`), CAMERA)).toBe('camera')
    expect(wallSide(a, wall(`${A}/wall-e#0`), CAMERA)).toBe('camera')
    expect(wallSide(a, wall(`${A}/wall-n#0`), CAMERA)).toBe('far')
    expect(wallSide(a, wall(`${A}/wall-w#0`), CAMERA)).toBe('far')
    expect(wallSide(a, wall(`${A}/wall-mid#0`), CAMERA)).toBe('inner')
    // house-c is the prefab turned a quarter: its local south wall faces −X or +X now; whichever
    // pieces face the camera, it is by geometry, never by the prefab's local names.
    const c = building('c0_0/house-c')
    // (Probed across the thin side: a long wall ending at a corner is still one side's wall.)
    const sides = items.filter((i) => i.buildingId === c.id && i.role === 'wall' && i.center.y < 3).map((i) => {
      const b = boxOf(i)
      const alongZ = b.max.z - b.min.z > b.max.x - b.min.x
      const outsideEast = alongZ && b.max.x + 0.05 > c.center.x + c.size.w / 2
      const outsideWest = alongZ && b.min.x - 0.05 < c.center.x - c.size.w / 2
      const outsideSouth = !alongZ && b.max.z + 0.05 > c.center.z + c.size.d / 2
      const outsideNorth = !alongZ && b.min.z - 0.05 < c.center.z - c.size.d / 2
      return { side: wallSide(c, b, CAMERA), outsideEast, outsideSouth, outsideWest, outsideNorth }
    })
    expect(sides.filter((s) => s.side === 'camera').length).toBeGreaterThan(3)
    expect(sides.filter((s) => s.side === 'far').length).toBeGreaterThan(3)
    for (const s of sides) {
      if (s.outsideEast || s.outsideSouth) expect(s.side).toBe('camera')
      else if (s.outsideWest || s.outsideNorth) expect(s.side).toBe('far')
      else expect(s.side).toBe('inner')
    }
  })

  it('observed storey: hysteresis on the stairs, clamped to the building', () => {
    const b = { height: 3, storeys: 2 }
    const climb = [0, 0.6, 1.2, 2.0, 2.24, 2.25, 2.6, 3]
    let level: number | null = null
    const up = climb.map((y) => (level = observedLevel(level, y, b)))
    expect(up).toEqual([0, 0, 0, 0, 0, 1, 1, 1])
    const down = [...climb].reverse().map((y) => (level = observedLevel(level, y, b)))
    expect(down).toEqual([1, 1, 1, 1, 1, 1, 0, 0])
    // Jitter around the middle of the flight never flips it.
    for (const y of [1.4, 1.6, 1.45, 1.55]) expect(observedLevel(0, y, b)).toBe(0)
    for (const y of [1.4, 1.6, 1.45, 1.55]) expect(observedLevel(1, y, b)).toBe(1)
    expect(observedLevel(null, 9, b)).toBe(1)
    expect(viewFor({ id: A, height: 3 }, 1)).toEqual({ buildingId: A, level: 1, floorY: 3, ceilingY: 5.8, wallTopY: 3 + WALL_CUT_HEIGHT })
  })

  it('the view follows the player: inside past the doorway, out again with hysteresis', () => {
    const { state } = setup()
    // Walking in through the front door (west wall at x 7, door at z 13).
    expect(state.update({ x: 6.5, y: 0, z: 13 })).toBe(false)
    expect(state.view).toBeNull()
    expect(state.update({ x: 7.1, y: 0, z: 13 })).toBe(false) // on the wall line: not yet
    expect(state.update({ x: 7.4, y: 0, z: 13 })).toBe(true)
    expect(state.view).toMatchObject({ buildingId: A, level: 0, floorY: 0, ceilingY: 2.8 })
    const v = state.version
    expect(state.update({ x: 6.8, y: 0, z: 13 })).toBe(false) // just outside: kept
    expect(state.version).toBe(v)
    expect(state.update({ x: 6.5, y: 0, z: 13 })).toBe(true) // clearly out
    expect(state.view).toBeNull()
    // Standing outside right against a wall never cuts the house (no "near the wall" reveal).
    expect(state.update({ x: 9.5, y: 0, z: 16.5 })).toBe(false)
    expect(state.view).toBeNull()
    // Up the flight: the storey changes three quarters of the way up, not before.
    state.update({ x: 10, y: 0, z: 12 })
    state.update({ x: 10.8, y: 1.5, z: 8.9 })
    expect(state.view?.level).toBe(0)
    state.update({ x: 12.2, y: 2.3, z: 8.9 })
    expect(state.view?.level).toBe(1)
    state.update({ x: 11, y: 3, z: 14 })
    expect(state.view).toMatchObject({ level: 1, floorY: 3, ceilingY: 5.8 })
  })

  it('ground floor: roof, upper floor and everything on it hidden; camera-side walls cut; far walls, stairs and the neighbours whole', () => {
    const { items, state } = setup()
    state.update({ x: 9, y: 0, z: 11.5 })
    const m = shows(items, state)
    expect(showOf(m, `${A}#floor-1`)).toEqual(['hidden'])
    for (const id of ['wall-n-1', 'wall-s-1', 'wall-w-1', 'wall-e-1', 'wall-mid-1', 'wardrobe', 'bed']) expect(showOf(m, `${A}/${id}`), id).toEqual(['hidden'])
    // Camera-side and inner walls of the storey: cut down (window lintels above the cut: hidden).
    expect(showOf(m, `${A}/wall-s#`)).toEqual(['cut', 'hidden'])
    expect(showOf(m, `${A}/wall-e#`)).toEqual(['cut', 'hidden'])
    expect(showOf(m, `${A}/wall-mid#`)).toEqual(['cut'])
    expect(m.get(`${A}/wall-mid#0`)!.limit).toBe(WALL_CUT_HEIGHT)
    // Walls facing away stay whole (the camera sees their inner face), furniture too.
    expect(showOf(m, `${A}/wall-n#`)).toEqual(['full'])
    expect(showOf(m, `${A}/wall-w#`)).toEqual(['full'])
    for (const id of ['table', 'cupboard', 'crate', 'shelf']) expect(showOf(m, `${A}/${id}`), id).toEqual(['full'])
    // The stairwell's walls are cut (at the ceiling against the far wall, low inside), its upstairs
    // rail hidden; its treads stay.
    expect(showOf(m, `${A}/stairs#side`)).toEqual(['cut'])
    expect(m.get(`${A}/stairs#side-a`)!.limit).toBe(2.8)
    expect(m.get(`${A}/stairs#side-b`)!.limit).toBe(WALL_CUT_HEIGHT)
    expect(showOf(m, `${A}/stairs#rail`)).toEqual(['hidden'])
    const treads = items.filter((i) => i.buildingId === A && i.role === 'stairs')
    expect(treads.every((i) => pieceShow(boxOf(i), state.limit(A, boxOf(i), 'stairs')) === 'full')).toBe(true)
    const roof = items.filter((i) => i.buildingId === A && i.role === 'roof')
    expect(roof.every((i) => pieceShow(boxOf(i), state.limit(A, boxOf(i), 'roof')) === 'hidden')).toBe(true)
    // Another copy of the same prefab: untouched.
    expect(showOf(m, 'c0_0/house-b/')).toEqual(['full'])
    expect(showOf(m, 'c0_0/house-c/')).toEqual(['full'])
  })

  it('upper floor: the floor underfoot and the storey below stay, the storey is cut on the camera side, the roof hidden', () => {
    const { items, state } = setup()
    state.update({ x: 11, y: 3, z: 14 })
    const m = shows(items, state)
    expect(showOf(m, `${A}#floor-1`)).toEqual(['full'])
    for (const id of ['wall-n#', 'wall-w#', 'wall-s#', 'wall-e#', 'wall-mid#', 'table', 'cupboard', 'wall-n-1#', 'wall-w-1#', 'wardrobe', 'bed']) expect(showOf(m, `${A}/${id}`), id).toEqual(['full'])
    expect(showOf(m, `${A}/wall-s-1#`)).toEqual(['cut', 'hidden'])
    expect(showOf(m, `${A}/wall-mid-1#`)).toEqual(['cut', 'hidden'])
    expect(m.get(`${A}/wall-mid-1#0`)!.limit).toBe(3 + WALL_CUT_HEIGHT)
    const roof = items.filter((i) => i.buildingId === A && i.role === 'roof')
    expect(roof.every((i) => pieceShow(boxOf(i), state.limit(A, boxOf(i), 'roof')) === 'hidden')).toBe(true)
  })

  it('entities on a hidden storey are hidden; the F6 storey filter follows the view', () => {
    const { state } = setup()
    state.update({ x: 9, y: 0, z: 11.5 })
    expect(state.hidesPoint({ x: 12, y: 3, z: 14 })).toBe(true) // upstairs
    expect(state.hidesPoint({ x: 12, y: 0, z: 14 })).toBe(false) // same storey
    expect(state.hidesPoint({ x: 11, y: 2.5, z: 8.9 })).toBe(false) // on the flight
    expect(state.hidesPoint({ x: 28, y: 3, z: 12 })).toBe(false) // another house: its roof is on
    expect(state.storeyShown(A, 0)).toBe(true)
    expect(state.storeyShown(A, 3)).toBe(false)
    expect(state.storeyShown('c0_0/house-b', 0)).toBe(true)
    expect(state.storeyShown('c0_0/house-b', 3)).toBe(false)
    state.update({ x: 11, y: 3, z: 14 })
    expect(state.hidesPoint({ x: 12, y: 3, z: 14 })).toBe(false)
    expect(state.storeyShown(A, 3)).toBe(true)
    expect(state.storeyShown(A, 0)).toBe(false)
  })

  it('presentation only: sight, attacks and movement still stop at a cut or hidden wall', () => {
    const { rt, state } = setup()
    const before = [rt.staticColliders.size, rt.visionOccluders.all.length, rt.lighting.revision]
    state.update({ x: 9, y: 0, z: 11.5 })
    // The partition (cut down on screen) still blocks the store room from the living room.
    const from = { x: 11, y: 1.5, z: 12 }
    const to = { x: 15, y: 1.5, z: 12 }
    expect(rt.isBlocked(from, to, [])).toBe(true)
    expect(rt.visionOccluders.clearFraction(from, to)).toBeLessThan(1)
    // The hidden upper floor still separates the storeys.
    expect(rt.isBlocked({ x: 11, y: 1.5, z: 14 }, { x: 11, y: 4.5, z: 14 }, [])).toBe(true)
    expect([rt.staticColliders.size, rt.visionOccluders.all.length, rt.lighting.revision]).toEqual(before)
  })

  it('a cut-away wall of one building never touches another building (and outdoors nothing changes)', () => {
    const { building, state } = setup()
    const b = building('c0_0/house-b')
    const box = { min: { x: 23, y: 0, z: 12 }, max: { x: 23.3, y: 3, z: 14 } }
    state.update({ x: 9, y: 0, z: 11.5 })
    expect(state.limit(b.id, box, 'wall')).toBe(Infinity)
    expect(state.limit(undefined, box, 'wall')).toBe(Infinity)
    state.update({ x: 22, y: 0, z: 21 })
    expect(state.view).toBeNull()
    expect(state.limit(A, box, 'wall')).toBe(Infinity)
    void (b satisfies BuildingInfo)
  })
})
