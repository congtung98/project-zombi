import type { DoorPlacement } from './buildings'

export type DoorStatus = 'open' | 'closed' | 'destroyed'
export const DOOR_MAX_HP = 120
export const DOOR_LEAF_THICKNESS = 0.12

export interface DoorState {
  id: string
  state: DoorStatus
  hp: number
}

/** Shared geometry contract for rendering and the Rapier integration test. */
export function doorLeafTransform(door: DoorPlacement, state: DoorStatus) {
  if (state === 'destroyed') return null
  const angle = state === 'open' ? door.openAngle : door.closedAngle
  return {
    angle,
    center: { x: door.hinge.x + Math.cos(angle) * door.width / 2, y: door.height / 2, z: door.hinge.z - Math.sin(angle) * door.width / 2 },
    halfExtents: [door.width / 2, door.height / 2, DOOR_LEAF_THICKNESS / 2] as const,
  }
}
