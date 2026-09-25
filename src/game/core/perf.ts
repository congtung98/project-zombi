/**
 * Performance instrumentation (R0). Sections are timed with `performance.now()` inside the
 * simulation tick; counters and gauges are plain numbers. Everything is aggregated over a rolling
 * window of ticks so the debug HUD and the benchmark scenarios read averages and worst values
 * without allocating per tick.
 *
 * Sections nest: `ai` includes the navigation and LOS work zombies trigger, `sim` is the whole tick.
 */

export const PERF_SECTIONS = ['sim', 'ai', 'movement', 'nav', 'vision', 'lighting', 'combat', 'spawn'] as const
export type PerfSection = (typeof PERF_SECTIONS)[number]

export const PERF_COUNTERS = [
  /** stepZombie calls (AI decision updates). */
  'aiUpdates',
  /** A* requests (queued or synchronous) and A* searches actually run. */
  'pathRequests',
  'pathsComputed',
  /** Door-route planning queries (siege). */
  'doorRoutes',
  /** Line-of-sight raycasts: player vision, zombie sight/attack, interaction/melee/spawn. */
  'visionRaycasts',
  'zombieRaycasts',
  'otherRaycasts',
  /** Zombie pairs examined by the separation pass. */
  'separationChecks',
  /** Vision occluders tested by the narrow phase (after the broad phase). */
  'occluderTests',
] as const
export type PerfCounter = (typeof PERF_COUNTERS)[number]

/** Values sampled once per tick (last value wins) or set by the render loop. */
export const PERF_GAUGES = [
  'zombies',
  'zombiesAlive',
  'zombiesActive',
  'zombiesNear',
  'zombiesDormant',
  'zombieBodies',
  'pathQueue',
  'frameMs',
  'drawCalls',
  'triangles',
  'sceneObjects',
] as const
export type PerfGauge = (typeof PERF_GAUGES)[number]

export interface PerfSnapshot {
  /** Ticks in the window. */
  ticks: number
  /** Average / worst milliseconds per tick for each section. */
  avgMs: Record<PerfSection, number>
  maxMs: Record<PerfSection, number>
  /** Average / worst count per tick. */
  avgCount: Record<PerfCounter, number>
  maxCount: Record<PerfCounter, number>
  gauges: Record<PerfGauge, number>
  /**
   * Render frames (browser only): average and worst frame interval in the window, and the CPU time
   * of a frame (first `useFrame` → end of `gl.render`: simulation, physics, views, render submission).
   */
  frame: { avgMs: number; maxMs: number; fps: number; cpuAvgMs: number; cpuMaxMs: number }
}

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? () => performance.now() : () => Date.now()

function zeroRecord<K extends string>(keys: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>
  for (const k of keys) out[k] = 0
  return out
}

export class PerfMonitor {
  /** false = `begin`/`end` become no-ops (tests that do not care still pay only a branch). */
  enabled = true
  readonly window: number
  private readonly sectionTime = zeroRecord(PERF_SECTIONS)
  private readonly counterValue = zeroRecord(PERF_COUNTERS)
  readonly gauges = zeroRecord(PERF_GAUGES)
  /** Ring buffers: one row per tick. */
  private readonly sectionRing: Float64Array
  private readonly counterRing: Float64Array
  private head = 0
  private filled = 0
  private readonly frameRing: Float64Array
  private readonly cpuRing: Float64Array
  private frameHead = 0
  private frameFilled = 0

  constructor(window = 120) {
    this.window = window
    this.sectionRing = new Float64Array(window * PERF_SECTIONS.length)
    this.counterRing = new Float64Array(window * PERF_COUNTERS.length)
    this.frameRing = new Float64Array(window)
    this.cpuRing = new Float64Array(window)
  }

  /** Start timing; pass the returned value to `end`. */
  begin(): number {
    return this.enabled ? now() : 0
  }

  end(section: PerfSection, started: number): void {
    if (!this.enabled) return
    this.sectionTime[section] += now() - started
  }

  count(counter: PerfCounter, n = 1): void {
    this.counterValue[counter] += n
  }

  gauge(name: PerfGauge, value: number): void {
    this.gauges[name] = value
  }

  /** Close the current tick: push its sections/counters into the window and reset them. */
  endTick(): void {
    const s = PERF_SECTIONS.length
    const c = PERF_COUNTERS.length
    for (let i = 0; i < s; i++) {
      const key = PERF_SECTIONS[i]
      this.sectionRing[this.head * s + i] = this.sectionTime[key]
      this.sectionTime[key] = 0
    }
    for (let i = 0; i < c; i++) {
      const key = PERF_COUNTERS[i]
      this.counterRing[this.head * c + i] = this.counterValue[key]
      this.counterValue[key] = 0
    }
    this.head = (this.head + 1) % this.window
    this.filled = Math.min(this.window, this.filled + 1)
  }

  /** Render loop: interval between two frames and CPU time of the frame (ms). */
  recordFrame(ms: number, cpuMs = 0): void {
    this.frameRing[this.frameHead] = ms
    this.cpuRing[this.frameHead] = cpuMs
    this.frameHead = (this.frameHead + 1) % this.window
    this.frameFilled = Math.min(this.window, this.frameFilled + 1)
  }

  reset(): void {
    this.head = 0
    this.filled = 0
    this.frameHead = 0
    this.frameFilled = 0
    for (const k of PERF_SECTIONS) this.sectionTime[k] = 0
    for (const k of PERF_COUNTERS) this.counterValue[k] = 0
  }

  snapshot(): PerfSnapshot {
    const n = this.filled
    const s = PERF_SECTIONS.length
    const c = PERF_COUNTERS.length
    const avgMs = zeroRecord(PERF_SECTIONS)
    const maxMs = zeroRecord(PERF_SECTIONS)
    const avgCount = zeroRecord(PERF_COUNTERS)
    const maxCount = zeroRecord(PERF_COUNTERS)
    for (let row = 0; row < n; row++) {
      for (let i = 0; i < s; i++) {
        const v = this.sectionRing[row * s + i]
        avgMs[PERF_SECTIONS[i]] += v
        if (v > maxMs[PERF_SECTIONS[i]]) maxMs[PERF_SECTIONS[i]] = v
      }
      for (let i = 0; i < c; i++) {
        const v = this.counterRing[row * c + i]
        avgCount[PERF_COUNTERS[i]] += v
        if (v > maxCount[PERF_COUNTERS[i]]) maxCount[PERF_COUNTERS[i]] = v
      }
    }
    if (n > 0) {
      for (const k of PERF_SECTIONS) avgMs[k] /= n
      for (const k of PERF_COUNTERS) avgCount[k] /= n
    }
    let frameSum = 0
    let frameMax = 0
    let cpuSum = 0
    let cpuMax = 0
    for (let i = 0; i < this.frameFilled; i++) {
      frameSum += this.frameRing[i]
      if (this.frameRing[i] > frameMax) frameMax = this.frameRing[i]
      cpuSum += this.cpuRing[i]
      if (this.cpuRing[i] > cpuMax) cpuMax = this.cpuRing[i]
    }
    const frameAvg = this.frameFilled > 0 ? frameSum / this.frameFilled : 0
    return {
      ticks: n,
      avgMs,
      maxMs,
      avgCount,
      maxCount,
      gauges: { ...this.gauges },
      frame: {
        avgMs: frameAvg,
        maxMs: frameMax,
        fps: frameAvg > 0 ? 1000 / frameAvg : 0,
        cpuAvgMs: this.frameFilled > 0 ? cpuSum / this.frameFilled : 0,
        cpuMaxMs: cpuMax,
      },
    }
  }
}
