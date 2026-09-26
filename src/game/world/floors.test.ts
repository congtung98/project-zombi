import { describe, expect, it } from 'vitest'
import { loadBundledWorld } from '../../map/content'
import { validateChunkDocument, validatePrefabDocument } from '../../map/validate'
import { resolveInstance } from '../../map/resolve'
import { deepCheck } from '../../map/analysis'
import type { ChunkDocument, PrefabDocument, QuarterTurns, StairsObject } from '../../map/schema'
import { GameRuntime } from '../core/runtime'
import { GAME_CONFIG } from '../core/config'
import { FloorField, stairApproach, stairHeightAt, subtractRect, subtractRects } from './floors'
import { isInsideBuilding } from './buildings'
import { NEIGHBORHOOD_MAP, type MapData } from './mapData'
import { buildLightingBuildings } from '../lighting/buildingLighting'
import { classifyVisibility } from '../systems/playerVision'
import { validateSaveGame } from '../systems/save'
import { collectStaticItems } from '../rendering/staticBatchData'
import { SAVE_SCHEMA_VERSION } from '../../types/save'
import type { Vec3 } from '../../types'

/**
 * M11b multi-storey buildings: content (storeys, levels, stairs, slabs), the floor rule, layered
 * navigation, and the simulation on two floors. The world is the frozen copy of `floors-lab`
 * (`src/test/fixtures/maps/`): a 10 × 8 m house at (16, 14), front door in the west wall, a flight
 * along the south wall climbing east from x 14.5 to 18.5, a bedroom and a landing upstairs.
 */

const HOUSE = 'c0_0/house'
const id = (local: string) => `${HOUSE}/${local}`
const lab = () => loadBundledWorld('floors-lab')
/** The lab without its yard zombies (tests place their own). */
const quietLab = (): MapData => ({ ...lab().map, zombieSpawns: [] })
const prefab = (): PrefabDocument => structuredClone(lab().docs.prefabs.get('building/two-storey')!)
const ENTRY = { prefabId: 'building/two-storey', contentVersion: 1, path: 'prefabs/two-storey.json' }
const codes = (doc: PrefabDocument) => validatePrefabDocument(doc, ENTRY, {}).map((i) => i.code)
const stairsOf = (doc: PrefabDocument) => doc.objects.find((o): o is StairsObject => o.kind === 'stairs')!

/** Player body stand-in: the test moves it; the simulation sets its height. */
function scriptedBody(x: number, z: number) {
  const body = {
    pos: { x, y: 0, z },
    translation: () => ({ ...body.pos }),
    linvel: () => ({ x: 0, y: 0, z: 0 }),
    setLinvel: () => {},
    setTranslation: (p: Vec3) => {
      body.pos = { ...p }
    },
  }
  return body
}

