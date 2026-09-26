import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { runtime } from '../core/runtime'

/** Scene objects are counted this often, and only while the perf HUD is open (debug only). */
const OBJECT_COUNT_INTERVAL = 1
/** Runs before every other `useFrame` (negative priorities never take over rendering). */
const FIRST = -1000

/**
 * R0 render-side instrumentation into `runtime.perf`: frame interval, CPU time of the frame (first
 * `useFrame` → end of `gl.render`, i.e. simulation, physics step, views and render submission) and
 * the draw calls/triangles of that render. Counting scene objects needs a traversal, so it runs once
 * a second and only while the perf HUD is shown (`countObjects`), never in normal play.
 */
export function PerfProbe({ countObjects }: { countObjects: boolean }) {
  const scene = useThree((s) => s.scene)
  const get = useThree((s) => s.get)
  const frame = useRef({ start: 0, interval: 0, count: OBJECT_COUNT_INTERVAL })

  useFrame((_, delta) => {
    const f = frame.current
    f.start = performance.now()
    f.interval = delta * 1000
    if (!countObjects) return
    f.count += delta
    if (f.count < OBJECT_COUNT_INTERVAL) return
    f.count = 0
    let objects = 0
    scene.traverse(() => {
      objects += 1
    })
    runtime.perf.gauge('sceneObjects', objects)
  }, FIRST)

  // End of the frame = the scene's after-render hook (called once at the end of `gl.render`).
  useEffect(() => {
    const target = get().scene
    const info = get().gl.info
    const previous = target.onAfterRender
    const hook: typeof previous = function (this: typeof target, ...args) {
      previous.apply(this, args)
      const f = frame.current
      if (f.start === 0) return
      const perf = runtime.perf
      // Gauges first: a frame log (G0) records them with the frame.
      perf.gauge('drawCalls', info.render.calls)
      perf.gauge('triangles', info.render.triangles)
      perf.recordFrame(f.interval, performance.now() - f.start)
    }
    Object.assign(target, { onAfterRender: hook })
    return () => {
      Object.assign(target, { onAfterRender: previous })
    }
  }, [get])

  return null
}
