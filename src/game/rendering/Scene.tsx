import { memo, useEffect, useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { runAnimators } from './character/animators'
import { Physics } from '@react-three/rapier'
import { runtime } from '../core/runtime'
import { useWorldStore } from '../../stores/worldStore'
import { CutawayController, StaticBatches } from './StaticBatches'
import { CameraRig } from './CameraRig'
import { ContainerView } from './ContainerView'
import { CursorProbe } from './CursorProbe'
import { DoorView } from './DoorView'
import { GameLoop } from './GameLoop'
import { Ground } from './Ground'
import { Lights } from './Lights'
import { OcclusionFader } from './OcclusionFader'
import { PerfProbe } from './PerfProbe'
import { PlayerVisionDebug } from './PlayerVisionDebug'
import { VisionOverlay } from './VisionOverlay'
import { IndoorLighting } from './IndoorLighting'
import { InteriorMask } from './InteriorMask'
import { WindowView } from './WindowView'
import { LampView } from './LampView'
import { BuildingLightingDebug } from './BuildingLightingDebug'
import { mapChunkSize } from '../world/mapData'
import { indexChunkEntities, type ChunkEntities } from './chunkEntities'
import { ChunkStreamer } from './ChunkStreamer'
import { useViewChunks } from './viewChunkStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { PlayerView } from './PlayerView'
import { Roads } from './Roads'
import { ChunkColliders } from './ChunkColliders'
import { ZombieBody, ZombieView } from './ZombieView'
import { cutaway } from './cutaway'
import type { Vec3 } from '../../types'

interface SceneProps {
  paused: boolean
  debug: boolean
  visionDebug: boolean
  lightingDebug: boolean
  perfHud: boolean
}

/** Gắn input manager vào canvas của R3F. */
function InputBridge() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    runtime.input.attach(gl.domElement)
    return () => runtime.input.detach()
  }, [gl])
  return null
}

/** Poses every character after the simulation tick (mounted after GameLoop). */
function CharacterAnimator() {
  useFrame((_, delta) => runAnimators(delta))
  return null
}

/**
 * R2: zombie visuals, zombie physics bodies and dropped bags subscribe to their own store slices, so
 * a zombie changing level (or a spawn/drop) re-renders only its list, never the whole scene (which
 * re-rendered ~1 000 static RigidBodies on the stress map: ~180 ms frames).
 */
function ZombieVisuals() {
  const ids = useWorldStore((s) => s.zombieIds)
  return (
    <>
      {ids.map((id) => (
        <ZombieView key={id} id={id} />
      ))}
    </>
  )
}

function ZombieBodies() {
  const ids = useWorldStore((s) => s.zombieBodyIds)
  return (
    <>
      {ids.map((id) => (
        <ZombieBody key={id} id={id} />
      ))}
    </>
  )
}

/** A dropped bag; M11c-1A: hidden on a storey the cutaway hides. */
function DropView({ position }: { position: Vec3 }) {
  const ref = useRef<Mesh>(null)
  useFrame(() => {
    if (ref.current) ref.current.visible = !cutaway.hidesPoint(position)
  })
  return (
    <mesh ref={ref} position={[position.x, position.y + 0.18, position.z]}>
      <boxGeometry args={[0.45, 0.36, 0.45]} />
      <meshStandardMaterial color="#d5ac54" />
    </mesh>
  )
}

function Drops() {
  const drops = useWorldStore((s) => s.drops)
  return (
    <>
      {drops.map((drop) => (
        <DropView key={drop.id} position={drop.position} />
      ))}
    </>
  )
}

/** Doors, containers, windows and lamps of one chunk (M10: mounted while the chunk is shown). */
const ChunkViews = memo(function ChunkViews({ entities }: { entities: ChunkEntities }) {
  return (
    <>
      {entities.doors.map((door) => (
        <DoorView key={door.id} door={door} />
      ))}
      {entities.containers.map((c) => (
        <ContainerView key={c.id} container={c} />
      ))}
      {entities.windows.map((w) => (
        <WindowView key={w.id} win={w} />
      ))}
      {entities.lamps.map((lamp) => (
        <LampView key={lamp.id} lamp={lamp} />
      ))}
    </>
  )
})

/** Interactive views of the shown chunks (every chunk when streaming is off). */
function StreamedViews() {
  const index = useMemo(() => indexChunkEntities(runtime.map, mapChunkSize(runtime.map)), [])
  const shown = useViewChunks()
  const keys = shown === null ? [...index.keys()] : shown.filter((k) => index.has(k))
  return (
    <>
      {keys.map((k) => (
        <ChunkViews key={k} entities={index.get(k)!} />
      ))}
    </>
  )
}

/**
 * Scene được remount (key = sessionId) khi bắt đầu ván mới hoặc load để mọi
 * physics body được tạo lại từ trạng thái runtime (vị trí đã lưu). Danh sách
 * zombie là mirror trong worldStore (spawn/dọn xác thêm/bớt view).
 */
export function Scene({ paused, debug, visionDebug, lightingDebug, perfHud }: SceneProps) {
  const visionOverlay = useSettingsStore((s) => s.visionOverlay) && runtime.config.visionOverlay.enabled

  return (
    <>
      <InputBridge />
      <Lights />
      <CameraRig />
      <CursorProbe />
      <ChunkStreamer />
      <Roads />
      <Drops />
      <StaticBatches />
      {/* M11c-1A: cuts the building the player is in (presentation only, before the fader). */}
      <CutawayController />
      <Physics gravity={[0, -9.81, 0]} paused={paused} debug={debug} timeStep={1 / 60}>
        <Ground />
        <ChunkColliders />
        {/* Door leaves carry their own bodies: inside Physics. Windows and lamps have none. */}
        <StreamedViews />
        <PlayerView />
        <ZombieBodies />
      </Physics>
      <ZombieVisuals />
      <OcclusionFader />
      {/* Building lighting: indoor fragments take the room light; outdoor ones keep the day/night lights. */}
      <IndoorLighting />
      {/* M11c-1B: indoor cells not seen now are darkened (a factor after the light; F4 tints). */}
      <InteriorMask debug={visionDebug} />
      {lightingDebug && <BuildingLightingDebug />}
      {/* Perception shade over the finished frame; never a light (see VisionOverlay). */}
      {visionOverlay && <VisionOverlay debug={visionDebug} />}
      {visionDebug && <PlayerVisionDebug />}
      <GameLoop paused={paused} />
      <PerfProbe countObjects={perfHud} />
      <CharacterAnimator />
    </>
  )
}
