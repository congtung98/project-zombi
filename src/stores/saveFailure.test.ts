import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SaveGame } from '../types/save'

/**
 * INV-LOOT S5 T21: a failing IndexedDB write (quota, blocked) never reports success and never
 * replaces the last good save; the game state stays in memory and a later save can succeed. Two
 * saves at once never let the late one overwrite the other (the busy guard).
 */
const stored = new Map<string, unknown>()
let failNext: string | null = null
let pending: (() => void) | null = null

vi.mock('../game/systems/saveStorage', async (importOriginal) => {
  const real = await importOriginal<typeof import('../game/systems/saveStorage')>()
  return {
    ...real,
    writeSave: vi.fn(async (save: SaveGame, slot: string) => {
      if (pending === null && failNext === 'hold') await new Promise<void>((resolve) => (pending = resolve))
      if (failNext && failNext !== 'hold') {
        const error = failNext
        failNext = null
        return { ok: false, error }
      }
      stored.set(slot, structuredClone(save))
      return { ok: true, value: slot }
    }),
    readSave: vi.fn(async (slot: string) => ({ ok: true, value: structuredClone(stored.get(slot)) })),
  }
})

const { useUiStore } = await import('./uiStore')
const { useHudStore } = await import('./hudStore')
const { runtime } = await import('../game/core/runtime')
const { readSave } = await import('../game/systems/saveStorage')
const { addItem, totalQuantity } = await import('../game/systems/inventory')

const toast = () => useHudStore.getState().toast ?? ''
const slot = () => [...stored.keys()][0]

describe('T21 save failures', () => {
  beforeEach(() => {
    stored.clear()
    failNext = null
    pending = null
    runtime.newGame(77)
    useUiStore.setState({ screen: 'playing', busy: false })
  })

  it('a failed write keeps the last good save and says so; the game keeps its state and saves later', async () => {
    addItem(runtime.player.inventory, 'water', 2)
    expect(await useUiStore.getState().saveGame()).toBe(true)
    const good = structuredClone(stored.get(slot())) as SaveGame
    const summary = useUiStore.getState().saveSlot

    addItem(runtime.player.inventory, 'canned_food', 3)
    failNext = 'Hết dung lượng lưu trữ của trình duyệt.'
    expect(await useUiStore.getState().saveGame()).toBe(false)
    expect(toast()).toBe('Không lưu được: Hết dung lượng lưu trữ của trình duyệt.')
    expect(useUiStore.getState().saveSlot).toEqual(summary)
    const kept = await readSave(slot())
    expect(kept.ok && (kept.value as SaveGame).player.inventory).toEqual(good.player.inventory)
    // Nothing was lost in memory; the next save writes it.
    expect(totalQuantity(runtime.player.inventory)).toBe(5)
    expect(useUiStore.getState().busy).toBe(false)
    expect(await useUiStore.getState().saveGame()).toBe(true)
    expect(totalQuantity((stored.get(slot()) as SaveGame).player.inventory)).toBe(5)
  })

  it('a second save while one is still writing is refused, so a late write cannot overwrite a newer one', async () => {
    failNext = 'hold'
    const first = useUiStore.getState().saveGame()
    await Promise.resolve()
    expect(await useUiStore.getState().saveGame()).toBe(false)
    failNext = null
    pending!()
    expect(await first).toBe(true)
    expect(stored.size).toBe(1)
  })
})
