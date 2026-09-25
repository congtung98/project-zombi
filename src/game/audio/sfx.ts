/**
 * Âm thanh tổng hợp bằng Web Audio API: không cần asset ngoài (không có giấy
 * phép phải ghi), đủ cho feedback MVP. Mỗi hiệu ứng là một hàm ngắn dựng từ
 * oscillator/noise + envelope. AudioContext chỉ được tạo/resume sau tương tác
 * người dùng (chính sách autoplay của trình duyệt).
 */
export type SfxName =
  | 'swing'
  | 'hit'
  | 'push'
  | 'zombieHurt'
  | 'zombieDie'
  | 'zombieAlert'
  | 'playerHurt'
  | 'door'
  | 'container'
  | 'eat'
  | 'drink'
  | 'heal'
  | 'pickup'
  | 'ui'
  | 'save'
  | 'weaponBreak'
  | 'workStart'
  | 'workDone'
  | 'workCancel'
  | 'doorBash'
  | 'doorBreak'
  | 'stepWalk'
  | 'stepRun'
  | 'switch'
  | 'curtain'

class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private volume = 0.8
  private muted = false
  /** Hạn chế spam: mỗi tên tối thiểu cách nhau chừng này ms. */
  private lastPlayed = new Map<SfxName, number>()

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v))
    this.applyGain()
  }

  setMuted(m: boolean): void {
    this.muted = m
    this.applyGain()
  }

  /** Gọi trong handler của tương tác người dùng (pointerdown/keydown) để mở khóa audio. */
  unlock(): void {
    const ctx = this.ensure()
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
  }

  /** `gain` 0..1 scales this one sound (distance falloff for world sounds such as door bashing). */
  play(name: SfxName, gain = 1): void {
    if (this.muted || this.volume <= 0 || gain <= 0) return
    const ctx = this.ensure()
    if (!ctx || ctx.state !== 'running') return
    const now = performance.now()
    const last = this.lastPlayed.get(name) ?? -Infinity
    if (now - last < MIN_GAP_MS[name]) return
    this.lastPlayed.set(name, now)
    try {
      let out: AudioNode = this.master!
      if (gain < 1) {
        const g = ctx.createGain()
        g.gain.value = gain
        g.connect(this.master!)
        out = g
      }
      RECIPES[name](ctx, out, this.noise())
    } catch {
      // Audio không bao giờ được làm hỏng game loop.
    }
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx
    if (typeof window === 'undefined') return null
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    try {
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.connect(this.ctx.destination)
      this.applyGain()
      return this.ctx
    } catch {
      return null
    }
  }

  private applyGain(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * 0.5, this.ctx.currentTime, 0.02)
  }

  private noise(): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer
    const ctx = this.ctx!
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    this.noiseBuffer = buf
    return buf
  }
}

const MIN_GAP_MS: Record<SfxName, number> = {
  swing: 80,
  hit: 60,
  push: 100,
  zombieHurt: 60,
  zombieDie: 100,
  zombieAlert: 400,
  playerHurt: 120,
  door: 150,
  container: 150,
  eat: 150,
  drink: 150,
  heal: 150,
  pickup: 40,
  ui: 40,
  save: 300,
  weaponBreak: 300,
  workStart: 150,
  workDone: 200,
  workCancel: 200,
  doorBash: 120,
  doorBreak: 300,
  stepWalk: 40,
  stepRun: 40,
  switch: 120,
  curtain: 200,
}

type Recipe = (ctx: AudioContext, out: AudioNode, noise: AudioBuffer) => void

function tone(
  ctx: AudioContext,
  out: AudioNode,
  opts: { type: OscillatorType; from: number; to?: number; duration: number; gain?: number; delay?: number },
): void {
  const t0 = ctx.currentTime + (opts.delay ?? 0)
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = opts.type
  osc.frequency.setValueAtTime(opts.from, t0)
  if (opts.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t0 + opts.duration)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.3, t0 + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration)
  osc.connect(g).connect(out)
  osc.start(t0)
  osc.stop(t0 + opts.duration + 0.02)
}

