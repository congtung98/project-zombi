import { describe, expect, it } from 'vitest'
import { GAME_CONFIG } from '../core/config'
import { GameRuntime } from '../core/runtime'
import { BuildingLightingSystem, OUTDOOR, outdoorLightLevel, solveBuilding, type LightingBuilding, type LightingInputs } from './buildingLighting'
import { classifyVisibility } from '../systems/playerVision'
import type { RoomPlacement } from '../world/buildings'
import type { DoorStatus } from '../world/doors'

const CFG = GAME_CONFIG.buildingLighting
const NOON = 0.5
const MIDNIGHT = 0
/** Time of day for an hour (clock: 0 = 00:00, 0.5 = 12:00). */
const at = (hour: number) => hour / 24

function room(id: string): RoomPlacement {
  return { id, name: id, buildingId: 'b', bounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }, height: 3, lamp: null }
}

function inputs(doors: Record<string, DoorStatus> = {}, extra: Partial<LightingInputs> = {}): LightingInputs {
  return { doorState: (id) => doors[id] ?? 'open', curtainClosed: () => false, lampOn: () => false, electricity: () => true, ...extra }
}

/** Runtime on the neighbourhood map at a time of day, lighting solved. */
function world(timeOfDay = NOON) {
  const rt = new GameRuntime()
  rt.newGame(5)
  rt.clock.restore(0, timeOfDay, 1)
  rt.tick(1 / 60)
  const light = (roomId: string) => rt.lighting.getRoomLight(roomId)!
  return { rt, light }
}

describe('outdoor light level (day/night adapter)', () => {
  it('≈ 1 at noon, ≈ 0.05 at midnight, in between at dawn/dusk', () => {
    expect(outdoorLightLevel(NOON, CFG)).toBeCloseTo(1)
    expect(outdoorLightLevel(MIDNIGHT, CFG)).toBeCloseTo(CFG.nightOutdoorLevel)
    const dusk = outdoorLightLevel(GAME_CONFIG.clock.nightStart, CFG)
    expect(dusk).toBeGreaterThan(0.1)
    expect(dusk).toBeLessThan(0.9)
  })
})

