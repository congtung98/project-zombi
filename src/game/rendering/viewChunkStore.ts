import { useSyncExternalStore } from 'react'

/**
 * M10: the chunks the scene shows (sorted keys), set by `ChunkStreamer` from the camera and read by
 * `StaticBatches` and the streamed entity views. Published only when the set changes.
 */
let shown: readonly string[] = []
/** Streaming off: every chunk is mounted (`useViewChunks` returns null). */
let all = false
const listeners = new Set<() => void>()

function notify(): void {
  for (const l of listeners) l()
}

export function publishViewChunks(next: readonly string[]): void {
  if (next.length === shown.length && next.every((k, i) => k === shown[i])) return
  shown = next
  notify()
}

export function setStreamAll(value: boolean): void {
  if (all === value) return
  all = value
  notify()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Shown chunk keys, or null when streaming is off and everything is mounted. */
export function useViewChunks(): readonly string[] | null {
  const keys = useSyncExternalStore(subscribe, () => shown)
  const everything = useSyncExternalStore(subscribe, () => all)
  return everything ? null : keys
}

/** Current shown keys (perf HUD, scripts through `window.__viewChunks` in dev). */
export function viewChunkKeys(): readonly string[] {
  return shown
}

/** Whether every chunk is mounted. */
export function streamAll(): boolean {
  return all
}
