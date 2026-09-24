import { GAME_CONFIG } from '../core/config'

/**
 * Mức ánh sáng ban ngày 0..1 theo `timeOfDay`: 0 ban đêm, 1 ban ngày, chuyển
 * mượt trong `twilight` quanh mốc `nightEnd` (bình minh) và `nightStart` (hoàng hôn).
 * Thuần, không phụ thuộc three.
 */
export function daylightAt(t: number, clock = GAME_CONFIG.clock, twilight = GAME_CONFIG.lighting.twilight): number {
  const dawn = smoothstep((t - (clock.nightEnd - twilight / 2)) / twilight)
  const dusk = smoothstep((clock.nightStart + twilight / 2 - t) / twilight)
  return Math.min(dawn, dusk)
}

function smoothstep(x: number): number {
  const c = Math.min(1, Math.max(0, x))
  return c * c * (3 - 2 * c)
}
