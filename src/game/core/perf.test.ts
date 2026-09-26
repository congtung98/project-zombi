import { describe, expect, it } from 'vitest'
import { FRAME_LOG_MAX, PerfMonitor } from './perf'

describe('G0 frame log', () => {
  it('records every frame between start and take, with the render gauges of the frame', () => {
    const perf = new PerfMonitor(4)
    perf.recordFrame(10, 3)
    perf.startFrameLog()
    for (let i = 1; i <= 6; i++) {
      perf.gauge('drawCalls', 100 + i)
      perf.gauge('triangles', 1000 * i)
      perf.recordFrame(16 + i, 4 + i)
    }
    const log = perf.takeFrameLog()
    // More frames than the rolling window: the log keeps them all.
    expect(log.intervalMs).toEqual([17, 18, 19, 20, 21, 22])
    expect(log.cpuMs).toEqual([5, 6, 7, 8, 9, 10])
    expect(log.drawCalls).toEqual([101, 102, 103, 104, 105, 106])
    expect(log.triangles).toEqual([1000, 2000, 3000, 4000, 5000, 6000])
    // Taking stops the log.
    perf.recordFrame(30, 1)
    expect(perf.takeFrameLog().intervalMs).toEqual([])
  })

  it('stops growing at the cap', () => {
    const perf = new PerfMonitor()
    perf.startFrameLog()
    for (let i = 0; i < FRAME_LOG_MAX + 10; i++) perf.recordFrame(16)
    expect(perf.takeFrameLog().intervalMs.length).toBe(FRAME_LOG_MAX)
  })
})
