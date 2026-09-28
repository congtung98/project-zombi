import { describe, expect, it } from 'vitest'
import { runtime as singleton, GameRuntime } from './runtime'
import { addItem, totalQuantity } from '../systems/inventory'
import { containerKey } from '../systems/inventoryCommands'
import { equippedWeapon } from '../systems/equipment'
import { buildRows, DEFAULT_QUERY } from '../../components/inventory/rows'
import { takeAll } from '../../components/inventory/commands'

/**
 * INV-LOOT S6: the rows of the test matrix (spec §14) that had no test of their own: T12, T27, T29
 * and T30. The others are listed with their tests in docs/inventory-loot-handbook.md §6.
 */
const CABINET = 'c-1_-1/safehouse/cabinet'
const DT = 1 / 60

function atCabinet(rt: GameRuntime = new GameRuntime()) {
  rt.newGame(4242)
  for (const z of [...rt.zombies.values()]) rt.zombies.delete(z.id)
  rt.setLineOfSightOverride({ isBlocked: () => false })
  const cabinet = rt.interactables.find((i) => i.id === CABINET)!
  rt.player.position = { x: cabinet.position.x + 0.5, y: 0, z: cabinet.position.z }
  rt.interact(cabinet)
  const summaries: { moved: number; skipped: string[] }[] = []
  rt.events.on('inventory:transferred', (e) => summaries.push({ moved: e.moved, skipped: e.skipped }))
  return { rt, box: containerKey(CABINET), summaries }
}

const run = (rt: GameRuntime, seconds: number) => {
  for (let t = 0; t < seconds; t += DT) rt.tick(DT)
}

describe('INV-LOOT test matrix, rows without a test of their own', () => {
  it('T12: an equipped weapon never leaves by transfer or drop; unequipped it goes and nothing still references it', () => {
    const { rt, box } = atCabinet()
    addItem(rt.player.inventory, 'crowbar', 1, { condition: 90 })
    const bar = rt.player.inventory.items.find((i) => i.itemId === 'crowbar')!
    expect(rt.equipItem(bar.id)).toBe(true)
    expect(rt.transferItems('main', box, [{ instanceId: bar.id }]).skipped[0].reason).toBe('equipped')
    expect(rt.transferItems('main', 'floor', [{ instanceId: bar.id }]).skipped[0].reason).toBe('equipped')
    expect(rt.queueTransfer('main', box, [{ instanceId: bar.id }]).refused[0].reason).toBe('equipped')
    expect(equippedWeapon(rt.player.inventory, rt.player.equipment)?.id).toBe(bar.id)
    // Unequip, then it moves; the equipment reference and the combat weapon are gone with it.
    expect(rt.equipItem(null)).toBe(true)
    expect(rt.queueTransfer('main', box, [{ instanceId: bar.id }]).id).not.toBeNull()
    run(rt, 3)
    expect(rt.jobs).toHaveLength(0)
    expect(rt.world.containers.get(CABINET)!.items.items.some((i) => i.id === bar.id)).toBe(true)
    expect(rt.player.equipment.weaponInstanceId).toBeNull()
    expect(equippedWeapon(rt.player.inventory, rt.player.equipment)).toBeNull()
  })

  it('T27: a batch Store/Drop skips favorites and the equipped weapon and reports them in one summary', () => {
    const { rt, box, summaries } = atCabinet()
    rt.world.containers.get(CABINET)!.items.items = []
    addItem(rt.player.inventory, 'baseball_bat', 1)
    addItem(rt.player.inventory, 'water', 2)
    addItem(rt.player.inventory, 'chips', 3)
    addItem(rt.player.inventory, 'bandage', 1)
    const [bat, water, chips, bandage] = ['baseball_bat', 'water', 'chips', 'bandage'].map((id) => rt.player.inventory.items.find((i) => i.itemId === id)!)
    expect(rt.equipItem(bat.id)).toBe(true)
    expect(rt.setFavorite(water.id, true)).toBe(true)
    const all = [bat, water, chips, bandage].map((i) => ({ instanceId: i.id }))
    // Store: the two protected lines are refused when queued (one summary), the others go.
    const stored = rt.queueTransfer('main', box, all)
    expect(stored.refused.map((r) => r.reason).sort()).toEqual(['equipped', 'favorite'])
    run(rt, 5)
    rt.events.flush()
    expect(summaries).toHaveLength(1)
    expect(summaries[0].skipped.sort()).toEqual(['equipped', 'favorite'])
    expect(rt.player.inventory.items.map((i) => i.itemId).sort()).toEqual(['baseball_bat', 'water'])
    // Drop: same rule.
    const dropped = rt.transferItems('main', 'floor', [{ instanceId: bat.id }, { instanceId: water.id }])
    expect(dropped.moved).toBe(0)
    expect(dropped.skipped.map((s) => s.reason)).toEqual(['equipped', 'favorite'])
  })

  it('T29: the player dying cancels the queue, frees every reservation and closes the windows; committed steps stay', () => {
    for (const cause of ['hit', 'starvation'] as const) {
      const { rt, box } = atCabinet()
      const inBox = () => totalQuantity(rt.world.containers.get(CABINET)!.items)
      const total = inBox() + totalQuantity(rt.player.inventory)
      expect(rt.queueTransfer(box, 'main', rt.openContainer!.items.items.map((i) => ({ instanceId: i.id }))).id).not.toBeNull()
      run(rt, 0.4)
      const moved = totalQuantity(rt.player.inventory)
      expect(rt.ledger.isEmpty()).toBe(false)
      // A zombie's blow goes through the runtime's own damage path (the one the AI calls).
      if (cause === 'hit') (rt as unknown as { applyPlayerDamage(amount: number, sourceId: string): void }).applyPlayerDamage(1000, 'zombie-1')
      else {
        rt.player.health = 0.01
        rt.player.hunger = 0
        rt.player.thirst = 0
      }
      run(rt, 0.5)
      expect(rt.player.alive).toBe(false)
      expect(rt.jobs).toEqual([])
      expect(rt.ledger.isEmpty()).toBe(true)
      expect([rt.inventoryOpen, rt.lootOpen, rt.openContainerId]).toEqual([false, false, null])
      expect(totalQuantity(rt.player.inventory)).toBeGreaterThanOrEqual(moved)
      expect(inBox() + totalQuantity(rt.player.inventory)).toBe(total)
    }
  })

  it('T30: Take All with a filter showing a few rows takes the whole container, within the capacity', () => {
    const { rt } = atCabinet(singleton)
    const items = rt.world.containers.get(CABINET)!.items
    items.items = []
    for (const [id, q] of [['water', 2], ['chips', 3], ['bandage', 2], ['wood_plank', 1]] as const) addItem(items, id, q)
    const visible = buildRows(items.items, { ...DEFAULT_QUERY, category: 'drink' }, (i) => i.quantity)
    expect(visible).toHaveLength(1)
    takeAll(containerKey(CABINET), 'main')
    expect(rt.jobs).toHaveLength(1)
    const job = rt.jobs[0]
    expect(job.kind === 'transfer' && job.lines.map((l) => l.itemId).sort()).toEqual(['bandage', 'chips', 'water', 'wood_plank'])
    run(rt, 6)
    expect(items.items).toHaveLength(0)
    expect(totalQuantity(rt.player.inventory)).toBe(8)
  })
})
