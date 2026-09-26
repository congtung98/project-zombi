/**
 * Content bundled with the game, keyed by `/content/maps/<worldId>/<path>` (M10: streamed per world).
 *
 * - In the main bundle: every `world.json` (the world menu reads names and sizes) and the whole
 *   default world `neighborhood-50` (the neighbourhood map and legacy save migration are built at
 *   import). The glob patterns must be literals, hence the ID spelled out here.
 * - Every other world's files load on demand with `loadBundledWorldFiles` (the game build puts
 *   each world in its own JS chunk, `vite.config.ts`): a player downloads and parses only the world
 *   they play. The editor preloads every world.
 *
 * Tests (vitest) resolve this module to `src/test/bundledFiles.ts` instead: every file eager, with the
 * frozen test copy of `neighborhood-50`, so editing the live neighbourhood does not break game tests.
 */
const EAGER = import.meta.glob<unknown>(['/content/maps/*/world.json', '/content/maps/neighborhood-50/**/*.json'], { eager: true, import: 'default' })
const LAZY = import.meta.glob<unknown>(['/content/maps/**/*.json', '!/content/maps/*/world.json', '!/content/maps/neighborhood-50/**'], { import: 'default' })

/** Files available synchronously: the eager ones plus every world loaded so far. */
export const BUNDLED_FILES: Record<string, unknown> = { ...EAGER }

const loading = new Map<string, Promise<void>>()

/** Load every file of a world (no-op when already loaded; a world with no lazy files resolves at once). */
export function loadBundledWorldFiles(worldId: string): Promise<void> {
  let p = loading.get(worldId)
  if (!p) {
    const prefix = `/content/maps/${worldId}/`
    const entries = Object.entries(LAZY).filter(([path]) => path.startsWith(prefix))
    p = Promise.all(entries.map(async ([path, load]) => {
      BUNDLED_FILES[path] = await load()
    })).then(() => undefined)
    // A failed load (network) may be retried later.
    p.catch(() => loading.delete(worldId))
    loading.set(worldId, p)
  }
  return p
}
