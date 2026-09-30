import type { MapData } from '../world/mapData'
import type { WorldState } from '../world/worldState'
import type { Interactable } from '../systems/interaction'
import type { ActionFailure, ActionType } from '../actions/types'

/**
 * AX4 (FB §5, §9, docs/character-action-ax0.md §2.5): an interactive object type is a provider. It
 * builds its objects from the map (with a pick volume and a reach), and says which options an object
 * offers now from its gameplay state, the default one first. It never changes that state itself: an
 * option is a request (action type + data) that the Action System runs. The runtime and the
 * character know no object type.
 */
export type InteractableInfo = Interactable

/** What a provider may read to decide (never write). */
export interface InteractionContext {
  map: MapData
  world: WorldState
  /** The container shown in the loot window, or null. */
  openContainerId: string | null
  lootOpen: boolean
}

export interface InteractionOption {
  /** Stable option ID, e.g. `door.open`. */
  id: string
  actionType: ActionType
  label: string
  /** Left click and E run it. */
  isDefault?: boolean
  /** Null = can run; otherwise why not (shown disabled, or hidden). */
  blocked: null | { reason: ActionFailure; text: string; hidden?: boolean }
  /** The action's data (its definition's type). */
  data: unknown
}

export interface InteractableProvider {
  type: string
  build(map: MapData): InteractableInfo[]
  getActions(obj: InteractableInfo, ictx: InteractionContext): InteractionOption[]
  /**
   * Shown with the prompt: `note` after the default option ("độ bền 90/120", "mất điện"), `status`
   * alone when there is nothing to do ("Cửa đã vỡ").
   */
  getInteractionContext(obj: InteractableInfo, ictx: InteractionContext): { note: string | null; status: string | null }
}
