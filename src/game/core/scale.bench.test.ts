import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, loadWorld, REGISTERED_LOOT_TABLES } from '../../map/content'
import { documentFiles } from '../../map/editor/document'
import { documentFromFiles } from '../../map/editor/pack'
import { generateTown } from '../../map/tools/generator'
import { GAME_CONFIG } from './config'
import { GameRuntime } from './runtime'
import { NavGrid } from '../world/navigation'

/**
 * M10 scale benchmark (simulation side, no WebGL): generated varied towns of 4×4, 8×8 and 16×16
 * blocks (~130 m to ~530 m). Run with
 *   SCALE_BENCH=1 npx vitest run src/game/core/scale.bench.test.ts --silent=false
 * One `SCALE <blocks> {json}` line each: content resolve, runtime build (nav warm-up within
 * `pathfinding.initialWarmMs`), the full tile-graph warm-up it no longer pays up front, the idle
 * frames that finish it, 600 ticks. Browser numbers: `scripts/m10-streaming-browser.mjs`, docs/map-editor-m10.md.
 */
const RUN = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.SCALE_BENCH
const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
const r2 = (n: number) => Math.round(n * 100) / 100

describe.skipIf(!RUN)('M10 scale benchmark', () => {
  const lib = documentFromFiles(bundledWorldFiles('neighborhood-50'), OPTS)
  if (!lib.ok) throw new Error(lib.error)
  const catalog = { id: 'neighborhood-50@1', prefabs: lib.doc.world.prefabs.map((entry) => ({ entry, doc: lib.doc.prefabs.get(entry.prefabId)! })) }

  for (const blocks of [4, 8, 16]) {
    it(`${blocks}x${blocks}`, () => {
      const doc = generateTown({ worldId: `scale-${blocks}`, name: 'Scale', seed: 11, blocksX: blocks, blocksZ: blocks, layout: 'varied' }, catalog, OPTS)
      const files = new Map(documentFiles(doc))
      let t = performance.now()
      const { map } = loadWorld((p) => files.get(p))
      const loadMs = performance.now() - t
      t = performance.now()
      const fullNav = new NavGrid(map, GAME_CONFIG.nav)
      const fullNavMs = performance.now() - t
      t = performance.now()
      const rt = new GameRuntime(map)
      const runtimeMs = performance.now() - t
      const pending = rt.nav.tiles.pendingWarm
      let idleFrames = 0
      while (rt.idleWork()) idleFrames++
      rt.newGame(3)
      const ticks: number[] = []
      for (let i = 0; i < 600; i++) {
        const s = performance.now()
        rt.tick(1 / 60)
        ticks.push(performance.now() - s)
      }
      ticks.sort((a, b) => a - b)
      expect(fullNav.tiles.warmed).toBe(true)
      console.log(`SCALE ${blocks}x${blocks} ` + JSON.stringify({
        area: `${map.size}x${map.depth ?? map.size}`,
        chunks: doc.world.chunks.length,
        walls: map.walls.length,
        doors: map.doors.length,
        zombies: rt.zombies.size,
        loadMs: r2(loadMs),
        navFullWarmMs: r2(fullNavMs),
        runtimeMs: r2(runtimeMs),
        tilesPendingAfterBuild: pending,
        idleFramesToWarm: idleFrames,
        tickAvgMs: r2(ticks.reduce((a, b) => a + b, 0) / ticks.length),
        tickP99Ms: r2(ticks[Math.floor(ticks.length * 0.99)]),
      }))
    }, 600_000)
  }
})
