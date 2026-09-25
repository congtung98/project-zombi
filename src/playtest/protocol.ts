import type { ValidationIssue } from '../map/validate'
import type { XZ } from '../map/schema'

/**
 * Messages between the map editor and its playtest frame (map editor M6, "Play From Here").
 * Same origin only. The editor sends an immutable snapshot of the document's files; the frame
 * loads it through the game's content loader and never writes anything back.
 */
export const PLAYTEST_CHANNEL = 'zombie-outbreak/playtest'

export interface PlaytestStart {
  channel: typeof PLAYTEST_CHANNEL
  type: 'start'
  /** Every file of the world folder by relative path (like a content pack). */
  files: Record<string, unknown>
  /** Where the player starts (world XZ). */
  spawn: XZ
  /** Start time of day, 0..1. */
  timeOfDay: number
}

export type PlaytestReply =
  | { channel: typeof PLAYTEST_CHANNEL; type: 'ready' }
  | { channel: typeof PLAYTEST_CHANNEL; type: 'started'; mapId: string }
  | { channel: typeof PLAYTEST_CHANNEL; type: 'error'; message: string; issues: ValidationIssue[] }

export function isPlaytestMessage(data: unknown): data is { channel: string; type: string } {
  return typeof data === 'object' && data !== null && (data as { channel?: unknown }).channel === PLAYTEST_CHANNEL
}
