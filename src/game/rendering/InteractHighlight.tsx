import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { MeshBasicMaterial, RingGeometry, type Mesh } from 'three'
import { runtime } from '../core/runtime'

/**
 * CS1c: marks the object E acts on (the same `runtime.currentInteractable` as the prompt) with a thin
 * pulsing ring on the floor under it, drawn over the scene. AX4: the object under the cursor instead,
 * when there is one outside the combat posture (a left click acts on it). View only. (No floating
 * marker: unopened containers already carry a yellow loot marker.)
 */
export function InteractHighlight() {
  const ring = useRef<Mesh>(null)
  const foe = useRef<Mesh>(null)
  const time = useRef(0)
  const res = useMemo(() => {
    const geometry = new RingGeometry(0.86, 1, 40)
    geometry.rotateX(-Math.PI / 2)
    const material = new MeshBasicMaterial({ color: '#ffd66b', transparent: true, opacity: 0.55, depthTest: false, depthWrite: false })
    // AX5: the zombie the stance was taken against (right click on it).
    const foe = new MeshBasicMaterial({ color: '#e0513f', transparent: true, opacity: 0.6, depthTest: false, depthWrite: false })
    return { geometry, material, foe }
  }, [])
  useEffect(() => () => {
    res.geometry.dispose()
    res.material.dispose()
    res.foe.dispose()
  }, [res])

  useFrame((_, delta) => {
    const f = foe.current
    const z = runtime.combatTarget && runtime.combatPosture ? runtime.zombies.get(runtime.combatTarget) : undefined
    if (f) {
      f.visible = !!z && z.ai !== 'DEAD'
      if (z) f.position.set(z.position.x, z.position.y + 0.03, z.position.z)
    }
    const mesh = ring.current
    if (!mesh) return
    // AX5: an open context menu keeps its object marked (the cursor may be on the menu meanwhile).
    const menu = runtime.worldMenu ? runtime.interactableFor(runtime.worldMenu.targetId) : null
    const hover = runtime.combatPosture ? null : runtime.hoverInteractable
    const target = runtime.player.alive ? menu ?? hover ?? runtime.currentInteractable : null
    mesh.visible = target !== null
    if (!target) return
    time.current += delta
    mesh.position.set(target.position.x, runtime.player.position.y + 0.03, target.position.z)
    mesh.scale.setScalar(Math.min(0.8, Math.max(0.3, target.radius * 0.7)))
    ;(mesh.material as MeshBasicMaterial).opacity = 0.4 + 0.2 * Math.sin(time.current * 4)
  })

  return (
    <>
      <mesh ref={ring} geometry={res.geometry} material={res.material} renderOrder={20} visible={false} />
      <mesh ref={foe} geometry={res.geometry} material={res.foe} renderOrder={20} scale={0.55} visible={false} />
    </>
  )
}
