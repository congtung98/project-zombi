import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { GAME_CONFIG } from '../../core/config'
import { BODY_PRESETS, DEFAULT_APPEARANCE, HAIR_STYLES, OUTFIT_STYLES } from '../../entities/appearance'
import { BONES, SLOT, SLOT_COUNT, bodyGeometry, bodyGeometryCount } from './body'
import { computePose, createPose, type PoseInput } from './pose'
import { applyPose, buildCharacter, lookPalette, playerLook, zombieLook, type CharacterRig } from './rig'

const base: PoseInput = { kind: 'player', time: 0, gaitPhase: 0, speed: 0, swing: -1, hitAt: 0.43, shove: -1, attack: -1, hurt: 0, dead: -1, armed: false, work: -1 }

/** Model-space bounds of the skinned (posed) mesh. */
function posedBounds(rig: CharacterRig) {
  rig.root.updateMatrixWorld(true)
  rig.mesh.skeleton.update()
  const v = new Vector3()
  const min = new Vector3(Infinity, Infinity, Infinity)
  const max = new Vector3(-Infinity, -Infinity, -Infinity)
  const count = rig.mesh.geometry.getAttribute('position').count
  for (let i = 0; i < count; i++) {
    rig.mesh.getVertexPosition(i, v)
    v.applyMatrix4(rig.mesh.matrixWorld)
    min.min(v)
    max.max(v)
  }
  return { min, max }
}

