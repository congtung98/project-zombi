import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'
import type { WindowPlacement } from '../world/buildings'
import { runtime } from '../core/runtime'
import { sharedBox, sharedStandardMaterial } from './sharedResources'
import { cutaway, pieceShow } from './cutaway'

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
 * M11c-1A: pane and curtain are hidden above the observed storey and cut down with their wall.
 */
export function WindowView({ win }: { win: WindowPlacement }) {
  const curtainRef = useRef<Mesh>(null)
  const glassRef = useRef<Mesh>(null)
  const cut = useRef({ version: -1, visible: true })
  const h = win.head - win.sill
  const pane = useMemo(() => {
    const hw = win.width / 2
    const t = win.thickness / 2
    return {
      min: { x: win.center.x - (win.alongX ? hw : t), y: win.center.y - h / 2, z: win.center.z - (win.alongX ? t : hw) },
      max: { x: win.center.x + (win.alongX ? hw : t), y: win.center.y + h / 2, z: win.center.z + (win.alongX ? t : hw) },
    }
  }, [win, h])
  const glass: [number, number, number] = win.alongX ? [win.width, h, GLASS_THICKNESS] : [GLASS_THICKNESS, h, win.width]
  const curtain: [number, number, number] = win.alongX ? [win.width + 0.1, h + 0.1, CURTAIN_THICKNESS] : [CURTAIN_THICKNESS, h + 0.1, win.width + 0.1]
  const inset = win.thickness / 2 + CURTAIN_THICKNESS
  const c = win.center

  useFrame(() => {
    const c = cut.current
    const glass = glassRef.current
    if (glass && c.version !== cutaway.version) {
      c.version = cutaway.version
      const limit = cutaway.limit(win.buildingId, pane, 'opening')
      const show = limit === Infinity ? 'full' : pieceShow(pane, limit)
      c.visible = show !== 'hidden'
      // A cut pane keeps the part under the limit (its bottom stays on the sill).
      const k = show === 'cut' ? (limit - pane.min.y) / h : 1
      glass.visible = c.visible
      glass.scale.y = k
      glass.position.y = pane.min.y + (h * k) / 2
    }
    const mesh = curtainRef.current
    if (mesh) mesh.visible = c.visible && runtime.world.curtains.get(win.id) === true
  })

  return (
    <>
      <mesh ref={glassRef} position={[c.x, c.y, c.z]} dispose={null} geometry={sharedBox(glass)} material={GLASS()} />
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
