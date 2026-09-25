import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, loadWorld, REGISTERED_LOOT_TABLES } from '../content'
import { deepCheck } from '../analysis'
import { GameRuntime } from '../../game/core/runtime'
import { generateTown, type Catalog } from '../tools/generator'
import { moveRecords } from './commands'
import { documentFiles, resolvedRecords, type MapDocument } from './document'
import { documentFromFiles, exportPack, parsePack, validateDocument } from './pack'

/**
 * Map editor performance scenarios (M6 report), Node only (no WebGL): run with
 *   PERF_SCENARIOS=1 npx vitest run src/map/editor/editor.perf.test.ts
 * Prints one `EDITOR PERF <world> {json}` line per world: median of 5 runs for validate, cold
 * resolve, a move command, export/import, deep check, runtime load and GameRuntime construction.
 */

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
const RUN = !!ENV.PERF_SCENARIOS
const OPTS = { lootTables: REGISTERED_LOOT_TABLES }

function median(fn: () => void, runs = 5): number {
  const t: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    fn()
    t.push(performance.now() - t0)
  }
  return Math.round(t.sort((a, b) => a - b)[Math.floor(runs / 2)] * 100) / 100
}

function worlds(): [string, MapDocument][] {
  const r = documentFromFiles(bundledWorldFiles('neighborhood-50'), OPTS)
  if (!r.ok) throw new Error(r.error)
  const catalog: Catalog = { id: 'neighborhood-50@1', prefabs: r.doc.world.prefabs.map((entry) => ({ entry, doc: r.doc.prefabs.get(entry.prefabId)! })) }
  return [
    ['neighborhood-50', r.doc],
    ['gen 2x2', generateTown({ worldId: 'g2', name: 'g2', seed: 42, blocksX: 2, blocksZ: 2 }, catalog, OPTS)],
    ['gen 4x4', generateTown({ worldId: 'g4', name: 'g4', seed: 3, blocksX: 4, blocksZ: 4 }, catalog, OPTS)],
  ]
}

describe.skipIf(!RUN)('map editor performance (M6)', () => {
  it('measures editor and loader operations', () => {
    for (const [name, doc] of worlds()) {
      const records = resolvedRecords(doc)
      const boxes = records.reduce((n, r) => n + (r.parts.walls?.length ?? 0) + (r.parts.containers?.length ?? 0), 0)
      const first = records.find((r) => r.category === 'instances')!.id
      const text = exportPack(doc)
      const files = new Map(documentFiles(doc))
      const result = {
        chunks: doc.world.chunks.length,
        records: records.length,
        boxes,
        packKB: Math.round(text.length / 1024),
        validateMs: median(() => validateDocument(doc, OPTS)),
        resolveColdMs: median(() => resolvedRecords({ ...doc, world: { ...doc.world } })),
        moveMs: median(() => moveRecords(doc, [first], { x: 0.5, z: 0 })),
        exportMs: median(() => exportPack(doc)),
        importMs: median(() => parsePack(text, OPTS)),
        deepCheckMs: median(() => deepCheck(doc), 3),
        loadWorldMs: median(() => loadWorld((p) => files.get(p))),
        runtimeMs: median(() => new GameRuntime(loadWorld((p) => files.get(p)).map), 3),
      }
      console.log(`EDITOR PERF ${name} ${JSON.stringify(result)}`)
      expect(result.records).toBeGreaterThan(0)
    }
  })
})
