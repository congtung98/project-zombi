import type { RecordCategory, XZ } from '../schema.ts'
import { quantize } from '../transform.ts'
import type { AnyRecord } from './document.ts'

/**
 * Placeable records of the world-authoring palette (M4): standalone objects, road/ground surfaces,
 * zones and spawns. A preset is a record template without ID and anchor; `drag` says how a
 * press-drag in the viewport sizes it (a plain click places the template as is).
 * Values follow the neighbourhood content (fence 1 m × 0.15 m, crate 1 m, car 4 × 1.4 × 2 m …).
 */

export type PresetCategory = Exclude<RecordCategory, 'instances'>

/**
 * - `point`: fixed size, the anchor follows the cursor;
 * - `line`: walls/fences, drag sets the length along the dominant axis, thickness stays;
 * - `rect`: drag sets the X/Z size (surfaces, rectangle zones, boxes);
 * - `radius`: circle zones, press at the centre and drag out the radius.
 */
export type DragMode = 'point' | 'line' | 'rect' | 'radius'

export interface RecordPreset {
  id: string
  category: PresetCategory
  label: string
  /** ID base: records become `<chunk>/<namespace>/<name>-<n>`. */
  name: string
  drag: DragMode
  template: AnyRecord
}

/** Box template with keys in content-file order (kind, name, position, size, color, lootTableId). */
const box = (kind: 'wall' | 'prop' | 'container', size: [number, number, number], color: string, container?: { name: string; lootTableId?: string }): AnyRecord => ({
  kind,
  ...(container ? { name: container.name } : {}),
  position: { x: 0, y: size[1] / 2, z: 0 },
  size,
  color,
  ...(container?.lootTableId ? { lootTableId: container.lootTableId } : {}),
})

export const RECORD_PRESETS: readonly RecordPreset[] = [
  { id: 'object/wall', category: 'objects', label: 'Tường', name: 'wall', drag: 'line', template: box('wall', [4, 2.6, 0.2], '#9a8f84') },
  { id: 'object/fence', category: 'objects', label: 'Hàng rào gỗ', name: 'fence', drag: 'line', template: box('prop', [4, 1, 0.15], '#7a6a55') },
  { id: 'object/crate', category: 'objects', label: 'Thùng gỗ', name: 'crate', drag: 'point', template: box('prop', [1, 1, 1], '#a67c52') },
  { id: 'object/car', category: 'objects', label: 'Xe hỏng', name: 'car', drag: 'point', template: box('prop', [4, 1.4, 2], '#7a3b3b') },
  { id: 'object/pillar', category: 'objects', label: 'Cột bê tông', name: 'pillar', drag: 'point', template: box('prop', [1.2, 2, 1.2], '#6f6a63') },
  { id: 'object/block', category: 'objects', label: 'Khối vật cản', name: 'block', drag: 'rect', template: box('prop', [2, 1, 2], '#77706a') },
  {
    id: 'object/scrap',
    category: 'objects',
    label: 'Đống phế liệu (loot)',
    name: 'scrap',
    drag: 'point',
    template: box('container', [1.4, 0.8, 1], '#6b6f73', { name: 'Đống phế liệu', lootTableId: 'scrap-pile' }),
  },
  {
    id: 'object/toolbox',
    category: 'objects',
    label: 'Thùng dụng cụ (loot)',
    name: 'toolbox',
    drag: 'point',
    template: box('container', [0.9, 0.7, 0.5], '#b0472f', { name: 'Thùng dụng cụ', lootTableId: 'park-toolbox' }),
  },
  { id: 'object/bin', category: 'objects', label: 'Thùng rỗng (container)', name: 'bin', drag: 'point', template: box('container', [0.8, 1, 0.8], '#4f6b4a', { name: 'Thùng' }) },

  { id: 'surface/asphalt', category: 'roads', label: 'Đường nhựa', name: 'road', drag: 'rect', template: { position: { x: 0, z: 0 }, size: [4, 16], color: '#3a3a3f' } },
  { id: 'surface/sidewalk', category: 'roads', label: 'Vỉa hè', name: 'sidewalk', drag: 'rect', template: { position: { x: 0, z: 0 }, size: [2, 16], color: '#8c8a84' } },
  { id: 'surface/dirt', category: 'roads', label: 'Đường đất', name: 'dirt', drag: 'rect', template: { position: { x: 0, z: 0 }, size: [3, 12], color: '#7a6246' } },
  { id: 'surface/gravel', category: 'roads', label: 'Sân sỏi', name: 'yard', drag: 'rect', template: { position: { x: 0, z: 0 }, size: [8, 8], color: '#8f8a7e' } },

  {
    id: 'zone/rect',
    category: 'zones',
    label: 'Zone zombie chữ nhật',
    name: 'zone',
    drag: 'rect',
    template: { kind: 'zombiePopulation', name: 'Zone mới', shape: 'rect', center: { x: 0, z: 0 }, size: [16, 12] },
  },
  {
    id: 'zone/circle',
    category: 'zones',
    label: 'Zone zombie tròn',
    name: 'zone',
    drag: 'radius',
    template: { kind: 'zombiePopulation', name: 'Zone mới', shape: 'circle', center: { x: 0, z: 0 }, radius: 8 },
  },

  { id: 'spawn/zombie', category: 'spawns', label: 'Spawn zombie', name: 'zombie', drag: 'point', template: { kind: 'zombie', position: { x: 0, z: 0 } } },
  { id: 'spawn/player', category: 'spawns', label: 'Spawn người chơi', name: 'player', drag: 'point', template: { kind: 'player', position: { x: 0, z: 0 } } },
]

export function findPreset(id: string): RecordPreset | undefined {
  return RECORD_PRESETS.find((p) => p.id === id)
}

/** Smallest size a drag can give (metres). */
export const MIN_DRAG_SIZE = 0.25

/**
 * World anchor and field overrides for a preset placed by a press at `from` and release at `to`
 * (both already snapped). `to` null or equal to `from` = click: the template's own size.
 */
export function presetPlacement(preset: RecordPreset, from: XZ, to: XZ | null): { at: XZ; fields: AnyRecord } {
  const dx = to ? to.x - from.x : 0
  const dz = to ? to.z - from.z : 0
  if (!to || (dx === 0 && dz === 0) || preset.drag === 'point') return { at: from, fields: {} }
  const t = preset.template
  const len = (v: number) => quantize(Math.max(MIN_DRAG_SIZE, Math.abs(v)))
  const mid = (a: number, b: number) => quantize((a + b) / 2)
  switch (preset.drag) {
    case 'radius':
      return { at: from, fields: { radius: len(Math.hypot(dx, dz)) } }
    case 'line': {
      const size = t.size as [number, number, number]
      const thickness = Math.min(size[0], size[2])
      if (Math.abs(dx) >= Math.abs(dz)) return { at: { x: mid(from.x, to.x), z: from.z }, fields: { size: [len(dx), size[1], thickness] } }
      return { at: { x: from.x, z: mid(from.z, to.z) }, fields: { size: [thickness, size[1], len(dz)] } }
    }
    case 'rect': {
      const at = { x: mid(from.x, to.x), z: mid(from.z, to.z) }
      const size = t.size as number[]
      return { at, fields: { size: size.length === 3 ? [len(dx), size[1], len(dz)] : [len(dx), len(dz)] } }
    }
  }
}
