import { Canvas } from '@react-three/fiber'
import { Scene } from '../game/rendering/Scene'
import { useUiStore } from '../stores/uiStore'

export function GameCanvas() {
  const sessionId = useUiStore((s) => s.sessionId)
  const screen = useUiStore((s) => s.screen)
  const debug = useUiStore((s) => s.debug)

  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 1.5]}
      gl={{ antialias: true }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <color attach="background" args={['#161a21']} />
      <Scene key={sessionId} paused={screen !== 'playing'} debug={debug} />
    </Canvas>
  )
}
