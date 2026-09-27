import type { FallKind } from './pose'

/**
 * C4 (character plan): which way a dying character falls. Presentation only: the kill, the drop, the
 * corpse timer and collisions stay in the simulation; this picks a pose once, at the moment of death.
 * - A recent hit decides first: pushed back → on its back, pushed forward → face down, pushed
 *   sideways → onto that side.
 * - Otherwise a stable order from the character's ID, so a crowd does not fall all the same way and
 *   a reloaded corpse falls the same way again.
 * - A fall whose path is blocked (a wall within the body length) is skipped; with no room at all the
 *   character crumples to its knees (never lies through a wall).
 */
const LYING: readonly FallKind[] = ['back', 'front', 'left', 'right']

function hash(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0
  return h
}

/**
 * Preferred falls, best first. `pushRel` = direction of the last hit's push relative to the facing
 * (rad, 0 = forward), or null when no hit was recent.
 */
export function fallOrder(id: string, pushRel: number | null): FallKind[] {
  const h = hash(id)
  const rest = [...LYING]
  // Seeded shuffle (Fisher–Yates on the hash bits).
  for (let i = rest.length - 1; i > 0; i--) {
    const j = (h >>> (i * 3)) % (i + 1)
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  if (pushRel !== null) {
    const a = Math.atan2(Math.sin(pushRel), Math.cos(pushRel))
    const first: FallKind = Math.abs(a) > 2.2 ? 'back' : Math.abs(a) < 0.9 ? 'front' : a > 0 ? 'left' : 'right'
    rest.splice(rest.indexOf(first), 1)
    rest.unshift(first)
  }
  return [...rest, 'crumple']
}

/** World direction the head travels in a fall (unit XZ; zero for crumpling), for a facing. */
export function fallDirection(kind: FallKind, facing: number): { x: number; z: number } {
  const local = kind === 'back' ? [0, -1] : kind === 'front' ? [0, 1] : kind === 'left' ? [1, 0] : kind === 'right' ? [-1, 0] : [0, 0]
  const c = Math.cos(facing)
  const s = Math.sin(facing)
  return { x: local[0] * c + local[1] * s, z: -local[0] * s + local[1] * c }
}

/** Body length checked for room to fall (m). */
export const FALL_ROOM = 1.7

/** First fall in `order` with room (`blocked(dir)` = something solid along that direction). */
export function chooseFall(order: readonly FallKind[], facing: number, blocked: (dir: { x: number; z: number }) => boolean): FallKind {
  for (const kind of order) {
    if (kind === 'crumple') return kind
    if (!blocked(fallDirection(kind, facing))) return kind
  }
  return 'crumple'
}
