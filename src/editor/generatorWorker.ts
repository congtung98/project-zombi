/// <reference lib="webworker" />
import { diffDocument } from '../map/editor/docPatch'
import { layoutWorldFromGeoJson } from '../map/editor/generator'
import { syncGenerated } from '../map/layout/worldSync'
import type { GeneratorJob, GeneratorJobResult } from './generatorJobs'

/**
 * World generator WG5: generator actions off the editor's main thread (§15). The worker gets a copy
 * of the document and the prefab library, runs the same pure functions as the editor would, and sends
 * back a patch (only what changed) or the new world. The editor cancels a job by terminating the worker.
 */
declare const self: DedicatedWorkerGlobalScope

self.onmessage = (e: MessageEvent<GeneratorJob>) => {
  const job = e.data
  const validation = { lootTables: new Set(job.lootTables) }
  const t0 = performance.now()
  let result: GeneratorJobResult
  try {
    if (job.kind === 'sync') {
      const r = syncGenerated(job.doc, job.request, { catalog: job.catalog, validation })
      result = r.ok ? { id: job.id, ok: true, kind: 'sync', patch: diffDocument(job.doc, r.doc), report: r.report, summary: r.summary, ms: performance.now() - t0 } : { id: job.id, ok: false, error: r.error }
    } else {
      const r = layoutWorldFromGeoJson(job.request, job.catalog, validation)
      result = r.ok ? { id: job.id, ok: true, kind: 'import', doc: r.doc, issues: r.issues, ms: performance.now() - t0 } : { id: job.id, ok: false, error: r.error, issues: r.issues }
    }
  } catch (err) {
    result = { id: job.id, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  self.postMessage(result)
}
