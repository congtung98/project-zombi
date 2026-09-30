import { getItemDef, type ItemId, type ItemInstance } from '../../entities/items'
import { usableInventories } from '../../systems/bags'
import { addItem, cloneInventory, removeQuantity, type Inventory } from '../../systems/inventory'
import { canBenefit, type UseItemFailure } from '../../systems/survival'
import { isUsableTool } from '../../systems/weapons'
import { INTERRUPT_ALL, type CharacterState } from '../characterState'
import { eventEffect, inventorySignature, type GameplayEffect } from '../effects'
import { registerAction } from '../registry'
import { ACTION, type ActionDefinition, type ActionJob, type AnimGroup } from '../types'
import type { ActionWorld } from '../world'

/**
 * AX2 (FB §6, CAS §6.1–6.3): using an item is a timed action named by its `consumable` component
 * (EAT, DRINK, HEAL), opening a sealed one is OPEN_ITEM. Nothing changes before the end: the unit is
 * reserved while the action runs, and the effect and the unit's removal are one transaction at the
 * end, so a cancel (moving, a blow, a swing, the stance) leaves the item and the stats as they were.
 */
export interface UseData {
  /** The item the action works on (for an item taken or opened first: what it becomes). */
  itemId: ItemId
  /** The instance chosen by the player; null when an earlier job of the request produces it. */
  instanceId: string | null
  /**
   * Follows an earlier job of the same request (taken from a container, opened first): when the
   * chosen instance is gone (merged into a stack, turned into another item), any free unit of the
   * same item in what the player carries is the one (a favorite only when nothing else is left).
   */
  follow: boolean
  /** The instance reserved when it started. */
  resolved: string | null
  /** Its change was applied (a chain goes on only then). */
  done: boolean
}

export type UseJob = ActionJob<UseData>

/** The use action type and the character state of a consumable's action. */
export const USE_STATES: Record<'EAT' | 'DRINK' | 'HEAL', { state: CharacterState; anim: AnimGroup; verb: string }> = {
  EAT: { state: 'EATING', anim: 'eat', verb: 'Ăn' },
  DRINK: { state: 'DRINKING', anim: 'drink', verb: 'Uống' },
  HEAL: { state: 'HEALING', anim: 'medical', verb: 'Dùng' },
}

/** An instance of the item with a free unit in what the player carries (main, then the worn bag). */
function resolve(w: ActionWorld, job: UseJob): { inventory: Inventory; item: ItemInstance } | null {
  const d = job.data
  const invs = usableInventories(w.player.inventory, w.player.equipment, w.world.bags)
  const free = (i: ItemInstance) => i.itemId === d.itemId && i.quantity - w.ledger.reserved(i.id, job.id) >= 1
  if (d.instanceId) {
    for (const inventory of invs) {
      const item = inventory.items.find((i) => i.id === d.instanceId)
      if (item && free(item)) return { inventory, item }
    }
  }
  if (!d.follow) return null
  let favorite: { inventory: Inventory; item: ItemInstance } | null = null
  for (const inventory of invs) {
    for (const item of inventory.items) {
      if (!free(item)) continue
      if (!item.favorite) return { inventory, item }
      favorite ??= { inventory, item }
    }
  }
  return favorite
}

/** The reserved instance now, where it is (it may not leave while reserved; a stack may grow). */
function find(w: ActionWorld, id: string | null): { inventory: Inventory; item: ItemInstance } | null {
  if (!id) return null
  for (const inventory of usableInventories(w.player.inventory, w.player.equipment, w.world.bags)) {
    const item = inventory.items.find((i) => i.id === id)
    if (item) return { inventory, item }
  }
  return null
}

function fail(w: ActionWorld, itemId: ItemId, reason: UseItemFailure): void {
  w.events.queue('item:useFailed', { itemId, name: getItemDef(itemId).name, reason })
  w.inventoryChanged()
}

function hasTool(w: ActionWorld, tag: NonNullable<ReturnType<typeof getItemDef>['sealed']>['requiresToolTag']): boolean {
  if (!tag) return true
  return usableInventories(w.player.inventory, w.player.equipment, w.world.bags).some((inv) => inv.items.some((i) => isUsableTool(i, tag)))
}

const view = (job: UseJob) => {
  const s = job.step
  return { id: job.id, kind: 'use' as const, label: job.label, stepProgress: s ? s.elapsed / s.duration : 0, stepRemaining: s ? Math.max(0, s.duration - s.elapsed) : 0, done: 0, total: 1 }
}