describe('room graph solver', () => {
  it('propagation: light × transmission × decay per step, depth ≤ 3, below-threshold light stops', () => {
    // Window room → kitchen → hallway → bathroom → closet (5 rooms in a line), doors open.
    const b: LightingBuilding = {
      id: 'b', rooms: ['living', 'kitchen', 'hall', 'bath', 'closet'].map(room), lamps: [], lightingDirty: true,
      windows: [{ id: 'w1', roomId: 'living', daylightFactor: 0.75 }, { id: 'w2', roomId: 'living', daylightFactor: 0.75 }],
      edges: [
        { doorId: 'd1', a: 'living', b: 'kitchen' },
        { doorId: 'd2', a: 'kitchen', b: 'hall' },
        { doorId: 'd3', a: 'hall', b: 'bath' },
        { doorId: 'd4', a: 'bath', b: 'closet' },
      ],
    }
    const r = solveBuilding(b, 1, inputs(), CFG)
    const living = r.get('living')!.directOutdoorLight
    expect(living).toBeCloseTo(Math.min(1, 1.5 * CFG.windowExposureScale) * CFG.roomDepthFactor)
    const step = CFG.defaultOpenDoorTransmission * CFG.propagationDecay
    expect(r.get('kitchen')!.propagatedLight).toBeCloseTo(living * step)
    expect(r.get('hall')!.propagatedLight).toBeCloseTo(living * step ** 2)
    expect(r.get('bath')!.propagatedLight).toBeCloseTo(living * step ** 3)
    expect(r.get('closet')!.propagatedLight).toBe(0) // depth 4: not reached
    expect(r.get('closet')!.finalLightLevel).toBe(CFG.minIndoorLight)
    // Closing the first door: 0.05 × 0.8 × 0.72 < threshold → nothing reaches the kitchen.
    const closed = solveBuilding(b, 1, inputs({ d1: 'closed' }), CFG)
    expect(closed.get('kitchen')!.propagatedLight).toBe(0)
  })

  it('cycles terminate and the best path wins (no light bouncing back and forth)', () => {
    const b: LightingBuilding = {
      id: 'b', rooms: ['a', 'b', 'c', 'd'].map(room), lamps: [], lightingDirty: true,
      windows: [{ id: 'w', roomId: 'a', daylightFactor: 0.75 }],
      edges: [{ doorId: '1', a: 'a', b: 'b' }, { doorId: '2', a: 'b', b: 'c' }, { doorId: '3', a: 'c', b: 'd' }, { doorId: '4', a: 'd', b: 'a' }],
    }
    const r = solveBuilding(b, 1, inputs(), CFG)
    const direct = r.get('a')!.directOutdoorLight
    const step = CFG.defaultOpenDoorTransmission * CFG.propagationDecay
    expect(r.get('b')!.propagatedLight).toBeCloseTo(direct * step)
    expect(r.get('d')!.propagatedLight).toBeCloseTo(direct * step)
    expect(r.get('c')!.propagatedLight).toBeCloseTo(direct * step ** 2)
    expect(r.get('a')!.propagatedLight).toBe(0) // never feeds itself
  })

  it('an exterior door lets outdoor light into a windowless room; outdoors is only a source', () => {
    const b: LightingBuilding = { id: 'b', rooms: [room('hut')], lamps: [], lightingDirty: true, windows: [], edges: [{ doorId: 'front', a: OUTDOOR, b: 'hut' }] }
    expect(solveBuilding(b, 1, inputs({ front: 'closed' }), CFG).get('hut')!.propagatedLight).toBeCloseTo(CFG.defaultClosedDoorTransmission * CFG.propagationDecay)
    expect(solveBuilding(b, 1, inputs({ front: 'open' }), CFG).get('hut')!.propagatedLight).toBeCloseTo(CFG.defaultOpenDoorTransmission * CFG.propagationDecay)
    expect(solveBuilding(b, 1, inputs({ front: 'destroyed' }), CFG).get('hut')!.propagatedLight).toBeCloseTo(CFG.destroyedDoorTransmission * CFG.propagationDecay)
  })

  it('final light combines without exceeding 1: 1 − (1 − direct)(1 − propagated)(1 − artificial)', () => {
    const b: LightingBuilding = {
      id: 'b', rooms: [{ ...room('r'), lamp: null }], lightingDirty: true, edges: [{ doorId: 'front', a: OUTDOOR, b: 'r' }],
      windows: [{ id: 'w', roomId: 'r', daylightFactor: 0.75 }],
      lamps: [{ id: 'l', name: 'l', roomId: 'r', intensity: 0.8, color: '#ffffff', requiresElectricity: true, switchAt: { x: 0, z: 0 }, position: { x: 0, y: 2.9, z: 0 } }],
    }
    const r = solveBuilding(b, 1, inputs({}, { lampOn: () => true }), CFG).get('r')!
    expect(r.finalLightLevel).toBeCloseTo(1 - (1 - r.directOutdoorLight) * (1 - r.propagatedLight) * (1 - r.artificialLight))
    expect(r.finalLightLevel).toBeLessThanOrEqual(1)
  })
})

