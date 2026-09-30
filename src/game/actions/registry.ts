import type { ActionDefinition, ActionType } from './types'

/**
 * AX1: the one action registry (CAS §3, FB §3). Features register their definitions; the Action
 * System, the menus and the tests look them up by type. Registering a type twice is a programming
 * error (a silent override would change a game rule without anyone noticing).
 */
const DEFINITIONS = new Map<ActionType, ActionDefinition<never>>()

export function registerAction<Data>(def: ActionDefinition<Data>): ActionDefinition<Data> {
  const existing = DEFINITIONS.get(def.type)
  if (existing && existing !== (def as unknown)) throw new Error(`Action type registered twice: ${def.type}`)
  DEFINITIONS.set(def.type, def as unknown as ActionDefinition<never>)
  return def
}

export function getAction<Data = unknown>(type: ActionType): ActionDefinition<Data> {
  const def = DEFINITIONS.get(type)
  if (!def) throw new Error(`Unknown action type: ${type}`)
  return def as unknown as ActionDefinition<Data>
}

export function hasAction(type: ActionType): boolean {
  return DEFINITIONS.has(type)
}

export function actionTypes(): ActionType[] {
  return [...DEFINITIONS.keys()]
}
