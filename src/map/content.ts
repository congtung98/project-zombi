import { LOOT_TABLES } from '../game/world/lootTables'
import type { MapData } from '../game/world/mapData'
import { BUNDLED_FILES } from './bundledFiles'
import { ChunkLifecycle } from './loader'
import { loadWorldDocuments, type ValidationIssue, type WorldDocuments } from './validate'

/** Bundled content files (`bundledFiles.ts`; tests see the frozen neighbourhood). */
const FILES = BUNDLED_FILES

/** Reader for one world folder (`world.json`, `chunks/…`, `prefabs/…`, `migrations/…`). */
export function bundledWorldReader(worldId: string): (path: string) => unknown {
  const root = `/content/maps/${worldId}/`
  return (path) => {
    const value = FILES[root + path]
    if (value === undefined) throw new Error(`Missing content file ${root}${path}`)
    return value
  }
}

/** IDs of the worlds bundled under `content/maps/` (folders with a `world.json`), sorted. */
export function bundledWorldIds(): string[] {
  return Object.keys(FILES)
    .map((p) => /^\/content\/maps\/([^/]+)\/world\.json$/.exec(p)?.[1])
    .filter((id): id is string => !!id)
    .sort()
}

/** A bundled world as the game menu lists it (raw `world.json`, nothing resolved). */
export interface BundledWorldEntry {
  worldId: string
  name: string
  /** `world.json` `listed` (default true): shown in the game's world menu. */
  listed: boolean
  /** Play area X × Z in metres. */
  size: { x: number; z: number }
}

/** Bundled worlds for the game's world menu, sorted by ID. Only reads `world.json`; loading validates. */
export function bundledWorldCatalog(): BundledWorldEntry[] {
  return bundledWorldIds().map((worldId) => {
    const w = (FILES[`/content/maps/${worldId}/world.json`] ?? {}) as { name?: unknown; listed?: unknown; playArea?: { size?: unknown; depth?: unknown } }
    const x = typeof w.playArea?.size === 'number' ? w.playArea.size : 0
    const z = typeof w.playArea?.depth === 'number' ? w.playArea.depth : x
    return { worldId, name: typeof w.name === 'string' && w.name ? w.name : worldId, listed: w.listed !== false, size: { x, z } }
  })
}

/** Every file of a bundled world folder by relative path (editor: open a world with its extras). */
export function bundledWorldFiles(worldId: string): Map<string, unknown> {
  const root = `/content/maps/${worldId}/`
  return new Map(Object.keys(FILES).filter((p) => p.startsWith(root)).sort().map((p) => [p.slice(root.length), FILES[p]]))
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
  const map = chunks.toMapData()
  return { docs, map: docs.contentMigrations ? { ...map, contentMigrations: docs.contentMigrations } : map, issues }
}

export function loadBundledWorld(worldId: string): LoadedWorld {
  return loadWorld(bundledWorldReader(worldId))
}