describe('storeys in content (M11b)', () => {
  it('raises every object, room and lamp to its storey; slabs cover the upper floor except the stairwell', () => {
    const { map } = lab()
    expect(map.buildings[0]).toMatchObject({ id: HOUSE, height: 3, storeys: 2 })
    const wall = (wid: string) => map.walls.find((w) => w.id === wid)!
    expect(wall(id('wall-mid-1#0')).position.y).toBe(4.5)
    expect(wall(id('wall-n#0')).position.y).toBe(1.5)
    const door = map.doors.find((d) => d.id === id('door-bedroom'))!
    expect([door.center.y, door.hinge.y]).toEqual([3, 3])
    expect(map.windows!.find((w) => w.id === id('win-n-1'))!.center.y).toBe(4.5)
    expect(map.containers.find((c) => c.id === id('wardrobe'))!.position.y).toBe(3.9)
    expect(map.containers.find((c) => c.id === id('cupboard'))!.position.y).toBe(0.5)
    const room = (rid: string) => map.rooms!.find((r) => r.id === id(rid))!
    expect(room('hall').floorY).toBeUndefined()
    expect(room('bedroom')).toMatchObject({ floorY: 3, height: 3 })
    expect(room('bedroom').lamp!.position.y).toBeCloseTo(5.92)

    const [stairs] = map.stairs!
    expect(stairs).toMatchObject({ id: id('stairs'), level: 0, axis: 'x', dir: 1, bottomY: 0, topY: 3, rect: { minX: 14.5, minZ: 16.35, maxX: 18.5, maxZ: 17.55 } })
    const area = map.floors!.reduce((a, s) => a + (s.rect.maxX - s.rect.minX) * (s.rect.maxZ - s.rect.minZ), 0)
    expect(area).toBeCloseTo(80 - 4 * 1.2)
    for (const s of map.floors!) {
      expect(s).toMatchObject({ buildingId: HOUSE, level: 1, y: 3 })
      expect(subtractRect(s.rect, stairs.rect)).toEqual([s.rect])
    }
    // The flight is walled in: sides up to a railing upstairs, a wall under its top end, a railing across its foot upstairs.
    const top = (w: { position: Vec3; size: number[] }) => w.position.y + w.size[1] / 2
    const bottom = (w: { position: Vec3; size: number[] }) => w.position.y - w.size[1] / 2
    expect([bottom(wall(id('stairs#side-a'))), top(wall(id('stairs#side-a')))]).toEqual([0, 4])
    expect([bottom(wall(id('stairs#back'))), top(wall(id('stairs#back')))]).toEqual([0, 2.2])
    expect([bottom(wall(id('stairs#rail'))), top(wall(id('stairs#rail')))]).toEqual([3, 4])
  })

  it('a flight turns with its instance: ends on floor inside the building, the hole where it arrives', () => {
    const doc = prefab()
    for (const q of [0, 1, 2, 3] as QuarterTurns[]) {
      const { parts } = resolveInstance({ instanceId: 'x/house', prefabId: doc.prefabId, position: { x: 50, y: 0, z: 50 }, quarterTurns: q }, doc, { x: 0, z: 0 })
      const [s] = parts.stairs
      const b = parts.buildings[0]
      const foot = stairApproach(s, 0, 0.9)
      const head = stairApproach(s, 1, 0.9)
      expect([isInsideBuilding(b, foot.x, foot.z), isInsideBuilding(b, head.x, head.z)]).toEqual([true, true])
      expect([foot.y, head.y]).toEqual([0, 3])
      const end0 = stairApproach(s, 0, 0)
      const end1 = stairApproach(s, 1, 0)
      expect([stairHeightAt(s, end0.x, end0.z), stairHeightAt(s, end1.x, end1.z)]).toEqual([0, 3])
      expect(subtractRects(parts.floors.map((f) => f.rect), [s.rect]).length).toBe(parts.floors.length)
      // Same climb as q = 0, turned: foot → head is the local +X turned by q.
      const [dx, dz] = [[1, 0], [0, -1], [-1, 0], [0, 1]][q]
      expect(Math.sign(head.x - foot.x) || 0).toBe(dx)
      expect(Math.sign(head.z - foot.z) || 0).toBe(dz)
    }
  })

  it('validates storeys, levels and stairs', () => {
    expect(codes(prefab())).toEqual([])
    const flat = prefab()
    flat.building!.storeys = 1
    expect(codes(flat)).toEqual(expect.arrayContaining(['stairs-need-storeys', 'out-of-range']))
    const low = prefab()
    low.building!.height = 2.4
    expect(codes(low)).toContain('storey-height')
    const steep = prefab()
    stairsOf(steep).length = 2
    expect(codes(steep)).toContain('stairs-too-steep')
    const outside = prefab()
    stairsOf(outside).position = { x: 3, z: 2.95 }
    expect(codes(outside)).toContain('stairs-outside-footprint')
    const tooHigh = prefab()
    stairsOf(tooHigh).level = 1
    expect(codes(tooHigh)).toContain('out-of-range')
    const roomLevel = prefab()
    roomLevel.rooms[0].level = 2
    expect(codes(roomLevel)).toContain('out-of-range')
    const tree = prefab()
    tree.objects.push({ kind: 'tree', localId: 'tree', level: 1, position: { x: 0, z: 0 }, height: 5, canopy: 2, trunk: 0.2, color: '#336633', style: 'round' } as never)
    expect(codes(tree)).toContain('level-not-allowed')
    const { docs } = lab()
    const chunk = structuredClone(docs.chunks.get('c0_0')!) as ChunkDocument
    chunk.objects.push({ kind: 'prop', objectId: 'c0_0/objects/crate', level: 1, position: { x: 4, y: 0.5, z: 4 }, size: [1, 1, 1], color: '#555555' } as never)
    expect(validateChunkDocument(chunk, docs.world.chunks[0], docs.world).map((i) => i.code)).toContain('level-not-allowed')
  })

  it('the deep check walks up the flight: everything upstairs is reachable', () => {
    expect(deepCheck(lab().docs).issues).toEqual([])
  })
})

