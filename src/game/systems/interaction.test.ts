import { describe, expect, it } from 'vitest'
import { selectInteractable, TARGET_STICKINESS, type Interactable } from './interaction'

const door: Interactable = { id: 'door', kind: 'door', name: 'Cửa', position: { x: 0, y: 1, z: 2 }, radius: 0.5 }
const cabinet: Interactable = { id: 'cab', kind: 'container', name: 'Tủ', position: { x: 0, y: 0.5, z: -2 }, radius: 0.5 }
const far: Interactable = { id: 'far', kind: 'container', name: 'Xa', position: { x: 10, y: 0.5, z: 0 }, radius: 0.5 }
const origin = { x: 0, y: 0.9, z: 0 }
// INTERACT_RANGE is 1 m from the player to the object's edge since S4: same layout, 1.4 m away.
const doorClose: Interactable = { ...door, position: { x: 0, y: 1, z: 1.4 } }
const cabinetClose: Interactable = { ...cabinet, position: { x: 0, y: 0.5, z: -1.4 } }

describe('selectInteractable', () => {
  it('returns null when nothing is in range', () => {
    expect(selectInteractable(origin, 0, [far])).toBeNull()
  })

  it('picks the nearest object in range', () => {
    const near: Interactable = { ...cabinet, id: 'near', position: { x: 1, y: 0.5, z: 0 } }
    // Facing +Z (toward the door at 2 m) but "near" is beside the player at 1 m.
    expect(selectInteractable(origin, 0, [door, near, far])?.id).toBe('near')
  })

  it('prefers the object the player is facing when distances tie', () => {
    // facing 0 → +Z → door; facing π → -Z → cabinet.
    expect(selectInteractable(origin, 0, [doorClose, cabinetClose])?.id).toBe('door')
    expect(selectInteractable(origin, Math.PI, [doorClose, cabinetClose])?.id).toBe('cab')
  })

  it('skips objects blocked by a wall', () => {
    expect(selectInteractable(origin, 0, [doorClose, cabinetClose], (item) => item.id === 'door')?.id).toBe('cab')
    expect(selectInteractable(origin, 0, [doorClose], () => true)).toBeNull()
  })

  it('takes object radius into account for range', () => {
    const wide: Interactable = { ...cabinet, id: 'wide', position: { x: 0, y: 0.5, z: -1.8 }, radius: 1 }
    expect(selectInteractable(origin, Math.PI, [wide])?.id).toBe('wide')
    const narrow: Interactable = { ...wide, id: 'narrow', radius: 0.2 }
    expect(selectInteractable(origin, Math.PI, [narrow])).toBeNull()
  })

  it('CS1c: the object under the cursor wins when it is in reach and not behind a wall', () => {
    const under = (id: string) => (item: Interactable) => (item.id === id ? 0.1 : 5)
    // Facing the door, but the cursor is on the cabinet.
    expect(selectInteractable(origin, 0, [doorClose, cabinetClose], undefined, undefined, { pointerDistance: under('cab') })?.id).toBe('cab')
    // Out of reach: the cursor does not pull it in.
    expect(selectInteractable(origin, 0, [doorClose, far], undefined, undefined, { pointerDistance: under('far') })?.id).toBe('door')
    // Behind a wall: back to the proximity rule.
    expect(selectInteractable(origin, 0, [doorClose, cabinetClose], (i) => i.id === 'cab', undefined, { pointerDistance: under('cab') })?.id).toBe('door')
    // Near but not over it (beyond its radius): proximity rule.
    expect(selectInteractable(origin, 0, [doorClose, cabinetClose], undefined, undefined, { pointerDistance: () => 0.6 })?.id).toBe('door')
  })

  it('CS1c: two containers side by side: the current target stays until another is clearly better', () => {
    const a: Interactable = { id: 'a', kind: 'container', name: 'A', position: { x: -0.5, y: 0.5, z: 1.2 }, radius: 0.5 }
    const b: Interactable = { id: 'b', kind: 'container', name: 'B', position: { x: 0.5, y: 0.5, z: 1.2 }, radius: 0.5 }
    // The player drifts a little left and right between them: no flicker.
    let current: string | null = null
    const picks: string[] = []
    for (const x of [0.05, -0.05, 0.08, -0.08, 0.03, -0.1]) {
      current = selectInteractable({ x, y: 0.9, z: 0 }, 0, [a, b], undefined, undefined, { current })?.id ?? null
      picks.push(current!)
    }
    expect(new Set(picks).size).toBe(1)
    // Clearly closer to the other one: it switches.
    const moved = selectInteractable({ x: 0.5 + TARGET_STICKINESS, y: 0.9, z: 0 }, 0, [a, b], undefined, undefined, { current: picks[0] === 'a' ? 'a' : 'b' })
    expect(moved?.id).toBe('b')
  })
})
