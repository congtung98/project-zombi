import { recordId, RECORD_CATEGORIES, type RecordCategory } from './schema.ts'
import { assembleMapData, compareRecords, resolveRecord, type ResolvedRecord } from './resolve.ts'
import type { WorldDocuments } from './validate.ts'
import type { MapData } from '../game/world/mapData.ts'

/**
 * Chunk lifecycle over validated documents. A record is active while at least one loaded chunk
 * owns or references it (ownership refs for anything crossing a chunk line), so a building on a
 * chunk line exists once and only disappears when the last chunk touching it unloads.
 *
 * Records are immutable descriptors: mutable state (doors, loot, lamps) lives in the runtime's
 * WorldState/save keyed by stable ID, never here, so unload → load cannot reset it.
 * M2 loads every chunk once; streaming (R3b and later) drives `load`/`unload` by distance.
 */

export interface ChunkLifecycleListener {
  added(record: ResolvedRecord): void
  removed(record: ResolvedRecord): void
}

interface Active {
  count: number
  record: ResolvedRecord
}

export class ChunkLifecycle {
  private readonly loaded = new Set<string>()
  private readonly active = new Map<string, Active>()
  /** Record ID → where it is stored, per owner chunk (built on first use). */
  private readonly index = new Map<string, Map<string, { category: RecordCategory; index: number }>>()

  readonly docs: WorldDocuments
  private readonly listener?: ChunkLifecycleListener

  constructor(docs: WorldDocuments, listener?: ChunkLifecycleListener) {
    this.docs = docs
    this.listener = listener
  }

  isLoaded(chunkId: string): boolean {
    return this.loaded.has(chunkId)
  }

  loadedChunks(): string[] {
    return [...this.loaded]
  }

  /** How many loaded chunks hold this record (0 = not active). */
  refCount(id: string): number {
    return this.active.get(id)?.count ?? 0
  }

  /** Load a chunk; loading it again is a no-op (returns false). */
  load(chunkId: string): boolean {
    if (this.loaded.has(chunkId)) return false
    const chunk = this.chunk(chunkId)
    this.loaded.add(chunkId)
    for (const category of RECORD_CATEGORIES) {
      chunk[category].forEach((r, i) => this.acquire(recordId(category, r), chunkId, category, i))
    }
    for (const ref of chunk.externalRefs) {
      const at = this.locate(ref.ownerChunkId, ref.id)
      this.acquire(ref.id, ref.ownerChunkId, at.category, at.index)
    }
    return true
  }

  /** Unload a chunk; records still referenced by another loaded chunk stay. */
  unload(chunkId: string): boolean {
    if (!this.loaded.delete(chunkId)) return false
    const chunk = this.chunk(chunkId)
    for (const category of RECORD_CATEGORIES) for (const r of chunk[category]) this.release(recordId(category, r))
    for (const ref of chunk.externalRefs) this.release(ref.id)
    return true
  }

  loadAll(): void {
    for (const e of this.docs.world.chunks) this.load(e.chunkId)
  }

  /** Active records in content order (independent of load order). */
  records(): ResolvedRecord[] {
    return [...this.active.values()].map((a) => a.record).sort(compareRecords)
  }

  toMapData(): MapData {
    return assembleMapData(this.docs.world, this.records())
  }

  private chunk(chunkId: string) {
    const chunk = this.docs.chunks.get(chunkId)
    if (!chunk) throw new Error(`Chunk ${chunkId} is not in world ${this.docs.world.worldId}`)
    return chunk
  }

  private locate(ownerChunkId: string, id: string): { category: RecordCategory; index: number } {
    let map = this.index.get(ownerChunkId)
    if (!map) {
      map = new Map()
      const chunk = this.chunk(ownerChunkId)
      for (const category of RECORD_CATEGORIES) chunk[category].forEach((r, index) => map!.set(recordId(category, r), { category, index }))
      this.index.set(ownerChunkId, map)
    }
    const at = map.get(id)
    if (!at) throw new Error(`Reference ${id} not found in owner chunk ${ownerChunkId}`)
    return at
  }

  private acquire(id: string, ownerChunkId: string, category: RecordCategory, index: number): void {
    const existing = this.active.get(id)
    if (existing) {
      existing.count++
      return
    }
    const prefabs = (prefabId: string) => this.docs.prefabs.get(prefabId)!
    const record = resolveRecord(this.docs.world, this.chunk(ownerChunkId), category, index, prefabs)
    this.active.set(id, { count: 1, record })
    this.listener?.added(record)
  }

  private release(id: string): void {
    const a = this.active.get(id)
    if (!a) return
    if (--a.count > 0) return
    this.active.delete(id)
    this.listener?.removed(a.record)
  }
}