describe('the floor rule (FloorField)', () => {
  const { map } = lab()
  const field = new FloorField(map.floors, map.stairs)

  it('keeps bodies on the ground, on the slab, or on the flight they walk', () => {
    expect(new FloorField().surfaceAt(3, 4, 7)).toBe(0)
    expect(field.surfaceAt(5, 5, 0)).toBe(0) // outside
    expect(field.surfaceAt(16, 12, 0)).toBe(0) // under the upper floor: never climbs onto it
    expect(field.surfaceAt(16, 12, 3)).toBe(3) // on it
    expect(field.surfaceAt(15.5, 16.95, 0.5)).toBeCloseTo(0.75) // a quarter up the flight
    expect(field.surfaceAt(18.6, 16.95, 2.9)).toBe(3) // off the top onto the landing
    expect(field.surfaceAt(18.4, 16.95, 3)).toBeCloseTo(2.925) // back onto the flight from the landing
    expect(field.surfaceAt(18.4, 16.95, 0)).toBe(0) // under the top end, from the ground: stays down
  })

  it('follows the way a body went: a long step (slow frame) still climbs; a teleport does not (M11c-1B)', () => {
    // From the foot (x 14) to 16.5 m in one step: the flight is already 1.5 m high there.
    expect(field.surfaceAt(16.5, 16.95, 0)).toBe(0) // one jump: would pass under the flight
    expect(field.follow(14, 16.95, 16.5, 16.95, 0)).toBeCloseTo(1.5) // along the way: on it
    expect(field.follow(14, 16.95, 14.2, 16.95, 0)).toBe(0) // a short step on the ground
    expect(field.follow(12, 12, 16, 12, 3)).toBe(3) // walking the upper floor
    // Further than a walk can go in one step: the destination alone (under the upper floor: ground).
    expect(field.follow(8, 16.95, 16.5, 16.95, 0)).toBe(0)
    expect(new FloorField().follow(0, 0, 3, 4, 7)).toBe(0)
  })

  it('subtracts rectangles into strips', () => {
    const a = { minX: 0, minZ: 0, maxX: 10, maxZ: 10 }
    const strips = subtractRect(a, { minX: 2, minZ: 3, maxX: 4, maxZ: 5 })
    expect(strips.reduce((s, r) => s + (r.maxX - r.minX) * (r.maxZ - r.minZ), 0)).toBe(96)
    expect(subtractRect(a, { minX: -1, minZ: -1, maxX: 11, maxZ: 11 })).toEqual([])
    expect(subtractRect(a, { minX: 20, minZ: 0, maxX: 30, maxZ: 10 })).toEqual([a])
  })
})

