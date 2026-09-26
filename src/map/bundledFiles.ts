/**
 * Content bundled with the game: every JSON under `content/maps/` is part of the build (Vite
 * inlines it), keyed by `/content/maps/<worldId>/<path>`. Streaming will swap this for fetched
 * chunk files behind the same `read(path)` contract (`content.ts`).
 *
 * Tests (vitest) resolve this module to `src/test/bundledFiles.ts` instead: the same files, with the
 * frozen test copy of `neighborhood-50`, so editing the live neighbourhood does not break game tests.
 */
export const BUNDLED_FILES: Record<string, unknown> = import.meta.glob<unknown>('/content/maps/**/*.json', { eager: true, import: 'default' })
