import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { runtime } from '../core/runtime'
import { CameraRig } from './CameraRig'
import { GameLoop } from './GameLoop'
import { Ground } from './Ground'
import { Lights } from './Lights'
import { PlayerView } from './PlayerView'
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
 * Scene được remount (key = sessionId) khi bắt đầu ván mới để mọi physics body
 * được tạo lại từ trạng thái runtime sạch.
 */
export function Scene({ paused, debug }: SceneProps) {
  const zombieIds = useMemo(() => Array.from(runtime.zombies.keys()), [])

  return (
    <>
      <InputBridge />
      <Lights />
      <CameraRig />
      <Physics gravity={[0, -9.81, 0]} paused={paused} debug={debug} timeStep={1 / 60}>
        <Ground />
        <Walls />
        <PlayerView />
        {zombieIds.map((id) => (
          <ZombieView key={id} id={id} />
        ))}
      </Physics>
      <GameLoop paused={paused} />
    </>
  )
}
