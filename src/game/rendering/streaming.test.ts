import { describe, expect, it } from 'vitest'
import { OrthographicCamera, Vector3 } from 'three'
import { bundledWorldFiles, loadWorld, REGISTERED_LOOT_TABLES } from '../../map/content'
import { documentFiles } from '../../map/editor/document'
import { documentFromFiles } from '../../map/editor/pack'
import { generateTown, type Catalog } from '../../map/tools/generator'
import { chunkIndex } from '../../map/transform'
import { GAME_CONFIG } from '../core/config'
import { GameRuntime } from '../core/runtime'
import { createRng } from '../systems/loot'
import { mapChunkSize, mapRooms, mapWindows, type MapData } from '../world/mapData'
import { NavGrid } from '../world/navigation'
import { indexChunkEntities } from './chunkEntities'
import { collectStaticItems, groupByChunk } from './staticBatchData'
import { chunkKey, chunksAround, chunksInRect, itemChunkKey, nextViewChunks, viewGroundRect, WIDE_KEY, type ViewRay } from './viewChunks'

const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
const CAM = GAME_CONFIG.camera
const S = 32
const STREAM = GAME_CONFIG.streaming

function catalog(): Catalog {
  const r = documentFromFiles(bundledWorldFiles('neighborhood-50'), OPTS)
  if (!r.ok) throw new Error(r.error)
  return { id: 'neighborhood-50@1', prefabs: r.doc.world.prefabs.map((entry) => ({ entry, doc: r.doc.prefabs.get(entry.prefabId)! })) }
}

function town(blocks: number, seed = 11): MapData {
  const doc = generateTown({ worldId: `stream-${blocks}`, name: 'Stream', seed, blocksX: blocks, blocksZ: blocks, layout: 'varied' }, catalog(), OPTS)
  const files = new Map(documentFiles(doc))
  return loadWorld((p) => files.get(p)).map
}

/** The game camera (`CameraRig`: R3F sizes the orthographic frustum in pixels, zoom divides it). */
function camera(target: { x: number; z: number }, zoom: number, width: number, height: number): OrthographicCamera {
  const cam = new OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 200)
  cam.zoom = zoom
  cam.position.set(target.x + CAM.offset.x, CAM.offset.y, target.z + CAM.offset.z)
  cam.lookAt(new Vector3(target.x, 0, target.z))
  cam.updateProjectionMatrix()
  cam.updateMatrixWorld()
  return cam
}

function rays(cam: OrthographicCamera, points: readonly (readonly [number, number])[]): ViewRay[] {
  const dir = new Vector3()
  cam.getWorldDirection(dir)
  return points.map(([x, y]) => {
    const o = new Vector3(x, y, -1).unproject(cam)
    return { origin: { x: o.x, y: o.y, z: o.z }, dir: { x: dir.x, y: dir.y, z: dir.z } }
  })
}

const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const
const shownFor = (cam: OrthographicCamera, player: { x: number; z: number }, current: ReadonlySet<string> = new Set()) =>
  nextViewChunks(current, viewGroundRect(rays(cam, CORNERS), STREAM.viewTop), chunksAround(player.x, player.z, S, STREAM.colliderChunkRadius), { chunkSize: S, margin: STREAM.viewMargin, keep: STREAM.viewKeep })

