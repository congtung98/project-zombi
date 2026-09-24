import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, type AmbientLight, type DirectionalLight, type HemisphereLight } from 'three'
import { runtime } from '../core/runtime'
import { daylightAt } from './daylight'

const L = runtime.config.lighting

const DAY_SUN = new Color(L.daySunColor)
const NIGHT_SUN = new Color(L.nightSunColor)
const DAY_AMBIENT = new Color(L.dayAmbientColor)
const NIGHT_AMBIENT = new Color(L.nightAmbientColor)
const DAY_BG = new Color(L.dayBackground)
const NIGHT_BG = new Color(L.nightBackground)

/**
 * Ánh sáng theo chu kỳ ngày/đêm của `GameClock`: đọc trực tiếp trong useFrame,
 * không qua React state. Ban đêm vẫn đủ sáng để chơi (ambient tối thiểu).
 * Nền scene (`<color attach="background">`) cũng đổi theo.
 */
export function Lights() {
  const ambientRef = useRef<AmbientLight>(null)
  const hemiRef = useRef<HemisphereLight>(null)
  const sunRef = useRef<DirectionalLight>(null)
  const bgRef = useRef<Color>(null)

  useFrame(() => {
    const d = daylightAt(runtime.clock.timeOfDay)
    const ambient = ambientRef.current
    if (ambient) {
      ambient.intensity = L.nightAmbient + (L.dayAmbient - L.nightAmbient) * d
      ambient.color.copy(NIGHT_AMBIENT).lerp(DAY_AMBIENT, d)
    }
    const hemi = hemiRef.current
    if (hemi) hemi.intensity = L.nightHemisphere + (L.dayHemisphere - L.nightHemisphere) * d
    const sun = sunRef.current
    if (sun) {
      sun.intensity = L.nightSun + (L.daySun - L.nightSun) * d
      sun.color.copy(NIGHT_SUN).lerp(DAY_SUN, d)
    }
    const bg = bgRef.current
    if (bg) bg.copy(NIGHT_BG).lerp(DAY_BG, d)
  })

  return (
    <>
      <color ref={bgRef} attach="background" args={[L.dayBackground]} />
      <ambientLight ref={ambientRef} intensity={L.dayAmbient} />
      <hemisphereLight ref={hemiRef} args={['#cfe3ff', '#3b4a2f', L.dayHemisphere]} />
      <directionalLight
        ref={sunRef}
        castShadow
        position={[18, 32, 12]}
        intensity={L.daySun}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={120}
        shadow-camera-left={-36}
        shadow-camera-right={36}
        shadow-camera-top={36}
        shadow-camera-bottom={-36}
        shadow-bias={-0.0004}
      />
    </>
  )
}
