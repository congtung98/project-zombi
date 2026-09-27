import { Bone, Color, Group, Matrix4, Skeleton, SkinnedMesh, Sphere, Vector3 } from 'three'
import { OUTFIT_STYLES, PANTS_HEX, SHIRT_HEX, SKIN_HEX, outfitOf, type BodyPreset, type CharacterAppearance, type HairStyle } from '../../entities/appearance'
import { BODY_FRAMES, BODY_HEIGHT, BONES, BONE_PARENT, GRIP, SLOT, SLOT_COUNT, bodyGeometry, boneOffsets, boneRest, type BoneName, type OutfitId } from './body'
import { CharacterMaterial } from './material'
import type { Pose } from './pose'

/**
 * One procedural low-poly character for every player preset and every zombie (no external asset,
 * nothing to license). C1 (character plan): a single rigid-weight `SkinnedMesh` on a bone chain
 * (pelvis, spine, head; shoulder and elbow per arm; hip, knee and ankle per leg): one draw call and
 * one shadow caster per character, geometry shared per body shape (`body.ts`), colours per character
 * (`material.ts`). The root sits at the feet, +Z is forward, the right hand is on −X. `applyPose`
 * only writes bone rotations each frame; animation stays in place (the simulation owns the position).
 */
export const RIG = {
  /** Pelvis height at rest (the hips bone); `pose.bodyY` moves it. */
  hipHeight: BODY_FRAMES.balanced.hipY,
  height: BODY_HEIGHT,
} as const

export interface CharacterLook {
  preset: BodyPreset
  hair: HairStyle
  outfit: OutfitId
  skin: string
  shirt: string
  pants: string
  hairColor: string
  eyes: string
  /** Collar/trim, shoes, belt, sole, stains (defaults from the other colours when omitted). */
  trim?: string
  shoes?: string
  belt?: string
  sole?: string
  stain?: string
}

/**
 * Shadow casting per character. With one mesh per character 'full' and 'body' are the same single
 * caster; 'none' casts nothing (shadows off).
 */
export type ShadowDetail = 'full' | 'body' | 'none'

export function shadowDetail(setting: 'off' | 'low' | 'high'): ShadowDetail {
  return setting === 'high' ? 'full' : setting === 'low' ? 'body' : 'none'
}

export interface CharacterRig {
  root: Group
  mesh: SkinnedMesh
  hips: Bone
  torso: Bone
  head: Bone
  shoulderL: Bone
  shoulderR: Bone
  elbowL: Bone
  elbowR: Bone
  hipL: Bone
  hipR: Bone
  kneeL: Bone
  kneeR: Bone
  ankleL: Bone
  ankleR: Bone
  /** Right-hand weapon attachment point, in the right fist. */
  weaponSocket: Group
  /** Per-instance material (palette, hit flash, eye glow, fade); disposed with the rig. */
  material: CharacterMaterial
  dispose: () => void
}

export function playerLook(a: CharacterAppearance): CharacterLook {
  return { preset: a.preset, hair: a.hair, outfit: outfitOf(a), skin: SKIN_HEX[a.skin], shirt: SHIRT_HEX[a.shirt], pants: PANTS_HEX[a.pants], hairColor: '#3b2a1e', eyes: '#1d1d22' }
}

// C1: zombie skin is pale and grey (not green); clothes muted, a little faded.
const ZOMBIE_SKIN = ['#a8a291', '#9d9c8c', '#b1a797', '#8e8b7e', '#a39a8f']
const ZOMBIE_SHIRT = ['#5b4a3a', '#4a5560', '#6b3b3b', '#55603a', '#6a6558', '#7a7468']
const ZOMBIE_PANTS = ['#3a3f4a', '#4a4031', '#2f3a2f', '#4d4a45']
const ZOMBIE_PRESETS: BodyPreset[] = ['balanced', 'sturdy', 'slim']
const ZOMBIE_HAIR: HairStyle[] = ['short', 'long', 'mohawk']

/** Deterministic zombie variant from its ID: same zombie looks the same after a reload. */
export function zombieLook(id: string): CharacterLook {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0
  const pick = <T>(list: readonly T[], shift: number) => list[(h >>> shift) % list.length]
  return {
    preset: pick(ZOMBIE_PRESETS, 0),
    hair: pick(ZOMBIE_HAIR, 3),
    outfit: pick(OUTFIT_STYLES, 17),
    skin: pick(ZOMBIE_SKIN, 6),
    shirt: pick(ZOMBIE_SHIRT, 9),
    pants: pick(ZOMBIE_PANTS, 13),
    hairColor: '#2c2a24',
    eyes: '#3a1010',
  }
}

const shade = (hex: string, k: number) => `#${new Color(hex).multiplyScalar(k).getHexString()}`

/**
 * C2: fixed colours of each outfit's secondary parts (the shirt/pants colours paint the top and
 * bottom): trim = crew neck / inner T-shirt / placket and cuffs / sleeve roll, belt = zip edges, belt,
 * strap buckles; stain = belt buckle metal.
 */
const OUTFIT_COLORS: Record<OutfitId, (shirt: string) => { trim: string; shoes: string; belt: string; sole: string; stain: string }> = {
  tee: (shirt) => ({ trim: shade(shirt, 0.72), shoes: '#3b3430', belt: '#2e2a26', sole: '#1f1d1b', stain: '#4a2a22' }),
  jacket: () => ({ trim: '#b7b1a5', shoes: '#4a3a2c', belt: '#26231f', sole: '#221e1b', stain: '#4a2a22' }),
  shirt: (shirt) => ({ trim: shade(shirt, 0.84), shoes: '#221f1e', belt: '#2f2219', sole: '#121111', stain: '#a39c88' }),
  work: (shirt) => ({ trim: shade(shirt, 0.8), shoes: '#5a4330', belt: '#8f8c83', sole: '#1d1a17', stain: '#4a2a22' }),
}

