import { useEffect, useState } from 'react'
import { runtime } from '../game/core/runtime'
import type { PerfSnapshot } from '../game/core/perf'

const REFRESH_MS = 250

const f1 = (v: number) => v.toFixed(1)
const f2 = (v: number) => v.toFixed(2)

/**
 * R0 performance HUD (F7, `?perf=1`): rolling averages/worst values of the simulation sections,
 * counters per tick and render stats. Debug only, refreshed 4 times a second; the numbers come from
 * `runtime.perf` (simulation) and `PerfProbe` (render loop).
 */
export function PerfHud() {
  const [snap, setSnap] = useState<PerfSnapshot>(() => runtime.perf.snapshot())

  useEffect(() => {
    const id = window.setInterval(() => setSnap(runtime.perf.snapshot()), REFRESH_MS)
    return () => window.clearInterval(id)
  }, [])

  const { avgMs: a, maxMs: m, avgCount: c, maxCount: mc, gauges: g, frame } = snap
  const rays = c.visionRaycasts + c.zombieRaycasts + c.otherRaycasts
  const lines = [
    `FPS ${f1(frame.fps)} · frame ${f1(frame.avgMs)} ms (max ${f1(frame.maxMs)}) · CPU ${f2(frame.cpuAvgMs)} ms (max ${f1(frame.cpuMaxMs)})`,
    `sim ${f2(a.sim)} ms (max ${f2(m.sim)})`,
    `  AI ${f2(a.ai)} (max ${f2(m.ai)}) · move ${f2(a.movement)} · nav ${f2(a.nav)} (max ${f2(m.nav)})`,
    `  vision ${f2(a.vision)} · light ${f2(a.lighting)} · combat ${f2(a.combat)} · spawn ${f2(a.spawn)}`,
    `draw calls ${g.drawCalls} · tris ${g.triangles} · objects ${g.sceneObjects}`,
    `zombies ${g.zombies} (alive ${g.zombiesAlive}) · active ${g.zombiesActive} · near ${g.zombiesNear} · dormant ${g.zombiesDormant} · bodies ${g.zombieBodies}`,
    `AI updates/tick ${f1(c.aiUpdates)} (max ${mc.aiUpdates})`,
    `path req/tick ${f2(c.pathRequests)} · A* ${f2(c.pathsComputed)} (max ${mc.pathsComputed}) · queue ${g.pathQueue} · door routes ${f2(c.doorRoutes)}`,
    `LOS rays/tick ${f1(rays)} (vision ${f1(c.visionRaycasts)} · zombie ${f1(c.zombieRaycasts)} · other ${f1(c.otherRaycasts)})`,
    `occluder tests/tick ${f1(c.occluderTests)} · separation pairs/tick ${f1(c.separationChecks)}`,
    `window ${snap.ticks} ticks · map ${runtime.map.id}`,
  ]
  return <pre className="perf-hud">{lines.join('\n')}</pre>
}
