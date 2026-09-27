import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { MeshBasicMaterial, RingGeometry, type Mesh } from 'three'
import { runtime } from '../core/runtime'

/**
 * CS1c: marks the object E acts on (the same `runtime.currentInteractable` as the prompt) with a thin
 * pulsing ring on the floor under it, drawn over the scene. View only. (No floating marker: unopened
 * containers already carry a yellow loot marker.)
 */
export function InteractHighlight() {
  const ring = useRef<Mesh>(null)
  const time = useRef(0)
  const res = useMemo(() => {
    const geometry = new RingGeometry(0.86, 1, 40)
    geometry.rotateX(-Math.PI / 2)
    const material = new MeshBasicMaterial({ color: '#ffd66b', transparent: true, opacity: 0.55, depthTest: false, depthWrite: false })
    return { geometry, material }
  }, [])
  useEffect(() => () => {
    res.geometry.dispose()
    res.material.dispose()
  }, [res])

  useFrame((_, delta) => {
    const mesh = ring.current
    if (!mesh) return
    const target = runtime.player.alive ? runtime.currentInteractable : null
    mesh.visible = target !== null
    if (!target) return
    time.current += delta
    mesh.position.set(target.position.x, runtime.player.position.y + 0.03, target.position.z)
    mesh.scale.setScalar(Math.min(0.8, Math.max(0.3, target.radius * 0.7)))
    ;(mesh.material as MeshBasicMaterial).opacity = 0.4 + 0.2 * Math.sin(time.current * 4)
  })

  return <mesh ref={ring} geometry={res.geometry} material={res.material} renderOrder={20} visible={false} />
}
