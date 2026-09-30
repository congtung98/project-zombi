import type { EventBus, GameEvents } from '../core/events'
import type { PlayerState } from '../entities/player'
import type { WorldState } from '../world/worldState'
import type { Inventory } from '../systems/inventory'
import type { InventoryKey } from '../systems/inventoryCommands'
import type { ReservationLedger } from '../systems/actionQueue'
import type { CraftSources } from '../systems/crafting'
import type { Vec3 } from '../../types'

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
}
