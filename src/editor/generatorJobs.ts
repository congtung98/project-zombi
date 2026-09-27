import type { DocPatch } from '../map/editor/docPatch'
import type { MapDocument } from '../map/editor/document'
import type { LayoutWorldRequest } from '../map/editor/generator'
import type { PrefabCatalog } from '../map/layout/buildings'
import type { LayoutIssue } from '../map/layout/schema'
import type { SyncReport, SyncRequest } from '../map/layout/worldSync'

/**
 * World generator WG5: jobs for the generator worker (`generatorWorker.ts`) and the runner the editor
 * store uses. One job at a time; `cancel` terminates the worker (a new one starts for the next job),
 * so a long regeneration never freezes the editor and can always be stopped.
 */

export type GeneratorJob =
  | { id: number; kind: 'sync'; doc: MapDocument; request: SyncRequest; catalog: PrefabCatalog | null; lootTables: string[] }
  | { id: number; kind: 'import'; request: LayoutWorldRequest; catalog: PrefabCatalog | null; lootTables: string[] }

export type GeneratorJobResult =
  | { id: number; ok: true; kind: 'sync'; patch: DocPatch; report: SyncReport; summary: string; ms: number }
  | { id: number; ok: true; kind: 'import'; doc: MapDocument; issues: LayoutIssue[]; ms: number }
  | { id: number; ok: false; error: string; issues?: LayoutIssue[] }

type Job = GeneratorJob extends infer J ? (J extends { id: number } ? Omit<J, 'id'> : never) : never

let worker: Worker | null = null
let nextId = 1
let pending: { id: number; resolve: (r: GeneratorJobResult | null) => void } | null = null

/** Web Workers exist (the browser); tests and old environments run the generator in place. */
export function workersAvailable(): boolean {
  return typeof Worker !== 'undefined'
}

/** Run a job in the worker. Resolves null when cancelled. */
export function runJob(job: Job): Promise<GeneratorJobResult | null> {
  cancelJob()
  worker ??= new Worker(new URL('./generatorWorker.ts', import.meta.url), { type: 'module' })
  const id = nextId++
  return new Promise((resolve) => {
    pending = { id, resolve }
    worker!.onmessage = (e: MessageEvent<GeneratorJobResult>) => {
      if (!pending || e.data.id !== pending.id) return
      pending = null
      resolve(e.data)
    }
    worker!.onerror = (e) => {
      if (!pending || pending.id !== id) return
      pending = null
      worker?.terminate()
      worker = null
      resolve({ id, ok: false, error: `worker lỗi: ${e.message || 'không rõ'}` })
    }
    worker!.postMessage({ ...job, id })
  })
}

/** Stop the running job (the worker is terminated and its partial work dropped). */
export function cancelJob(): boolean {
  if (!pending) return false
  const p = pending
  pending = null
  worker?.terminate()
  worker = null
  p.resolve(null)
  return true
}
