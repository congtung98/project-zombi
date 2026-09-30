import type { MapData } from '../world/mapData'
import type { InteractableInfo, InteractableProvider } from './types'

/**
 * AX4: the one registry of interactive object types (WIS §9.3). A new object type (a generator, a
 * workbench) registers a provider; a type registered twice is a programming error.
 */
const PROVIDERS = new Map<string, InteractableProvider>()

export function registerInteractable(provider: InteractableProvider): InteractableProvider {
  const existing = PROVIDERS.get(provider.type)
  if (existing && existing !== provider) throw new Error(`Interactable type registered twice: ${provider.type}`)
  PROVIDERS.set(provider.type, provider)
  return provider
}

export function interactableProvider(type: string): InteractableProvider | undefined {
  return PROVIDERS.get(type)
}

/** Every interactive object of the map, provider by provider in registration order. */
export function buildInteractables(map: MapData): InteractableInfo[] {
  return [...PROVIDERS.values()].flatMap((p) => p.build(map))
}