describe('layered navigation (NavWorld)', () => {
  const OUTSIDE = { x: 8, y: 0, z: 20 }
  const BEDROOM = { x: 12.5, y: 3, z: 11.5 }

  it('a single-storey world is the ground grid, unchanged', () => {
    const rt = new GameRuntime(NEIGHBORHOOD_MAP)
    expect(rt.navWorld.single).toBe(true)
    expect(rt.navWorld.ground).toBe(rt.nav)
    expect(rt.navWorld.portals).toBe(rt.nav.portals)
  })

  it('one layer per storey, joined by the flight', () => {
    const rt = new GameRuntime(quietLab())
    const w = rt.navWorld
    expect(w.layers.map((l) => [l.elevation, l.buildingId])).toEqual([[0, null], [3, HOUSE]])
    expect(w.stairs.map((s) => [s.stair.id, s.lower, s.upper])).toEqual([[id('stairs'), 0, 1]])
    expect(w.locate({ x: 16, y: 1.5, z: 16.95 })).toMatchObject({ stair: 0 })
    expect(w.locate({ x: 16, y: 3, z: 12 })).toEqual({ layer: 1 })
    expect(w.locate({ x: 16, y: 0, z: 12 })).toEqual({ layer: 0 })
    expect(w.hasLineOfWalk({ x: 12, y: 0, z: 12 }, { x: 14, y: 3, z: 12 })).toBe(false)
    expect(w.hasLineOfWalk({ x: 12, y: 3, z: 12 }, { x: 14, y: 3, z: 12 })).toBe(true)
  })

  it('routes up the flight when the front door is open, breaks it when closed, and upstairs doors count', () => {
    const rt = new GameRuntime(quietLab())
    const w = rt.navWorld
    expect(w.routeKind(OUTSIDE, BEDROOM)).toBe('none')
    expect(w.findDoorRoute(OUTSIDE, BEDROOM)).toMatchObject({ doorId: id('door'), side: 0 })
    rt.setDoorState(id('door'), 'open')
    expect(w.routeKind(OUTSIDE, BEDROOM)).toBe('search')
    expect(w.componentAt(OUTSIDE)).toBe(w.componentAt(BEDROOM))
    const path = w.findPath(OUTSIDE, BEDROOM)!
    // Through the door, to the foot of the flight, straight up to its head, then upstairs.
    const foot = path.findIndex((p) => Math.abs(p.x - 13.6) < 1e-6 && p.y === 0)
    expect(foot).toBeGreaterThan(0)
    expect(path[foot + 1]).toMatchObject({ x: 19.4, y: 3 })
    expect(path.slice(foot + 1).every((p) => p.y === 3)).toBe(true)
    expect(path.at(-1)).toEqual(BEDROOM)
    rt.setDoorState(id('door-bedroom'), 'closed')
    expect(w.routeKind(OUTSIDE, BEDROOM)).toBe('none')
    expect(w.findDoorRoute(OUTSIDE, BEDROOM)).toMatchObject({ doorId: id('door-bedroom'), approach: { y: 3 } })
    // Halfway up the flight: straight to either end.
    const onStairs = { x: 16.5, y: 1.5, z: 16.95 }
    expect(w.findPath(onStairs, { x: 20, y: 3, z: 15 })![0]).toMatchObject({ x: 19.4, y: 3 })
    expect(w.findPath(onStairs, { x: 12, y: 0, z: 15 })![0]).toMatchObject({ x: 13.6, y: 0 })
  })
})

