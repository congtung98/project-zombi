import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { runtime } from '../core/runtime'
import { useWorldStore } from '../../stores/worldStore'
import { BuildingView } from './BuildingView'
import { CameraRig } from './CameraRig'
import { ContainerView } from './ContainerView'
import { CursorProbe } from './CursorProbe'
import { DoorView } from './DoorView'
import { GameLoop } from './GameLoop'
import { Ground } from './Ground'
import { Lights } from './Lights'
import { OcclusionFader } from './OcclusionFader'
import { PhysicsBridge } from './PhysicsBridge'
import { PlayerView } from './PlayerView'
import { Roads } from './Roads'
import { Walls } from './Walls'
import { ZombieView } from './ZombieView'

interface SceneProps {
  paused: boolean
  debug: boolean
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

/**
 * Scene được remount (key = sessionId) khi bắt đầu ván mới hoặc load để mọi
 * physics body được tạo lại từ trạng thái runtime (vị trí đã lưu). Danh sách
 * zombie là mirror trong worldStore (spawn/dọn xác thêm/bớt view).
 */
export function Scene({ paused, debug }: SceneProps) {
  const zombieIds = useWorldStore((s) => s.zombieIds)
  const map = runtime.map

  return (
    <>
      <InputBridge />
      <Lights />
      <CameraRig />
      <CursorProbe />
      <Roads />
      {map.buildings.map((b) => (
        <BuildingView key={b.id} building={b} />
      ))}
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
        <PlayerView />
        {zombieIds.map((id) => (
          <ZombieView key={id} id={id} />
        ))}
      </Physics>
      <OcclusionFader />
      <GameLoop paused={paused} />
    </>
  )
}
