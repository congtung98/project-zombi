import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import { GAME_CONFIG } from '../../core/config'
import { BODY_PRESETS, HAIR_STYLES, DEFAULT_APPEARANCE } from '../../entities/appearance'
import { ARM_FORWARD, computePose, createPose, swingYaw, type PoseInput } from './pose'
import { applyPose, buildCharacter, playerLook, setCharacterGlow, zombieLook } from './rig'
import { buildWeaponModel } from './weaponModels'
import { getItemDef, ITEM_IDS } from '../../entities/items'

const base: PoseInput = { kind: 'player', time: 0, gaitPhase: 0, speed: 0, swing: -1, hitAt: 0.15 / 0.35, shove: -1, attack: -1, hurt: 0, dead: -1, armed: true, work: -1 }

function bounds(obj: import('three').Object3D) {
  obj.updateMatrixWorld(true)
  return new Box3().setFromObject(obj)
}

describe('procedural rig', () => {
  it('every preset/hair has feet at 0, the same height and fits inside the unchanged capsule footprint', () => {
    const heights = new Set<number>()
    for (const preset of BODY_PRESETS) for (const hair of HAIR_STYLES) {
      const rig = buildCharacter(playerLook({ ...DEFAULT_APPEARANCE, preset, hair }))
      const box = bounds(rig.root)
      expect(box.min.y).toBeCloseTo(0, 5)
      heights.add(Math.round((box.max.y - (hair === 'mohawk' ? 0.03 : 0)) * 20) / 20)
      // Idle: arms and body stay within the collider diameter (2 × radius).
      expect(box.max.x - box.min.x).toBeLessThanOrEqual(GAME_CONFIG.player.radius * 2)
      expect(box.max.y).toBeLessThanOrEqual(GAME_CONFIG.player.height + 0.05)
      rig.dispose()
    }
    expect(heights.size).toBe(1)
  })

  it('faces +Z and holds the weapon socket in the right hand (−X side)', () => {
    const rig = buildCharacter(playerLook(DEFAULT_APPEARANCE))
    rig.root.updateMatrixWorld(true)
    const eyes = rig.head.children[1].getWorldPosition(new Vector3())
    const head = rig.head.getWorldPosition(new Vector3())
    expect(eyes.z).toBeGreaterThan(head.z)
    const hand = rig.weaponSocket.getWorldPosition(new Vector3())
    expect(hand.x).toBeLessThan(0)
    expect(hand.y).toBeGreaterThan(0.6)
    expect(hand.y).toBeLessThan(1.1)
  })

  it('zombie variants are deterministic per ID and never share material objects with the player', () => {
    expect(zombieLook('zombie-3')).toEqual(zombieLook('zombie-3'))
    const looks = new Set(Array.from({ length: 12 }, (_, i) => JSON.stringify(zombieLook(`zombie-${i + 1}`))))
    expect(looks.size).toBeGreaterThan(4)
    const player = buildCharacter(playerLook(DEFAULT_APPEARANCE))
    const zombie = buildCharacter(zombieLook('zombie-1'))
    expect(zombie.materials.shirt).not.toBe(player.materials.shirt)
    setCharacterGlow(zombie, true, true)
    expect(zombie.materials.shirt.emissive.getHex()).toBe(0xffffff)
    expect(player.materials.shirt.emissive.getHex()).toBe(0)
    expect(player.materials.eyes.emissive.getHex()).toBe(0)
  })

  it('weapon models attach along the socket with their grip at the hand for every melee', () => {
    const melee = ITEM_IDS.filter((id) => getItemDef(id).melee)
    expect(melee).toContain('wooden_club')
    for (const id of melee) {
      const model = buildWeaponModel(id, false, true)!
      const box = bounds(model.group)
      expect(box.max.z).toBeGreaterThan(0.5) // extends forward from the grip
      expect(box.min.z).toBeLessThan(0.05)
      model.dispose()
    }
    expect(buildWeaponModel('water', false, true)).toBeNull()
  })
})

