import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, type Mesh, type MeshStandardMaterial } from 'three'
import { SWITCH_HEIGHT, type LampPlacement } from '../world/buildings'
import { runtime } from '../core/runtime'
import { mapRooms } from '../world/mapData'
import { cutaway, type Box3Like } from './cutaway'

/** How far from its wall a switch may stand (m). */
const SWITCH_WALL_REACH = 0.45
/** Half the switch box's height: a switch on a cut wall sits on the wall's top. */
const SWITCH_HALF = 0.07

/** The wall a switch is mounted on: the nearest wall box around it at its height (null: none). */
function switchWall(lamp: LampPlacement): Box3Like | null {
  const { x, z } = lamp.switchAt
  const y = (lamp.floorY ?? 0) + SWITCH_HEIGHT
  const r = SWITCH_WALL_REACH
  let best: Box3Like | null = null
  let bestDistance = Infinity
  for (const c of runtime.staticColliders.querySolid(x - r, z - r, x + r, z + r)) {
    if (c.kind !== 'wall' || y < c.min.y || y > c.max.y) continue
    const d = Math.hypot(Math.max(c.min.x - x, 0, x - c.max.x), Math.max(c.min.z - z, 0, z - c.max.z))
    if (d <= r && d < bestDistance) {
      bestDistance = d
      best = { min: { ...c.min }, max: { ...c.max } }
    }
  }
  return best
}

const OFF = new Color('#000000')
const SWITCH_ON = new Color('#6fdc7a')
const SWITCH_OFF = new Color('#3b3f45')

/**
 * Ceiling lamp fixture (glows while lit: switched on and powered) and its wall switch (the E
 * interaction point). Visual only: the room's brightness comes from building lighting, there is no
 * Three.js light per lamp.
 * M11c-1A: the fixture and the switch are hidden on a storey the cutaway hides. A switch whose wall
 * is cut below it stays drawn (its on/off colour is what shows the lamp's state): it moves down onto
 * the top of what is left of the wall, over its wall line. Drawing only: E still reaches it where it
 * is (`runtime` interactables), whatever the cutaway.
 */
export function LampView({ lamp }: { lamp: LampPlacement }) {
  const fixtureRef = useRef<MeshStandardMaterial>(null)
  const switchRef = useRef<MeshStandardMaterial>(null)
  const fixtureMesh = useRef<Mesh>(null)
  const switchMesh = useRef<Mesh>(null)
  const cutVersion = useRef(-1)
  const glow = useMemo(() => new Color(lamp.color), [lamp.color])
  const buildingId = useMemo(() => mapRooms(runtime.map).find((r) => r.id === lamp.roomId)?.buildingId, [lamp.roomId])
  const wall = useMemo(() => switchWall(lamp), [lamp])

  useFrame(() => {
    if (cutVersion.current !== cutaway.version && fixtureMesh.current && switchMesh.current) {
      cutVersion.current = cutaway.version
      const floor = { x: lamp.switchAt.x, y: lamp.floorY ?? 0, z: lamp.switchAt.z }
      const storeyHidden = cutaway.hidesPoint(floor)
      fixtureMesh.current.visible = !storeyHidden
      const limit = wall ? cutaway.limit(buildingId, wall, 'wall') : Infinity
      const mesh = switchMesh.current
      mesh.visible = !storeyHidden
      if (wall && floor.y + SWITCH_HEIGHT > limit) {
        // On the cut wall's top, at the point of the wall nearest the switch.
        mesh.position.set(
          Math.min(wall.max.x, Math.max(wall.min.x, lamp.switchAt.x)),
          Math.max(floor.y, limit) + SWITCH_HALF,
          Math.min(wall.max.z, Math.max(wall.min.z, lamp.switchAt.z)),
        )
      } else {
        mesh.position.set(lamp.switchAt.x, floor.y + SWITCH_HEIGHT, lamp.switchAt.z)
      }
    }
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
      <mesh ref={fixtureMesh} position={[lamp.position.x, lamp.position.y, lamp.position.z]}>
        <boxGeometry args={[0.55, 0.06, 0.55]} />
        <meshStandardMaterial ref={fixtureRef} color="#e9e4d6" />
      </mesh>
      <mesh ref={switchMesh} position={[lamp.switchAt.x, (lamp.floorY ?? 0) + SWITCH_HEIGHT, lamp.switchAt.z]}>
        <boxGeometry args={[0.1, 0.14, 0.1]} />
        <meshStandardMaterial ref={switchRef} color="#3b3f45" />
      </mesh>
    </>
  )
}
