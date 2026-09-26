/**
 * Test build of `src/map/bundledFiles.ts` (vitest alias in `vite.config.ts`): every file eager (no
 * per-world loading), the live worlds of `content/maps/` except the frozen ones in
 * `src/test/fixtures/maps/` (`neighborhood-50`, M11b `floors-lab` for the storey tests, M11c-1A
 * `cutaway-lab` for the cutaway tests). Game and editor tests assert that copy's exact IDs,
 * positions and loot, so the live neighbourhood can be edited (and given content migrations)
 * without rewriting them. `src/map/liveContent.test.ts` still loads every live world.
 * Never imported by the game or the editor.
 */
const LIVE = import.meta.glob<unknown>('/content/maps/**/*.json', { eager: true, import: 'default' })
const FROZEN = import.meta.glob<unknown>('/src/test/fixtures/maps/**/*.json', { eager: true, import: 'default' })

const FROZEN_PREFIX = '/src/test/fixtures/maps/'
const FROZEN_WORLDS = new Set(Object.keys(FROZEN).map((p) => p.slice(FROZEN_PREFIX.length).split('/')[0]))

export const BUNDLED_FILES: Record<string, unknown> = {
  ...Object.fromEntries(Object.entries(LIVE).filter(([p]) => !FROZEN_WORLDS.has(p.split('/')[3]))),
  ...Object.fromEntries(Object.entries(FROZEN).map(([p, v]) => [`/content/maps/${p.slice(FROZEN_PREFIX.length)}`, v])),
}

/** Every file is already loaded in tests. */
export function loadBundledWorldFiles(worldId: string): Promise<void> {
  void worldId
  return Promise.resolve()
}