describe('pose', () => {
  it('the weapon arm points straight ahead exactly at the hit window, and only there crosses the front', () => {
    const p = computePose({ ...base, swing: base.hitAt })
    expect(p.armR.y).toBeCloseTo(0, 5)
    expect(p.armR.x).toBeCloseTo(ARM_FORWARD, 5)
    expect(swingYaw(0.2, base.hitAt)).toBeLessThan(-1)
    expect(swingYaw(0.8, base.hitAt)).toBeGreaterThan(1)
    // Monotonic sweep between wind-up and follow-through: one crossing, no second "hit".
    let crossings = 0
    for (let t = 0.2; t < 0.85; t += 0.01) if (Math.sign(swingYaw(t, base.hitAt)) !== Math.sign(swingYaw(t + 0.01, base.hitAt))) crossings++
    expect(crossings).toBe(1)
  })

  it('walk cycle swings legs in opposition; idle stands still; running leans forward', () => {
    const walk = computePose({ ...base, speed: 4, gaitPhase: Math.PI / 2 })
    expect(walk.legL).toBeGreaterThan(0.3)
    expect(walk.legR).toBeCloseTo(-walk.legL, 5)
    const idle = computePose({ ...base, speed: 0, gaitPhase: Math.PI / 2 })
    expect(idle.legL).toBe(0)
    expect(computePose({ ...base, speed: 7 }).bodyPitch).toBeGreaterThan(0.1)
  })

  it('zombies reach forward, raise then slam at the damage frame; death lies flat', () => {
    const chase = computePose({ ...base, kind: 'zombie', armed: false, speed: 2.3 })
    expect(chase.armL.x).toBeLessThan(-1)
    const windup = computePose({ ...base, kind: 'zombie', attack: 0.7 })
    const hit = computePose({ ...base, kind: 'zombie', attack: 1 })
    expect(windup.armL.x).toBeLessThan(-2.4)
    expect(hit.armL.x).toBeGreaterThan(windup.armL.x)
    const dead = computePose({ ...base, dead: 1 })
    expect(dead.rootPitch).toBeCloseTo(-Math.PI / 2, 5)
  })

  it('shove pushes both arms forward, hurt leans back; every combination stays finite', () => {
    const shove = computePose({ ...base, armed: false, shove: 0.3 })
    expect(shove.armL.x).toBeLessThan(-1.3)
    expect(shove.armR.x).toBeLessThan(-1.3)
    expect(computePose({ ...base, hurt: 1 }).bodyPitch).toBeLessThan(0)
    const rig = buildCharacter(zombieLook('zombie-9'))
    const out = createPose()
    for (const kind of ['player', 'zombie'] as const) for (const v of [-1, 0, 0.5, 1, 2]) {
      computePose({ ...base, kind, swing: v, shove: v, attack: v, dead: v, hurt: v, work: v, speed: Math.max(0, v * 5), gaitPhase: v * 3, time: v }, out)
      for (const n of [out.bodyY, out.bodyPitch, out.torsoTwist, out.headPitch, out.headRoll, out.legL, out.legR, out.rootPitch, out.armL.x, out.armL.y, out.armL.z, out.armR.x, out.armR.y, out.armR.z]) expect(Number.isFinite(n)).toBe(true)
      applyPose(rig, out)
    }
  })

  it('work pose (craft/repair): leans over with both arms forward and taps; a swing overrides it', () => {
    const idle = computePose({ ...base, armed: false })
    const samples = [0, 0.1, 0.2, 0.3].map((t) => computePose({ ...base, armed: false, work: t }))
    for (const w of samples) {
      expect(w.bodyPitch).toBeGreaterThan(idle.bodyPitch + 0.2)
      expect(w.headPitch).toBeGreaterThan(idle.headPitch + 0.3)
      expect(w.armL.x).toBeLessThan(-0.8)
      expect(w.armR.x).toBeLessThan(-0.6)
    }
    // The hammering hand actually moves over time.
    expect(Math.max(...samples.map((w) => w.armR.x)) - Math.min(...samples.map((w) => w.armR.x))).toBeGreaterThan(0.3)
    const swinging = computePose({ ...base, work: 0.2, swing: base.hitAt })
    expect(swinging.armR.y).toBeCloseTo(0, 5)
    expect(swinging.armR.x).toBeCloseTo(ARM_FORWARD, 5)
    // No work (−1) leaves the Phase 2-S3 poses untouched.
    expect(computePose({ ...base, work: -1 })).toEqual(computePose({ ...base }))
  })
})
