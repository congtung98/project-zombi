import { GAME_CONFIG } from './config'

/** Nguồn thời gian simulation duy nhất. Chỉ tiến khi tick chạy (không chạy khi pause). */
export class GameClock {
  /** Tổng thời gian game đã trôi (giây). */
  elapsed = 0
  /** Thời điểm trong ngày 0..1 (0 = nửa đêm, 0.5 = giữa trưa). */
  timeOfDay = GAME_CONFIG.clock.startTimeOfDay
  day = 1

  private dayLengthSec = GAME_CONFIG.clock.dayLengthSec

  reset(timeOfDay = GAME_CONFIG.clock.startTimeOfDay): void {
    this.elapsed = 0
    this.timeOfDay = timeOfDay
    this.day = 1
  }

  advance(dt: number): void {
    this.elapsed += dt
    this.timeOfDay += dt / this.dayLengthSec
    while (this.timeOfDay >= 1) {
      this.timeOfDay -= 1
      this.day += 1
    }
  }

  get isNight(): boolean {
    return this.timeOfDay < 0.22 || this.timeOfDay > 0.8
  }

  /** Chuỗi HH:MM để hiển thị. */
  formatTime(): string {
    const totalMinutes = Math.floor(this.timeOfDay * 24 * 60)
    const h = Math.floor(totalMinutes / 60)
    const m = totalMinutes % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
}
