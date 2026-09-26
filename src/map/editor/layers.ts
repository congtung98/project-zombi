import type { ResolvedRecord } from '../resolve.ts'

/**
 * Editor layers (M4): session state that hides records or locks them against picking. Never part
 * of the document or an export, and never a gameplay switch (a hidden record still exists in the
 * game). The ground is one world-level plane, so there is no terrain layer (docs/map-editor-m4.md).
 */

export const LAYERS = [
  { id: 'buildings', label: 'Công trình' },
  { id: 'props', label: 'Tường / vật cản' },
  { id: 'vegetation', label: 'Cây' },
  { id: 'containers', label: 'Container' },
  { id: 'surfaces', label: 'Nền / đường' },
  { id: 'zones', label: 'Zone' },
  { id: 'zombies', label: 'Spawn zombie' },
  { id: 'players', label: 'Spawn người chơi' },
] as const

export type LayerId = (typeof LAYERS)[number]['id']

export interface LayerState {
  hidden: boolean
  locked: boolean
}

export type LayerStates = Record<LayerId, LayerState>

export function defaultLayers(): LayerStates {
  return Object.fromEntries(LAYERS.map((l) => [l.id, { hidden: false, locked: false }])) as LayerStates
}

export function layerOf(r: ResolvedRecord): LayerId {
  switch (r.category) {
    case 'instances':
      return 'buildings'
    case 'objects':
      return r.parts.containers?.length ? 'containers' : r.parts.trees?.length ? 'vegetation' : 'props'
    case 'roads':
      return 'surfaces'
    case 'zones':
      return 'zones'
    case 'spawns':
      return r.parts.playerSpawns?.length ? 'players' : 'zombies'
  }
}

export function isHidden(r: ResolvedRecord, layers: LayerStates): boolean {
  return layers[layerOf(r)].hidden
}

/** Pickable, selectable and movable: visible and not locked. */
export function isEditable(r: ResolvedRecord, layers: LayerStates): boolean {
  const s = layers[layerOf(r)]
  return !s.hidden && !s.locked
}
