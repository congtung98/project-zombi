import { describe, expect, it } from 'vitest'
import { loadBundledWorld } from '../../map/content'
import { GameRuntime } from '../core/runtime'
import { GAME_CONFIG } from '../core/config'
import type { MapData } from '../world/mapData'
import { validateSaveGame } from './save'
import { isSavedExploration, type InteriorVisibility } from './interiorVisibility'
import { CutawayState } from '../rendering/cutaway'

/**
 * M11c-1B: interior visibility on the frozen `cutaway-lab` world. House A spans x 7..17, z 8..16:
 * living room x 7..13 with a window in the south wall at x 8.8..10.2, store room x 13..17 behind a
 * solid wall (its own door in the east wall), a bedroom and a landing upstairs.
 */

const A = 'c0_0/house-a'
const lab = (): MapData => ({ ...loadBundledWorld('cutaway-lab').map, zombieSpawns: [] })
const NORTH = Math.PI

function setup() {
  const rt = new GameRuntime(lab())
  const look = (x: number, y: number, z: number, facing: number, inside: string | null = null) => rt.interior.update({ position: { x, y, z }, facing }, rt.visionOccluders, inside)
  return { rt, look }
}

/** Whether the cell of a room containing (x, z) was seen in the last pass / explored. */
function cell(interior: InteriorVisibility, roomId: string, x: number, z: number): { seen: boolean; explored: boolean } {
  const g = interior.byRoom.get(roomId)!
  const c = Math.floor((x - g.minX) / GAME_CONFIG.interiorVisibility.cell)
  const r = Math.floor((z - g.minZ) / GAME_CONFIG.interiorVisibility.cell)
  const i = r * g.cols + c
  return { seen: g.seen[i] === 1, explored: g.explored[i] === 1 }
}
const seenIn = (interior: InteriorVisibility, roomId: string) => interior.byRoom.get(roomId)!.seen.reduce((n, v) => n + v, 0)

