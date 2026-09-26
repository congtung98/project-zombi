import { bundledWorldCatalog, loadBundledWorld, loadBundledWorldFiles, type BundledWorldEntry } from '../../map/content'
import type { MapData } from './mapData'

/**
 * Which bundled world the game plays. Every world under `content/maps/` (for example an editor
 * export written there with `npm run map:unpack`) can be picked in the main menu; the choice is kept
 * in localStorage and applied by reloading the page, because the runtime singleton is built on one
 * map. `?world=<worldId>` overrides it for one visit (links, browser scripts). Each world keeps its
 * own save slot (`uiStore`).
 */
export const DEFAULT_WORLD_ID = 'neighborhood-50'
const STORAGE_KEY = 'zombie-outbreak.world'

export type WorldSource = 'url' | 'stored' | 'default'

export interface WorldSelection {
  map: MapData
  source: WorldSource
  /** Why the requested world was not used (shown in the main menu). */
  notice?: string
}

export interface WorldRequest {
  /** `?world=` of this visit. */
  url: string | null
  /** World picked in the menu earlier. */
  stored: string | null
  catalog: readonly BundledWorldEntry[]
  load: (worldId: string) => MapData
  loadDefault: () => MapData
  /** Dev: a bad `?world=` throws (`MapContentError`) instead of falling back, so broken content is loud. */
  strictUrl: boolean
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * URL world, else the stored choice, else the default world. A stored or (production) URL world
 * that is gone or fails to load falls back to the default with a notice: a bad choice must never
 * leave the player on a blank page.
 */
export function selectWorld(req: WorldRequest): WorldSelection {
  const tryLoad = (worldId: string, source: WorldSource, label: string): WorldSelection => {
    if (worldId === DEFAULT_WORLD_ID) return { map: req.loadDefault(), source }
    const strict = source === 'url' && req.strictUrl
    if (!req.catalog.some((w) => w.worldId === worldId)) {
      if (strict) throw new Error(`World "${worldId}" không có trong content/maps`)
      return { map: req.loadDefault(), source: 'default', notice: `${label} "${worldId}" không còn trong bản game này; đang chơi world mặc định.` }
    }
    try {
      return { map: req.load(worldId), source }
    } catch (e) {
      if (strict) throw e
      return { map: req.loadDefault(), source: 'default', notice: `${label} "${worldId}" bị lỗi nội dung (${describe(e)}); đang chơi world mặc định.` }
    }
  }
  if (req.url) return tryLoad(req.url, 'url', 'World trong đường dẫn')
  if (req.stored) return tryLoad(req.stored, 'stored', 'World đã chọn')
  return { map: req.loadDefault(), source: 'default' }
}

/**
 * Worlds offered in the menu: listed ones (dev also shows hidden ones) plus the one being played;
 * the default world first, then by name.
 */
export function menuWorlds(catalog: readonly BundledWorldEntry[], currentId: string, showHidden: boolean): BundledWorldEntry[] {
  return catalog
    .filter((w) => w.listed || showHidden || w.worldId === currentId)
    .sort((a, b) => Number(b.worldId === DEFAULT_WORLD_ID) - Number(a.worldId === DEFAULT_WORLD_ID) || a.name.localeCompare(b.name, 'vi') || a.worldId.localeCompare(b.worldId))
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function urlWorld(): string | null {
  return typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('world') || null
}

/**
 * M10: load the files of the world this visit asks for (URL, else the stored choice) before the
 * runtime module is imported (`main.tsx`): worlds other than the default one are not in the main
 * bundle. A world that is gone or fails to load is left to `selectWorld`, which falls back.
 */
export async function preloadStartupWorld(): Promise<void> {
  const worldId = urlWorld() ?? (typeof window === 'undefined' ? null : readStored())
  if (!worldId || !bundledWorldCatalog().some((w) => w.worldId === worldId)) return
  try {
    await loadBundledWorldFiles(worldId)
  } catch {
    // Missing files make the load in `selectWorld` fail: default world + notice.
  }
}

let selection: WorldSelection | null = null

/** World for the runtime singleton (called once, from `runtime.ts`). */
export function startupWorld(loadDefault: () => MapData): MapData {
  const browser = typeof window !== 'undefined'
  selection = selectWorld({
    url: urlWorld(),
    stored: browser ? readStored() : null,
    catalog: bundledWorldCatalog(),
    load: (id) => loadBundledWorld(id).map,
    loadDefault,
    strictUrl: import.meta.env.DEV,
  })
  // A stored world that could not be played is forgotten: the notice shows once.
  if (selection.notice && selection.source === 'default' && browser && !urlWorld()) {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Storage unavailable: nothing was stored either.
    }
  }
  return selection.map
}

/** How the startup world was chosen (null in tests and the editor playtest). */
export function startupSelection(): WorldSelection | null {
  return selection
}

/**
 * Play another world: remember it and reload without `?world=` (the new runtime is built on it).
 * If localStorage is unavailable (private mode), the world goes in the URL instead.
 */
export function switchWorld(worldId: string): void {
  let stored = false
  try {
    if (worldId === DEFAULT_WORLD_ID) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, worldId)
    stored = true
  } catch {
    stored = false
  }
  const url = new URL(window.location.href)
  if (stored) url.searchParams.delete('world')
  else url.searchParams.set('world', worldId)
  window.location.assign(url.toString())
}
