import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'
import type { WindowPlacement } from '../world/buildings'
import { runtime } from '../core/runtime'
import { sharedBox, sharedStandardMaterial } from './sharedResources'

const GLASS_THICKNESS = 0.04
/** R1: one glass and one curtain material for every window. */
const GLASS = () => sharedStandardMaterial('#a9d2ea', { transparent: true, opacity: 0.32, roughness: 0.08, metalness: 0.1, depthWrite: false })
const CURTAIN = () => sharedStandardMaterial('#7d5a6e', { roughness: 0.95 })
const CURTAIN_THICKNESS = 0.05

/**
 * Window: a glass pane in the wall gap (sill and header come from the wall batches). The pane collider
 * blocks movement, zombie sight and interaction rays like the wall it replaces; the player's own
 * sight goes through it unless the curtain is closed (vision occluders, separate from lighting).
 * The curtain hangs on the inner side and is drawn only while closed.
 */
export function WindowView({ win }: { win: WindowPlacement }) {
  const curtainRef = useRef<Mesh>(null)
  const h = win.head - win.sill
  const glass: [number, number, number] = win.alongX ? [win.width, h, GLASS_THICKNESS] : [GLASS_THICKNESS, h, win.width]
  const curtain: [number, number, number] = win.alongX ? [win.width + 0.1, h + 0.1, CURTAIN_THICKNESS] : [CURTAIN_THICKNESS, h + 0.1, win.width + 0.1]
  const inset = win.thickness / 2 + CURTAIN_THICKNESS
  const c = win.center

  useFrame(() => {
    const mesh = curtainRef.current
    if (mesh) mesh.visible = runtime.world.curtains.get(win.id) === true
  })

  return (
    <>
      <mesh position={[c.x, c.y, c.z]} dispose={null} geometry={sharedBox(glass)} material={GLASS()} />
      <mesh
        ref={curtainRef}
        position={[c.x + win.inward.x * inset, c.y, c.z + win.inward.z * inset]}
        visible={false}
        castShadow
        dispose={null}
        geometry={sharedBox(curtain)}
        material={CURTAIN()}
      />
    </>
  )
}
