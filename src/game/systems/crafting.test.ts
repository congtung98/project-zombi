import { describe, expect, it } from 'vitest'
import { ITEMS, type ItemId } from '../entities/items'
import { RECIPES, repairRecipeFor, type Recipe } from '../entities/recipes'
import { addItem, countItem, createInventory, totalQuantity, type Inventory } from './inventory'
import { checkRecipe, commitRecipe } from './crafting'
import { reservationBlocks, reservationFor } from './timedAction'
import type { WeaponInstance } from './weapons'
import { GAME_CONFIG } from '../core/config'

const CLUB = RECIPES.craft_wooden_club
const WOOD = RECIPES.repair_wood
const METAL = RECIPES.repair_metal

function bag(items: [ItemId, number][], size = GAME_CONFIG.inventory.slots): Inventory {
  const inv = createInventory(size, 'player')
  for (const [id, n] of items) addItem(inv, id, n)
  return inv
}

function weapon(inv: Inventory, itemId: ItemId, condition: number): WeaponInstance {
  addItem(inv, itemId, 1, { condition })
  return inv.slots.findLast((i) => i?.itemId === itemId) as WeaponInstance
}

/** Ad-hoc recipe for the tool rules (shipped S4 recipes need no tool; S6/S7 ones will). */
const HAMMER_JOB: Recipe = {
  id: 'test_hammer_job', kind: 'craft', name: 'Test', duration: 1,
  inputs: [{ itemId: 'nails', quantity: 2 }], tools: [{ tag: 'hammer', wear: 1 }], output: { itemId: 'wood_plank', quantity: 1 },
}

describe('P2-S4 items and recipe data', () => {
  it('materials stack by type with the plan limits; the crafted club is a full-condition weapon', () => {
    expect([ITEMS.wood_plank.stackLimit, ITEMS.scrap_metal.stackLimit, ITEMS.duct_tape.stackLimit, ITEMS.nails.stackLimit]).toEqual([10, 10, 10, 50])
    for (const id of ['wood_plank', 'scrap_metal', 'duct_tape', 'nails'] as const) expect(ITEMS[id].kind).toBe('material')
    const inv = bag([['nails', 60]])
    expect(inv.slots.filter(Boolean).map((s) => s!.quantity)).toEqual([50, 10])
    expect(repairRecipeFor('baseball_bat')).toBe(WOOD)
    expect(repairRecipeFor('wooden_club')).toBe(WOOD)
    for (const id of ['metal_pipe', 'crowbar', 'hammer'] as const) expect(repairRecipeFor(id)).toBe(METAL)
    expect(repairRecipeFor('water')).toBeNull()
    expect([WOOD.amount, WOOD.duration, METAL.amount, METAL.duration, CLUB.duration]).toEqual([30, 4, 25, 5, 4])
  })
})

