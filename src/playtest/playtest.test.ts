import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, loadWorld } from '../map/content'
import { enableMemorySaveStorage, readSave } from '../game/systems/saveStorage'
import { setPlaytestSession } from '../game/world/playtest'

/**
 * Playtest session wiring (M6), in the order the playtest page uses: validate the snapshot, keep
 * saves in memory, set the session, and only then import the game modules. The runtime singleton
 * must be built on the snapshot and every save must go to the in-memory playtest slot.
 */
describe('playtest session (M6)', () => {
  it('builds the runtime on the snapshot and keeps saves in memory, away from slot-1', async () => {
    const files = bundledWorldFiles('neighborhood-50')
    const loaded = loadWorld((p) => files.get(p))
    const map = { ...loaded.map, playerSpawn: { x: 3, y: 0, z: 18 } }
    enableMemorySaveStorage()
    setPlaytestSession({ map, timeOfDay: 0.5 })
    const { runtime } = await import('../game/core/runtime')
    const { useUiStore } = await import('../stores/uiStore')
    expect(runtime.map).toBe(map)
    useUiStore.getState().startNewGame()
    runtime.clock.reset(0.5)
    expect([Math.round(runtime.player.position.x), Math.round(runtime.player.position.z)]).toEqual([3, 18])
    expect(await useUiStore.getState().saveGame('test')).toBe(true)
    const saved = await readSave('slot-playtest')
    expect(saved.ok && (saved.value as { mapId: string }).mapId).toBe('neighborhood-50')
    const player = await readSave('slot-1')
    expect(player.ok && player.value).toBeUndefined()
    // No IndexedDB was needed at all (Node has none): storage never left memory.
    expect(typeof indexedDB).toBe('undefined')
  })
})