describe('interior visibility (M11c-1B)', () => {
  it('through a window from outside: part of the room is seen, the closed room next to it is not', () => {
    const { rt, look } = setup()
    look(9.5, 0, 20, NORTH)
    const i = rt.interior
    // Straight through the pane: seen, deep into the room too.
    expect(cell(i, `${A}/living`, 9.5, 15.5).seen).toBe(true)
    expect(cell(i, `${A}/living`, 9.4, 11).seen).toBe(true)
    // Off the window's wedge, in the same room: the wall hides it.
    expect(cell(i, `${A}/living`, 12.5, 12).seen).toBe(false)
    expect(cell(i, `${A}/living`, 7.4, 15.6).seen).toBe(false)
    const living = seenIn(i, `${A}/living`)
    const all = i.byRoom.get(`${A}/living`)!.insideCount
    expect(living).toBeGreaterThan(10)
    expect(living).toBeLessThan(all / 2)
    // The store room behind the solid wall, the upper floor and the other houses: nothing.
    expect(seenIn(i, `${A}/store`)).toBe(0)
    expect(seenIn(i, `${A}/bedroom`)).toBe(0)
    expect(seenIn(i, 'c0_0/house-b/living')).toBe(0)
    // Seen from outside: house A is peeked into (the cutaway cuts it).
    expect(i.peeks).toEqual([A])
  })

  it('a closed curtain or turning away shows nothing; walking back remembers what was seen', () => {
    const { rt, look } = setup()
    rt.setCurtain(`${A}/win-s`, true)
    look(9.5, 0, 20, NORTH)
    expect(seenIn(rt.interior, `${A}/living`)).toBe(0)
    expect(rt.interior.peeks).toEqual([])
    rt.setCurtain(`${A}/win-s`, false)
    look(9.5, 0, 20, 0) // facing south, away from the house
    expect(seenIn(rt.interior, `${A}/living`)).toBe(0)
    look(9.5, 0, 20, NORTH)
    const seen = cell(rt.interior, `${A}/living`, 9.5, 15.5)
    expect(seen).toEqual({ seen: true, explored: true })
    look(9.5, 0, 20, 0)
    // Not seen any more, still explored.
    expect(cell(rt.interior, `${A}/living`, 9.5, 15.5)).toEqual({ seen: false, explored: true })
    expect(rt.interior.exploredShare(`${A}/living`)).toBeGreaterThan(0)
    expect(rt.interior.exploredShare(`${A}/store`)).toBe(0)
  })

  it('inside: the room in the cone is seen, the one behind the solid wall is not, near cells behind are', () => {
    const { rt, look } = setup()
    look(10, 0, 12, Math.PI / 2, A) // facing +X, towards the partition
    const i = rt.interior
    expect(cell(i, `${A}/living`, 12.5, 12).seen).toBe(true)
    expect(seenIn(i, `${A}/store`)).toBe(0)
    // Behind the back but within the near radius (2.5 m): seen; further behind: not.
    expect(cell(i, `${A}/living`, 8.5, 12).seen).toBe(true)
    expect(cell(i, `${A}/living`, 7.3, 12).seen).toBe(false)
    // The building the player is in is never a peek.
    expect(i.peeks).toEqual([])
  })

  it('by storey: upstairs sees the upper rooms only, the ground floor its own', () => {
    const { rt, look } = setup()
    look(11, 3, 14, NORTH, A)
    expect(seenIn(rt.interior, `${A}/bedroom`)).toBeGreaterThan(0)
    expect(seenIn(rt.interior, `${A}/living`)).toBe(0)
    look(10, 0, 12, NORTH, A)
    expect(seenIn(rt.interior, `${A}/bedroom`)).toBe(0)
    expect(seenIn(rt.interior, `${A}/living`)).toBeGreaterThan(0)
  })

  it('the memory goes into the save and comes back; a malformed or stale one is dropped, never an error', () => {
    const { rt, look } = setup()
    const empty = rt.createSnapshot()
    expect(empty.exploration).toBeUndefined() // nothing explored: the save round-trips unchanged
    look(9.5, 0, 20, NORTH)
    const save = rt.createSnapshot()
    expect(isSavedExploration(save.exploration)).toBe(true)
    expect(save.exploration!.rooms.map((r) => r.id)).toEqual([`${A}/living`])
    const explored = rt.interior.byRoom.get(`${A}/living`)!.exploredCount

    const other = new GameRuntime(lab())
    other.loadSnapshot(structuredClone(save))
    expect(other.interior.byRoom.get(`${A}/living`)!.exploredCount).toBe(explored)
    expect(other.createSnapshot().exploration).toEqual(save.exploration)

    // Malformed: the save still validates and loads, with nothing remembered.
    const broken = { ...structuredClone(save), exploration: { cell: 'x', rooms: 3 } }
    expect(validateSaveGame(broken, rt.map.id, rt.map).ok).toBe(true)
    other.loadSnapshot(broken as never)
    expect(other.interior.exploredShare(`${A}/living`)).toBe(0)
    // Another cell size or a room whose grid changed: skipped.
    other.interior.restore({ cell: 0.5, rooms: save.exploration!.rooms })
    expect(other.interior.exploredShare(`${A}/living`)).toBe(0)
    other.interior.restore({ cell: save.exploration!.cell, rooms: [{ id: `${A}/living`, bits: 'AAAA' }, { id: 'gone', bits: save.exploration!.rooms[0].bits }] })
    expect(other.interior.exploredShare(`${A}/living`)).toBe(0)
  })

  it('a pass from the same spot, facing and world revision is skipped; a curtain change is not', () => {
    const { rt } = setup()
    const observer = { position: { x: 9.5, y: 0, z: 20 }, facing: NORTH }
    const step = () => rt.interior.step(1, observer, rt.visionOccluders, null, rt.lighting.revision)
    step()
    const seen = seenIn(rt.interior, `${A}/living`)
    expect(seen).toBeGreaterThan(0)
    // Closed without the world revision moving: the pass is skipped (same key), still seen.
    rt.world.curtains.set(`${A}/win-s`, true)
    step()
    expect(seenIn(rt.interior, `${A}/living`)).toBe(seen)
    // Through the runtime (lighting revision bumps): recomputed, nothing seen.
    rt.setCurtain(`${A}/win-s`, true)
    rt.lighting.update()
    step()
    expect(seenIn(rt.interior, `${A}/living`)).toBe(0)
  })

  it('peeks cut the building seen into from outside and outlive the last sighting by the hold time', () => {
    const { rt } = setup()
    const byId = new Map(rt.map.buildings.map((b) => [b.id, b]))
    const state = new CutawayState()
    state.attach((p, margin) => {
      const id = rt.buildingAt(p, margin)
      return id ? byId.get(id)! : null
    }, GAME_CONFIG.camera.offset, (id) => byId.get(id) ?? null, 0.8)
    const outside = { x: 9.5, y: 0, z: 20 }
    expect(state.update(outside, [A], 10)).toBe(true)
    expect([state.view, state.peekIds, state.cutIds]).toEqual([null, [A], [A]])
    // Roof and upper floor gone, the camera-side wall cut: like being inside, at the ground floor.
    expect(state.storeyShown(A, 0)).toBe(true)
    expect(state.limit(A, { min: { x: 7, y: 5.8, z: 8 }, max: { x: 17, y: 6.2, z: 16 } }, 'roof')).toBe(2.8)
    expect(state.update(outside, [], 10.5)).toBe(false) // within the hold
    expect(state.update(outside, [], 10.9)).toBe(true) // expired
    expect(state.cutIds).toEqual([])
    // Walking in: the peek becomes the building the player is in (never both).
    state.update(outside, [A], 11)
    state.update({ x: 9, y: 0, z: 11.5 }, [A], 11.1)
    expect([state.view?.buildingId, state.peekIds]).toEqual([A, []])
  })
})