describe('view streaming (M10)', () => {
  it('every item a chunk wide or less that shows on screen belongs to a shown chunk (zoom range, screen sizes)', () => {
    const rng = createRng(7)
    for (const [w, h] of [[1280, 800], [1920, 1080], [390, 844], [2560, 1440]]) {
      for (const zoom of [CAM.zoomMin, CAM.zoomDefault, CAM.zoomMax]) {
        const player = { x: (rng() - 0.5) * 400, z: (rng() - 0.5) * 400 }
        const cam = camera(player, zoom, w, h)
        const shown = new Set(shownFor(cam, player))
        // Screen points at every height up to the tallest drawn thing: the item there has its
        // centre within half a chunk, so its chunk (the chunk of the centre) must be shown.
        const samples: [number, number][] = []
        for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) samples.push([-1 + i / 4, -1 + j / 4])
        for (const ray of rays(cam, samples)) {
          for (const y of [0, STREAM.viewTop / 2, STREAM.viewTop]) {
            const t = (y - ray.origin.y) / ray.dir.y
            const p = { x: ray.origin.x + ray.dir.x * t, z: ray.origin.z + ray.dir.z * t }
            for (const [dx, dz] of [[-S / 2, -S / 2], [S / 2, -S / 2], [-S / 2, S / 2], [S / 2, S / 2], [0, 0]]) {
              expect(shown.has(chunkKey(chunkIndex(p.x + dx, S), chunkIndex(p.z + dz, S))), `${w}x${h} zoom ${zoom}`).toBe(true)
            }
          }
        }
        // …and far fewer than a big world's ~290 chunks (default zoom, full HD: 36).
        if (zoom === CAM.zoomDefault && w <= 1920) expect(shown.size).toBeLessThanOrEqual(40)
      }
    }
  })

  it("always includes the player's physics neighbourhood", () => {
    const player = { x: 100, z: -40 }
    // A camera looking somewhere else entirely (smoothing lag, a script moving the player).
    const shown = new Set(shownFor(camera({ x: -300, z: 300 }, CAM.zoomMax, 800, 600), player))
    for (const k of chunksAround(player.x, player.z, S, STREAM.colliderChunkRadius)) expect(shown.has(k)).toBe(true)
  })

  it('hysteresis: a camera wobbling on a chunk line keeps the same set; moving away unloads', () => {
    const at = (x: number) => camera({ x, z: 0 }, CAM.zoomDefault, 1280, 800)
    let current = new Set(shownFor(at(64), { x: 64, z: 0 }))
    const sets = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const x = 64 + (i % 2 ? 1.5 : -1.5)
      current = new Set(shownFor(at(x), { x, z: 0 }, current))
      sets.add([...current].join('|'))
    }
    expect(sets.size).toBe(1)
    const far = shownFor(at(640), { x: 640, z: 0 }, current)
    expect(far.some((k) => current.has(k))).toBe(false)
  })

  it('chunk keys: rectangles, neighbourhoods, wide items', () => {
    expect(chunksInRect({ minX: 0, minZ: 0, maxX: 31, maxZ: 31 }, S, 0)).toEqual(['0,0'])
    expect(chunksInRect({ minX: 0, minZ: 0, maxX: 31, maxZ: 31 }, S, 1)).toHaveLength(9)
    expect(chunksAround(-1, 40, S, 1)).toContain('-1,1')
    expect(itemChunkKey(10, 10, 40, 0.3, S)).toBe(WIDE_KEY)
    expect(itemChunkKey(-10, 70, 20, 12, S)).toBe('-1,2')
    expect(viewGroundRect([{ origin: { x: 0, y: 10, z: 0 }, dir: { x: 1, y: 0, z: 0 } }], 20)).toBeNull()
  })

  it('every door, container, window, lamp and static item of a big town is in exactly one chunk group', () => {
    const map = town(6)
    const size = mapChunkSize(map)
    const index = indexChunkEntities(map, size)
    const all = [...index.values()]
    expect(all.flatMap((e) => e.doors).map((d) => d.id).sort()).toEqual(map.doors.map((d) => d.id).sort())
    expect(all.flatMap((e) => e.containers)).toHaveLength(map.containers.length)
    expect(all.flatMap((e) => e.windows)).toHaveLength(mapWindows(map).length)
    expect(all.flatMap((e) => e.lamps)).toHaveLength(mapRooms(map).filter((r) => r.lamp).length)
    for (const [key, e] of index) for (const d of e.doors) expect(key).toBe(chunkKey(chunkIndex(d.center.x, size), chunkIndex(d.center.z, size)))
    const rt = new GameRuntime(map)
    const items = collectStaticItems(map, rt.staticColliders)
    const groups = groupByChunk(items, size)
    expect([...groups.values()].reduce((n, l) => n + l.length, 0)).toBe(items.length)
    // The boundary fence (longer than a chunk) is always mounted; nothing else is wide.
    expect(groups.get(WIDE_KEY)!.length).toBeGreaterThanOrEqual(4)
    expect(groups.get(WIDE_KEY)!.every((i) => Math.max(i.size[0], i.size[2]) > size)).toBe(true)
  })
})

describe('nav warm-up on big worlds (M10)', () => {
  const map = town(8)

  it('the runtime warms the tile graph around the start within its budget; the rest warms idle', () => {
    const rt = new GameRuntime(map)
    const tiles = rt.nav.tiles
    const pending = tiles.pendingWarmTiles()
    expect(pending.length).toBeGreaterThan(0)
    // The start's tile and its neighbours went first.
    const spawn = rt.nav.worldToCell(map.playerSpawn.x, map.playerSpawn.z)
    const start = tiles.tileOfCell(spawn.cz * rt.nav.cols + spawn.cx)
    expect(pending).not.toContain(start)
    const distance = (t: number) => Math.max(Math.abs((t % tiles.tilesX) - (start % tiles.tilesX)), Math.abs(Math.floor(t / tiles.tilesX) - Math.floor(start / tiles.tilesX)))
    const d = pending.map(distance)
    expect(d).toEqual([...d].sort((a, b) => a - b))
    let frames = 0
    while (rt.idleWork(4)) frames++
    expect(tiles.warmed).toBe(true)
    expect(frames).toBeGreaterThan(0)
    expect(rt.idleWork()).toBe(false)
  })

  it('routes do not depend on how far the warm-up got', () => {
    const rt = new GameRuntime(map)
    const full = new NavGrid(map, GAME_CONFIG.nav)
    expect(full.tiles.warmed).toBe(true)
    const rng = createRng(3)
    const half = map.size / 2
    let long = 0
    for (let i = 0; i < 25; i++) {
      const pick = () => {
        for (;;) {
          const p = { x: (rng() - 0.5) * 2 * half, y: 0, z: (rng() - 0.5) * 2 * (map.depth ?? map.size) / 2 }
          if (full.isWalkable(p.x, p.z)) return p
        }
      }
      const a = pick()
      const b = pick()
      expect(rt.nav.findPath(a, b)).toEqual(full.findPath(a, b))
      if (Math.hypot(a.x - b.x, a.z - b.z) > 100) long++
    }
    expect(long).toBeGreaterThan(3)
  })

  it('a loaded save warms around the player, not the start', () => {
    const rt = new GameRuntime(map)
    rt.newGame(5)
    const far = { x: map.size / 2 - 20, y: 0.9, z: (map.depth ?? map.size) / 2 - 20 }
    const snap = rt.createSnapshot()
    const rt2 = new GameRuntime(map)
    rt2.loadSnapshot({ ...snap, player: { ...snap.player, position: far } })
    const tiles = rt2.nav.tiles
    const cell = rt2.nav.worldToCell(far.x, far.z)
    const tile = tiles.tileOfCell(cell.cz * rt2.nav.cols + cell.cx)
    const distance = (t: number) => Math.max(Math.abs((t % tiles.tilesX) - (tile % tiles.tilesX)), Math.abs(Math.floor(t / tiles.tilesX) - Math.floor(tile / tiles.tilesX)))
    const pending = tiles.pendingWarmTiles()
    expect(pending.length).toBeGreaterThan(0)
    const d = pending.map(distance)
    expect(d).toEqual([...d].sort((a, b) => a - b))
  })
})
