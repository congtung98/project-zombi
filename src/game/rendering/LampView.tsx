import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, type MeshStandardMaterial } from 'three'
import type { LampPlacement } from '../world/buildings'
import { runtime } from '../core/runtime'

const OFF = new Color('#000000')
const SWITCH_ON = new Color('#6fdc7a')
const SWITCH_OFF = new Color('#3b3f45')

/**
 * Ceiling lamp fixture (glows while lit: switched on and powered) and its wall switch (the E
 * interaction point). Visual only: the room's brightness comes from building lighting, there is no
 * Three.js light per lamp.
 */
export function LampView({ lamp }: { lamp: LampPlacement }) {
  const fixtureRef = useRef<MeshStandardMaterial>(null)
  const switchRef = useRef<MeshStandardMaterial>(null)
  const glow = useMemo(() => new Color(lamp.color), [lamp.color])

  useFrame(() => {
    const on = runtime.world.lamps.get(lamp.id) === true
    const lit = on && (!lamp.requiresElectricity || runtime.world.electricity)
    const f = fixtureRef.current
    if (f) {
      f.emissive.copy(lit ? glow : OFF)
      f.emissiveIntensity = lit ? 1.6 : 0
    }
    const s = switchRef.current
    if (s) s.color.copy(on ? SWITCH_ON : SWITCH_OFF)
  })

  return (
    <>
      <mesh position={[lamp.position.x, lamp.position.y, lamp.position.z]}>
        <boxGeometry args={[0.55, 0.06, 0.55]} />
        <meshStandardMaterial ref={fixtureRef} color="#e9e4d6" />
      </mesh>
      <mesh position={[lamp.switchAt.x, 1.3, lamp.switchAt.z]}>
        <boxGeometry args={[0.1, 0.14, 0.1]} />
        <meshStandardMaterial ref={switchRef} color="#3b3f45" />
      </mesh>
    </>
  )
}
