import { useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrthographicCamera } from '@react-three/drei'
import { GAME_CONFIG } from '../game/core/config'
import { DEFAULT_APPEARANCE, OUTFIT_STYLES, type CharacterAppearance } from '../game/entities/appearance'
import { computePose, createPose, type PoseInput } from '../game/rendering/character/pose'
import { applyPose, buildCharacter, playerLook, zombieLook, type CharacterLook } from '../game/rendering/character/rig'
import { buildWeaponModel } from '../game/rendering/character/weaponModels'
import { ZOMBIE_POSTURES } from '../game/rendering/character/zombieVariants'

/**
 * C0 (character plan): dev-only character lab, `/?lab=characters` on the dev server. Same rig, pose
 * functions, camera angle, zoom (px/m) and day lights as the game, on a 1 m grid (25 cm from zoom 60), with fixed
 * pose inputs (no clock), so screenshots are identical run to run and compare before/after a sprint.
 * URL: `set` = lineup | states | turn | close | outfits | combat | zombies, `zoom` (px/m, game default 28), `yaw` (rad, facing of the
 * states set), `t` (s, idle breathing time). `window.__labReady` is set once the frame is drawn.
 */
const CAM = GAME_CONFIG.camera
const L = GAME_CONFIG.lighting
const MELEE = GAME_CONFIG.melee
const HIT_AT = MELEE.hitDelay / MELEE.swingDuration

export interface LabActor {
  label: string
  look: CharacterLook
  kind: 'player' | 'zombie'
  weapon?: string
  pose: Partial<PoseInput>
  facing: number
}

const IDLE: PoseInput = { kind: 'player', time: 0, gaitPhase: 0, speed: 0, swing: -1, hitAt: HIT_AT, shove: -1, attack: -1, hurt: 0, dead: -1, armed: false, work: -1 }

const player = playerLook(DEFAULT_APPEARANCE)
const zombie = zombieLook('zombie-1')

function lineup(yaw: number): LabActor[] {
  const actors: LabActor[] = [
    { label: 'player', look: player, kind: 'player', pose: {}, facing: yaw },
    { label: 'player armed', look: player, kind: 'player', weapon: 'baseball_bat', pose: { armed: true }, facing: yaw },
  ]
  for (let i = 1; i <= 4; i++) actors.push({ label: `zombie-${i}`, look: zombieLook(`zombie-${i}`), kind: 'zombie', pose: {}, facing: yaw })
  return actors
}

function states(yaw: number): LabActor[] {
  const P = (label: string, pose: Partial<PoseInput>): LabActor => ({ label, look: player, kind: 'player', weapon: 'baseball_bat', pose: { armed: true, ...pose }, facing: yaw })
  const Z = (label: string, pose: Partial<PoseInput>): LabActor => ({ label, look: zombie, kind: 'zombie', pose, facing: yaw })
  return [
    P('idle', {}),
    P('walk', { speed: GAME_CONFIG.player.walkSpeed, gaitPhase: Math.PI / 2 }),
    P('run', { speed: GAME_CONFIG.player.runSpeed, gaitPhase: Math.PI / 2 }),
    P('swing windup', { swing: 0.1 }),
    P('swing hit', { swing: HIT_AT }),
    P('swing follow', { swing: 0.8 }),
    P('hurt', { hurt: 1 }),
    P('dead', { dead: 1 }),
    Z('z idle', {}),
    Z('z walk', { speed: GAME_CONFIG.zombie.speed, gaitPhase: Math.PI / 2 }),
    Z('z attack raise', { attack: 0.6 }),
    Z('z attack hit', { attack: 1 }),
    Z('z hurt', { hurt: 1 }),
    Z('z dead', { dead: 1 }),
  ]
}

/** Close-up: the player from the front three-quarter, side and back, and two zombies. */
function close(): LabActor[] {
  return [
    { label: 'front', look: player, kind: 'player', pose: {}, facing: Math.PI / 4 },
    { label: 'side', look: player, kind: 'player', weapon: 'baseball_bat', pose: { armed: true }, facing: -Math.PI / 4 },
    { label: 'back', look: player, kind: 'player', pose: {}, facing: Math.PI + Math.PI / 4 },
    { label: 'zombie front', look: zombieLook('zombie-2'), kind: 'zombie', pose: {}, facing: Math.PI / 4 },
    { label: 'zombie side', look: zombieLook('zombie-3'), kind: 'zombie', pose: { speed: GAME_CONFIG.zombie.speed, gaitPhase: Math.PI / 2 }, facing: -Math.PI / 4 },
  ]
}