/** Palette in slot order (see `SLOT`). */
export function lookPalette(look: CharacterLook): string[] {
  const out = new Array<string>(SLOT_COUNT)
  const fixed = OUTFIT_COLORS[look.outfit](look.shirt)
  out[SLOT.skin] = look.skin
  out[SLOT.top] = look.shirt
  out[SLOT.trim] = look.trim ?? fixed.trim
  out[SLOT.bottom] = look.pants
  out[SLOT.shoes] = look.shoes ?? fixed.shoes
  out[SLOT.hair] = look.hairColor
  out[SLOT.eyes] = look.eyes
  out[SLOT.belt] = look.belt ?? fixed.belt
  out[SLOT.sole] = look.sole ?? fixed.sole
  out[SLOT.stain] = look.stain ?? fixed.stain
  return out
}

/** Bounds of every pose (swing, reach, fall) around the feet: fixed, so culling never clips a limb. */
const POSE_BOUNDS = new Sphere(new Vector3(0, 0.9, 0), 1.6)

export function buildCharacter(look: CharacterLook, shadows: ShadowDetail = 'full'): CharacterRig {
  const frame = BODY_FRAMES[look.preset]
  const offsets = boneOffsets(frame)
  const rest = boneRest(frame)
  const bones = {} as Record<BoneName, Bone>
  for (const name of BONES) {
    const bone = new Bone()
    bone.name = name
    bone.position.set(...offsets[name])
    // Arms: pitch, then yaw (pose.ts convention).
    if (name === 'shoulderL' || name === 'shoulderR') bone.rotation.order = 'YXZ'
    const parent = BONE_PARENT[name]
    if (parent) bones[parent].add(bone)
    bones[name] = bone
  }

  const root = new Group()
  root.name = 'character'
  const material = new CharacterMaterial(lookPalette(look))
  const mesh = new SkinnedMesh(bodyGeometry({ preset: look.preset, hair: look.hair, outfit: look.outfit }), material)
  mesh.name = 'character-body'
  mesh.castShadow = shadows !== 'none'
  mesh.boundingSphere = POSE_BOUNDS.clone()
  root.add(mesh, bones.hips)
  // Rest pose = pure translations: the inverse bind matrices follow from the rest positions.
  const inverses = BONES.map((b) => new Matrix4().makeTranslation(-rest[b][0], -rest[b][1], -rest[b][2]))
  const skeleton = new Skeleton(BONES.map((b) => bones[b]), inverses)
  mesh.bind(skeleton, new Matrix4())

  // Weapon socket in the right fist. Weapons extend along their +Z from the grip; tilting the socket
  // 45° points a held weapon down-forward with the forearm hanging and forward-up when it is level.
  const weaponSocket = new Group()
  weaponSocket.name = 'weaponSocket'
  weaponSocket.position.set(0, -GRIP, 0.01)
  weaponSocket.rotation.x = Math.PI / 4
  bones.elbowR.add(weaponSocket)

  return {
    root, mesh, ...bones, weaponSocket, material,
    dispose: () => {
      material.dispose()
      skeleton.dispose()
    },
  }
}

/** Write a computed pose into the rig's bones. */
export function applyPose(rig: CharacterRig, pose: Pose): void {
  rig.root.rotation.set(pose.rootPitch, 0, pose.rootRoll)
  rig.root.position.y = pose.rootLift
  rig.hips.position.y = RIG.hipHeight + pose.bodyY
  rig.hips.rotation.set(0, pose.hipsYaw, pose.hipsRoll)
  rig.torso.rotation.set(pose.bodyPitch, pose.torsoTwist, pose.torsoRoll)
  rig.head.rotation.set(pose.headPitch, pose.headYaw, pose.headRoll)
  rig.shoulderL.rotation.set(pose.armL.x, pose.armL.y, pose.armL.z)
  rig.shoulderR.rotation.set(pose.armR.x, pose.armR.y, pose.armR.z)
  rig.elbowL.rotation.x = pose.elbowL
  rig.elbowR.rotation.x = pose.elbowR
  rig.hipL.rotation.set(pose.legL, 0, pose.legSplayL)
  rig.hipR.rotation.set(pose.legR, 0, -pose.legSplayR)
  rig.kneeL.rotation.x = pose.kneeL
  rig.kneeR.rotation.x = pose.kneeR
  rig.ankleL.rotation.x = pose.ankleL
  rig.ankleR.rotation.x = pose.ankleR
}

const HIT_FLASH = new Color('#ffffff')
const NO_EMISSIVE = new Color('#000000')
const EYE_GLOW = new Color('#ff3322').multiplyScalar(2.2)

/** Per-instance tint: white flash when hit, glowing eyes while hunting. Other characters are unaffected. */
export function setCharacterGlow(rig: CharacterRig, flash: boolean, eyesGlow: boolean): void {
  const m = rig.material
  m.emissive.copy(flash ? HIT_FLASH : NO_EMISSIVE)
  m.emissiveIntensity = flash ? 0.7 : 0
  m.eyeGlow.copy(eyesGlow ? EYE_GLOW : NO_EMISSIVE)
}

/**
 * Per-instance opacity for the player-vision fade. The material only switches to transparent while
 * fading (depth writes stay on so inner faces never show through).
 */
export function setCharacterOpacity(rig: CharacterRig, opacity: number): void {
  const m = rig.material
  const fading = opacity < 0.999
  if (m.transparent !== fading) {
    m.transparent = fading
    m.needsUpdate = true
  }
  m.opacity = fading ? opacity : 1
}
