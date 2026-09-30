import type { EventBus, GameEvents } from '../core/events'
import type { ActionSystem } from '../actions/actionSystem'
import { getAction } from '../actions/registry'
import type { ActionContext, ActionSource } from '../actions/types'
import { interactableProvider } from './registry'
import type { InteractableInfo, InteractionContext, InteractionOption } from './types'
import './providers'

/**
 * AX4 (docs/character-action-ax0.md §5): object → options (its provider) → the chosen option as a
 * request → the Action System. Left click, E and (AX5) the context menu all go through `execute`, so
 * one rule decides what an object does whatever the input. Nothing here changes world state.
 */
export interface InteractionWorld {
  readonly actions: ActionSystem
  readonly events: EventBus<GameEvents>
  context(): InteractionContext
  version(id: string): number
}

export class InteractionSystem {
  private readonly w: InteractionWorld

  constructor(w: InteractionWorld) {
    this.w = w
  }

  /** What the object offers now, hidden ones left out; the default first when there is one. */
  options(obj: InteractableInfo): InteractionOption[] {
    const provider = interactableProvider(obj.kind)
    if (!provider) return []
    const list = provider.getActions(obj, this.w.context()).filter((o) => !o.blocked?.hidden)
    return [...list.filter((o) => o.isDefault), ...list.filter((o) => !o.isDefault)]
  }

  defaultOption(obj: InteractableInfo): InteractionOption | null {
    return this.options(obj).find((o) => o.isDefault) ?? null
  }

  /** The E / hover prompt: the default option with its note, or the object's status alone. */
  prompt(obj: InteractableInfo): string | null {
    const provider = interactableProvider(obj.kind)
    if (!provider) return null
    const info = provider.getInteractionContext(obj, this.w.context())
    const def = this.defaultOption(obj)
    if (!def) return info.status
    return info.note ? `${def.label} (${info.note})` : def.label
  }

  /**
   * Run an option: a disabled one says why; one already waiting for the same object is not queued
   * twice (repeated clicks never open-close-open); `immediate` actions run now, others are queued.
   * Returns whether the request was accepted.
   */
  execute(obj: InteractableInfo, option: InteractionOption, source: ActionSource, requestId?: string): boolean {
    if (option.blocked) {
      this.w.events.queue('interaction:failed', { label: option.label, reason: option.blocked.reason })
      return false
    }
    const pending = this.w.actions.jobs.some((j) => j.type === option.actionType && j.ctx.target.kind === 'world' && j.ctx.target.objectId === obj.id)
    if (pending) return false
    const ctx: ActionContext = {
      actorId: 'player',
      type: option.actionType,
      target: { kind: 'world', objectId: obj.id, objectType: obj.kind, version: this.w.version(obj.id) },
      source,
    }
    if (getAction(option.actionType).lane === 'immediate') return this.w.actions.perform(option.actionType, ctx, option.data, option.label, { requestId }).ok
    const r = this.w.actions.enqueue(option.actionType, ctx, option.data, option.label, { requestId })
    return r.ok && r.state !== 'not-started'
  }

  executeDefault(obj: InteractableInfo, source: ActionSource, requestId?: string): boolean {
    const option = this.defaultOption(obj)
    return option ? this.execute(obj, option, source, requestId) : false
  }
}
