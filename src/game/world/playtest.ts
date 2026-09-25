import type { MapData } from './mapData'

/**
 * Editor playtest session (map editor M6, "Play From Here"): set by the playtest page before the
 * game modules load, so the runtime singleton is built on the editor's snapshot instead of a
 * bundled world. The game page never sets it; there is no fallback to another map.
 */
export interface PlaytestSession {
  map: MapData
  /** Start time of day 0..1 (lighting/night checks). */
  timeOfDay: number
}

let session: PlaytestSession | null = null

export function setPlaytestSession(s: PlaytestSession): void {
  session = s
}

export function playtestSession(): PlaytestSession | null {
  return session
}
