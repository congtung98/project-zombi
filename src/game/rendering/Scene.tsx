import { useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { runAnimators } from './character/animators'
import { Physics } from '@react-three/rapier'
import { runtime } from '../core/runtime'
import { useWorldStore } from '../../stores/worldStore'
import { BuildingView, RoofController } from './BuildingView'
import { CameraRig } from './CameraRig'
import { ContainerView } from './ContainerView'
import { CursorProbe } from './CursorProbe'
import { DoorView } from './DoorView'
import { GameLoop } from './GameLoop'
import { Ground } from './Ground'
import { Lights } from './Lights'
import { OcclusionFader } from './OcclusionFader'
import { PhysicsBridge } from './PhysicsBridge'
import { PerfProbe } from './PerfProbe'
import { PlayerVisionDebug } from './PlayerVisionDebug'
import { VisionOverlay } from './VisionOverlay'
import { IndoorLighting } from './IndoorLighting'
import { WindowView } from './WindowView'
import { LampView } from './LampView'
import { BuildingLightingDebug } from './BuildingLightingDebug'
import { mapRooms, mapWindows } from '../world/mapData'
import { useSettingsStore } from '../../stores/settingsStore'
import { PlayerView } from './PlayerView'
import { Roads } from './Roads'
import { Walls } from './Walls'
import { ZombieBody, ZombieView } from './ZombieView'

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

function Drops() {
  const drops = useWorldStore((s) => s.drops)
  return (
    <>
      {drops.map((drop) => (
        <mesh key={drop.id} position={[drop.position.x, 0.18, drop.position.z]}>
          <boxGeometry args={[0.45, 0.36, 0.45]} />
          <meshStandardMaterial color="#d5ac54" />
        </mesh>
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
  const map = runtime.map

  return (
    <>
      <InputBridge />
      <Lights />
      <CameraRig />
      <CursorProbe />
      <Roads />
      <Drops />
      {map.buildings.map((b) => (
        <BuildingView key={b.id} building={b} />
      ))}
      <RoofController />
      <Physics gravity={[0, -9.81, 0]} paused={paused} debug={debug} timeStep={1 / 60}>
        <PhysicsBridge />
        <Ground />
        <Walls />
        {map.doors.map((door) => (
          <DoorView key={door.id} door={door} />
        ))}
        {map.containers.map((c) => (
          <ContainerView key={c.id} container={c} />
        ))}
        {mapWindows(map).map((w) => (
          <WindowView key={w.id} win={w} />
        ))}
        <PlayerView />
        <ZombieBodies />
      </Physics>
      <ZombieVisuals />
      {mapRooms(map).flatMap((r) => (r.lamp ? [<LampView key={r.lamp.id} lamp={r.lamp} />] : []))}
      <OcclusionFader />
      {/* Building lighting: indoor fragments take the room light; outdoor ones keep the day/night lights. */}
      <IndoorLighting />
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
