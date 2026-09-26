import type { BuildingProps, XZ } from '../schema.ts'
import { quantize } from '../transform.ts'
import { MIN_DRAG_SIZE, TREE_TEMPLATES, type DragMode } from './presets.ts'
import type { AnyRecord } from './document.ts'

/**
 * Palette of the prefab editor (M5): what can be put inside a prefab, in the prefab's own frame.
 * Walls are drawn as wall runs (openings cut automatically); doors and windows snap onto the
 * nearest wall run; rooms are dragged rectangles (optionally with a lamp and its wall switch).
 * Sizes follow the neighbourhood buildings.
 */

export type PrefabPresetGroup = 'structure' | 'openings' | 'furniture' | 'containers' | 'rooms'

export interface PrefabPreset {
  id: string
  group: PrefabPresetGroup
  label: string
  /** Local ID base: `<name>-<n>`. */
  name: string
  drag: DragMode
  /** Object template without `localId` (rooms: room template), keys in content-file order. */
  template: AnyRecord
}

/** Wall/door defaults of a prefab without building properties. */
export const DEFAULT_BUILDING: BuildingProps = { height: 3, wallThickness: 0.3, wallColor: '#c4a484', roofColor: '#7a3f2f', floorColor: '#8a7560' }

const box = (kind: 'prop' | 'container', size: [number, number, number], color: string, container?: { name: string; lootTableId?: string }): AnyRecord => ({
  kind,
  ...(container ? { name: container.name } : {}),
  position: { x: 0, y: size[1] / 2, z: 0 },
  size,
  color,
  ...(container?.lootTableId ? { lootTableId: container.lootTableId } : {}),
})

const lamp = { name: 'Đèn', intensity: 0.8, color: '#ffd9a0', requiresElectricity: true }