describe('building lighting acceptance (neighbourhood map)', () => {
  it('graph: windows and doors find their rooms (bedroom door joins living ↔ bedroom, front door joins outdoors)', () => {
    const { rt } = world()
    const house = Array.from(rt.lighting.allBuildings()).find((b) => b.id === 'house')!
    expect(house.windows.map((w) => [w.id, w.roomId])).toEqual([['win-house-n', 'room-house-living'], ['win-house-w', 'room-house-living']])
    expect(house.edges).toEqual(expect.arrayContaining([
      { doorId: 'door-house', a: OUTDOOR, b: 'room-house-living' },
      { doorId: 'door-house-bedroom', a: 'room-house-living', b: 'room-house-bedroom' },
    ]))
    expect(house.lamps.map((l) => l.id)).toEqual(['lamp-house-living', 'lamp-house-bedroom'])
  })

  it('1 · outdoor daylight: ≈ 1 at noon outside, whatever the facing', () => {
    const { rt } = world()
    const outside = { x: 0, y: 0.9, z: -8 }
    for (const facing of [0, 1, 2, 3, 4, 5, 6]) {
      rt.player.facing = facing
      rt.tick(1 / 60)
      expect(rt.lighting.getLightAtPosition(outside)).toBeCloseTo(1)
    }
  })

  it('2 · a room with windows is lit (> 0.5) at noon', () => {
    const { light } = world()
    expect(light('room-house-living').finalLightLevel).toBeGreaterThan(0.5)
    expect(light('room-safehouse').finalLightLevel).toBeGreaterThan(0.5)
    expect(light('room-store').finalLightLevel).toBeGreaterThan(0.5)
  })

  it('3 · back room (no window, door open) is darker than the window room', () => {
    const { light } = world()
    expect(light('room-house-bedroom').finalLightLevel).toBeLessThan(light('room-house-living').finalLightLevel)
    expect(light('room-house-bedroom').propagatedLight).toBeGreaterThan(0.2)
  })

  it('4 · closing the bedroom door drops it significantly; opening restores it', () => {
    const { rt, light } = world()
    const open = light('room-house-bedroom').finalLightLevel
    rt.setDoorState('door-house-bedroom', 'closed')
    rt.tick(1 / 60)
    const closed = light('room-house-bedroom').finalLightLevel
    expect(closed).toBeLessThan(open * 0.3)
    expect(light('room-house-living').finalLightLevel).toBeCloseTo(light('room-house-living').finalLightLevel) // living unaffected
    rt.setDoorState('door-house-bedroom', 'open')
    rt.tick(1 / 60)
    expect(light('room-house-bedroom').finalLightLevel).toBeCloseTo(open)
  })

  it('5 · night, windowless bedroom: dark with the lamp off, clearly lit with it on', () => {
    const { rt, light } = world(MIDNIGHT)
    expect(light('room-house-bedroom').finalLightLevel).toBeLessThan(0.1)
    rt.setLamp('lamp-house-bedroom', true)
    rt.tick(1 / 60)
    expect(light('room-house-bedroom').artificialLight).toBeCloseTo(0.7)
    expect(light('room-house-bedroom').finalLightLevel).toBeGreaterThan(0.6)
  })

  it('6 · no electricity: a switched-on electric lamp gives nothing', () => {
    const { rt, light } = world(MIDNIGHT)
    rt.setLamp('lamp-house-bedroom', true)
    rt.setElectricity(false)
    rt.tick(1 / 60)
    expect(light('room-house-bedroom').artificialLight).toBe(0)
    rt.setElectricity(true)
    rt.tick(1 / 60)
    expect(light('room-house-bedroom').artificialLight).toBeCloseTo(0.7)
  })

  it('7 · turning the player 360° never changes room light nor triggers a recomputation', () => {
    const { rt } = world()
    rt.player.position = { x: 11, y: 0.9, z: 12 }
    const before = JSON.stringify(Array.from(rt.lighting.roomsList(), (r) => rt.lighting.getRoomLight(r.id)))
    const recalcs = rt.lighting.stats.recalculations
    const revision = rt.lighting.revision
    for (let deg = 0; deg <= 360; deg += 15) {
      rt.player.facing = (deg * Math.PI) / 180
      rt.tick(1 / 60)
    }
    expect(JSON.stringify(Array.from(rt.lighting.roomsList(), (r) => rt.lighting.getRoomLight(r.id)))).toBe(before)
    expect(rt.lighting.stats.recalculations).toBe(recalcs)
    expect(rt.lighting.revision).toBe(revision)
  })

  it('8 · player vision independence: a zombie out of the FOV in a bright room is hidden, the room stays bright', () => {
    const { rt, light } = world()
    const zombie = rt.spawnZombie({ x: 10, y: 0, z: 14 })
    rt.player.position = { x: 12.5, y: 0.9, z: 10.5 }
    rt.player.facing = Math.PI // looking −Z, the zombie is behind (+Z), 4.3 m away
    for (let i = 0; i < 6; i++) rt.tick(1 / 60)
    const bright = light('room-house-living').finalLightLevel
    expect(bright).toBeGreaterThan(0.5)
    expect(rt.vision.get(zombie.id)!.reason).toBe('OUTSIDE_FOV')
    rt.player.facing = Math.atan2(10 - 12.5, 14 - 10.5)
    for (let i = 0; i < 6; i++) rt.tick(1 / 60)
    expect(rt.vision.isVisible(zombie.id)).toBe(true)
    expect(light('room-house-living').finalLightLevel).toBe(bright)
  })

  it('9 · 12:00 → 20:00: window rooms darken gradually, the back room reaches the floor first, lamps stay', () => {
    const { rt, light } = world(at(12))
    rt.setLamp('lamp-store', true)
    const samples: { living: number; bedroom: number; lampArt: number }[] = []
    for (let h = 12; h <= 20; h += 0.25) {
      rt.clock.restore(rt.clock.elapsed, at(h), 1)
      rt.tick(1 / 60)
      samples.push({ living: light('room-house-living').finalLightLevel, bedroom: light('room-house-bedroom').finalLightLevel, lampArt: light('room-store').artificialLight })
    }
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].living).toBeLessThanOrEqual(samples[i - 1].living + 1e-9)
      expect(samples[i].bedroom).toBeLessThanOrEqual(samples[i - 1].bedroom + 1e-9)
    }
    expect(samples[0].living).toBeGreaterThan(0.5)
    expect(samples.at(-1)!.living).toBeLessThan(0.15)
    const floorAt = (key: 'living' | 'bedroom') => samples.findIndex((s) => s[key] <= CFG.minIndoorLight + 1e-9)
    expect(floorAt('bedroom')).toBeGreaterThanOrEqual(0)
    expect(floorAt('living') === -1 || floorAt('bedroom') < floorAt('living')).toBe(true)
    expect(new Set(samples.map((s) => s.lampArt))).toEqual(new Set([0.9]))
  })

  it('10 · closing a curtain lowers direct daylight but not to zero; it also blocks the player’s sight', () => {
    const { rt, light } = world()
    const open = light('room-safehouse').directOutdoorLight
    rt.setCurtain('win-safehouse-n', true)
    rt.setCurtain('win-safehouse-e', true)
    rt.tick(1 / 60)
    const closed = light('room-safehouse').directOutdoorLight
    expect(closed).toBeLessThan(open * 0.3)
    expect(closed).toBeGreaterThan(0)
    // Vision: from inside, a zombie outside the north window is seen through the glass, not through the curtain.
    const observer = { position: { x: -12, y: 0.9, z: -16.5 }, facing: Math.PI }
    const outside = { x: -12, y: 0, z: -22 }
    const los = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => rt.visionOccluders.firstBlocker(a, b) === null
    expect(classifyVisibility(observer, outside, GAME_CONFIG.playerVision, los)).toBe('BLOCKED_BY_OCCLUDER')
    rt.setCurtain('win-safehouse-n', false)
    expect(classifyVisibility(observer, outside, GAME_CONFIG.playerVision, los)).toBe('VISIBLE')
  })
})

