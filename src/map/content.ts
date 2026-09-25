import { LOOT_TABLES } from '../game/world/lootTables'
import type { MapData } from '../game/world/mapData'
import { ChunkLifecycle } from './loader'
import { loadWorldDocuments, type ValidationIssue, type WorldDocuments } from './validate'

/**
 * Content bundled with the game: every JSON under `content/maps/` is part of the build (Vite
 * inlines it; vitest reads it the same way). Streaming will swap this for fetched chunk files
 * behind the same `read(path)` contract.
 */
const FILES = import.meta.glob<unknown>('/content/maps/**/*.json', { eager: true, import: 'default' })

/** Reader for one world folder (`world.json`, `chunks/…`, `prefabs/…`, `migrations/…`). */
export function bundledWorldReader(worldId: string): (path: string) => unknown {
  const root = `/content/maps/${worldId}/`
  return (path) => {
    const value = FILES[root + path]
    if (value === undefined) throw new Error(`Missing content file ${root}${path}`)
    return value
  }
}

export const REGISTERED_LOOT_TABLES: ReadonlySet<string> = new Set(Object.keys(LOOT_TABLES))

export interface LoadedWorld {
  docs: WorldDocuments
  map: MapData
  /** Warnings (errors throw `MapContentError`). */
  issues: ValidationIssue[]
}

/** Load, validate and resolve a whole world (M2: every chunk at once, through the lifecycle). */
export function loadWorld(read: (path: string) => unknown): LoadedWorld {
  const { docs, issues } = loadWorldDocuments(read, { lootTables: REGISTERED_LOOT_TABLES })
  const chunks = new ChunkLifecycle(docs)
  chunks.loadAll()
  return { docs, map: chunks.toMapData(), issues }
}

export function loadBundledWorld(worldId: string): LoadedWorld {
  return loadWorld(bundledWorldReader(worldId))
}
