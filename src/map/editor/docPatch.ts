import type { ChunkDocument, PrefabDocument, WorldDocument } from '../schema.ts'
import type { MapDocument } from './document.ts'

/**
 * Document patches (world generator WG5): what changed between two documents that share their
 * unchanged parts (the result of a command), by object identity. A Web Worker works on a copy of the
 * document, so it sends back only the changed chunks, prefabs, extras and world; `applyPatch` puts
 * them onto the editor's own document, whose unchanged chunks keep their identity (cheap history,
 * the viewport re-resolves only what changed).
 */
export interface DocPatch {
  /** New world document, or absent when unchanged. */
  world?: WorldDocument
  prefabs: [string, PrefabDocument][]
  removedPrefabs: string[]
  chunks: [string, ChunkDocument][]
  removedChunks: string[]
  extras: [string, unknown][]
  removedExtras: string[]
}

function diffMap<V>(a: ReadonlyMap<string, V>, b: ReadonlyMap<string, V>): { changed: [string, V][]; removed: string[] } {
  const changed: [string, V][] = []
  for (const [k, v] of b) if (a.get(k) !== v) changed.push([k, v])
  const removed = [...a.keys()].filter((k) => !b.has(k))
  return { changed, removed }
}

export function diffDocument(base: MapDocument, next: MapDocument): DocPatch {
  const prefabs = diffMap(base.prefabs, next.prefabs)
  const chunks = diffMap(base.chunks, next.chunks)
  const extras = diffMap(base.extras, next.extras)
  const patch: DocPatch = { prefabs: prefabs.changed, removedPrefabs: prefabs.removed, chunks: chunks.changed, removedChunks: chunks.removed, extras: extras.changed, removedExtras: extras.removed }
  if (next.world !== base.world) patch.world = next.world
  return patch
}

function applyMap<V>(a: ReadonlyMap<string, V>, changed: readonly [string, V][], removed: readonly string[]): ReadonlyMap<string, V> {
  if (!changed.length && !removed.length) return a
  const m = new Map(a)
  for (const [k, v] of changed) m.set(k, v)
  for (const k of removed) m.delete(k)
  return m
}

export function applyPatch(base: MapDocument, patch: DocPatch): MapDocument {
  return {
    world: patch.world ?? base.world,
    prefabs: applyMap(base.prefabs, patch.prefabs, patch.removedPrefabs),
    chunks: applyMap(base.chunks, patch.chunks, patch.removedChunks),
    extras: applyMap(base.extras, patch.extras, patch.removedExtras),
  }
}

export function isEmptyPatch(p: DocPatch): boolean {
  return !p.world && !p.prefabs.length && !p.removedPrefabs.length && !p.chunks.length && !p.removedChunks.length && !p.extras.length && !p.removedExtras.length
}
