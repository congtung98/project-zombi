import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import { GAME_CONFIG } from '../../core/config'
import { BODY_PRESETS, HAIR_STYLES, DEFAULT_APPEARANCE } from '../../entities/appearance'
import { ARM_FORWARD, computePose, createPose, swingYaw, type ActionPose, type ActionPoseGroup, type PoseInput } from './pose'
import { applyPose, buildCharacter, playerLook, setCharacterGlow, zombieLook } from './rig'
import { SLOT } from './body'
import { buildWeaponModel } from './weaponModels'
import { getItemDef, ITEM_IDS } from '../../entities/items'

const base: PoseInput = { kind: 'player', time: 0, gaitPhase: 0, speed: 0, swing: -1, hitAt: 0.15 / 0.35, shove: -1, attack: -1, hurt: 0, dead: -1, armed: true }

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
    // Eye vertices (palette slot) sit on the front of the head.
    const paint = rig.mesh.geometry.getAttribute('paint')
    const pos = rig.mesh.geometry.getAttribute('position')
    let eyeZ = -1
    for (let i = 0; i < paint.count; i++) if (paint.getX(i) === SLOT.eyes) eyeZ = Math.max(eyeZ, pos.getZ(i))
    expect(eyeZ).toBeGreaterThan(0.08)
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
    expect(zombie.material).not.toBe(player.material)
    setCharacterGlow(zombie, true, true)
    expect(zombie.material.emissive.getHex()).toBe(0xffffff)
    expect(zombie.material.eyeGlow.r).toBeGreaterThan(0)
    expect(player.material.emissive.getHex()).toBe(0)
    expect(player.material.eyeGlow.getHex()).toBe(0)
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
      computePose({ ...base, kind, swing: v, shove: v, attack: v, dead: v, hurt: v, action: { group: 'medical', t: v, progress: v, weight: v }, speed: Math.max(0, v * 5), gaitPhase: v * 3, time: v }, out)
      for (const n of [out.bodyY, out.bodyPitch, out.torsoTwist, out.headPitch, out.headRoll, out.legL, out.legR, out.rootPitch, out.armL.x, out.armL.y, out.armL.z, out.armR.x, out.armR.y, out.armR.z]) expect(Number.isFinite(n)).toBe(true)
      applyPose(rig, out)
    }
  })

  const act = (group: ActionPoseGroup, t: number, progress = 0.5, weight = 1): ActionPose => ({ group, t, progress, weight })

  it('work pose (craft/repair): leans over with both arms forward and taps; a swing overrides it', () => {
    const idle = computePose({ ...base, armed: false })
    const samples = [0, 0.1, 0.2, 0.3].map((t) => computePose({ ...base, armed: false, action: act('work', t) }))
    for (const w of samples) {
      expect(w.bodyPitch).toBeGreaterThan(idle.bodyPitch + 0.2)
      expect(w.headPitch).toBeGreaterThan(idle.headPitch + 0.3)
      expect(w.armL.x).toBeLessThan(-0.8)
      expect(w.armR.x).toBeLessThan(-0.6)
    }
    // The hammering hand actually moves over time.
    expect(Math.max(...samples.map((w) => w.armR.x)) - Math.min(...samples.map((w) => w.armR.x))).toBeGreaterThan(0.3)
    const swinging = computePose({ ...base, action: act('work', 0.2), swing: base.hitAt })
    expect(swinging.armR.y).toBeCloseTo(0, 5)
    expect(swinging.armR.x).toBeCloseTo(ARM_FORWARD, 5)
    // No action, or one blended out, leaves the Phase 2-S3 poses untouched.
    expect(computePose({ ...base, action: null })).toEqual(computePose({ ...base }))
    expect(computePose({ ...base, action: act('drink', 1, 0.5, 0) })).toEqual(computePose({ ...base }))
  })

  it('AX3 pose groups: eating brings bites to the mouth, drinking tips the head back, bandaging looks down', () => {
    const idle = computePose({ ...base, armed: false })
    const bites = [0, 0.25, 0.5, 0.75].map((t) => computePose({ ...base, armed: false, action: act('eat', t) }))
    for (const e of bites) expect(e.elbowL).toBeLessThan(-1.5) // the food held at the chest
    expect(Math.min(...bites.map((e) => e.elbowR))).toBeLessThan(-2.0) // at the mouth
    expect(Math.max(...bites.map((e) => e.elbowR))).toBeGreaterThan(-1.8) // and back down
    const sip = computePose({ ...base, armed: false, action: act('drink', 1.2, 0.5) })
    expect(sip.headPitch).toBeLessThan(idle.headPitch - 0.3)
    expect(sip.armR.x).toBeLessThan(-1.1)
    // The bottle comes down at the end: the last 15 % lowers it.
    expect(computePose({ ...base, armed: false, action: act('drink', 2.5, 1) }).headPitch).toBeCloseTo(idle.headPitch, 5)
    const wrap = computePose({ ...base, armed: false, action: act('medical', 0.7) })
    expect(wrap.headPitch).toBeGreaterThan(idle.headPitch + 0.4)
    expect(wrap.elbowL).toBeLessThan(-0.9)
    const reach = computePose({ ...base, armed: false, action: act('reach', 0.2, 0.6) })
    expect(reach.armR.x).toBeLessThan(-1.2)
  })

  it('AX3 layers: death and a hit reaction still apply over an action; the ready stance gives way to it', () => {
    const dead = computePose({ ...base, dead: 1, fall: 'back', action: act('eat', 0.4) })
    const corpse = computePose({ ...base, dead: 1, fall: 'back' })
    for (const k of ['bodyPitch', 'headPitch', 'elbowL', 'elbowR', 'rootPitch'] as const) expect(dead[k]).toBeCloseTo(corpse[k], 9)
    for (const k of ['x', 'y', 'z'] as const) expect([dead.armL[k], dead.armR[k]].map((v) => +v.toFixed(9))).toEqual([corpse.armL[k], corpse.armR[k]].map((v) => +v.toFixed(9)))
    const drinking = computePose({ ...base, action: act('drink', 1) })
    expect(computePose({ ...base, action: act('drink', 1), hurt: 1 }).bodyPitch).toBeLessThan(drinking.bodyPitch)
    expect(computePose({ ...base, ready: 1, action: act('medical', 0.3) }).armL.y).toBeCloseTo(computePose({ ...base, action: act('medical', 0.3) }).armL.y, 5)
    // Half blended: halfway between the pose without it and the full action pose.
    const none = computePose({ ...base, armed: false })
    const full = computePose({ ...base, armed: false, action: act('eat', 0.3) })
    const half = computePose({ ...base, armed: false, action: act('eat', 0.3, 0.5, 0.5) })
    expect(half.elbowR).toBeCloseTo((none.elbowR + full.elbowR) / 2, 5)
  })

  it('CS1 ready stance: weapon raised in both hands, the swing starts from it and still crosses the front at the hit', () => {
    const idle = computePose({ ...base })
    const ready = computePose({ ...base, ready: 1 })
    expect(ready.armR.x).toBeLessThan(idle.armR.x - 0.5)
    expect(ready.armR.y).toBeLessThan(-0.3)
    expect(ready.armL.x).toBeLessThan(-0.9)
    expect(ready.kneeL).toBeGreaterThan(idle.kneeL)
    // Half blended = in between (no pop).
    const half = computePose({ ...base, ready: 0.5 })
    expect(half.armR.x).toBeLessThan(idle.armR.x)
    expect(half.armR.x).toBeGreaterThan(ready.armR.x)
    // The swing's first frame is the ready pose, the damage frame is the plain swing, the end returns to it.
    const start = computePose({ ...base, ready: 1, swing: 0 })
    expect(start.armR.x).toBeCloseTo(ready.armR.x, 5)
    expect(start.armR.y).toBeCloseTo(ready.armR.y, 5)
    const hit = computePose({ ...base, ready: 1, swing: base.hitAt })
    expect(hit.armR.y).toBeCloseTo(0, 5)
    expect(hit.armR.x).toBeCloseTo(ARM_FORWARD, 5)
    expect(computePose({ ...base, ready: 1, swing: 1 }).armR.x).toBeCloseTo(ready.armR.x, 5)
    // Unarmed: fists up in front of the chest.
    const fists = computePose({ ...base, armed: false, ready: 1 })
    expect(fists.elbowR).toBeLessThan(-1.5)
    expect(fists.elbowL).toBeLessThan(-1.5)
    // No stance input leaves the C4 poses untouched; the chest lead only twists the chest and head.
    expect(computePose({ ...base, ready: 0, aimLead: 0 })).toEqual(computePose({ ...base }))
    const lead = computePose({ ...base, aimLead: 0.4 })
    expect(lead.torsoTwist - idle.torsoTwist).toBeCloseTo(0.32, 5)
    expect(lead.hipsYaw).toBeCloseTo(idle.hipsYaw, 9)
  })
})
