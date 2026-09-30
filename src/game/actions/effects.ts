import { GAME_CONFIG } from '../core/config'
import type { EventBus, GameEvents } from '../core/events'
import type { ItemInstance } from '../entities/items'
import type { PlayerState } from '../entities/player'
import { findItem, previewTransfer, removeQuantity, transferItem, type Inventory } from '../systems/inventory'
import { clampStat } from '../systems/survival'
import type { ActionFailure } from './types'

/**
 * AX1 (docs/character-action-ax0.md §2.3, FB §2 "Gameplay Effect"): an action's gameplay change is a
 * list of effects the Action System applies as one transaction. Every effect is checked against the
 * state as it is now before anything is written; one failing check means nothing changes. Effects are
 * domain operations (a stat, units of an instance, an inventory prepared on copies), never a pose.
 */
export type GameplayEffect =
  /** Add to a player stat, clamped to 0..max. */
  | { type: 'stat'; stat: 'health' | 'hunger' | 'thirst' | 'stamina'; delta: number }
  /** Remove units of one instance (a sip, a bite, a bandage). */
  | { type: 'item.consume'; inventory: Inventory; instanceId: string; quantity: number }
  /** Move exactly `quantity` units of an instance (merging into stacks first, `transferItem` rules). */
  | { type: 'item.transfer'; from: Inventory; to: Inventory; instanceId: string; quantity: number }
  /**
   * Replace an inventory's contents with a version prepared on a copy (a recipe consumes, wears and
   * creates on copies). Refused when the inventory changed since `base` (`inventorySignature`) was read.
   */
  | { type: 'inventory.write'; inventory: Inventory; base: string; items: ItemInstance[]; nextItemId: number }
  /**
   * AX4: change a world object's gameplay state through its type's adapter (a door's state, a lamp,
   * a curtain, a container opened); render, collider, navigation, lighting and save follow it.
   */
  | { type: 'world.set'; objectType: string; objectId: string; patch: Record<string, unknown> }
  | { type: 'event'; name: keyof GameEvents; payload: GameEvents[keyof GameEvents] }
  /**
   * Bookkeeping after the change that cannot fail and holds no gameplay state of its own (the floor's
   * index, the equipment references, a job's summary). Runs only when every effect applied.
   */
  | { type: 'after'; run: () => void }

export interface Mutation {
  effects: GameplayEffect[]
}

/**
 * What an inventory holds now, as text: each instance's ID, quantity and condition/fuel, in order,
 * and the next ID. Two reads differ exactly when the contents changed (in place or replaced).
 */
export function inventorySignature(inv: Inventory): string {
  let s = `${inv.nextItemId}`
  for (const i of inv.items) s += `|${i.id}:${i.quantity}:${i.kind === 'weapon' ? i.condition : i.kind === 'tool' ? (i.fuel ?? '') : ''}${i.favorite ? '*' : ''}`
  return s
}

/** Typed event effect (the payload must match the event). */
export function eventEffect<K extends keyof GameEvents>(name: K, payload: GameEvents[K]): GameplayEffect {
  return { type: 'event', name, payload }
}

/** How `world.set` reaches one object type (the runtime registers one per type it owns). */
export interface WorldAdapter {
  exists(id: string): boolean
  apply(id: string, patch: Record<string, unknown>): void
}

export interface EffectEnv {
  player: PlayerState
  events: EventBus<GameEvents>
  limits?: typeof GAME_CONFIG.player
  worldAdapter?: (type: string) => WorldAdapter | undefined
}

export type ApplyResult = { ok: true } | { ok: false; failure: ActionFailure; index: number }

const STAT_MAX = { health: 'maxHealth', hunger: 'maxHunger', thirst: 'maxThirst', stamina: 'maxStamina' } as const

/**
 * Check every effect against the state now, and only then apply them all in order. Units taken from
 * the same instance by two effects of one mutation are counted together, so the checks can never
 * pass one by one and fail together.
 */
export function applyMutation(m: Mutation, env: EffectEnv): ApplyResult {
  const taken = new Map<string, number>()
  for (let i = 0; i < m.effects.length; i++) {
    const e = m.effects[i]
    const failure = e.type === 'world.set' ? (env.worldAdapter?.(e.objectType)?.exists(e.objectId) ? null : 'TARGET_GONE') : check(e, taken)
    if (failure) return { ok: false, failure, index: i }
  }
  const limits = env.limits ?? GAME_CONFIG.player
  for (const e of m.effects) {
    switch (e.type) {
      case 'stat':
        env.player[e.stat] = clampStat(env.player[e.stat] + e.delta, limits[STAT_MAX[e.stat]])
        break
      case 'item.consume':
        removeQuantity(e.inventory, e.instanceId, e.quantity)
        break
      case 'item.transfer':
        transferItem(e.from, e.instanceId, e.to, e.quantity)
        break
      case 'inventory.write':
        e.inventory.items = e.items
        e.inventory.nextItemId = e.nextItemId
        break
      case 'world.set':
        env.worldAdapter!(e.objectType)!.apply(e.objectId, e.patch)
        break
      case 'event':
        env.events.queue(e.name, e.payload as never)
        break
      case 'after':
        e.run()
        break
    }
  }
  return { ok: true }
}

function check(e: GameplayEffect, taken: Map<string, number>): ActionFailure | null {
  const take = (inv: Inventory, instanceId: string, quantity: number): ActionFailure | null => {
    const item = findItem(inv, instanceId)
    const key = `${inv.id}|${instanceId}`
    const already = taken.get(key) ?? 0
    if (!item || !Number.isFinite(quantity) || quantity <= 0 || item.quantity - already < quantity) return 'MISSING_ITEM'
    taken.set(key, already + quantity)
    return null
  }
  switch (e.type) {
    case 'item.consume':
      return take(e.inventory, e.instanceId, e.quantity)
    case 'item.transfer': {
      const missing = take(e.from, e.instanceId, e.quantity)
      if (missing) return missing
      return previewTransfer(e.from, e.instanceId, e.to, e.quantity).quantity === e.quantity ? null : 'TARGET_CHANGED'
    }
    case 'inventory.write':
      return inventorySignature(e.inventory) === e.base ? null : 'TARGET_CHANGED'
    default:
      return null
  }
}
