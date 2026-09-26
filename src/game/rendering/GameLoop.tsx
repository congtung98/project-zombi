import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { runtime } from '../core/runtime'
import { useHudStore } from '../../stores/hudStore'
import { useUiStore } from '../../stores/uiStore'

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
  const frames = useRef(0)
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)

  useFrame((_, delta) => {
    // Dev only: last frame's renderer stats for scripts/p2-render-bench.mjs (not a GPU benchmark).
    if (import.meta.env.DEV) {
      const r = gl.info.render
      const w = window as unknown as { __renderInfo: object; __scene: object }
      w.__renderInfo = { calls: r.calls, triangles: r.triangles, fps: fps.current }
      w.__scene = scene
    }
    fpsFrames.current += 1
    fpsTime.current += delta
    if (fpsTime.current >= 0.5) {
      fps.current = Math.round(fpsFrames.current / fpsTime.current)
      fpsFrames.current = 0
      fpsTime.current = 0
    }

    if (!paused) {
      runtime.tick(delta)
      if (frames.current < 2) {
        frames.current += 1
        if (frames.current === 2) useUiStore.getState().markSceneReady()
      }
      // Autosave ngay sau tick: snapshot ở ranh giới tick, không thấy trạng thái nửa chừng.
      if (runtime.consumeAutosave()) void useUiStore.getState().saveGame('Đã tự động lưu.')
    } else {
      // M10: menu/pause frames warm the nav graph of big worlds (a few ms each, until done).
      runtime.idleWork()
    }

    hudTimer.current += delta
    if (hudTimer.current >= runtime.config.loop.hudSyncInterval) {
      hudTimer.current = 0
      useHudStore.getState().sync(runtime, fps.current)
    }
  })

  return null
}