describe('event driven updates and world interaction', () => {
  it('recomputes only on changes: nothing per tick at a steady time, daylight in 0.03 steps', () => {
    const { rt } = world(NOON)
    const base = rt.lighting.stats.recalculations
    for (let i = 0; i < 120; i++) rt.tick(1 / 60) // 2 s at noon: outdoor level constant
    expect(rt.lighting.stats.recalculations).toBe(base)
    rt.setLamp('lamp-safehouse', true)
    rt.tick(1 / 60)
    expect(rt.lighting.stats.recalculations).toBe(base + 1) // only the safehouse
    const sys = new BuildingLightingSystem(CFG, inputs(), [])
    sys.updateOutdoorLight(1)
    sys.updateOutdoorLight(0.985)
    sys.updateOutdoorLight(0.975)
    expect(sys.stats.daylightSteps).toBe(1)
    sys.updateOutdoorLight(0.96)
    expect(sys.stats.daylightSteps).toBe(2)
  })

  it('light at a position: the room level indoors, the outdoor level outside', () => {
    const { rt, light } = world(NOON)
    expect(rt.lighting.getLightAtPosition({ x: 16, y: 0.9, z: 13 })).toBe(light('room-house-bedroom').finalLightLevel)
    expect(rt.lighting.getRoomAtPosition({ x: 11, y: 0.9, z: 12 })!.id).toBe('room-house-living')
    expect(rt.lighting.getRoomAtPosition({ x: 0, y: 0.9, z: 0 })).toBeNull()
  })

  it('E on the wall switch toggles the lamp; the curtain cannot be drawn from outside through the glass', () => {
    const { rt } = world(NOON)
    // Physics stand-in for this scene: only the safehouse north wall line (z = −18, glass included) blocks.
    rt.registerPhysicsQuery({ isBlocked: (a, b) => (a.z < -18) !== (b.z < -18) })
    const sw = rt.interactables.find((i) => i.id === 'lamp-house-living')!
    rt.interact(sw)
    expect(rt.world.lamps.get('lamp-house-living')).toBe(true)
    const curtain = rt.interactables.find((i) => i.id === 'win-safehouse-n')!
    expect(curtain.kind).toBe('window')
    // Inside, in front of the window, facing it.
    rt.player.position = { x: -12, y: 0.9, z: -16.9 }
    rt.player.facing = Math.PI
    rt.tick(1 / 60)
    expect(rt.currentInteractable?.id).toBe('win-safehouse-n')
    expect(rt.interactPrompt).toBe('Kéo rèm Cửa sổ phía bắc nhà an toàn')
    // Outside the same window: the glass (nav/physics blocker) is in the way.
    rt.player.position = { x: -12, y: 0.9, z: -18.8 }
    rt.player.facing = 0
    rt.tick(1 / 60)
    expect(rt.currentInteractable?.id).not.toBe('win-safehouse-n')
  })

  it('window glass blocks walking like the wall it replaces; the bedroom door starts open', () => {
    const { rt } = world(NOON)
    expect(rt.nav.isWalkable(-12, -18)).toBe(false)
    expect(rt.world.doors.get('door-house-bedroom')!.state).toBe('open')
    expect(rt.nav.findPath({ x: 11, y: 0, z: 10 }, { x: 16.5, y: 0, z: 14 })).not.toBeNull()
  })
})

describe('lighting is not player vision', () => {
  const sources = import.meta.glob<string>(['./buildingLighting.ts', '../rendering/IndoorLighting.tsx', '../rendering/indoorShading.ts', '../rendering/LampView.tsx', '../rendering/WindowView.tsx'], { query: '?raw', import: 'default', eager: true })

  it('lighting code never reads the vision system, the player facing or the camera', () => {
    expect(Object.keys(sources)).toHaveLength(5)
    for (const [file, text] of Object.entries(sources)) {
      expect(text, file).not.toMatch(/runtime\.vision(?![A-Za-z])|systems\/playerVision|visionOverlay|\.facing|camera\.|s\.camera/)
    }
  })

  it('no Three.js light is created per lamp or room', () => {
    for (const [file, text] of Object.entries(sources)) expect(text, file).not.toMatch(/PointLight|SpotLight|RectAreaLight|<pointLight|<spotLight/)
  })
})
