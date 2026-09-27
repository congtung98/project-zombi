import { bundledWorldFiles } from '../map/content'

/**
 * World generator WG4: the `layout/…` files of repo worlds (the layout a world was generated from,
 * with the generator's manifest). Editor only: the game's content glob (`src/map/bundledFiles.ts`)
 * leaves them out, so a generated world downloads and plays exactly like a hand-made one.
 */
const LAYOUT_FILES = import.meta.glob<unknown>('/content/maps/*/layout/**/*.json', { eager: true, import: 'default' })

/** Every file of a repo world folder, its layout files included (the editor opens worlds with this). */
export function editorWorldFiles(worldId: string): Map<string, unknown> {
  const root = `/content/maps/${worldId}/`
  const files = bundledWorldFiles(worldId)
  for (const [path, value] of Object.entries(LAYOUT_FILES)) if (path.startsWith(root)) files.set(path.slice(root.length), value)
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}
