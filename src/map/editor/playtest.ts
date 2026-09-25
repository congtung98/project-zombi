import type { XZ } from '../schema.ts'
import { blockingSolid, lowSolids } from '../validate.ts'
import { documentFiles, resolvedRecords, type MapDocument } from './document.ts'

/**
 * Play From Here (M6), editor side: where a test session may start and the snapshot it runs on.
 * The snapshot is plain data (every file of the world folder); the playtest page loads it through
 * the game's content loader, so it plays exactly what Export would write.
 */

/** Why a point can't be a start point (outside the play area, inside a collider), or null. */
export function playPointProblem(doc: MapDocument, p: XZ): string | null {
  const half = doc.world.playArea.size / 2
  if (Math.abs(p.x) > half || Math.abs(p.z) > half) return `(${p.x}, ${p.z}) nằm ngoài vùng chơi ${doc.world.playArea.size} m`
  const blocker = blockingSolid(lowSolids(resolvedRecords(doc)), p)
  return blocker ? `(${p.x}, ${p.z}) nằm trong ${blocker.id}` : null
}

/** Immutable snapshot of the document for the playtest frame. */
export function playtestFiles(doc: MapDocument): Record<string, unknown> {
  return structuredClone(Object.fromEntries(documentFiles(doc)))
}
