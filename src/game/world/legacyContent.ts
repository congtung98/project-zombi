import { bundledWorldReader } from '../../map/content'
import type { LegacyIdMap } from '../../map/tools/importLegacy'
import type { MapData } from './mapData'

/**
 * The neighbourhood as it was before map content (save v1–v7 used these IDs): the frozen map
 * and the legacy → stable ID table, both under `content/maps/neighborhood-50/migrations/`.
 * Only save migration reads this; the world itself is built from the content documents.
 */

export interface LegacyContent {
  /** Map the old saves were written against (legacy IDs, same layout as content v1). */
  map: MapData
  ids: LegacyIdMap
}

const NEIGHBORHOOD_ID = 'neighborhood-50'
const read = bundledWorldReader(NEIGHBORHOOD_ID)
const NEIGHBORHOOD_LEGACY: LegacyContent = {
  map: read('migrations/legacy-v7-map.json') as MapData,
  ids: read('migrations/legacy-v7-ids.json') as LegacyIdMap,
}

/** Legacy content for saves of this world, if its IDs changed when it became data-driven. */
export function legacyContentFor(map: MapData): LegacyContent | undefined {
  return map.id === NEIGHBORHOOD_ID && map.contentVersion !== undefined ? NEIGHBORHOOD_LEGACY : undefined
}

/** Containers added in P2-S2 (save v3). Older saves receive them once, seeded, during migration. */
export const CONTAINERS_ADDED_V3: ReadonlySet<string> = new Set(['ct-safehouse-closet', 'ct-store-tools', 'ct-house-nightstand', 'ct-park-toolbox'])

/** Material containers added in P2-S4 (save v5); seeded once when an older save migrates. */
export const CONTAINERS_ADDED_V5: ReadonlySet<string> = new Set(['ct-safehouse-toolbox', 'ct-store-hardware', 'ct-house-scrap'])

/** Building lighting sprint (save v7): the bedroom door; older saves get it in its initial state. */
export const DOORS_ADDED_V7: ReadonlySet<string> = new Set(['door-house-bedroom'])
/** Wall pieces added in v7 (the house partition): migrated players/zombies inside them are moved out. */
export const WALL_PREFIXES_ADDED_V7: readonly string[] = ['house-partition']
