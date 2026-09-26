import { useEffect } from 'react'
import { runtime } from '../core/runtime'
import { applyContactMap, buildContactMap, contactStats, contactUniforms } from './contactShade'

/**
 * G4: builds the world's contact map once, in idle time after the scene mounts (until then nothing is
 * darkened), and takes it off when the scene goes (a new game, another world).
 */
export function ContactShade() {
  useEffect(() => {
    let off: (() => void) | null = null
    let cancelled = false
    const build = () => {
      if (cancelled) return
      const start = performance.now()
      const m = buildContactMap(runtime.map)
      off = applyContactMap(m)
      Object.assign(contactStats, { ms: Math.round((performance.now() - start) * 10) / 10, width: m.width, height: m.height })
      if (import.meta.env.DEV) (window as unknown as { __contact: object }).__contact = { stats: contactStats, uniforms: contactUniforms }
    }
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    const handle = idle ? idle(build, { timeout: 1500 }) : window.setTimeout(build, 200)
    return () => {
      cancelled = true
      if (!idle) window.clearTimeout(handle)
      off?.()
    }
  }, [])
  return null
}
