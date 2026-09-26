import { describe, expect, it } from 'vitest'
import { loadBundledWorld } from '../../map/content'
import { GameRuntime } from '../core/runtime'
import { GRAPHICS_PRESETS } from '../../stores/settingsStore'
import { collectStaticItems } from './staticBatchData'
import { DECOR } from './decor/catalog'

/**
 * G6: graphics tiers change presentation only. Low leaves out the smallest decor and keeps every
 * building piece, piece of furniture and collider; nothing a tier changes is read by gameplay.
 */

describe('graphics tiers (G6)', () => {
  const rt = new GameRuntime({ ...loadBundledWorld('graphics-lab').map, zombieSpawns: [] })

  it('Low drops only the small decor; walls, furniture and the rest stay piece for piece', () => {
    const full = collectStaticItems(rt.map, rt.staticColliders, { smallDecor: true })
    const low = collectStaticItems(rt.map, rt.staticColliders, { smallDecor: false })
    const key = (i: (typeof full)[number]) => `${i.id}|${i.center.toArray().join(',')}|${i.size.join(',')}`
    const lowKeys = new Set(low.map(key))
    const dropped = full.filter((i) => !lowKeys.has(key(i)))
    expect(dropped.length).toBeGreaterThan(20)
    expect(dropped.every((i) => i.decor && i.decor.assetId !== 'unknown' && DECOR[i.decor.assetId].small)).toBe(true)
    // Large decor (rugs, bags, cartons, bushes) stays at Low.
    expect(low.some((i) => i.decor?.assetId === 'decor/rug')).toBe(true)
    expect(low.some((i) => i.decor?.assetId === 'decor/bush')).toBe(true)
  })

  it('the tiers only touch presentation settings, Medium being the default look', () => {
    for (const p of Object.values(GRAPHICS_PRESETS)) expect(Object.keys(p).sort()).toEqual(['anisotropy', 'contact', 'maxPixelRatio', 'shadows', 'smallDecor'])
    expect(GRAPHICS_PRESETS.medium).toMatchObject({ shadows: 'high', contact: true, smallDecor: true })
    expect(GRAPHICS_PRESETS.low.shadows).not.toBe('off') // Low keeps shadows (only smaller)
  })
})
