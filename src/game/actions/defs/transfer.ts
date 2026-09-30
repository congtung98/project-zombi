import { getItemDef, type ItemInstance } from '../../entities/items'
import { transferStep, type TransferLineState, type TransferStepState } from '../../systems/actionQueue'
import { accepts, findItem, previewTransfer, type Inventory } from '../../systems/inventory'
import { isCarried, itemRefusal, type InventoryKey, type TransferLine, type TransferRefusal, type TransferSkip, type TransferSummary } from '../../systems/inventoryCommands'
import type { FloorCell } from '../../systems/floor'
import type { Vec3 } from '../../../types'
import { INTERRUPT_ALL } from '../characterState'
import type { GameplayEffect } from '../effects'
import { registerAction } from '../registry'
import { ACTION, type ActionDefinition, type ActionJob } from '../types'
import type { ActionWorld } from '../world'

/**
 * TRANSFER (INV-LOOT §8, S4; AX1 moved it from the runtime into a definition, rules unchanged):
 * instances move between inventories in timed steps. Each line gets a fixed number of units when
 * queued; each step checks again and reserves when it starts, and checks again when it commits.
 */
export interface TransferData {
  source: InventoryKey
  destination: InventoryKey
  lines: TransferLineState[]
  /** Line being worked on. */
  index: number
  /** Units queued in total (progress of the whole job). */
  total: number
  summary: TransferSummary
  /** A drop lands where the player stood when it was queued (moving cancels the job anyway). */
  dropAt: Vec3 | null
}

export type TransferJob = ActionJob<TransferData>

/** The job's transfer data, or null when it is another action. */
export function transferData(job: ActionJob): TransferData | null {
  return job.type === ACTION.TRANSFER ? (job as TransferJob).data : null
}

/** Instances still waiting to move in queued transfers (the UI's "Chờ chuyển" badge). */
export function pendingTransferIds(jobs: readonly ActionJob[]): string[] {
  const ids = new Set<string>()
  for (const job of jobs) {
    const d = transferData(job)
    if (!d) continue
    for (let i = d.index; i < d.lines.length; i++) if (d.lines[i].left > 0) ids.add(d.lines[i].instanceId)
  }
  return [...ids]
}

export interface PreparedTransfer {
  accepted: TransferLineState[]
  refused: TransferSkip[]
  label: string
}

/**
 * Request time: check every line now (reach, equipped, favorite, what the running job holds and what
 * earlier queued lines already claim, so a spammed double click never queues more than there is) and
 * fix its number of units. Writes nothing.
 */
export function prepareTransfer(w: ActionWorld, source: InventoryKey, destination: InventoryKey, lines: readonly TransferLine[], busy: boolean): PreparedTransfer {
  const refused: TransferSkip[] = []
  const accepted: TransferLineState[] = []
  const refuse = (instanceId: string, itemId: TransferSkip['itemId'], reason: TransferRefusal) => refused.push({ instanceId, itemId, reason })
  const from = source === 'floor' ? null : w.inventoryFor(source)
  const to = destination === 'floor' ? null : w.inventoryFor(destination)
  const claimed = new Map<string, number>()
  for (const line of lines) {
    const onFloor = source === 'floor' ? w.world.floor.find(line.instanceId) : null
    const inv = source === 'floor' ? (onFloor && w.canReachFloor(onFloor.position) ? onFloor.cell.items : null) : from
    const item = inv ? findItem(inv, line.instanceId) : undefined
    const itemId = item?.itemId ?? null
    if (!w.player.alive) refuse(line.instanceId, itemId, 'dead')
    else if (busy) refuse(line.instanceId, itemId, 'busy')
    else if (!inv || (destination !== 'floor' && !to)) refuse(line.instanceId, itemId, 'unreachable')
    else if (source === destination) refuse(line.instanceId, itemId, 'same-inventory')
    else if (!item) refuse(line.instanceId, null, 'missing')
    else if (to && !accepts(to, item.itemId)) refuse(item.id, item.itemId, 'bag-in-bag')
    else {
      const leaving = isCarried(source) && !isCarried(destination)
      const refusal = itemRefusal(item, w.player.equipment, leaving, w.bagHeld(item.id))
      const queued = w.claimed(item.id) + (claimed.get(item.id) ?? 0)
      const free = item.quantity - w.ledger.reserved(item.id) - queued
      const want = line.quantity === undefined ? item.quantity : Math.floor(line.quantity)
      if (refusal) refuse(item.id, item.itemId, refusal)
      else if (!Number.isFinite(want) || want <= 0) refuse(item.id, item.itemId, 'invalid-quantity')
      else if (free <= 0) refuse(item.id, item.itemId, queued > 0 ? 'queued' : 'reserved')
      else {
        const units = Math.min(want, free)
        claimed.set(item.id, (claimed.get(item.id) ?? 0) + units)
        accepted.push({ instanceId: item.id, itemId: item.itemId, left: units, queued: units })
      }
    }
  }
  const verb = destination === 'floor' ? 'Bỏ xuống' : !isCarried(source) && isCarried(destination) ? 'Lấy' : isCarried(source) && !isCarried(destination) ? 'Cất' : 'Chuyển'
  const label = accepted.length > 0 ? `${verb} ${getItemDef(accepted[0].itemId).name}${accepted.length > 1 ? ` +${accepted.length - 1}` : ''}` : verb
  return { accepted, refused, label }
}