function burst(
  ctx: AudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  opts: { duration: number; gain?: number; filter?: number; q?: number; type?: BiquadFilterType; delay?: number; sweepTo?: number },
): void {
  const t0 = ctx.currentTime + (opts.delay ?? 0)
  const src = ctx.createBufferSource()
  src.buffer = noise
  const f = ctx.createBiquadFilter()
  f.type = opts.type ?? 'bandpass'
  f.frequency.setValueAtTime(opts.filter ?? 1000, t0)
  if (opts.sweepTo !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, opts.sweepTo), t0 + opts.duration)
  f.Q.value = opts.q ?? 1
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.3, t0 + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration)
  src.connect(f).connect(g).connect(out)
  src.start(t0)
  src.stop(t0 + opts.duration + 0.02)
}

const RECIPES: Record<SfxName, Recipe> = {
  swing: (c, o, n) => burst(c, o, n, { duration: 0.18, gain: 0.25, filter: 600, sweepTo: 2400, q: 0.7 }),
  hit: (c, o, n) => {
    burst(c, o, n, { duration: 0.12, gain: 0.5, filter: 300, q: 0.8, type: 'lowpass' })
    tone(c, o, { type: 'sine', from: 160, to: 60, duration: 0.14, gain: 0.5 })
  },
  push: (c, o, n) => burst(c, o, n, { duration: 0.22, gain: 0.35, filter: 400, sweepTo: 150, q: 0.6 }),
  zombieHurt: (c, o) => tone(c, o, { type: 'sawtooth', from: 220, to: 120, duration: 0.25, gain: 0.18 }),
  zombieDie: (c, o) => {
    tone(c, o, { type: 'sawtooth', from: 200, to: 50, duration: 0.6, gain: 0.22 })
    tone(c, o, { type: 'square', from: 90, to: 40, duration: 0.5, gain: 0.08, delay: 0.05 })
  },
  zombieAlert: (c, o) => {
    tone(c, o, { type: 'sawtooth', from: 140, to: 260, duration: 0.35, gain: 0.14 })
    tone(c, o, { type: 'sawtooth', from: 260, to: 180, duration: 0.3, gain: 0.12, delay: 0.3 })
  },
  playerHurt: (c, o, n) => {
    tone(c, o, { type: 'square', from: 110, to: 70, duration: 0.25, gain: 0.25 })
    burst(c, o, n, { duration: 0.2, gain: 0.25, filter: 900, q: 0.5 })
  },
  door: (c, o, n) => {
    burst(c, o, n, { duration: 0.25, gain: 0.2, filter: 250, sweepTo: 500, q: 2 })
    tone(c, o, { type: 'triangle', from: 90, to: 70, duration: 0.2, gain: 0.15 })
  },
  container: (c, o, n) => {
    burst(c, o, n, { duration: 0.1, gain: 0.25, filter: 1200, q: 1.5 })
    tone(c, o, { type: 'triangle', from: 300, to: 200, duration: 0.15, gain: 0.12, delay: 0.05 })
  },
  eat: (c, o, n) => {
    burst(c, o, n, { duration: 0.09, gain: 0.3, filter: 800, q: 1.2 })
    burst(c, o, n, { duration: 0.09, gain: 0.25, filter: 700, q: 1.2, delay: 0.14 })
  },
  drink: (c, o) => {
    tone(c, o, { type: 'sine', from: 300, to: 500, duration: 0.12, gain: 0.15 })
    tone(c, o, { type: 'sine', from: 350, to: 550, duration: 0.12, gain: 0.15, delay: 0.16 })
  },
  heal: (c, o) => {
    tone(c, o, { type: 'sine', from: 440, duration: 0.15, gain: 0.15 })
    tone(c, o, { type: 'sine', from: 660, duration: 0.25, gain: 0.15, delay: 0.14 })
  },
  pickup: (c, o) => tone(c, o, { type: 'triangle', from: 700, to: 1000, duration: 0.08, gain: 0.15 }),
  ui: (c, o) => tone(c, o, { type: 'sine', from: 500, duration: 0.05, gain: 0.08 }),
  // Light switch: a short plastic click; curtain: a soft cloth swish.
  switch: (c, o, n) => {
    burst(c, o, n, { duration: 0.03, gain: 0.25, filter: 3200, q: 2 })
    tone(c, o, { type: 'square', from: 1400, to: 900, duration: 0.025, gain: 0.05 })
  },
  curtain: (c, o, n) => burst(c, o, n, { duration: 0.35, gain: 0.12, filter: 1800, sweepTo: 900, q: 0.7 }),
  // Gỗ/kim loại gãy: tiếng rắc ngắn + nốt trầm đi xuống để khác tiếng trúng đòn thường.
  weaponBreak: (c, o, n) => {
    burst(c, o, n, { duration: 0.18, gain: 0.45, filter: 2200, q: 3 })
    tone(c, o, { type: 'square', from: 330, to: 90, duration: 0.35, gain: 0.14, delay: 0.04 })
  },
  // Timed craft/repair: two knocks to start, a bright chime when done, a dull drop when cancelled.
  workStart: (c, o, n) => {
    burst(c, o, n, { duration: 0.07, gain: 0.3, filter: 900, q: 2 })
    burst(c, o, n, { duration: 0.07, gain: 0.3, filter: 900, q: 2, delay: 0.16 })
  },
  workDone: (c, o, n) => {
    burst(c, o, n, { duration: 0.08, gain: 0.3, filter: 1400, q: 2 })
    tone(c, o, { type: 'triangle', from: 660, duration: 0.12, gain: 0.14, delay: 0.06 })
    tone(c, o, { type: 'triangle', from: 990, duration: 0.2, gain: 0.14, delay: 0.16 })
  },
  workCancel: (c, o) => tone(c, o, { type: 'triangle', from: 300, to: 160, duration: 0.2, gain: 0.14 }),
  // Zombie fist on a wooden door: low thump + short rattle. Breaking: splinter crack + debris.
  doorBash: (c, o, n) => {
    tone(c, o, { type: 'sine', from: 95, to: 55, duration: 0.22, gain: 0.45 })
    burst(c, o, n, { duration: 0.12, gain: 0.3, filter: 350, q: 1.2, type: 'lowpass' })
    burst(c, o, n, { duration: 0.08, gain: 0.12, filter: 1800, q: 4, delay: 0.05 })
  },
  // Footsteps (only while zombies can hear the player): a soft heel thud when walking; running
  // is louder with a gritty scuff. Small random detune per step so a walk does not sound looped.
  stepWalk: (c, o, n) => {
    const v = 0.9 + Math.random() * 0.2
    burst(c, o, n, { duration: 0.07, gain: 0.16, filter: 320 * v, q: 0.9, type: 'lowpass' })
    tone(c, o, { type: 'sine', from: 85 * v, to: 55, duration: 0.07, gain: 0.12 })
  },
  stepRun: (c, o, n) => {
    const v = 0.9 + Math.random() * 0.2
    burst(c, o, n, { duration: 0.08, gain: 0.26, filter: 420 * v, q: 0.9, type: 'lowpass' })
    tone(c, o, { type: 'sine', from: 95 * v, to: 55, duration: 0.08, gain: 0.18 })
    burst(c, o, n, { duration: 0.05, gain: 0.08, filter: 2600 * v, q: 1.5, delay: 0.01 })
  },
  doorBreak: (c, o, n) => {
    burst(c, o, n, { duration: 0.35, gain: 0.5, filter: 2500, sweepTo: 600, q: 1.5 })
    tone(c, o, { type: 'sawtooth', from: 140, to: 45, duration: 0.45, gain: 0.2 })
    burst(c, o, n, { duration: 0.1, gain: 0.25, filter: 1200, q: 3, delay: 0.18 })
    burst(c, o, n, { duration: 0.1, gain: 0.2, filter: 900, q: 3, delay: 0.3 })
  },
  save: (c, o) => {
    tone(c, o, { type: 'sine', from: 520, duration: 0.1, gain: 0.12 })
    tone(c, o, { type: 'sine', from: 780, duration: 0.18, gain: 0.12, delay: 0.1 })
  },
}

export const sfx = new Sfx()
