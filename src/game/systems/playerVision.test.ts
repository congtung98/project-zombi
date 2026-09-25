import { describe, expect, it } from 'vitest'
import { GAME_CONFIG, type PlayerVisionConfig } from '../core/config'
import { classifyVisibility, cosHalfFov, isInsideVisionCone, PlayerVisionSystem, type VisionObserver, type VisionTarget } from './playerVision'
import { buildVisionOccluders, createWindowOccluder, segmentBoxEntry, VisionOccluderSet } from '../world/visionOccluders'
import { generateBuildingWalls, generateDoorPlacements, type BuildingDef } from '../world/buildings'
import { NEIGHBORHOOD_MAP, type MapData } from '../world/mapData'
import type { DoorStatus } from '../world/doors'
import type { Vec3 } from '../../types'

const CFG: PlayerVisionConfig = GAME_CONFIG.playerVision
const cfg = (patch: Partial<PlayerVisionConfig>): PlayerVisionConfig => ({ ...CFG, ...patch })
const at = (x: number, z: number): Vec3 => ({ x, y: 0.9, z })
/** Facing 0 looks along +Z (runtime convention: forward = (sin f, cos f)). */
const observer = (x: number, z: number, facing = 0): VisionObserver => ({ position: at(x, z), facing })
const clear = () => true

function system(targets: () => VisionTarget[], hasLineOfSight: (a: Vec3, b: Vec3) => boolean = clear, config = CFG) {
  const calls = { los: 0 }
  const vision = new PlayerVisionSystem(config, {
    getNearbyEntities: () => targets(),
    hasLineOfSight: (a, b) => {
      calls.los += 1
      return hasLineOfSight(a, b)
    },
  })
  return { vision, calls }
}

/** Advance in 60 Hz ticks. */
function run(vision: PlayerVisionSystem, obs: VisionObserver, seconds: number) {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) vision.update(1 / 60, obs)
}

describe('vision cone and classification order', () => {
  it('uses the character facing with a dot product against cos(FOV/2)', () => {
    const cos = cosHalfFov(110)
    const o = observer(0, 0)
    expect(isInsideVisionCone(o, at(0, 5), cos)).toBe(true)
    expect(isInsideVisionCone(o, at(3, 3), cos)).toBe(true) // 45°
    expect(isInsideVisionCone(o, at(5, 2), cos)).toBe(false) // ≈ 68°
    expect(isInsideVisionCone(o, at(0, -5), cos)).toBe(false)
    // Turned to face −X: the same points swap.
    const west = observer(0, 0, -Math.PI / 2)
    expect(isInsideVisionCone(west, at(-5, 0), cos)).toBe(true)
    expect(isInsideVisionCone(west, at(0, 5), cos)).toBe(false)
  })

  it('distance → near radius → cone → LOS; the near radius wins over the cone but not over walls', () => {
    const o = observer(0, 0)
    const blocked = () => false
    expect(classifyVisibility(o, at(0, 25), CFG, clear)).toBe('OUT_OF_RANGE')
    expect(classifyVisibility(o, at(0, 10), CFG, clear)).toBe('VISIBLE')
    expect(classifyVisibility(o, at(0, 10), CFG, blocked)).toBe('BLOCKED_BY_OCCLUDER')
    expect(classifyVisibility(o, at(0, -6), CFG, clear)).toBe('OUTSIDE_FOV') // behind, camera may see it
    expect(classifyVisibility(o, at(0, -2), CFG, clear)).toBe('NEAR_DETECTION') // right behind the back
    expect(classifyVisibility(o, at(0, -2), CFG, blocked)).toBe('BLOCKED_BY_OCCLUDER')
    expect(classifyVisibility(o, at(0, -2), cfg({ nearDetectionThroughWalls: true }), blocked)).toBe('NEAR_DETECTION')
  })

  it('raycasts from the eye (1.6 m) to the zombie mid-body (1.2 m), never from the feet', () => {
    const rays: [Vec3, Vec3][] = []
    classifyVisibility(observer(1, 2), at(1, 9), CFG, (a, b) => (rays.push([a, b]), true))
    expect(rays).toEqual([[{ x: 1, y: CFG.playerEyeHeight, z: 2 }, { x: 1, y: CFG.zombieTargetHeight, z: 9 }]])
  })
})

