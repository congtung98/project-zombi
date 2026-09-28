import type { ItemInstance } from '../entities/items'
import type { Vec3 } from '../../types'
import { createInventory, type Inventory } from './inventory'

/**
 * INV-LOOT Floor (save v11): items on the ground, organised in 1 m cells per storey but each item keeps
 * its real position, so reach and walls are checked for the item itself (two items of one cell are
 * not both reachable just because one is). A cell is an ordinary inventory of kind `floor` with no
 * slot limit; it exists only while it holds something. Items never merge on the floor: every drop is
 * its own pile where it fell.
 */
export const FLOOR_CELL_SIZE = 1

export interface FloorCell {
  id: string
  /** Feet height of the storey the items lie on. */
  y: number
  items: Inventory
  /** Real position of every item of the cell, by instance ID. */
  positions: Map<string, Vec3>
}

/** As a save stores a cell (plain data). */
export interface SavedFloorCell {
  id: string
  y: number
  items: Inventory
  positions: { id: string; position: Vec3 }[]
}

/** Storey key: feet heights are exact storey levels (0, 2.9, …), rounded to the centimetre. */
export function floorCellId(position: Vec3): string {
  const cx = Math.floor(position.x / FLOOR_CELL_SIZE)
  const cz = Math.floor(position.z / FLOOR_CELL_SIZE)
  return `floor:${Math.round(position.y * 100)}:${cx}:${cz}`
}

export class FloorStore {
  readonly cells = new Map<string, FloorCell>()
  /** Instance → cell, kept with every change (never a second copy of an item). */
  private readonly where = new Map<string, string>()

  /** The cell at `position`, created when missing. */
  cellAt(position: Vec3): FloorCell {
    const id = floorCellId(position)
    let cell = this.cells.get(id)
    if (!cell) {
      cell = { id, y: position.y, items: createInventory(null, id, 'floor'), positions: new Map() }
      this.cells.set(id, cell)
    }
    return cell
  }

  /** Cell and position of an item on the ground, or null. */
  find(instanceId: string): { cell: FloorCell; item: ItemInstance; position: Vec3 } | null {
    const cellId = this.where.get(instanceId)
    const cell = cellId ? this.cells.get(cellId) : undefined
    const item = cell?.items.items.find((i) => i.id === instanceId)
    const position = cell?.positions.get(instanceId)
    return cell && item && position ? { cell, item, position } : null
  }

  /**
   * After items moved in or out of `cell` (by `transferItem`): new items get `dropAt` as their
   * position, gone items lose theirs, an empty cell is removed.
   */
  sync(cell: FloorCell, dropAt?: Vec3): void {
    const present = new Set(cell.items.items.map((i) => i.id))
    for (const id of [...cell.positions.keys()]) {
      if (present.has(id)) continue
      cell.positions.delete(id)
      if (this.where.get(id) === cell.id) this.where.delete(id)
    }
    for (const item of cell.items.items) {
      if (!cell.positions.has(item.id)) {
        if (!dropAt) throw new Error(`floor item without a position: ${item.id}`)
        cell.positions.set(item.id, { ...dropAt })
      }
      this.where.set(item.id, cell.id)
    }
    if (cell.items.items.length === 0) this.cells.delete(cell.id)
  }

  /** Every item with its position (render projection, nearby queries). */
  entries(): { cell: FloorCell; item: ItemInstance; position: Vec3 }[] {
    const out: { cell: FloorCell; item: ItemInstance; position: Vec3 }[] = []
    for (const cell of this.cells.values()) for (const item of cell.items.items) out.push({ cell, item, position: cell.positions.get(item.id)! })
    return out
  }

  /** Items within `radius` (horizontal) of `center` on the storey at `y`; cells outside are skipped. */
  near(center: Vec3, radius: number, y: number): { cell: FloorCell; item: ItemInstance; position: Vec3 }[] {
    const out: { cell: FloorCell; item: ItemInstance; position: Vec3 }[] = []
    const r = Math.ceil(radius / FLOOR_CELL_SIZE)
    const cx = Math.floor(center.x / FLOOR_CELL_SIZE)
    const cz = Math.floor(center.z / FLOOR_CELL_SIZE)
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const cell = this.cells.get(`floor:${Math.round(y * 100)}:${cx + dx}:${cz + dz}`)
        if (!cell) continue
        for (const item of cell.items.items) {
          const p = cell.positions.get(item.id)!
          if (Math.hypot(p.x - center.x, p.z - center.z) <= radius) out.push({ cell, item, position: p })
        }
      }
    }
    return out
  }

  serialize(): SavedFloorCell[] {
    return [...this.cells.values()].map((c) => ({
      id: c.id,
      y: c.y,
      items: { ...c.items, items: c.items.items.map((i) => ({ ...i })) },
      positions: c.items.items.map((i) => ({ id: i.id, position: { ...c.positions.get(i.id)! } })),
    }))
  }

  static restore(saved: readonly SavedFloorCell[]): FloorStore {
    const store = new FloorStore()
    for (const s of saved) {
      const cell: FloorCell = { id: s.id, y: s.y, items: { ...s.items, items: s.items.items.map((i) => ({ ...i })) }, positions: new Map(s.positions.map((p) => [p.id, { ...p.position }])) }
      store.cells.set(cell.id, cell)
      store.sync(cell)
    }
    return store
  }
}
