import { describe, expect, it } from 'vitest'
import { Box3, Mesh } from 'three'
import { buildBackpackModel, hasBackpackModel } from './backpackModel'
import { BODY_FRAMES } from './body'

/** INV-LOOT S5: the worn backpack model on the torso bone. */
describe('backpack model', () => {
  it('sits on the back (behind the top, clear of it), straps over the shoulders, wider bodies push it out', () => {
    const slim = buildBackpackModel('backpack', { preset: 'slim', outfit: 'tee' }, true)!
    const sturdy = buildBackpackModel('backpack', { preset: 'sturdy', outfit: 'jacket' }, false)!
    const body = (m: typeof slim) => m.group.children[0] as Mesh
    for (const [model, preset] of [[slim, 'slim'], [sturdy, 'sturdy']] as const) {
      const box = new Box3().setFromObject(body(model))
      // The whole bag body behind the top's back surface, from the waist to the shoulder blades.
      expect(box.max.z).toBeLessThan(-0.115 * BODY_FRAMES[preset].depth)
      expect(box.min.y).toBeGreaterThan(0)
      expect(box.max.y).toBeLessThan(0.45)
      // Straps reach the front of the chest.
      expect(Math.max(...model.group.children.map((c) => c.position.z))).toBeGreaterThan(0.1)
    }
    expect(body(sturdy).position.z).toBeLessThan(body(slim).position.z)
    expect(body(slim).castShadow).toBe(true)
    expect(body(sturdy).castShadow).toBe(false)
    slim.dispose()
    sturdy.dispose()
  })

  it('only bags with a model get one', () => {
    expect(hasBackpackModel('backpack')).toBe(true)
    expect(hasBackpackModel('water')).toBe(false)
    expect(buildBackpackModel('unknown_item', { preset: 'balanced', outfit: 'tee' }, false)).toBeNull()
  })
})