describe('two storeys in the simulation', () => {
  it('the player walks up the flight onto the upper floor and back down, even on long frames', () => {
    const rt = new GameRuntime(quietLab())
    const body = scriptedBody(13.6, 16.95)
    rt.registerPlayerBody(body as unknown as Parameters<GameRuntime['registerPlayerBody']>[0])
    rt.player.position = { x: 13.6, y: 0, z: 16.95 }
    const walk = (dx: number, dt: number, seconds: number) => {
      for (let t = 0; t < seconds - 1e-9; t += dt) {
        body.pos.x += dx * dt
        rt.tick(dt)
      }
    }
    walk(4, 1 / 60, 0.75) // x 16.6: halfway
    expect(rt.player.position.y).toBeCloseTo(1.5, 0)
    walk(4, 1 / 60, 0.75) // x 19.6: past the top
    expect(rt.player.position.y).toBe(3)
    expect(body.pos.y).toBeCloseTo(3 + GAME_CONFIG.player.height / 2 + 0.02)
    walk(-7, 0.1, 1) // running down on 10 fps frames
    expect(rt.player.position.y).toBe(0)
    expect(body.pos.x).toBeCloseTo(12.6)
  })

  it('an upper storey door leaf and lamp switch stand on the upper floor (collider, sight, drawing, reach)', () => {
    const rt = new GameRuntime(quietLab())
    const door = id('door-bedroom')
    for (const pose of ['open', 'closed']) {
      const c = rt.staticColliders.get(`${door}:${pose}`)!
      expect(c.min.y).toBeCloseTo(3)
      expect(c.max.y).toBeCloseTo(5.2)
    }
    const leaf = rt.visionOccluders.all.find((o) => o.id === door)!
    expect([leaf.min.y, leaf.max.y].map((y) => Math.round(y * 100) / 100)).toEqual([3, 5.2])
    // Nothing of it is left on the ground floor below: a zombie walks through where it stands above.
    rt.setDoorState(door, 'closed')
    const below = rt.staticColliders.querySolid(15.5, 13.3, 16.5, 13.7).filter((c) => c.min.y < 1.8)
    expect(below.map((c) => c.id)).toEqual([])
    const lamp = rt.map.rooms!.find((r) => r.id === id('bedroom'))!.lamp!
    expect(lamp.floorY).toBe(3)
    expect(rt.interactables.find((i) => i.id === lamp.id)!.position.y).toBeCloseTo(4.3)
    expect(rt.map.rooms!.find((r) => r.id === id('hall'))!.lamp!.floorY).toBeUndefined()
  })

  it('walking under the upper floor stays on the ground', () => {
    const rt = new GameRuntime(quietLab())
    rt.player.position = { x: 12, y: 0, z: 12 }
    for (let x = 12; x <= 20; x += 0.5) {
      rt.player.position.x = x
      rt.tick(1 / 60)
      expect(rt.player.position.y).toBe(0)
    }
  })

  it('reaches only the interactables of the storey the player stands on', () => {
    const rt = new GameRuntime(quietLab())
    rt.player.facing = Math.PI // towards −Z: the cupboard, and the wardrobe right above it
    rt.player.position = { x: 12.5, y: 0, z: 11.4 }
    rt.tick(1 / 60)
    expect(rt.currentInteractable?.id).toBe(id('cupboard'))
    rt.player.position = { x: 12.5, y: 3, z: 11.4 }
    rt.tick(1 / 60)
    expect(rt.currentInteractable?.id).toBe(id('wardrobe'))
    rt.interact(rt.currentInteractable!)
    expect(rt.openContainerId).toBe(id('wardrobe'))
    // Dropped upstairs, the bag lies on the upper floor.
    rt.closeAllUi()
    rt.player.inventory.slots[0] = { id: 'test:1', itemId: 'water', quantity: 1, kind: 'stack' }
    expect(rt.dropItem(0)).toBe(true)
    expect(rt.world.containers.get('drop:test:1')!.position).toMatchObject({ y: 3 })
  })

  it('storeys block sight and blows: a zombie right under the player neither sees nor hits them', () => {
    const rt = new GameRuntime(quietLab())
    rt.pickWanderPoint = () => null
    rt.player.position = { x: 14.5, y: 3, z: 12 }
    expect(rt.isBlocked({ x: 14.5, y: 1.5, z: 12 }, { x: 14.5, y: 4.5, z: 12 }, [])).toBe(true)
    const zombie = rt.spawnZombie({ x: 14.5, y: 0, z: 12.3 })
    zombie.ai = 'CHASE'
    zombie.seesTarget = true
    for (let t = 0; t < 1; t += 1 / 30) rt.tick(1 / 30)
    expect(rt.player.health).toBe(GAME_CONFIG.player.maxHealth)
    expect(zombie.ai).not.toBe('ATTACK')
    expect(zombie.position.y).toBe(0)
    // Player vision: the slab hides a zombie on the floor below, even within the near radius.
    const los = (a: Vec3, b: Vec3) => rt.visionOccluders.firstBlocker(a, b) === null
    const observer = { position: rt.player.position, facing: 0 }
    expect(classifyVisibility(observer, { x: 15.5, y: 0, z: 12 }, GAME_CONFIG.playerVision, los)).toBe('BLOCKED_BY_OCCLUDER')
    expect(classifyVisibility(observer, { x: 15.5, y: 3, z: 12 }, GAME_CONFIG.playerVision, los)).toBe('NEAR_DETECTION')
  })

  it('a zombie follows a remembered player up the stairs and attacks on the upper floor', () => {
    const rt = new GameRuntime(quietLab())
    rt.pathBudget = { ...rt.pathBudget, maxPathMs: Infinity }
    rt.pickWanderPoint = () => null
    rt.player.position = { x: 14.5, y: 3, z: 12 }
    const zombie = rt.spawnZombie({ x: 13, y: 0, z: 12 })
    zombie.ai = 'SEARCH'
    zombie.lastKnownTarget = { ...rt.player.position }
    zombie.memorySource = 'noise'
    let climbed = false
    for (let t = 0; t < 30 && rt.player.health === GAME_CONFIG.player.maxHealth; t += 1 / 30) {
      rt.tick(1 / 30)
      if (zombie.position.y > 1 && zombie.position.y < 2) climbed = true
    }
    expect(climbed).toBe(true)
    expect(zombie.position.y).toBe(3)
    expect(rt.player.health).toBeLessThan(GAME_CONFIG.player.maxHealth)
  })

  it('lights each storey on its own; the stairwell passes light between them', () => {
    const rt = new GameRuntime(quietLab())
    expect(rt.lighting.getRoomAtPosition({ x: 16, y: 3, z: 12 })?.id).toBe(id('bedroom'))
    expect(rt.lighting.getRoomAtPosition({ x: 16, y: 0, z: 12 })?.id).toBe(id('hall'))
    rt.setLamp(id('lamp-bedroom'), true)
    rt.tick(1 / 60)
    expect(rt.lighting.getRoomLight(id('bedroom'))!.artificialLight).toBeCloseTo(0.7)
    expect(rt.lighting.getRoomLight(id('hall'))!.artificialLight).toBe(0)
    const [house] = buildLightingBuildings(rt.map, GAME_CONFIG.buildingLighting)
    expect(house.edges).toContainEqual({ doorId: id('stairs'), a: id('hall'), b: id('landing'), transmission: GAME_CONFIG.buildingLighting.defaultOpenDoorTransmission })
    // The bedroom lamp switch is upstairs.
    rt.player.position = { x: 16.8, y: 0, z: 12.9 }
    rt.player.facing = 0
    rt.tick(1 / 60)
    expect(rt.currentInteractable?.id).not.toBe(id('lamp-bedroom'))
  })

  it('saves keep the storey; v8 saves (one storey) land on the ground', () => {
    const rt = new GameRuntime(quietLab())
    rt.player.position = { x: 14.5, y: 3, z: 12 }
    rt.spawnZombie({ x: 16, y: 3, z: 15 })
    rt.tick(1 / 60)
    const snap = JSON.parse(JSON.stringify(rt.createSnapshot()))
    expect(snap.schemaVersion).toBe(SAVE_SCHEMA_VERSION)
    const checked = validateSaveGame(snap, rt.map.id, rt.map)
    if (!checked.ok) throw new Error(checked.detail)
    expect(checked.migrated).toBe(false)
    const other = new GameRuntime(quietLab())
    other.loadSnapshot(checked.save)
    other.tick(1 / 60)
    expect(other.player.position.y).toBe(3)
    expect(other.zombies.get('zombie-1')!.position.y).toBe(3)

    const v8 = structuredClone(snap)
    v8.schemaVersion = 8
    v8.player.position.y = 0.9
    v8.zombies[0].position.y = 0.9
    const old = validateSaveGame(v8, rt.map.id, rt.map)
    if (!old.ok) throw new Error(old.detail)
    expect(old).toMatchObject({ migrated: true, fromVersion: 8 })
    expect([old.save.player.position.y, old.save.zombies[0].position.y]).toEqual([0, 0])
  })

  it('draws the upper floor slabs, the treads of the flight and the roof on the top storey', () => {
    const rt = new GameRuntime(quietLab())
    const items = collectStaticItems(rt.map, rt.staticColliders)
    const slabs = items.filter((i) => i.shape === 'box' && Math.abs(i.center.y - 2.9) < 1e-6 && i.size[1] === 0.2)
    expect(slabs).toHaveLength(rt.map.floors!.length)
    const roof = items.filter((i) => i.roofOf === HOUSE)
    expect(roof.every((r) => Math.abs(r.center.y - 6.1) < 1e-6)).toBe(true)
    const treads = items.filter((i) => i.shape === 'box' && Math.abs(i.center.z - 16.95) < 1e-6 && i.center.x > 14.5 && i.center.x < 18.5)
    expect(treads).toHaveLength(15)
    expect(Math.max(...treads.map((t) => t.center.y + t.size[1] / 2))).toBeCloseTo(3)
  })
})
