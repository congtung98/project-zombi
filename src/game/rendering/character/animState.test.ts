import { describe, expect, it } from 'vitest'
import { Group } from 'three'
import { getItemDef, ITEM_IDS } from '../../entities/items'
import { DEFAULT_APPEARANCE } from '../../entities/appearance'
import { buildCharacter, playerLook } from './rig'
import { buildItemProp, propShape } from './itemProps'
import { ProceduralPoseDriver, PropAttachment, type CharacterAnimState } from './animState'

/** AX3: props in the hands and the driver that poses the rig (the view's only link to actions). */
const idle: CharacterAnimState = {
  time: 0, gaitPhase: 0, speed: 0, hipTurn: 0, swing: -1, hitAt: 0.4, shove: -1, hurt: 0, dead: -1, fall: 'back', armed: false, ready: 0, aimLead: 0,
  action: null, props: { right: null, left: null, hideWeapon: false },
}

describe('hand props (AX3)', () => {
  it('every item that can be eaten, drunk, applied or opened has its own shape; any other item a fallback box', () => {
    for (const id of ITEM_IDS) {
      const def = getItemDef(id)
      if (def.consumable || def.sealed) expect(propShape(id), id).not.toBeNull()
      const prop = buildItemProp(id, false)
      expect(prop.children.length).toBeGreaterThan(0)
    }
    expect(propShape('nails')).toBeNull()
  })

  it('a prop goes into the right or left fist and leaves it; swapping a hundred times leaves nothing behind', () => {
    const rig = buildCharacter(playerLook(DEFAULT_APPEARANCE))
    const props = new PropAttachment(rig, false)
    props.sync({ right: 'water', left: null })
    expect(rig.weaponSocket.children.map((c) => c.name)).toEqual(['prop:water'])
    props.sync({ right: null, left: 'bandage' })
    expect([rig.weaponSocket.children.length, rig.leftSocket.children.map((c) => c.name)]).toEqual([0, ['prop:bandage']])
    for (let i = 0; i < 100; i++) props.sync({ right: i % 2 ? 'chips' : 'soda', left: i % 3 ? null : 'medkit' })
    expect(rig.weaponSocket.children).toHaveLength(1)
    expect(rig.leftSocket.children.length).toBeLessThanOrEqual(1)
    props.clear()
    expect([rig.weaponSocket.children.length, rig.leftSocket.children.length]).toEqual([0, 0])
  })

  it('the driver hides the weapon while an action needs the hands and gives it back after (never unequips)', () => {
    const rig = buildCharacter(playerLook(DEFAULT_APPEARANCE))
    const driver = new ProceduralPoseDriver(rig, false)
    const weapon = new Group()
    rig.weaponSocket.add(weapon)
    driver.setWeapon(weapon)
    driver.update({ ...idle, action: { group: 'drink', t: 1, progress: 0.5, weight: 1 }, props: { right: 'water', left: null, hideWeapon: true } })
    expect([weapon.visible, weapon.parent === rig.weaponSocket, rig.weaponSocket.children.some((c) => c.name === 'prop:water')]).toEqual([false, true, true])
    driver.update(idle)
    expect([weapon.visible, rig.weaponSocket.children.some((c) => c.name === 'prop:water')]).toEqual([true, false])
    driver.dispose()
  })
})