/** Source, destination and item of a line now (reach checked at the item for the floor), or why not. */
function resolveLine(w: ActionWorld, job: TransferJob, line: TransferLineState): { from: Inventory; to: Inventory | null; item: ItemInstance; cell: FloorCell | null } | { reason: TransferRefusal } {
  const d = job.data
  const onFloor = d.source === 'floor' ? w.world.floor.find(line.instanceId) : null
  const from = d.source === 'floor' ? (onFloor && w.canReachFloor(onFloor.position) ? onFloor.cell.items : null) : w.inventoryFor(d.source)
  const to = d.destination === 'floor' ? null : w.inventoryFor(d.destination)
  if (!from || (d.destination !== 'floor' && !to)) return { reason: onFloor || d.source !== 'floor' ? 'unreachable' : 'missing' }
  const item = findItem(from, line.instanceId)
  if (!item) return { reason: 'missing' }
  const leaving = isCarried(d.source) && !isCarried(d.destination)
  const refusal = itemRefusal(item, w.player.equipment, leaving, w.ledger.reserved(item.id, job.id) >= item.quantity || w.bagHeld(item.id))
  if (refusal) return { reason: refusal }
  return { from, to, item, cell: onFloor?.cell ?? null }
}

/** One summary per transfer job (what moved, and why the rest did not). */
function report(w: ActionWorld, job: TransferJob): void {
  const d = job.data
  d.summary.movedLines = d.lines.filter((l) => l.left < l.queued).length
  w.events.queue('inventory:transferred', { source: d.source, destination: d.destination, moved: d.summary.moved, movedLines: d.summary.movedLines, skipped: d.summary.skipped.map((x) => x.reason) })
}

export const TRANSFER: ActionDefinition<TransferData> = registerAction<TransferData>({
  type: ACTION.TRANSFER,
  lane: 'queue',
  characterState: 'LOOTING',
  // Moving, a blow or a swing stop it; the combat stance does not (INV-LOOT S5: the stance may be
  // taken over open windows while items keep moving).
  interrupt: { ...INTERRUPT_ALL, stance: 'allow' },
  presentation: { anim: 'work' },

  /** The next step (Pending → Running: validate and reserve), skipping lines that cannot move. */
  begin(job, w) {
    const d = job.data
    while (d.index < d.lines.length) {
      const line = d.lines[d.index]
      const res = resolveLine(w, job, line)
      if ('reason' in res) {
        d.summary.skipped.push({ instanceId: line.instanceId, itemId: line.itemId, reason: res.reason })
        d.index += 1
        continue
      }
      const { units: batch, seconds } = transferStep(res.item, w.world.bags)
      const units = Math.min(line.left, batch, res.item.quantity - w.ledger.reserved(res.item.id, job.id))
      // Room is checked when the step starts, never kept: a full destination skips this item and the
      // others still move (merges into stacks with room included), nothing waits forever.
      const preview = res.to ? previewTransfer(res.from, res.item.id, res.to, units) : { quantity: units, reason: null }
      if (units <= 0 || preview.quantity <= 0) {
        d.summary.skipped.push({ instanceId: line.instanceId, itemId: line.itemId, reason: units <= 0 ? 'reserved' : (preview.reason ?? 'full') })
        d.index += 1
        continue
      }
      const step: TransferStepState = { instanceId: res.item.id, units: preview.quantity, duration: seconds, elapsed: 0 }
      w.ledger.reserve(job.id, 'transfer', res.item.id, preview.quantity)
      return step
    }
    return null
  },

  /** Running → Committed: check everything again and move the step's units as one change. */
  commit(job, w, s) {
    const step = s as TransferStepState
    const d = job.data
    const line = d.lines[d.index]
    const res = resolveLine(w, job, line)
    if ('reason' in res) {
      d.summary.skipped.push({ instanceId: line.instanceId, itemId: line.itemId, reason: res.reason })
      d.index += 1
      return { next: 'step' }
    }
    const dropCell = d.destination === 'floor' ? w.world.floor.cellAt(d.dropAt!) : null
    const to = dropCell ? dropCell.items : res.to!
    const preview = previewTransfer(res.from, res.item.id, to, step.units)
    const moved = preview.quantity
    const effects: GameplayEffect[] = []
    if (moved > 0) effects.push({ type: 'item.transfer', from: res.from, to, instanceId: res.item.id, quantity: moved })
    effects.push({
      type: 'after',
      run: () => {
        if (res.cell) w.world.floor.sync(res.cell)
        if (dropCell) w.world.floor.sync(dropCell, d.dropAt!)
        if (moved > 0) {
          d.summary.moved += moved
          line.left -= moved
          if (res.cell || dropCell) w.floorChanged()
          w.inventoryChanged()
        }
        if (moved < step.units) {
          d.summary.skipped.push({ instanceId: line.instanceId, itemId: line.itemId, reason: preview.reason ?? 'full' })
          d.index += 1
        } else if (line.left <= 0 || !findItem(res.from, line.instanceId)) d.index += 1
      },
    })
    return { next: 'step', mutation: { effects } }
  },

  ended(job, w) {
    w.ledger.release(job.id)
    report(w, job)
    w.inventoryChanged()
  },

  cancelled(job, w) {
    if (job.data.summary.moved > 0) report(w, job)
  },

  claims(job, instanceId) {
    const d = job.data
    let n = 0
    for (let i = d.index; i < d.lines.length; i++) if (d.lines[i].instanceId === instanceId) n += d.lines[i].left
    return n
  },

  view(job) {
    const s = job.step
    const d = job.data
    return { id: job.id, kind: 'transfer', label: job.label, stepProgress: s ? s.elapsed / s.duration : 0, stepRemaining: s ? Math.max(0, s.duration - s.elapsed) : 0, done: d.summary.moved, total: d.total }
  },
})