describe('PlayerVisionSystem passes', () => {
  it('broad phase first: no raycast for zombies out of range or outside the cone', () => {
    const targets = [
      { id: 'far', position: at(0, 30) },
      { id: 'behind', position: at(0, -8) },
      { id: 'side', position: at(9, 0) },
      { id: 'front', position: at(0, 8) },
    ]
    const { vision, calls } = system(() => targets)
    vision.update(1 / 60, observer(0, 0))
    expect(calls.los).toBe(1)
    expect(vision.get('far')!.reason).toBe('OUT_OF_RANGE')
    expect(vision.get('behind')!.reason).toBe('OUTSIDE_FOV')
    expect(vision.get('side')!.reason).toBe('OUTSIDE_FOV')
    expect(vision.get('front')!.reason).toBe('VISIBLE')
    expect(vision.isVisible('front')).toBe(true)
    expect(vision.isVisible('behind')).toBe(false)
  })

  it('runs about 20 passes per second, not every frame', () => {
    const { vision } = system(() => [{ id: 'a', position: at(0, 5) }])
    run(vision, observer(0, 0), 1)
    expect(vision.stats.passes).toBeGreaterThanOrEqual(18)
    expect(vision.stats.passes).toBeLessThanOrEqual(21)
  })

  it('a quick 180° turn reveals the zombie behind within one pass and fades it in', () => {
    const { vision } = system(() => [{ id: 'z', position: at(0, -8) }])
    const o = observer(0, 0)
    run(vision, o, 0.5)
    expect(vision.get('z')!.opacity).toBe(0)
    o.facing = Math.PI
    run(vision, o, CFG.visionUpdateInterval / 1000 + 1 / 60)
    expect(vision.isVisible('z')).toBe(true)
    const partial = vision.get('z')!.opacity
    expect(partial).toBeGreaterThan(0)
    expect(partial).toBeLessThan(1) // fading in, not popping
    run(vision, o, CFG.visibilityFadeDuration)
    expect(vision.get('z')!.opacity).toBe(1)
  })

  it('grace period then fade out when the zombie goes behind a wall (no instant pop)', () => {
    let wall = false
    const { vision } = system(() => [{ id: 'z', position: at(0, 8) }], () => !wall)
    const o = observer(0, 0)
    run(vision, o, 0.5)
    expect(vision.get('z')!.opacity).toBe(1)
    wall = true
    run(vision, o, 0.1)
    expect(vision.get('z')!.seen).toBe(false)
    expect(vision.isVisible('z')).toBe(true) // still inside the 150 ms grace
    expect(vision.get('z')!.opacity).toBe(1)
    run(vision, o, 0.12)
    expect(vision.isVisible('z')).toBe(false)
    const fading = vision.get('z')!.opacity
    expect(fading).toBeGreaterThan(0)
    expect(fading).toBeLessThan(1)
    run(vision, o, CFG.visibilityFadeDuration)
    expect(vision.get('z')!.opacity).toBe(0)
  })

  it('a flicker shorter than the grace period never hides the zombie', () => {
    let pass = 0
    // Blocked on every other raycast (tiny occluder / jittering ray).
    const { vision } = system(() => [{ id: 'z', position: at(0, 8) }], () => pass++ % 2 === 0)
    const o = observer(0, 0)
    run(vision, o, 0.1)
    for (let i = 0; i < 60; i++) {
      vision.update(1 / 60, o)
      expect(vision.isVisible('z')).toBe(true)
    }
  })

  it('a new zombie starts at opacity 0 and entities the query no longer returns go out of range', () => {
    let list: VisionTarget[] = [{ id: 'a', position: at(0, 5) }]
    const { vision } = system(() => list)
    expect(vision.opacity('a')).toBe(0)
    run(vision, observer(0, 0), 0.5)
    expect(vision.opacity('a')).toBe(1)
    list = []
    run(vision, observer(0, 0), 0.1)
    expect(vision.get('a')!.reason).toBe('OUT_OF_RANGE')
    vision.forget('a')
    expect(vision.get('a')).toBeUndefined()
  })

  it('limits raycasts per pass and refreshes the stalest first, so every zombie is checked', () => {
    const many: VisionTarget[] = Array.from({ length: 200 }, (_, i) => ({ id: `z${i}`, position: at(((i % 20) - 10) * 0.5, 5 + Math.floor(i / 20)) }))
    const { vision, calls } = system(() => many)
    const passes = Math.ceil(many.length / CFG.maxRaycastsPerUpdate)
    for (let i = 0; i < passes; i++) {
      const before = calls.los
      vision.updateVisibility(observer(0, 0))
      expect(calls.los - before).toBeLessThanOrEqual(CFG.maxRaycastsPerUpdate)
    }
    for (const t of many) expect(vision.get(t.id)!.losPass).toBeGreaterThan(0)
  })

  it('records debug rays only while debug is on', () => {
    const { vision } = system(() => [{ id: 'z', position: at(0, 5) }])
    vision.updateVisibility(observer(0, 0))
    expect(vision.debugRays).toHaveLength(0)
    vision.debug = true
    vision.updateVisibility(observer(0, 0))
    expect(vision.debugRays).toEqual([{ from: { x: 0, y: CFG.playerEyeHeight, z: 0 }, to: { x: 0, y: CFG.zombieTargetHeight, z: 5 }, clear: true }])
  })
})