describe('C1 skinned body', () => {
  it('one skinned mesh, one material per character; weights sum to 1 on valid bones; palette slots in range', () => {
    const rig = buildCharacter(playerLook(DEFAULT_APPEARANCE))
    const meshes: unknown[] = []
    rig.root.traverse((o) => { if ((o as { isMesh?: boolean }).isMesh) meshes.push(o) })
    expect(meshes).toHaveLength(1)
    expect(rig.mesh.skeleton.bones.map((b) => b.name)).toEqual([...BONES])
    const g = rig.mesh.geometry
    const idx = g.getAttribute('skinIndex')
    const w = g.getAttribute('skinWeight')
    const paint = g.getAttribute('paint')
    for (let i = 0; i < idx.count; i++) {
      expect(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)).toBeCloseTo(1, 5)
      for (const k of [idx.getX(i), idx.getY(i)]) expect(k).toBeLessThan(BONES.length)
      expect(paint.getX(i)).toBeGreaterThanOrEqual(0)
      expect(paint.getX(i)).toBeLessThan(SLOT_COUNT)
    }
    // Low-poly budget: the whole body stays under 2 500 triangles.
    expect(g.getAttribute('position').count / 3).toBeLessThan(2500)
    rig.dispose()
  })

  it('geometry is shared per body shape: a crowd of 40 zombies uses at most one per preset × hair × outfit', () => {
    const before = bodyGeometryCount()
    const shapesMax = BODY_PRESETS.length * HAIR_STYLES.length * OUTFIT_STYLES.length
    const rigs = Array.from({ length: 40 }, (_, i) => buildCharacter(zombieLook(`zombie-${i + 1}`)))
    const shapes = new Set(rigs.map((r) => r.mesh.geometry))
    expect(shapes.size).toBeLessThanOrEqual(shapesMax)
    expect(bodyGeometryCount() - before).toBeLessThanOrEqual(shapesMax)
    // Zombies wear every outfit.
    expect(new Set(rigs.map((r) => r.mesh.geometry.name.split('/')[2])).size).toBe(OUTFIT_STYLES.length)
    expect(new Set(rigs.map((r) => r.material)).size).toBe(40)
    const a = buildCharacter(zombieLook('zombie-1'))
    expect(a.mesh.geometry).toBe(rigs[0].mesh.geometry)
    for (const r of [...rigs, a]) r.dispose()
  })

  it('stands 1.8 m tall inside the capsule, feet on the floor, for every preset, hair and outfit', () => {
    for (const preset of BODY_PRESETS) for (const hair of HAIR_STYLES) for (const outfit of OUTFIT_STYLES) {
      const rig = buildCharacter(playerLook({ ...DEFAULT_APPEARANCE, preset, hair, outfit }))
      applyPose(rig, computePose(base))
      const { min, max } = posedBounds(rig)
      expect(min.y).toBeGreaterThan(-0.015)
      expect(min.y).toBeLessThan(0.01)
      expect(max.y).toBeGreaterThan(1.74)
      expect(max.y).toBeLessThan(GAME_CONFIG.player.height + 0.05)
      expect(max.x - min.x).toBeLessThanOrEqual(GAME_CONFIG.player.radius * 2)
      rig.dispose()
    }
  })

  it('outfits differ in shape, not only colour: each has its own triangle count and silhouette', () => {
    const counts = OUTFIT_STYLES.map((outfit) => bodyGeometry({ preset: 'balanced', hair: 'short', outfit }).getAttribute('position').count)
    expect(new Set(counts).size).toBe(OUTFIT_STYLES.length)
    const box = (outfit: (typeof OUTFIT_STYLES)[number]) => {
      const g = bodyGeometry({ preset: 'balanced', hair: 'short', outfit })
      g.computeBoundingBox()
      return g.boundingBox!
    }
    // The jacket is wider than the T-shirt; overalls and shirt sleeves reach the wrists or forearms.
    expect(box('jacket').max.x - box('jacket').min.x).toBeGreaterThan(box('tee').max.x - box('tee').min.x)
    for (const outfit of OUTFIT_STYLES) expect(box(outfit).max.x - box(outfit).min.x).toBeLessThanOrEqual(0.8)
  })

  it('walking and running keep a foot on the floor through the whole cycle (no hover, no sinking)', () => {
    for (const [kind, speed, outfit] of [['player', 4, 'tee'], ['player', 7, 'work'], ['player', 4, 'jacket'], ['zombie', 2.3, 'tee']] as const) {
      const rig = buildCharacter(kind === 'player' ? playerLook({ ...DEFAULT_APPEARANCE, outfit }) : zombieLook('zombie-2'))
      const pose = createPose()
      for (let k = 0; k < 16; k++) {
        applyPose(rig, computePose({ ...base, kind, speed, gaitPhase: (k / 16) * Math.PI * 2 }, pose))
        const { min } = posedBounds(rig)
        expect(min.y, `${kind} ${speed} phase ${k}`).toBeGreaterThan(-0.03)
        expect(min.y, `${kind} ${speed} phase ${k}`).toBeLessThan(0.035)
      }
      rig.dispose()
    }
  })

  it('joints bend without tearing: blended elbow/knee vertices stay between the two bones', () => {
    const rig = buildCharacter(playerLook(DEFAULT_APPEARANCE))
    applyPose(rig, computePose({ ...base, speed: 7, gaitPhase: Math.PI }))
    rig.root.updateMatrixWorld(true)
    rig.mesh.skeleton.update()
    const g = rig.mesh.geometry
    const w = g.getAttribute('skinWeight')
    const idx = g.getAttribute('skinIndex')
    const v = new Vector3()
    const joint = new Vector3()
    const elbowL = BONES.indexOf('elbowL')
    rig.elbowL.getWorldPosition(joint)
    let checked = 0
    for (let i = 0; i < w.count; i++) {
      if (idx.getX(i) === BONES.indexOf('shoulderL') && idx.getY(i) === elbowL && w.getY(i) === 0.5) {
        rig.mesh.getVertexPosition(i, v)
        // Blended ring around the elbow: within the arm's radius of the joint, whatever the bend.
        expect(v.distanceTo(joint)).toBeLessThan(0.07)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(8)
    rig.dispose()
  })

  it('palette: player colours from the appearance IDs, zombies pale (never green), every slot filled', () => {
    const p = lookPalette(playerLook(DEFAULT_APPEARANCE))
    expect(p).toHaveLength(SLOT_COUNT)
    expect(p.every((c) => /^#[0-9a-f]{6}$/i.test(c))).toBe(true)
    for (let i = 1; i <= 30; i++) {
      const skin = lookPalette(zombieLook(`zombie-${i}`))[SLOT.skin]
      const [r, g, b] = [1, 3, 5].map((k) => parseInt(skin.slice(k, k + 2), 16))
      // Green no longer dominates: pale grey/yellowish tones.
      expect(g - Math.max(r, b)).toBeLessThan(6)
    }
    expect(bodyGeometry({ preset: 'balanced', hair: 'short', outfit: 'tee' })).toBe(bodyGeometry({ preset: 'balanced', hair: 'short', outfit: 'tee' }))
  })

  it('dispose frees the per-character material and bone texture only', () => {
    const rig = buildCharacter(zombieLook('zombie-5'))
    const other = buildCharacter(zombieLook('zombie-5'))
    let disposed = 0
    rig.material.addEventListener('dispose', () => disposed++)
    let geometryDisposed = 0
    rig.mesh.geometry.addEventListener('dispose', () => geometryDisposed++)
    rig.mesh.skeleton.computeBoneTexture()
    const tex = rig.mesh.skeleton.boneTexture!
    let texDisposed = 0
    tex.addEventListener('dispose', () => texDisposed++)
    rig.dispose()
    expect(disposed).toBe(1)
    expect(texDisposed).toBe(1)
    expect(geometryDisposed).toBe(0)
    expect(other.mesh.geometry).toBe(rig.mesh.geometry)
    other.dispose()
  })
})
