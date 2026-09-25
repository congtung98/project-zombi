import { describe, expect, it } from 'vitest'
import { GAME_CONFIG, type VisionOverlayConfig } from '../core/config'
import { computeSectorDistances, overlayAlphaAt, overlayStrength, sectorDistanceAt, type OverlayView } from './visionOverlay'
import { buildVisionOccluders } from '../world/visionOccluders'
import { generateBuildingWalls, generateDoorPlacements, type BuildingDef } from '../world/buildings'
import type { MapData } from '../world/mapData'
import type { DoorStatus } from '../world/doors'

const VISION = GAME_CONFIG.playerVision
const CFG: VisionOverlayConfig = GAME_CONFIG.visionOverlay
const noLos: VisionOverlayConfig = { ...CFG, losAware: false }
const DAY = overlayStrength(1, CFG)
const NIGHT = overlayStrength(0, CFG)
/** Player at the origin facing +Z (runtime yaw convention). */
const view = (facing = 0, strength = DAY): OverlayView => ({ x: 0, z: 0, facing, strength })
const at = (deg: number, dist: number) => ({ x: Math.sin((deg * Math.PI) / 180) * dist, z: Math.cos((deg * Math.PI) / 180) * dist })

describe('VisionOverlay intensity (perception, not lighting)', () => {
  it('never exceeds maxOpacity anywhere, day or night, so the world stays ≥ 85 % bright', () => {
    let max = 0
    for (const strength of [DAY, NIGHT]) {
      for (let deg = 0; deg < 360; deg += 5) {
        for (const d of [0, 1, 2.5, 4, 8, 15, 20, 25, 40]) max = Math.max(max, overlayAlphaAt(at(deg, d), view(0, strength), VISION, noLos))
      }
    }
    expect(max).toBeLessThanOrEqual(CFG.maxOpacity)
    expect(1 - max).toBeGreaterThanOrEqual(0.85)
  })

  it('inside the vision: untouched; inside the near radius: untouched in every direction (not a light)', () => {
    for (const d of [4, 10, 16]) expect(overlayAlphaAt(at(0, d), view(), VISION, noLos)).toBeCloseTo(CFG.insideOpacity, 5)
    for (let deg = 0; deg < 360; deg += 15) expect(overlayAlphaAt(at(deg, 1.8), view(), VISION, noLos)).toBe(0)
  })

  it('behind the player: a light shade growing gently with distance (not fog)', () => {
    const rear = (d: number) => overlayAlphaAt(at(180, d), view(), VISION, noLos)
    expect(rear(5)).toBeGreaterThan(0.02)
    expect(rear(5)).toBeLessThan(0.04)
    expect(rear(15)).toBeGreaterThan(rear(5))
    expect(rear(15)).toBeLessThan(0.07)
    expect(rear(25)).toBeCloseTo(CFG.outsideOpacity, 3)
    expect(rear(60)).toBeCloseTo(CFG.outsideOpacity, 3) // no darkening towards black far away
  })

  it('soft cone edge: no jump between neighbouring angles', () => {
    let maxStep = 0
    let prev = overlayAlphaAt(at(0, 12), view(), VISION, noLos)
    for (let deg = 0.5; deg <= 180; deg += 0.5) {
      const a = overlayAlphaAt(at(deg, 12), view(), VISION, noLos)
      maxStep = Math.max(maxStep, Math.abs(a - prev))
      prev = a
    }
    expect(maxStep).toBeLessThan(0.002)
  })

  it('follows the character facing: turning 180° swaps front and back', () => {
    const front = at(0, 12)
    const back = at(180, 12)
    expect(overlayAlphaAt(front, view(0), VISION, noLos)).toBe(0)
    expect(overlayAlphaAt(back, view(0), VISION, noLos)).toBeGreaterThan(0.04)
    expect(overlayAlphaAt(front, view(Math.PI), VISION, noLos)).toBeCloseTo(overlayAlphaAt(back, view(0), VISION, noLos), 6)
    expect(overlayAlphaAt(back, view(Math.PI), VISION, noLos)).toBeCloseTo(0, 6)
  })

  it('half strength at night: the dark is the clock, the overlay only adds a little', () => {
    expect(DAY).toBe(CFG.daytimeStrength)
    expect(NIGHT).toBe(CFG.nighttimeStrength)
    expect(overlayStrength(0.5, CFG)).toBeCloseTo((DAY + NIGHT) / 2)
    const day = overlayAlphaAt(at(180, 25), view(0, DAY), VISION, noLos)
    const night = overlayAlphaAt(at(180, 25), view(0, NIGHT), VISION, noLos)
    expect(night).toBeCloseTo(day * CFG.nighttimeStrength, 6)
    // A night scene at 30 % brightness stays above 28 % behind the player.
    expect(0.3 * (1 - night)).toBeGreaterThan(0.28)
  })
})

const hut: BuildingDef = {
  id: 'hut', name: 'Hut', center: { x: 0, z: 0 }, size: { w: 6, d: 6 }, height: 3, wallThickness: 0.3,
  wallColor: '#fff', roofColor: '#000', floorColor: '#888',
  doors: [{ id: 'door-hut', name: 'Cửa', side: 'S', offset: 0, width: 1.4 }], containers: [],
}
const hutMap: MapData = {
  id: 'overlay-test', size: 40, playerSpawn: { x: 0, y: 0, z: -1 }, zombieSpawns: [], buildings: [hut],
  walls: generateBuildingWalls(hut), doors: generateDoorPlacements(hut), containers: [], roads: [],
}

describe('VisionOverlay LOS sector mask', () => {
  it('slices wrap around and interpolate', () => {
    const s = new Float32Array([10, 20, 30, 40])
    expect(sectorDistanceAt(s, (0.5 / 4) * Math.PI * 2)).toBeCloseTo(10)
    expect(sectorDistanceAt(s, (1 / 4) * Math.PI * 2)).toBeCloseTo(15)
    expect(sectorDistanceAt(s, 0)).toBeCloseTo(25) // between the last and first slice
    expect(sectorDistanceAt(s, -Math.PI / 2)).toBeCloseTo(sectorDistanceAt(s, 1.5 * Math.PI))
  })

  it('inside the hut: the cone past a closed door gets the blocked shade, an open door clears it', () => {
    let door: DoorStatus = 'closed'
    const occluders = buildVisionOccluders(hutMap, () => door, VISION.occluderMinHeight)
    const player = { x: 0, y: 0.9, z: -1 }
    const sectors = computeSectorDistances(player, occluders, VISION, new Float32Array(CFG.losRays))
    const v: OverlayView = { x: 0, z: -1, facing: 0, strength: DAY }
    const outside = { x: 0, z: 12 }
    const closed = overlayAlphaAt(outside, v, VISION, CFG, sectors)
    expect(closed).toBeGreaterThan(0.06)
    expect(closed).toBeLessThanOrEqual(CFG.blockedOpacity)
    door = 'open'
    computeSectorDistances(player, occluders, VISION, sectors)
    expect(overlayAlphaAt(outside, v, VISION, CFG, sectors)).toBeLessThan(0.005)
    // The room itself (clear, inside the cone) stays untouched.
    expect(overlayAlphaAt({ x: 0, z: 2 }, v, VISION, CFG, sectors)).toBe(0)
  })
})