function consumeDefinition(type: 'EAT' | 'DRINK' | 'HEAL'): ActionDefinition<UseData> {
  const { state, anim } = USE_STATES[type]
  return {
    type,
    lane: 'queue',
    characterState: state,
    // D7: anything the player does or suffers stops it (the stance too), nothing is used up.
    interrupt: INTERRUPT_ALL,
    presentation: { anim, prop: { from: 'target-item', hand: type === 'HEAL' ? 'left' : 'right' }, hideWeapon: true },

    begin(job, w) {
      const def = getItemDef(job.data.itemId)
      const found = resolve(w, job)
      if (!found) {
        fail(w, job.data.itemId, 'empty')
        return null
      }
      if (!w.player.alive) {
        fail(w, job.data.itemId, 'dead')
        return null
      }
      if (!canBenefit(w.player, def.effect)) {
        fail(w, job.data.itemId, 'no-effect')
        return null
      }
      job.data.resolved = found.item.id
      w.ledger.reserve(job.id, 'use', found.item.id, 1)
      w.inventoryChanged()
      return { duration: def.consumable!.seconds, elapsed: 0 }
    },

    /** The whole effect and the unit's removal, or nothing (the item gone, or it would do nothing now). */
    commit(job, w) {
      const d = job.data
      const def = getItemDef(d.itemId)
      const found = find(w, d.resolved)
      if (!found || found.item.quantity < 1) {
        fail(w, d.itemId, 'empty')
        return { next: 'done' }
      }
      if (!canBenefit(w.player, def.effect)) {
        fail(w, d.itemId, 'no-effect')
        return { next: 'done' }
      }
      const effects: GameplayEffect[] = []
      for (const stat of ['health', 'hunger', 'thirst', 'stamina'] as const) {
        const delta = def.effect[stat]
        if (delta) effects.push({ type: 'stat', stat, delta })
      }
      effects.push({ type: 'item.consume', inventory: found.inventory, instanceId: found.item.id, quantity: 1 })
      effects.push(eventEffect('item:used', { itemId: def.id, name: def.name, effect: def.effect }))
      effects.push({ type: 'after', run: () => {
        d.done = true
        w.inventoryChanged()
      } })
      return { next: 'done', mutation: { effects } }
    },

    succeeded: (job) => job.data.done,
    propItem: (job) => job.data.itemId,
    claims: (job, instanceId) => (!job.step && job.data.instanceId === instanceId ? 1 : 0),
    view,
  }
}

export const EAT = registerAction(consumeDefinition('EAT'))
export const DRINK = registerAction(consumeDefinition('DRINK'))
export const HEAL = registerAction(consumeDefinition('HEAL'))

/** Open one unit of a sealed item: it becomes one unit of `sealed.opensTo` in the same inventory. */
export const OPEN_ITEM = registerAction<UseData>({
  type: ACTION.OPEN_ITEM,
  lane: 'queue',
  characterState: 'INTERACTING',
  interrupt: INTERRUPT_ALL,
  presentation: { anim: 'work', prop: { from: 'target-item', hand: 'left' }, hideWeapon: true },

  begin(job, w) {
    const sealed = getItemDef(job.data.itemId).sealed!
    const found = resolve(w, job)
    if (!found) {
        fail(w, job.data.itemId, 'empty')
        return null
      }
    if (!hasTool(w, sealed.requiresToolTag)) {
        fail(w, job.data.itemId, 'missing-tool')
        return null
      }
    if (!opened(found.inventory, found.item, sealed.opensTo)) {
        fail(w, job.data.itemId, 'full')
        return null
      }
    job.data.resolved = found.item.id
    w.ledger.reserve(job.id, 'use', found.item.id, 1)
    w.inventoryChanged()
    return { duration: sealed.seconds, elapsed: 0 }
  },

  /** One sealed unit out, one opened unit in, on a copy of the inventory written as one change. */
  commit(job, w) {
    const d = job.data
    const def = getItemDef(d.itemId)
    const sealed = def.sealed!
    const found = find(w, d.resolved)
    if (!found) {
        fail(w, d.itemId, 'empty')
        return { next: 'done' }
      }
    if (!hasTool(w, sealed.requiresToolTag)) {
        fail(w, d.itemId, 'missing-tool')
        return { next: 'done' }
      }
    const after = opened(found.inventory, found.item, sealed.opensTo)
    if (!after) {
        fail(w, d.itemId, 'full')
        return { next: 'done' }
      }
    const effects: GameplayEffect[] = [
      { type: 'inventory.write', inventory: found.inventory, base: inventorySignature(found.inventory), items: after.items, nextItemId: after.nextItemId },
      eventEffect('item:opened', { itemId: def.id, name: def.name, to: sealed.opensTo }),
      { type: 'after', run: () => {
        d.done = true
        w.inventoryChanged()
      } },
    ]
    return { next: 'done', mutation: { effects } }
  },

  succeeded: (job) => job.data.done,
  propItem: (job) => job.data.itemId,
  claims: (job, instanceId) => (!job.step && job.data.instanceId === instanceId ? 1 : 0),
  view,
})

/** The inventory with one unit opened (on a copy), or null when the opened item finds no room. */
function opened(inventory: Inventory, item: ItemInstance, to: ItemId): Inventory | null {
  const copy = cloneInventory(inventory)
  removeQuantity(copy, item.id, 1)
  return addItem(copy, to, 1).remainder > 0 ? null : copy
}
