import { loadBundledWorld, loadWorld } from '../../map/content'
import { documentReader, tileWorld } from '../../map/tools/tileWorld'
import type { MapData } from './mapData'

/**
 * Dev-only synthetic large map (R0 stress mode, `?stress=N`): the neighbourhood content tiled
 * N × N by the tile generator (`map/tools/tileWorld.ts`), re-homed into the 32 m chunk grid and
 * loaded through the normal content pipeline. One outer boundary (zombies cross tiles), IDs
 * `<chunk>/t<i>-<j>-<name>`, loot tables reused. Tile (0, 0) keeps the player spawn; two extra
 * outdoor spawn points bring each tile to 10 zombies at New Game.
 */

/** Two more outdoor spawn points per tile (walkable, outside buildings/fences/car). */
const EXTRA_SPAWNS = [
  { x: -8, z: -5 },
  { x: 8, z: 5 },
]

export const STRESS_MAP_PREFIX = 'stress-'

/** N × N tiles of the neighbourhood (N clamped to 1..8), centred on the origin. */
export function buildStressMap(tiles: number): MapData {
  const n = Math.max(1, Math.min(8, Math.floor(tiles)))
  const base = loadBundledWorld('neighborhood-50').docs
  const docs = tileWorld(base, { worldId: `${STRESS_MAP_PREFIX}${n}x${n}`, name: `Stress ${n}×${n}`, tiles: n, extraZombieSpawns: EXTRA_SPAWNS })
  return loadWorld(documentReader(docs)).map
}

/** `?stress=N` in a dev build (0 = off). */
export const STRESS_TILES: number = (() => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return 0
  const v = Number(new URLSearchParams(window.location.search).get('stress'))
  return Number.isFinite(v) && v >= 1 ? Math.min(8, Math.floor(v)) : 0
})()