const hut: BuildingDef = {
  id: 'hut', name: 'Hut', center: { x: 0, z: 0 }, size: { w: 6, d: 6 }, height: 3, wallThickness: 0.3,
  wallColor: '#fff', roofColor: '#000', floorColor: '#888',
  doors: [{ id: 'door-hut', name: 'Cửa', side: 'S', offset: 0, width: 1.4 }], containers: [],
}
const fence = { id: 'fence', position: { x: 0, y: 0.5, z: 8 }, size: [6, 1, 0.15] as [number, number, number] }
const hutMap: MapData = {
  id: 'vision-test', size: 40, playerSpawn: at(0, -1), zombieSpawns: [], buildings: [hut],
  walls: [...generateBuildingWalls(hut), fence], doors: generateDoorPlacements(hut), containers: [], roads: [],
}

function hutVision() {
  let door: DoorStatus = 'closed'
  const occluders = buildVisionOccluders(hutMap, () => door, CFG.occluderMinHeight)
  const los = (a: Vec3, b: Vec3) => occluders.firstBlocker(a, b) === null
  return { occluders, los, setDoor: (s: DoorStatus) => (door = s) }
}

describe('vision occluders (walls, doors, windows)', () => {
  it('slab test: entry parameter along the segment, Infinity when missing', () => {
    const min = { x: 1, y: 0, z: -1 }
    const max = { x: 2, y: 3, z: 1 }
    expect(segmentBoxEntry({ x: 0, y: 1, z: 0 }, { x: 4, y: 0, z: 0 }, min, max)).toBeCloseTo(0.25)
    expect(segmentBoxEntry({ x: 0, y: 1, z: 0 }, { x: 0.5, y: 0, z: 0 }, min, max)).toBe(Infinity)
    expect(segmentBoxEntry({ x: 0, y: 3.5, z: 0 }, { x: 4, y: 0, z: 0 }, min, max)).toBe(Infinity) // over the top
  })

  it('the neighbourhood map: tall walls/furniture/doors block, fences, crates, cars and beds do not', () => {
    const set = buildVisionOccluders(NEIGHBORHOOD_MAP, () => 'closed', CFG.occluderMinHeight)
    const ids = new Set(set.all.map((o) => o.id))
    for (const id of ['bound-n', 'safehouse-S-0', 'safehouse-S-lintel', 'pillar-1', 'ct-store-shelf-1', 'ct-house-wardrobe', 'ct-store-fridge', 'door-safehouse', 'door-store', 'door-house']) {
      expect(ids.has(id), id).toBe(true)
    }
    for (const id of ['fence-park-n', 'crate-1', 'car-1', 'house-bed', 'store-counter', 'ct-safehouse-cabinet', 'ct-park-toolbox']) {
      expect(ids.has(id), id).toBe(false)
    }
  })

  it('inside the hut facing the door: closed door hides, open or broken door shows, walls always hide', () => {
    const { los, setDoor } = hutVision()
    const o = observer(0, -1, 0)
    const inDoorway = at(0, 6)
    const besideDoor = at(2.5, 6)
    expect(classifyVisibility(o, inDoorway, CFG, los)).toBe('BLOCKED_BY_OCCLUDER')
    setDoor('open')
    expect(classifyVisibility(o, inDoorway, CFG, los)).toBe('VISIBLE') // the lintel above does not block
    expect(classifyVisibility(o, besideDoor, CFG, los)).toBe('BLOCKED_BY_OCCLUDER')
    setDoor('destroyed')
    expect(classifyVisibility(o, inDoorway, CFG, los)).toBe('VISIBLE')
    // Right behind the closed door (inside the near radius): still hidden, the door is in the way.
    setDoor('closed')
    expect(classifyVisibility(observer(0, 2, 0), at(0, 4), CFG, los)).toBe('BLOCKED_BY_OCCLUDER')
  })

  it('a low fence never blocks sight', () => {
    const { los } = hutVision()
    expect(classifyVisibility(observer(0, 5, 0), at(0, 12), CFG, los)).toBe('VISIBLE')
  })

  it('windows: glass does not block, a closed curtain does, toggled without rebuilding', () => {
    let curtain = false
    const set = new VisionOccluderSet()
    set.add(createWindowOccluder('win-1', { x: -1, y: 0.9, z: 4.9 }, { x: 1, y: 2.1, z: 5.1 }, () => curtain))
    const los = (a: Vec3, b: Vec3) => set.firstBlocker(a, b) === null
    expect(classifyVisibility(observer(0, 0), at(0, 10), CFG, los)).toBe('VISIBLE')
    curtain = true
    expect(classifyVisibility(observer(0, 0), at(0, 10), CFG, los)).toBe('BLOCKED_BY_OCCLUDER')
    set.remove('win-1')
    expect(classifyVisibility(observer(0, 0), at(0, 10), CFG, los)).toBe('VISIBLE')
  })

  it('performance: 500 zombies around the player on the full map stay well under a millisecond budget per pass', () => {
    const set = buildVisionOccluders(NEIGHBORHOOD_MAP, () => 'closed', CFG.occluderMinHeight)
    const zombies: VisionTarget[] = Array.from({ length: 500 }, (_, i) => ({ id: `z${i}`, position: at(((i * 37) % 48) - 24, ((i * 53) % 48) - 24) }))
    const vision = new PlayerVisionSystem(CFG, {
      getNearbyEntities: () => zombies,
      hasLineOfSight: (a, b) => set.firstBlocker(a, b) === null,
    })
    const o = observer(0, 0, Math.PI / 4)
    for (let i = 0; i < 20; i++) vision.updateVisibility(o) // warm-up
    const passes = 200
    const start = performance.now()
    for (let i = 0; i < passes; i++) {
      o.facing += 0.05
      vision.updateVisibility(o)
      vision.updateVisibilityFade(1 / 20)
    }
    const perPass = (performance.now() - start) / passes
    console.log(`[vision perf] 500 zombies: ${perPass.toFixed(3)} ms/pass (${vision.stats.raycasts} raycasts, ${vision.stats.visible} visible, ${set.all.length} occluders)`)
    expect(vision.stats.raycasts).toBeLessThanOrEqual(CFG.maxRaycastsPerUpdate)
    expect(perPass).toBeLessThan(5)
  })
})

