import { describe, expect, it } from 'vitest'
import { selectInteractable, type Interactable } from './interaction'

const door: Interactable = { id: 'door', kind: 'door', name: 'Cửa', position: { x: 0, y: 1, z: 2 }, radius: 0.5 }
const cabinet: Interactable = { id: 'cab', kind: 'container', name: 'Tủ', position: { x: 0, y: 0.5, z: -2 }, radius: 0.5 }
const far: Interactable = { id: 'far', kind: 'container', name: 'Xa', position: { x: 10, y: 0.5, z: 0 }, radius: 0.5 }
const origin = { x: 0, y: 0.9, z: 0 }

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
    expect(selectInteractable(origin, 0, [door, cabinet])?.id).toBe('door')
    expect(selectInteractable(origin, Math.PI, [door, cabinet])?.id).toBe('cab')
  })

  it('skips objects blocked by a wall', () => {
    expect(selectInteractable(origin, 0, [door, cabinet], (item) => item.id === 'door')?.id).toBe('cab')
    expect(selectInteractable(origin, 0, [door], () => true)).toBeNull()
  })

  it('takes object radius into account for range', () => {
    const wide: Interactable = { ...cabinet, id: 'wide', position: { x: 0, y: 0.5, z: -2.8 }, radius: 1 }
    expect(selectInteractable(origin, Math.PI, [wide])?.id).toBe('wide')
    const narrow: Interactable = { ...wide, id: 'narrow', radius: 0.2 }
    expect(selectInteractable(origin, Math.PI, [narrow])).toBeNull()
  })
})
