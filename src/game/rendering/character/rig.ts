import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, type Material } from 'three'
import { PANTS_HEX, SHIRT_HEX, SKIN_HEX, type BodyPreset, type CharacterAppearance, type HairStyle } from '../../entities/appearance'
import type { Pose } from './pose'

/**
 * One procedural low-poly rig for every player preset and every zombie (no external asset,
 * nothing to license). The root sits at the feet, +Z is forward, the right hand is on −X.
 * Joints are plain Groups; `applyPose` only writes their transforms each frame.
 */
export const RIG = {
  legLength: 0.86,
  torsoHeight: 0.58,
  headSize: 0.27,
  armLength: 0.64,
  sleeveLength: 0.26,
  neck: 0.03,
} as const

/**
 * Same height/collider for all presets; only widths change (cosmetic). Shoulder-to-shoulder width is
 * torsoW + 2·armW + 0.04 and must stay ≤ the capsule diameter (0.8 m) so no preset clips walls.
 */
export const PRESET_DIMENSIONS: Record<BodyPreset, { torsoW: number; torsoD: number; armW: number; legW: number }> = {
  balanced: { torsoW: 0.46, torsoD: 0.26, armW: 0.12, legW: 0.16 },
  sturdy: { torsoW: 0.5, torsoD: 0.3, armW: 0.13, legW: 0.18 },
  slim: { torsoW: 0.4, torsoD: 0.22, armW: 0.1, legW: 0.14 },
}

export interface CharacterLook {
  preset: BodyPreset
  hair: HairStyle
  skin: string
  shirt: string
  pants: string
  hairColor: string
  eyes: string
}

/**
 * Shadow casters per character (each caster is one extra draw call in the shadow pass):
 * 'full' = torso, head and legs (arms/hair add little from the high isometric camera),
 * 'body' = torso only, 'none' = nothing.
 */
export type ShadowDetail = 'full' | 'body' | 'none'

/** Shadow quality setting → casting parts. Low shadows keep one caster per body part group. */
export function shadowDetail(setting: 'off' | 'low' | 'high'): ShadowDetail {
  return setting === 'high' ? 'full' : setting === 'low' ? 'body' : 'none'
}

export interface CharacterRig {
  root: Group
  hips: Group
  torso: Group
  head: Group
  shoulderL: Group
  shoulderR: Group
  hipL: Group
  hipR: Group
  /** Right-hand weapon attachment point, at the end of the right arm. */
  weaponSocket: Group
  /** Per-instance materials for hit flash / eye glow; disposed with the rig. */
  materials: { skin: MeshStandardMaterial; shirt: MeshStandardMaterial; pants: MeshStandardMaterial; hair: MeshStandardMaterial; eyes: MeshStandardMaterial }
  dispose: () => void
}

/** A single shared unit cube scaled per part keeps geometry memory flat for any crowd size. */
const UNIT_BOX = new BoxGeometry(1, 1, 1)

export function playerLook(a: CharacterAppearance): CharacterLook {
  return { preset: a.preset, hair: a.hair, skin: SKIN_HEX[a.skin], shirt: SHIRT_HEX[a.shirt], pants: PANTS_HEX[a.pants], hairColor: '#3b2a1e', eyes: '#1d1d22' }
}

const ZOMBIE_SKIN = ['#7f9a6a', '#8e9c7c', '#6f8a70', '#9aa384']
const ZOMBIE_SHIRT = ['#5b4a3a', '#4a5560', '#6b3b3b', '#55603a', '#6a6558']
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
    skin: pick(ZOMBIE_SKIN, 6),
    shirt: pick(ZOMBIE_SHIRT, 9),
    pants: pick(ZOMBIE_PANTS, 13),
    hairColor: '#2c2a24',
    eyes: '#3a1010',
  }
}

function part(material: Material, size: [number, number, number], position: [number, number, number], castShadow: boolean): Mesh {
  const mesh = new Mesh(UNIT_BOX, material)
  mesh.scale.set(...size)
  mesh.position.set(...position)
  mesh.castShadow = castShadow
  return mesh
}