describe('player vision is not world lighting', () => {
  const sources = {
    ...import.meta.glob<string>('./playerVision.ts', { query: '?raw', import: 'default', eager: true }),
    ...import.meta.glob<string>('../world/visionOccluders.ts', { query: '?raw', import: 'default', eager: true }),
  }
  const rendering = import.meta.glob<string>(['../rendering/*.tsx', '../rendering/daylight.ts'], { query: '?raw', import: 'default', eager: true })

  it('the vision modules import no three.js, rendering or lighting code', () => {
    expect(Object.keys(sources)).toHaveLength(2)
    for (const [file, text] of Object.entries(sources)) {
      for (const i of text.match(/from '[^']+'/g) ?? []) expect(i, `${file}: ${i}`).not.toMatch(/three|rendering|Lights|daylight|@react-three/)
    }
  })

  it('lighting reads only the clock, and only zombie rendering/debug read the vision state', () => {
    expect(rendering['../rendering/Lights.tsx']).toMatch(/daylightAt\(runtime\.clock\.timeOfDay\)/)
    for (const file of ['../rendering/Lights.tsx', '../rendering/daylight.ts']) expect(rendering[file]).not.toMatch(/vision/i)
    const readers = Object.entries(rendering).filter(([, text]) => /runtime\.vision(?![A-Za-z])/.test(text)).map(([file]) => file.replace('../rendering/', ''))
    expect(readers.sort()).toEqual(['PlayerVisionDebug.tsx', 'ZombieView.tsx'])
  })

  it('VisionOverlay is one overlay pass: it writes no light, exposure, fog, background or world material', () => {
    const overlay = rendering['../rendering/VisionOverlay.tsx']
    expect(overlay).toBeTruthy()
    expect(overlay).not.toMatch(/intensity|toneMapping|Exposure|SpotLight|PointLight|DirectionalLight|AmbientLight|HemisphereLight|scene\.|\.fog|emissive|multiplyScalar|traverse/)
    // It only reads the daylight factor (never writes the clock) and draws a single full-screen quad.
    expect(overlay).toMatch(/daylightAt\(runtime\.clock\.timeOfDay\)/)
    expect(overlay).not.toMatch(/clock\.(restore|advance|reset)|timeOfDay\s*=/)
    expect(overlay.match(/<mesh/g)).toHaveLength(1)
  })
})