/** C2: every outfit (front three-quarter row, back row), with the hair styles and presets mixed in. */
function outfits(): LabActor[] {
  const looks: CharacterAppearance[] = [
    { ...DEFAULT_APPEARANCE, outfit: 'tee' },
    { ...DEFAULT_APPEARANCE, outfit: 'jacket', shirt: 'grey', pants: 'denim', hair: 'long', skin: 'light', preset: 'slim' },
    { ...DEFAULT_APPEARANCE, outfit: 'shirt', shirt: 'blue', pants: 'black', hair: 'short', skin: 'brown' },
    { ...DEFAULT_APPEARANCE, outfit: 'work', shirt: 'red', pants: 'olive', hair: 'mohawk', skin: 'dark', preset: 'sturdy' },
  ]
  if (looks.length !== OUTFIT_STYLES.length) throw new Error('lab: one look per outfit')
  return [
    ...looks.map((a) => ({ label: `${a.outfit} front`, look: playerLook(a), kind: 'player' as const, pose: {}, facing: Math.PI / 4 })),
    ...looks.map((a) => ({ label: `${a.outfit} back`, look: playerLook(a), kind: 'player' as const, pose: { speed: 4, gaitPhase: Math.PI / 2 }, facing: Math.PI + Math.PI / 4 })),
  ]
}

/** C4: swing phases with the two-handed grip, hit reactions by direction, the five death falls. */
function combat(yaw: number): LabActor[] {
  const P = (label: string, pose: Partial<PoseInput>): LabActor => ({ label, look: player, kind: 'player', weapon: 'baseball_bat', pose: { armed: true, ...pose }, facing: yaw })
  const Z = (label: string, pose: Partial<PoseInput>): LabActor => ({ label, look: zombieLook('zombie-6'), kind: 'zombie', pose, facing: yaw })
  return [
    P('windup', { swing: 0.2 }),
    P('contact', { swing: HIT_AT }),
    P('follow', { swing: 0.8 }),
    P('hurt front', { hurt: 1, hurtDir: Math.PI }),
    P('hurt left', { hurt: 1, hurtDir: Math.PI / 2 }),
    Z('z hurt back', { hurt: 1, hurtDir: 0 }),
    Z('fall back', { dead: 1, fall: 'back' }),
    Z('fall front', { dead: 1, fall: 'front' }),
    Z('fall left', { dead: 1, fall: 'left' }),
    Z('fall right', { dead: 1, fall: 'right' }),
    Z('crumple', { dead: 1, fall: 'crumple' }),
    Z('mid fall', { dead: 0.55, fall: 'back' }),
  ]
}

/** C5: the four zombie postures wandering (arms hanging, back row) and hunting (arms reaching). */
function zombies(yaw: number): LabActor[] {
  const looks = ['zombie-2', 'zombie-5', 'zombie-8', 'zombie-13'].map((id) => ({ ...zombieLook(id), worn: true }))
  const row = (reach: number) => ZOMBIE_POSTURES.map((posture, i) => ({
    label: `${posture} ${reach ? 'hunt' : 'wander'}`,
    look: looks[i],
    kind: 'zombie' as const,
    pose: { posture, reach, speed: reach ? GAME_CONFIG.zombie.speed : GAME_CONFIG.zombie.wanderSpeed, gaitPhase: 0.9 + i, time: i * 0.7 },
    facing: yaw,
  }))
  return [...row(0), ...row(1)]
}

function turn(): LabActor[] {
  const out: LabActor[] = []
  for (let i = 0; i < 8; i++) out.push({ label: `p ${i * 45}°`, look: player, kind: 'player', weapon: 'baseball_bat', pose: { armed: true }, facing: (i * Math.PI) / 4 })
  for (let i = 0; i < 8; i++) out.push({ label: `z ${i * 45}°`, look: zombie, kind: 'zombie', pose: { speed: GAME_CONFIG.zombie.speed, gaitPhase: Math.PI / 2 }, facing: (i * Math.PI) / 4 })
  return out
}