export function buildCharacter(look: CharacterLook, shadows: ShadowDetail = 'full'): CharacterRig {
  const d = PRESET_DIMENSIONS[look.preset]
  const full = shadows === 'full'
  const body = shadows !== 'none'
  const limbs = false // arms and hair never cast: small from the isometric camera, one draw call each
  const mat = (color: string) => new MeshStandardMaterial({ color, roughness: 0.85 })
  const materials = { skin: mat(look.skin), shirt: mat(look.shirt), pants: mat(look.pants), hair: mat(look.hairColor), eyes: mat(look.eyes) }

  const root = new Group()
  root.name = 'character'
  const hips = new Group()
  hips.position.y = RIG.legLength
  root.add(hips)

  // Legs pivot at the hip and hang down.
  const legX = d.torsoW / 2 - d.legW / 2 - 0.02
  const hipL = new Group()
  hipL.position.set(legX, 0, 0)
  hipL.add(part(materials.pants, [d.legW, RIG.legLength, d.legW + 0.02], [0, -RIG.legLength / 2, 0], full))
  const hipR = new Group()
  hipR.position.set(-legX, 0, 0)
  hipR.add(part(materials.pants, [d.legW, RIG.legLength, d.legW + 0.02], [0, -RIG.legLength / 2, 0], full))
  hips.add(hipL, hipR)

  const torso = new Group()
  hips.add(torso)
  torso.add(part(materials.shirt, [d.torsoW, RIG.torsoHeight, d.torsoD], [0, RIG.torsoHeight / 2, 0], body))

  const head = new Group()
  head.position.y = RIG.torsoHeight + RIG.neck
  torso.add(head)
  const hs = RIG.headSize
  head.add(part(materials.skin, [hs, hs * 1.05, hs], [0, hs / 2, 0], full))
  // Eyes band on the face (+Z) shows facing; zombies make it glow while hunting.
  head.add(part(materials.eyes, [hs * 0.7, hs * 0.14, 0.02], [0, hs * 0.58, hs / 2 + 0.005], false))
  addHair(head, look.hair, materials.hair, hs, limbs)

  // Arms pivot at the shoulder; sleeve (shirt) + forearm/hand (skin). Euler YXZ: pitch, then yaw.
  const shoulderY = RIG.torsoHeight - 0.06
  const armX = d.torsoW / 2 + d.armW / 2 + 0.01
  const makeArm = (x: number) => {
    const g = new Group()
    g.position.set(x, shoulderY, 0)
    g.rotation.order = 'YXZ'
    g.add(part(materials.shirt, [d.armW + 0.02, RIG.sleeveLength, d.armW + 0.02], [0, -RIG.sleeveLength / 2, 0], limbs))
    const fore = RIG.armLength - RIG.sleeveLength
    g.add(part(materials.skin, [d.armW, fore, d.armW], [0, -RIG.sleeveLength - fore / 2, 0], limbs))
    return g
  }
  const shoulderL = makeArm(armX)
  const shoulderR = makeArm(-armX)
  torso.add(shoulderL, shoulderR)

  // Weapon socket in the right hand. Weapons extend along their +Z from the grip; tilting the socket
  // 45° points a held weapon down-forward at rest and forward-up when the arm swings level.
  const weaponSocket = new Group()
  weaponSocket.name = 'weaponSocket'
  weaponSocket.position.set(0, -RIG.armLength + 0.05, 0)
  weaponSocket.rotation.x = Math.PI / 4
  shoulderR.add(weaponSocket)

  return {
    root, hips, torso, head, shoulderL, shoulderR, hipL, hipR, weaponSocket, materials,
    dispose: () => {
      for (const m of Object.values(materials)) m.dispose()
    },
  }
}

function addHair(head: Group, style: HairStyle, material: Material, hs: number, castShadow: boolean): void {
  if (style === 'short') {
    head.add(part(material, [hs + 0.02, hs * 0.28, hs + 0.02], [0, hs * 1.02, -0.005], castShadow))
  } else if (style === 'long') {
    head.add(part(material, [hs + 0.03, hs * 0.3, hs + 0.03], [0, hs * 1.02, -0.005], castShadow))
    head.add(part(material, [hs + 0.03, hs * 0.95, 0.07], [0, hs * 0.55, -hs / 2 - 0.03], castShadow))
  } else {
    head.add(part(material, [0.07, hs * 0.35, hs * 0.95], [0, hs * 1.12, 0], castShadow))
  }
}

/** Write a computed pose into the rig's joints. */
export function applyPose(rig: CharacterRig, pose: Pose): void {
  rig.root.rotation.x = pose.rootPitch
  rig.hips.position.y = RIG.legLength + pose.bodyY
  rig.torso.rotation.set(pose.bodyPitch, pose.torsoTwist, 0)
  rig.head.rotation.set(pose.headPitch, 0, pose.headRoll)
  rig.shoulderL.rotation.set(pose.armL.x, pose.armL.y, pose.armL.z)
  rig.shoulderR.rotation.set(pose.armR.x, pose.armR.y, pose.armR.z)
  rig.hipL.rotation.x = pose.legL
  rig.hipR.rotation.x = pose.legR
}

const HIT_FLASH = new Color('#ffffff')
const NO_EMISSIVE = new Color('#000000')
const EYE_GLOW = new Color('#ff3322')

/** Per-instance tint: white flash when hit, glowing eyes while hunting. Other characters are unaffected. */
export function setCharacterGlow(rig: CharacterRig, flash: boolean, eyesGlow: boolean): void {
  const m = rig.materials
  for (const mat of [m.skin, m.shirt, m.pants]) {
    mat.emissive.copy(flash ? HIT_FLASH : NO_EMISSIVE)
    mat.emissiveIntensity = flash ? 0.7 : 0
  }
  m.eyes.emissive.copy(eyesGlow ? EYE_GLOW : NO_EMISSIVE)
  m.eyes.emissiveIntensity = eyesGlow ? 1.4 : 0
}

/**
 * Per-instance opacity for the player-vision fade. Materials only switch to transparent while
 * fading (depth writes stay on so inner faces of the box parts never show through).
 */
export function setCharacterOpacity(rig: CharacterRig, opacity: number): void {
  const fading = opacity < 0.999
  for (const m of Object.values(rig.materials)) {
    if (m.transparent !== fading) {
      m.transparent = fading
      m.needsUpdate = true
    }
    m.opacity = fading ? opacity : 1
  }
}
