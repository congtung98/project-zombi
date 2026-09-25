import { Canvas } from '@react-three/fiber'
import { Scene } from '../game/rendering/Scene'
import { useSettingsStore } from '../stores/settingsStore'
import { useUiStore } from '../stores/uiStore'

export function GameCanvas() {
  const sessionId = useUiStore((s) => s.sessionId)
  const screen = useUiStore((s) => s.screen)
  const debug = useUiStore((s) => s.debug)
  const visionDebug = useUiStore((s) => s.visionDebug)
  const lightingDebug = useUiStore((s) => s.lightingDebug)
  const shadows = useSettingsStore((s) => s.shadows)
  const maxPixelRatio = useSettingsStore((s) => s.maxPixelRatio)

  // Đổi chất lượng bóng/pixel ratio cần tạo lại renderer: key theo cài đặt để remount Canvas.
  return (
    <Canvas
      key={`${shadows}-${maxPixelRatio}`}
      shadows={shadows === 'off' ? false : shadows === 'low' ? 'basic' : 'percentage'}
      dpr={[1, maxPixelRatio]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Scene key={sessionId} paused={screen !== 'playing'} debug={debug} visionDebug={visionDebug} lightingDebug={lightingDebug} />
    </Canvas>
  )
}