export const PREFAB_PRESETS: readonly PrefabPreset[] = [
  { id: 'structure/wall-run', group: 'structure', label: 'Tường (kéo theo trục)', name: 'wall', drag: 'line', template: { kind: 'wallRun' } },
  { id: 'structure/block', group: 'structure', label: 'Khối tường / cột', name: 'block', drag: 'rect', template: { ...box('prop', [0.6, 3, 0.6], '#c4a484'), kind: 'wall' } },
  // M11c-2: dragged from the foot towards the top; climbs from the active storey to the next one.
  { id: 'structure/stairs', group: 'structure', label: 'Cầu thang (kéo từ chân lên đỉnh)', name: 'stairs', drag: 'line', template: { kind: 'stairs', width: 1.2 } },

  { id: 'opening/door', group: 'openings', label: 'Cửa đi 1,2 m', name: 'door', drag: 'point', template: { kind: 'door', name: 'Cửa', position: { x: 0, z: 0 }, quarterTurns: 0, width: 1.2, openTowards: 1 } },
  { id: 'opening/door-wide', group: 'openings', label: 'Cửa đi 1,4 m', name: 'door', drag: 'point', template: { kind: 'door', name: 'Cửa', position: { x: 0, z: 0 }, quarterTurns: 0, width: 1.4, openTowards: 1 } },
  {
    id: 'opening/window',
    group: 'openings',
    label: 'Cửa sổ 1,2 m',
    name: 'win',
    drag: 'point',
    template: { kind: 'window', name: 'Cửa sổ', position: { x: 0, z: 0 }, quarterTurns: 0, width: 1.2, sill: 0.9, head: 2.1, thickness: 0.3 },
  },

  { id: 'furniture/bed', group: 'furniture', label: 'Giường', name: 'bed', drag: 'point', template: box('prop', [2, 0.6, 1.6], '#8c4a5a') },
  { id: 'furniture/table', group: 'furniture', label: 'Bàn', name: 'table', drag: 'point', template: box('prop', [1.4, 0.8, 0.9], '#7b5a44') },
  { id: 'furniture/sofa', group: 'furniture', label: 'Ghế sofa', name: 'sofa', drag: 'point', template: box('prop', [2, 0.8, 0.9], '#5a6b7b') },
  { id: 'furniture/counter', group: 'furniture', label: 'Quầy', name: 'counter', drag: 'line', template: box('prop', [2, 1, 0.6], '#9a8f84') },
  { id: 'furniture/tree', group: 'furniture', label: 'Cây (vườn)', name: 'tree', drag: 'point', template: { ...TREE_TEMPLATES.round, height: 5, canopy: 2 } },
  { id: 'furniture/block', group: 'furniture', label: 'Khối nội thất', name: 'furniture', drag: 'rect', template: box('prop', [1, 0.8, 1], '#77706a') },

  { id: 'container/kitchen', group: 'containers', label: 'Tủ bếp', name: 'kitchen', drag: 'point', template: box('container', [1.4, 1, 0.6], '#9c7a5a', { name: 'Tủ bếp', lootTableId: 'house-kitchen' }) },
  { id: 'container/wardrobe', group: 'containers', label: 'Tủ quần áo', name: 'wardrobe', drag: 'point', template: box('container', [1.6, 2, 0.6], '#6d4c35', { name: 'Tủ quần áo', lootTableId: 'house-wardrobe' }) },
  { id: 'container/nightstand', group: 'containers', label: 'Tủ đầu giường', name: 'nightstand', drag: 'point', template: box('container', [0.5, 0.7, 0.5], '#7b5a44', { name: 'Tủ đầu giường', lootTableId: 'house-nightstand' }) },
  { id: 'container/shelf', group: 'containers', label: 'Kệ hàng', name: 'shelf', drag: 'point', template: box('container', [2, 1.6, 0.6], '#8a8580', { name: 'Kệ hàng', lootTableId: 'store-shelf' }) },
  { id: 'container/fridge', group: 'containers', label: 'Tủ lạnh', name: 'fridge', drag: 'point', template: box('container', [0.8, 1.8, 0.8], '#d8dde0', { name: 'Tủ lạnh', lootTableId: 'store-fridge' }) },
  { id: 'container/empty', group: 'containers', label: 'Tủ trống (không loot)', name: 'cabinet', drag: 'point', template: box('container', [1, 1, 0.6], '#6b5a3a', { name: 'Tủ' }) },

  { id: 'room/lamp', group: 'rooms', label: 'Phòng có đèn (kéo khung)', name: 'room', drag: 'rect', template: { name: 'Phòng', lamp } },
  { id: 'room/plain', group: 'rooms', label: 'Phòng không đèn (kéo khung)', name: 'room', drag: 'rect', template: { name: 'Phòng' } },
]

export function findPrefabPreset(id: string): PrefabPreset | undefined {
  return PREFAB_PRESETS.find((p) => p.id === id)
}

/** Default room size for a click (no drag), metres. */
export const DEFAULT_ROOM = 4

/** Snap a drag onto its dominant axis (wall runs): the end point with the minor offset dropped. */
export function axisEnd(from: XZ, to: XZ): XZ {
  return Math.abs(to.x - from.x) >= Math.abs(to.z - from.z) ? { x: to.x, z: from.z } : { x: from.x, z: to.z }
}

/** Rectangle spanned by a drag (a click: `size` around the point). */
export function dragRect(from: XZ, to: XZ | null, size: number): { minX: number; minZ: number; maxX: number; maxZ: number } {
  if (!to || (Math.abs(to.x - from.x) < MIN_DRAG_SIZE && Math.abs(to.z - from.z) < MIN_DRAG_SIZE)) {
    return { minX: quantize(from.x - size / 2), minZ: quantize(from.z - size / 2), maxX: quantize(from.x + size / 2), maxZ: quantize(from.z + size / 2) }
  }
  const w = Math.max(MIN_DRAG_SIZE, Math.abs(to.x - from.x))
  const d = Math.max(MIN_DRAG_SIZE, Math.abs(to.z - from.z))
  const minX = Math.min(from.x, to.x)
  const minZ = Math.min(from.z, to.z)
  return { minX: quantize(minX), minZ: quantize(minZ), maxX: quantize(minX + w), maxZ: quantize(minZ + d) }
}
