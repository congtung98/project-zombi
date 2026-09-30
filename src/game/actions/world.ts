import type { EventBus, GameEvents } from '../core/events'
import type { PlayerState } from '../entities/player'
import type { WorldState } from '../world/worldState'
import type { Inventory } from '../systems/inventory'
import type { InventoryKey } from '../systems/inventoryCommands'
import type { ReservationLedger } from '../systems/actionQueue'
import type { CraftSources } from '../systems/crafting'
import type { Vec3 } from '../../types'
import type { WorldAdapter } from './effects'

/**
 * AX1: the part of the simulation an action definition may read and ask for. The runtime builds it
 * once; definitions never reach into the runtime itself, so a definition is testable with a stand-in
 * and knows nothing about input, rendering or other features.
 */
export interface ActionWorld {
  readonly player: PlayerState
  readonly world: WorldState
  readonly ledger: ReservationLedger
  readonly events: EventBus<GameEvents>
  /** The inventory behind a key while the player can reach it, else null. */
  inventoryFor(key: InventoryKey): Inventory | null
  /** Reach of a point on the floor (an item's own position). */
  canReachFloor(position: Vec3): boolean
  /** A bag whose contents hold a reservation (it may not be moved meanwhile). */
  bagHeld(instanceId: string): boolean
  /** Craft sources: main then the worn bag, minus other reservations (and queued claims when queueing). */
  craftSources(exceptAction?: number, queueing?: boolean): CraftSources
  /** Units of an instance that queued work still counts on. */
  claimed(instanceId: string): number
  /** The UI must take a new inventory snapshot. */
  inventoryChanged(): void
  /** Items appeared on or left the floor (markers, and the reach lists refresh at once). */
  floorChanged(): void
  /** AX4: a world object of this type with this ID exists. */
  objectExists(type: string, id: string): boolean
  /** AX4: the player can reach the object now (distance, storey, nothing in between). */
  canReachObject(id: string): boolean
  /** AX4: the container shown in the loot window, or null. */
  openContainerId(): string | null
  /** AX4: how a `world.set` effect changes objects of a type (the runtime's own setters). */
  worldAdapter(type: string): WorldAdapter | undefined
  /** AX5: queue taking every item of a container in reach into the main inventory (a follow-up request). */
  requestTakeAll(containerId: string): void
  /** AX5 combat lane: start a swing toward `yaw` (the combat code's rules), or false. */
  startSwing(yaw: number): boolean
  /** AX5 combat lane: start a shove toward the cursor, or false. */
  startShove(): boolean
  /** AX5 combat lane: the zombie the stance was taken against (right click on it), or null. */
  setCombatTarget(entityId: string | null): void
}
