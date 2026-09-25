import { beforeAll, describe, expect, it } from 'vitest'
import RAPIER from '@dimforge/rapier3d-compat'
import { GameRuntime } from '../core/runtime'
import { createRng } from '../systems/loot'
import { doorLeafTransform } from './doors'
import { NEIGHBORHOOD_MAP } from './mapData'
import { buildStressMap } from './stressMap'

beforeAll(async () => { await RAPIER.init() })

/**
 * R3b: obstruction queries moved from Rapier raycasts to `StaticColliderRegistry.segmentBlocked`.
 * Build the colliders the views used to give Rapier (walls, containers, window panes, the door leaf
 * in its current pose) and compare both answers on random segments.
 */
function rapierWorld(rt: GameRuntime) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  const owner = new Map<number, string>()
  const add = (id: string, desc: RAPIER.ColliderDesc) => owner.set(world.createCollider(desc).handle, id)
  const box = (min: { x: number; y: number; z: number }, max: typeof min) =>
    RAPIER.ColliderDesc.cuboid((max.x - min.x) / 2, (max.y - min.y) / 2, (max.z - min.z) / 2).setTranslation((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2)
  for (const kind of ['wall', 'container', 'window'] as const) for (const c of rt.staticColliders.list(kind)) add(kind === 'window' ? c.id : c.id, box(c.min, c.max))
  for (const door of rt.map.doors) {
    const leaf = doorLeafTransform(door, rt.world.doors.get(door.id)!.state)
    if (!leaf) continue
    add(door.id, RAPIER.ColliderDesc.cuboid(...leaf.halfExtents).setTranslation(leaf.center.x, leaf.center.y, leaf.center.z).setRotation({ x: 0, y: Math.sin(leaf.angle / 2), z: 0, w: Math.cos(leaf.angle / 2) }))
  }
  world.step() // builds the query pipeline
  const blocked = (from: { x: number; y: number; z: number }, to: typeof from, ignore?: string) => {
    const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
    const len = Math.hypot(d.x, d.y, d.z)
    if (len < 1e-4) return false
    const ray = new RAPIER.Ray(from, { x: d.x / len, y: d.y / len, z: d.z / len })
    return world.castRay(ray, len, true, undefined, undefined, undefined, undefined, (c) => owner.get(c.handle) !== ignore) !== null
  }
  return { world, blocked }
}

function compare(rt: GameRuntime, seed: number, samples: number, span: number) {
  const { world, blocked } = rapierWorld(rt)
  try {
    const rng = createRng(seed)
    const half = rt.map.size / 2
    let hits = 0
    const mismatches: string[] = []
    for (let i = 0; i < samples; i++) {
      const a = { x: (rng() * 2 - 1) * half, y: 0.2 + rng() * 2.6, z: (rng() * 2 - 1) * half }
      const b = { x: a.x + (rng() * 2 - 1) * span, y: 0.2 + rng() * 2.6, z: a.z + (rng() * 2 - 1) * span }
      const ignore = i % 7 === 0 ? rt.map.doors[i % rt.map.doors.length].id : undefined
      const want = blocked(a, b, ignore)
      if (want) hits++
      if (rt.staticColliders.segmentBlocked(a, b, ignore) !== want) mismatches.push(JSON.stringify({ a, b, ignore, want }))
    }
    return { hits, mismatches }
  } finally { world.free() }
}

describe('simulation line of sight = Rapier raycast (R3b)', () => {
  it.each(['closed', 'open', 'destroyed'] as const)('neighbourhood, doors %s: 4 000 random segments agree', (state) => {
    const rt = new GameRuntime(NEIGHBORHOOD_MAP)
    rt.newGame(3)
    for (const d of rt.map.doors) rt.setDoorState(d.id, state)
    const { hits, mismatches } = compare(rt, 11 + state.length, 4000, 12)
    expect(mismatches).toEqual([])
    expect(hits).toBeGreaterThan(400)
  })

  it('stress map 2×2 (re-homed content): long segments agree', () => {
    const rt = new GameRuntime(buildStressMap(2))
    rt.newGame(5)
    const { hits, mismatches } = compare(rt, 99, 3000, 40)
    expect(mismatches).toEqual([])
    expect(hits).toBeGreaterThan(1000)
  })

  it('a zombie behind a wall cannot reach the player; through the open door it can', () => {
    const rt = new GameRuntime(NEIGHBORHOOD_MAP)
    rt.newGame(1)
    const door = rt.map.doors.find((d) => d.id === 'c-1_-1/safehouse/door')!
    const inside = { x: door.center.x, y: 1.6, z: door.center.z - 1.5 }
    const outside = { x: door.center.x, y: 1.6, z: door.center.z + 2 }
    const wallSide = { x: door.center.x + 3, y: 1.6, z: door.center.z + 2 }
    rt.setDoorState(door.id, 'closed')
    expect(rt.isBlocked(outside, inside, [])).toBe(true)
    expect(rt.isBlocked(outside, inside, [door.id])).toBe(false)
    rt.setDoorState(door.id, 'open')
    expect(rt.isBlocked(outside, inside, [])).toBe(false)
    expect(rt.isBlocked(wallSide, inside, [])).toBe(true)
  })
})