describe('crafting', () => {
  it('crafts one club from 2 wood + 1 tape: inputs consumed exactly once, new unique ID at full condition', () => {
    const inv = bag([['wood_plank', 3], ['duct_tape', 2]])
    const check = checkRecipe(inv, CLUB, null)
    expect(check).toMatchObject({ ok: true, failure: null, output: { itemId: 'wooden_club', quantity: 1 } })
    const r = commitRecipe(inv, CLUB, null, [])
    expect(r.ok).toBe(true)
    expect([countItem(inv, 'wood_plank'), countItem(inv, 'duct_tape')]).toEqual([1, 1])
    const club = inv.slots.find((i) => i?.itemId === 'wooden_club') as WeaponInstance
    expect(club).toMatchObject({ kind: 'weapon', condition: 40 })
    expect(r.ok && r.outputId).toBe(club.id)
    const ids = inv.slots.flatMap((i) => (i ? [i.id] : []))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('missing inputs block with have/need and change nothing', () => {
    const inv = bag([['wood_plank', 1]])
    const before = structuredClone(inv)
    const check = checkRecipe(inv, CLUB, null)
    expect(check.failure).toBe('missing-input')
    expect(check.inputs).toEqual([
      { itemId: 'wood_plank', need: 2, have: 1, ok: false },
      { itemId: 'duct_tape', need: 1, have: 0, ok: false },
    ])
    expect(commitRecipe(inv, CLUB, null, [])).toEqual({ ok: false, failure: 'missing-input' })
    expect(inv).toEqual(before)
  })

  it('a full bag may craft when consuming the inputs frees a slot (space counted after inputs)', () => {
    const inv = bag([['wood_plank', 2], ['duct_tape', 1]])
    for (let i = 0; i < 10; i++) addItem(inv, 'medkit', 1)
    expect(inv.slots.every(Boolean)).toBe(true)
    expect(checkRecipe(inv, CLUB, null).ok).toBe(true)
    const total = totalQuantity(inv)
    expect(commitRecipe(inv, CLUB, null, []).ok).toBe(true)
    expect(totalQuantity(inv)).toBe(total - 3 + 1)
    expect(countItem(inv, 'medkit')).toBe(10)
  })

  it('a full bag whose stacks survive consumption is refused with no-space and loses nothing', () => {
    const inv = bag([['wood_plank', 3], ['duct_tape', 2]])
    for (let i = 0; i < 10; i++) addItem(inv, 'medkit', 1)
    const before = structuredClone(inv)
    expect(checkRecipe(inv, CLUB, null).failure).toBe('no-space')
    expect(commitRecipe(inv, CLUB, null, [])).toEqual({ ok: false, failure: 'no-space' })
    expect(inv).toEqual(before)
  })
})

describe('repair', () => {
  it('a broken bat gets +30 and keeps its ID; wood and tape are spent', () => {
    const inv = bag([['wood_plank', 2], ['duct_tape', 1]])
    const bat = weapon(inv, 'baseball_bat', 0)
    const check = checkRecipe(inv, WOOD, bat.id)
    expect(check.repair).toEqual({ targetId: bat.id, itemId: 'baseball_bat', before: 0, after: 30, max: 80 })
    const r = commitRecipe(inv, WOOD, bat.id, [])
    expect(r.ok).toBe(true)
    const after = inv.slots.find((i) => i?.id === bat.id) as WeaponInstance
    expect(after.condition).toBe(30)
    expect([countItem(inv, 'wood_plank'), countItem(inv, 'duct_tape')]).toEqual([1, 0])
  })

  it('caps at max condition (preview shows the real gain) and refuses a full weapon', () => {
    const inv = bag([['scrap_metal', 2], ['duct_tape', 2]])
    const pipe = weapon(inv, 'metal_pipe', 110)
    expect(checkRecipe(inv, METAL, pipe.id).repair).toMatchObject({ before: 110, after: 120, max: 120 })
    expect(commitRecipe(inv, METAL, pipe.id, []).ok).toBe(true)
    expect(pipe.condition).toBe(110) // the old object is not mutated; the bag holds the committed copy
    expect((inv.slots.find((i) => i?.id === pipe.id) as WeaponInstance).condition).toBe(120)
    const before = structuredClone(inv)
    expect(checkRecipe(inv, METAL, pipe.id).failure).toBe('full-condition')
    expect(commitRecipe(inv, METAL, pipe.id, [])).toEqual({ ok: false, failure: 'full-condition' })
    expect(inv).toEqual(before)
  })

  it('rejects the wrong group, non-weapons and missing targets', () => {
    const inv = bag([['wood_plank', 5], ['duct_tape', 5], ['scrap_metal', 5]])
    const pipe = weapon(inv, 'metal_pipe', 10)
    const tape = inv.slots.find((i) => i?.itemId === 'duct_tape')!
    expect(checkRecipe(inv, WOOD, pipe.id).failure).toBe('not-repairable')
    expect(checkRecipe(inv, WOOD, tape.id).failure).toBe('not-repairable')
    expect(checkRecipe(inv, WOOD, 'player:999').failure).toBe('no-target')
    expect(checkRecipe(inv, WOOD, null).failure).toBe('no-target')
  })
})

describe('tool requirements', () => {
  it('a hammer at condition 1 completes one job, breaks, and then no longer qualifies', () => {
    const inv = bag([['nails', 4]])
    const hammer = weapon(inv, 'hammer', 1)
    const check = checkRecipe(inv, HAMMER_JOB, null)
    expect(check.tools).toEqual([{ tag: 'hammer', instanceId: hammer.id, ok: true }])
    const r = commitRecipe(inv, HAMMER_JOB, null, [hammer.id])
    expect(r.ok && r.toolWear).toEqual([{ id: hammer.id, itemId: 'hammer', condition: 0, broke: true }])
    expect(checkRecipe(inv, HAMMER_JOB, null).failure).toBe('missing-tool')
  })

  it('broken tools and the repair target itself never satisfy a requirement', () => {
    const inv = bag([['nails', 4], ['scrap_metal', 1], ['duct_tape', 1]])
    weapon(inv, 'hammer', 0)
    expect(checkRecipe(inv, HAMMER_JOB, null).failure).toBe('missing-tool')
    const target = weapon(inv, 'hammer', 50)
    const selfRepair: Recipe = { ...METAL, tools: [{ tag: 'hammer', wear: 1 }] }
    expect(checkRecipe(inv, selfRepair, target.id).tools[0]).toEqual({ tag: 'hammer', instanceId: null, ok: false })
    // Plain repair needs no tool, so a broken hammer never locks progress.
    const broken = inv.slots.find((i) => i?.itemId === 'hammer' && i.kind === 'weapon' && i.condition === 0)!
    expect(checkRecipe(inv, METAL, broken.id).ok).toBe(true)
  })

  it('a pinned (reserved) tool that broke meanwhile fails the commit instead of using another', () => {
    const inv = bag([['nails', 4]])
    const first = weapon(inv, 'hammer', 5)
    weapon(inv, 'hammer', 80)
    first.condition = 0
    const before = structuredClone(inv)
    expect(commitRecipe(inv, HAMMER_JOB, null, [first.id])).toEqual({ ok: false, failure: 'missing-tool' })
    expect(inv).toEqual(before)
  })
})

describe('reservation', () => {
  it('blocks reserved instances and any removal that would dip below a reserved count', () => {
    const inv = bag([['wood_plank', 12], ['duct_tape', 1], ['water', 1]])
    const bat = weapon(inv, 'baseball_bat', 0)
    const r = reservationFor(WOOD, bat.id, checkRecipe(inv, WOOD, bat.id))
    expect(r).toEqual({ counts: { wood_plank: 1, duct_tape: 1 }, instanceIds: [bat.id] })
    const slotOf = (pred: (i: Inventory['slots'][number]) => boolean) => inv.slots.findIndex(pred)
    expect(reservationBlocks(inv, r, slotOf((i) => i?.id === bat.id), 1)).toBe(true)
    expect(reservationBlocks(inv, r, slotOf((i) => i?.itemId === 'duct_tape'), 1)).toBe(true)
    // 12 wood = stacks of 10 + 2: moving either stack keeps ≥ 1 wood, moving both would not.
    const woodSlots = inv.slots.flatMap((i, n) => (i?.itemId === 'wood_plank' ? [n] : []))
    expect(reservationBlocks(inv, r, woodSlots[0], 10)).toBe(false)
    expect(reservationBlocks(inv, r, woodSlots[1], 2)).toBe(false)
    inv.slots[woodSlots[0]] = null
    expect(reservationBlocks(inv, r, woodSlots[1], 2)).toBe(true)
    expect(reservationBlocks(inv, r, woodSlots[1], 1)).toBe(false)
    expect(reservationBlocks(inv, r, slotOf((i) => i?.itemId === 'water'), 1)).toBe(false)
    expect(reservationBlocks(inv, null, slotOf((i) => i?.id === bat.id), 1)).toBe(false)
  })
})
