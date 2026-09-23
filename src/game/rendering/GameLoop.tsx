import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { runtime } from '../core/runtime'
import { useHudStore } from '../../stores/hudStore'

interface GameLoopProps {
  paused: boolean
}

/**
 * Chạy simulation mỗi frame. Pause dừng hoàn toàn tick (cooldown, đồng hồ,
 * chỉ số) nhưng vẫn đồng bộ HUD để màn hình pause hiển thị đúng.
 */
export function GameLoop({ paused }: GameLoopProps) {
  const hudTimer = useRef(0)
  const fpsFrames = useRef(0)
  const fpsTime = useRef(0)
  const fps = useRef(0)

  useFrame((_, delta) => {
    fpsFrames.current += 1
    fpsTime.current += delta
    if (fpsTime.current >= 0.5) {
      fps.current = Math.round(fpsFrames.current / fpsTime.current)
      fpsFrames.current = 0
      fpsTime.current = 0
    }

    if (!paused) runtime.tick(delta)

    hudTimer.current += delta
    if (hudTimer.current >= runtime.config.loop.hudSyncInterval) {
      hudTimer.current = 0
      useHudStore.getState().sync(runtime, fps.current)
    }
  })

  return null
}
