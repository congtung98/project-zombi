import { GAME_CONFIG } from '../../core/config'
import { INTERRUPT_ALL } from '../characterState'
import { registerAction } from '../registry'
import { ACTION, type ActionDefinition, type ActionFailure, type ActionJob, type ActionType } from '../types'
import type { ActionWorld } from '../world'

/**
 * AX4 (WIS §9, FB case 1): the world object actions. Each checks reach and the object's state again
 * when it runs (the request may be stale: WIS §5 version), then changes the object's gameplay state
 * through one `world.set` effect; render, collider, navigation, lighting and save follow that state.
 * Doors, lamps and curtains act at once (a chase must never wait on a door); opening a container
 * takes a moment (D1), closing it does not.
 */
type WorldTarget = { objectId: string; objectType: string; version: number }

export interface DoorData { to: 'open' | 'closed' }
export interface LightData { on: boolean }
export interface CurtainData { closed: boolean }
export type ContainerData = Record<string, never>

function target(job: ActionJob): WorldTarget {
  const t = job.ctx.target
  if (t.kind !== 'world') throw new Error(`${job.type} needs a world object target`)
  return t
}

function fail(w: ActionWorld, job: ActionJob, reason: ActionFailure): false {
  w.events.queue('interaction:failed', { label: job.label, reason })
  return false
}

/**
 * The object still exists, is in reach, and its state still allows the action. It is always checked
 * against the state now: a request made from an older state (another version, WIS §5) that no longer
 * makes sense fails as `TARGET_CHANGED`, one that still does runs.
 */
function checkWorld(w: ActionWorld, job: ActionJob, check: () => boolean): boolean {
  const t = target(job)
  if (!w.objectExists(t.objectType, t.objectId)) return fail(w, job, 'TARGET_GONE')
  if (!w.canReachObject(t.objectId)) return fail(w, job, 'OUT_OF_RANGE')
  if (!check()) return fail(w, job, 'TARGET_CHANGED')
  return true
}

const view = (job: ActionJob) => {
  const s = job.step
  return { id: job.id, kind: 'interact' as const, label: job.label, stepProgress: s && s.duration > 0 ? s.elapsed / s.duration : 0, stepRemaining: s ? Math.max(0, s.duration - s.elapsed) : 0, done: 0, total: 1 }
}

function immediate<Data>(type: ActionType, check: (w: ActionWorld, id: string, data: Data) => boolean, patch: (data: Data) => Record<string, unknown>): ActionDefinition<Data> {
  return {
    type,
    lane: 'immediate',
    characterState: 'INTERACTING',
    interrupt: INTERRUPT_ALL,
    presentation: { anim: 'reach' },
    begin(job, w) {
      const t = target(job)
      return checkWorld(w, job, () => check(w, t.objectId, job.data)) ? { duration: 0, elapsed: 0 } : null
    },
    commit(job) {
      const t = target(job)
      return { next: 'done', mutation: { effects: [{ type: 'world.set', objectType: t.objectType, objectId: t.objectId, patch: patch(job.data) }] } }
    },
    view,
  }
}

const doorCheck = (w: ActionWorld, id: string, d: DoorData) => {
  const door = w.world.doors.get(id)
  return !!door && door.state !== 'destroyed' && door.state !== d.to
}

export const OPEN_DOOR = registerAction(immediate<DoorData>(ACTION.OPEN_DOOR, doorCheck, (d) => ({ state: d.to })))
export const CLOSE_DOOR = registerAction(immediate<DoorData>(ACTION.CLOSE_DOOR, doorCheck, (d) => ({ state: d.to })))
export const TOGGLE_LIGHT = registerAction(immediate<LightData>(ACTION.TOGGLE_LIGHT, (w, id, d) => w.world.lamps.has(id) && w.world.lamps.get(id) !== d.on, (d) => ({ on: d.on })))
export const TOGGLE_CURTAIN = registerAction(immediate<CurtainData>(ACTION.TOGGLE_CURTAIN, (w, id, d) => w.world.curtains.has(id) && w.world.curtains.get(id) !== d.closed, (d) => ({ closed: d.closed })))
export const CLOSE_CONTAINER = registerAction(immediate<ContainerData>(ACTION.CLOSE_CONTAINER, (w, id) => w.openContainerId() === id, () => ({ open: false })))

/** FB case 1: Open → OPEN_CONTAINER → reach pose → the container's state becomes open (its loot window). */
export const OPEN_CONTAINER = registerAction<ContainerData>({
  type: ACTION.OPEN_CONTAINER,
  lane: 'queue',
  characterState: 'LOOTING',
  interrupt: INTERRUPT_ALL,
  presentation: { anim: 'reach' },
  begin(job, w) {
    const t = target(job)
    if (!checkWorld(w, job, () => w.world.containers.has(t.objectId))) return null
    w.inventoryChanged()
    return { duration: GAME_CONFIG.actions.openContainerSeconds, elapsed: 0 }
  },
  commit(job, w) {
    const t = target(job)
    // Checked again at the end: the player may have been pushed out of reach meanwhile.
    if (!w.canReachObject(t.objectId)) {
      fail(w, job, 'OUT_OF_RANGE')
      return { next: 'done' }
    }
    return { next: 'done', mutation: { effects: [{ type: 'world.set', objectType: t.objectType, objectId: t.objectId, patch: { open: true } }] } }
  },
  view,
})
