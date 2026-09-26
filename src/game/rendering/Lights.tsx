import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, Vector3, type AmbientLight, type DirectionalLight, type HemisphereLight } from 'three'
import { runtime } from '../core/runtime'
import { useSettingsStore } from '../../stores/settingsStore'
import { daylightAt } from './daylight'

const L = runtime.config.lighting

const DAY_SUN = new Color(L.daySunColor)
const NIGHT_SUN = new Color(L.nightSunColor)
const DAY_AMBIENT = new Color(L.dayAmbientColor)
const NIGHT_AMBIENT = new Color(L.nightAmbientColor)
const DAY_BG = new Color(L.dayBackground)
const NIGHT_BG = new Color(L.nightBackground)

/** Sun offset from the point it lights (its direction); the shadow box is centred on the player. */
const SUN_OFFSET = new Vector3(18, 32, 12)
/** Half side of the sun's shadow box (m): the gameplay view at the widest zoom fits in it. */
const SHADOW_HALF = 36

/**
 * G4: the shadow camera follows the player (before, it stayed on the world origin and houses far
 * from it had no shadow). The centre moves in whole shadow texels of the light's own axes, so a
 * walking player never makes shadow edges crawl.
 */
const lightDir = SUN_OFFSET.clone().normalize()
const lightRight = new Vector3(0, 1, 0).cross(lightDir).normalize()
const lightUp = lightDir.clone().cross(lightRight).normalize()
const centre = new Vector3()
function snapShadowCentre(x: number, z: number, texel: number, out: Vector3): Vector3 {
  out.set(x, 0, z)
  const u = out.dot(lightRight)
  const v = out.dot(lightUp)
  out.addScaledVector(lightRight, Math.round(u / texel) * texel - u)
  out.addScaledVector(lightUp, Math.round(v / texel) * texel - v)
  return out
}

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
  const shadows = useSettingsStore((s) => s.shadows)
  const shadowMap = shadows === 'high' ? 2048 : 1024

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
      const p = runtime.player.position
      snapShadowCentre(p.x, p.z, (2 * SHADOW_HALF) / shadowMap, centre)
      sun.target.position.copy(centre)
      sun.target.updateMatrixWorld()
      sun.position.copy(centre).add(SUN_OFFSET)
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
        castShadow={shadows !== 'off'}
        position={SUN_OFFSET.toArray()}
        intensity={L.daySun}
        shadow-mapSize-width={shadowMap}
        shadow-mapSize-height={shadowMap}
        shadow-camera-near={1}
        shadow-camera-far={120}
        shadow-camera-left={-SHADOW_HALF}
        shadow-camera-right={SHADOW_HALF}
        shadow-camera-top={SHADOW_HALF}
        shadow-camera-bottom={-SHADOW_HALF}
        shadow-bias={-0.0004}
      />
    </>
  )
}
