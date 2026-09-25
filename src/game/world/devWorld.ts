import { loadBundledWorld } from '../../map/content'
import type { MapData } from './mapData'

/**
 * Dev-only `?world=<worldId>`: play another world bundled under `content/maps/` (for example an
 * editor export written there with `npm run map:unpack`). Loaded through the normal content
 * pipeline; invalid content throws `MapContentError` instead of falling back to the neighbourhood.
 * Its saves go to their own slot (`uiStore`), never the player's `slot-1`.
 */
export const DEV_WORLD_ID: string | null = (() => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('world') || null
})()

export function loadDevWorld(worldId: string): MapData {
  return loadBundledWorld(worldId).map
}
