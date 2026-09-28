import type { Equipment, ItemId, ItemInstance } from '../entities/items'
import type { TransferBlock } from './inventory'

/**
 * INV-LOOT: how the UI and the runtime name an inventory. `main` = the player's main inventory,
 * `worn` = the worn bag's contents, `container:<id>` = a world container (in S2 only the open one).
 * Commands carry keys and instance IDs, never item objects or list indexes.
 */
export type InventoryKey = 'main' | 'worn' | `container:${string}`

export function containerKey(containerId: string): InventoryKey {
  return `container:${containerId}`
}

export function containerIdOf(key: InventoryKey): string | null {
  return key.startsWith('container:') ? key.slice('container:'.length) : null
}

/** What the player carries (main and worn bag): items leaving it for a container or the ground are guarded. */
export function isCarried(key: InventoryKey): boolean {
  return key === 'main' || key === 'worn'
}

/** Why one item did not move (capacity reasons come from `transferItem`, state reasons from here). */
export type TransferRefusal = TransferBlock | 'equipped' | 'favorite' | 'reserved' | 'unreachable' | 'dead' | 'busy'

export interface TransferLine {
  instanceId: string
  /** Units to move; omitted = the whole instance. */
  quantity?: number
}

export interface TransferSkip {
  instanceId: string
  itemId: ItemId | null
  reason: TransferRefusal
}

/** One summary per command (never one message per unit). */
export interface TransferSummary {
  /** Units moved. */
  moved: number
  /** Lines that moved at least one unit. */
  movedLines: number
  /** Lines that moved nothing or only part, with the reason for the rest. */
  skipped: TransferSkip[]
}

/** Result of a single-line transfer (take, store): units moved, units left at the source, why the rest stayed. */
export interface TransferOutcome {
  moved: number
  remainder: number
  reason: TransferRefusal | null
}

export function emptySummary(): TransferSummary {
  return { moved: 0, movedLines: 0, skipped: [] }
}

/** True when the instance is referenced by the equipment (weapon in hand or bag on the back). */
export function isEquipped(item: ItemInstance, equipment: Equipment): boolean {
  return item.id === equipment.weaponInstanceId || item.id === equipment.backInstanceId
}

/**
 * State rules checked before capacity, in the order the UI explains them:
 * - equipped items never move (take off first), not even into the worn bag;
 * - a favorite never leaves what the player carries (remove the favorite first);
 * - an item promised to a running action stays where it is.
 */
export function itemRefusal(item: ItemInstance, equipment: Equipment, leavingCarried: boolean, reserved: boolean): TransferRefusal | null {
  if (isEquipped(item, equipment)) return 'equipped'
  if (leavingCarried && item.favorite) return 'favorite'
  if (reserved) return 'reserved'
  return null
}