/** Screen-right in world space for the game camera (offset x = z): actors line up across the screen. */
const ACROSS = { x: Math.SQRT1_2, z: -Math.SQRT1_2 }
/** Screen-down (toward the camera) on the ground. */
const TOWARD = { x: Math.SQRT1_2, z: Math.SQRT1_2 }

function Actor({ actor, x, z, time }: { actor: LabActor; x: number; z: number; time: number }) {
  const rig = useMemo(() => buildCharacter(actor.look, 'full'), [actor.look])
  useEffect(() => {
    const weapon = actor.weapon ? buildWeaponModel(actor.weapon as never, false, true) : null
    if (weapon) rig.weaponSocket.add(weapon.group)
    return () => {
      weapon?.group.removeFromParent()
      weapon?.dispose()
      rig.dispose()
    }
  }, [rig, actor.weapon])
  useEffect(() => {
    applyPose(rig, computePose({ ...IDLE, time, kind: actor.kind, ...actor.pose }, createPose()))
  }, [rig, actor, time])
  return (
    <group position={[x, 0, z]} rotation={[0, actor.facing, 0]}>
      <primitive object={rig.root} />
    </group>
  )
}

function Ready() {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    let frames = 0
    let raf = 0
    const tick = () => {
      invalidate()
      if (++frames >= 3) (window as unknown as { __labReady: boolean }).__labReady = true
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [invalidate])
  return null
}

export default function CharacterLab() {
  const params = new URLSearchParams(window.location.search)
  const set = params.get('set') ?? 'lineup'
  const zoom = Number(params.get('zoom') ?? CAM.zoomDefault)
  const yaw = Number(params.get('yaw') ?? Math.PI / 2)
  const time = Number(params.get('t') ?? 0)
  const actors = set === 'states' ? states(yaw) : set === 'turn' ? turn() : set === 'close' ? close() : set === 'outfits' ? outfits() : set === 'combat' ? combat(yaw) : set === 'zombies' ? zombies(yaw) : lineup(Math.PI / 4)
  // Two rows when there are many actors (states: player row behind, zombie row in front).
  const perRow = set === 'lineup' || set === 'close' ? actors.length : set === 'outfits' || set === 'combat' ? 6 : set === 'zombies' ? 4 : 8
  const spacing = 1.8
  const placed = actors.map((actor, i) => {
    const row = Math.floor(i / perRow)
    const col = i % perRow
    const inRow = Math.min(perRow, actors.length - row * perRow)
    const a = (col - (inRow - 1) / 2) * spacing
    const b = (row - 0.5 * (Math.ceil(actors.length / perRow) - 1)) * 3
    return { actor, x: ACROSS.x * a + TOWARD.x * b, z: ACROSS.z * a + TOWARD.z * b }
  })

  return (
    <div style={{ position: 'fixed', inset: 0, background: L.dayBackground }}>
      <Canvas shadows="percentage" dpr={1} gl={{ antialias: true }} frameloop="demand">
        <OrthographicCamera makeDefault position={[CAM.offset.x, CAM.offset.y + 0.9, CAM.offset.z]} zoom={zoom} near={0.1} far={200} onUpdate={(c) => c.lookAt(0, 0.9, 0)} />
        <color attach="background" args={[L.dayBackground]} />
        <ambientLight intensity={L.dayAmbient} color={L.dayAmbientColor} />
        <hemisphereLight args={['#cfe3ff', '#3b4a2f', L.dayHemisphere]} />
        <directionalLight
          position={[18, 32, 12]}
          intensity={L.daySun}
          color={L.daySunColor}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-12}
          shadow-camera-right={12}
          shadow-camera-top={12}
          shadow-camera-bottom={-12}
          shadow-bias={-0.0004}
        />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[40, 40]} />
          <meshStandardMaterial color="#6f6b63" roughness={0.95} />
        </mesh>
        {zoom >= 60 && <gridHelper args={[40, 160, '#7f7a70', '#7f7a70']} position={[0, 0.002, 0]} />}
        <gridHelper args={[40, 40, '#403e3a', '#403e3a']} position={[0, 0.003, 0]} />
        {placed.map((p) => (
          <Actor key={p.actor.label} actor={p.actor} x={p.x} z={p.z} time={time} />
        ))}
        <Ready />
      </Canvas>
    </div>
  )
}
