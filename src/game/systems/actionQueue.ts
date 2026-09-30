import { GAME_CONFIG } from '../core/config'
import { getItemDef, type ItemId, type ItemInstance } from '../entities/items'
import { itemWeight, type BagStore } from './bags'

/**
 * INV-LOOT S4: one queue for every timed action, run in order; only the running one holds
 * reservations. AX1: the queue itself is `actions/actionSystem.ts`; here the ledger and transfer helpers.
 */

/** Who holds a reservation: a transfer step keeps its item from any use; a recipe allows equipping; a use (AX2: eat, drink, apply, open) holds the unit it works on. */
export type ReservationKind = 'transfer' | 'recipe' | 'use'

/**
 * The one reservation ledger (INV-LOOT §5, S0 audit §5): quantities of instances promised to an action,
 * by action. An instance is never promised beyond its quantity; releasing an action frees only what
 * that action held, so cancelling a transfer can never free a craft's materials.
 */
export class ReservationLedger {
  private readonly byAction = new Map<number, { kind: ReservationKind; items: Map<string, number> }>()

  reserve(actionId: number, kind: ReservationKind, instanceId: string, quantity: number): void {
    if (quantity <= 0) return
    let entry = this.byAction.get(actionId)
    if (!entry) {
      entry = { kind, items: new Map() }
      this.byAction.set(actionId, entry)
    }
    entry.items.set(instanceId, (entry.items.get(instanceId) ?? 0) + quantity)
  }

  release(actionId: number): void {
    this.byAction.delete(actionId)
  }

  clear(): void {
    this.byAction.clear()
  }

  /** Units of the instance promised to any action except `exceptAction`. */
  reserved(instanceId: string, exceptAction?: number): number {
    let n = 0
    for (const [id, entry] of this.byAction) if (id !== exceptAction) n += entry.items.get(instanceId) ?? 0
    return n
  }

  /** True when a transfer step holds the instance (it may not be equipped, used or moved meanwhile). */
  heldByTransfer(instanceId: string): boolean {
    for (const entry of this.byAction.values()) if (entry.kind === 'transfer' && entry.items.has(instanceId)) return true
    return false
  }

  /** Instances with a reservation (for the UI's "Đang dùng" badge). */
  ids(): string[] {
    const out = new Set<string>()
    for (const entry of this.byAction.values()) for (const id of entry.items.keys()) out.add(id)
    return [...out]
  }

  isEmpty(): boolean {
    return this.byAction.size === 0
  }
}

/**
 * One timed step for an item: small items move in batches (`transfer` on the definition), others one
 * unit per step timed from the unit weight (a bag with its contents), INV-LOOT §4 / S0 audit §4.
 */
export function transferStep(item: ItemInstance, bags: BagStore, cfg = GAME_CONFIG.transfer): { units: number; seconds: number } {
  const def = getItemDef(item.itemId)
  if (def.transfer) return { units: def.transfer.batch, seconds: def.transfer.seconds }
  const kg = item.kind === 'bag' ? itemWeight(item, bags) : def.weightKg
  return { units: 1, seconds: Math.min(cfg.max, Math.max(cfg.min, cfg.base + kg * cfg.perKg)) }
}

export interface TransferLineState {
  instanceId: string
  itemId: ItemId
  /** Units still to move for this line (fixed when queued, never above what was available then). */
  left: number
  /** Units queued for this line (progress; the line moved something when `left < queued`). */
  queued: number
}

/** A transfer's timed step (an `ActionStep` that knows its instance and units). */
/** A transfer's timed step: an `ActionStep` that knows its instance and units. */
export interface TransferStepState {
  instanceId: string
  units: number
  duration: number
  elapsed: number
}

/** Progress of the running job for the HUD and the inventory window. */
export interface JobView {
  id: number
  kind: 'transfer' | 'craft' | 'repair' | 'use'
  label: string
  /** 0..1 of the current step (a recipe is one step). */
  stepProgress: number
  /** Seconds left in the current step. */
  stepRemaining: number
  /** Units done / queued (a recipe: 0/1). */
  done: number
  total: number
}
