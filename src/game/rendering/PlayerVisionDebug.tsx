import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { BufferAttribute, BufferGeometry, Line, LineBasicMaterial, LineSegments, type Group } from 'three'
import { runtime } from '../core/runtime'
import { useWorldStore } from '../../stores/worldStore'
import type { VisionReason } from '../systems/playerVision'
import type { EntityId } from '../../types'

const CFG = runtime.config.playerVision
const Y = 0.06
const CIRCLE_SEGMENTS = 64
const COLOR_CLEAR = [0.25, 0.95, 0.35] as const
const COLOR_BLOCKED = [0.95, 0.25, 0.2] as const

const REASON_COLOR: Record<VisionReason, string> = {
  VISIBLE: '#4cf06a',
  NEAR_DETECTION: '#5ec8ff',
  OUTSIDE_FOV: '#f0c24c',
  OUT_OF_RANGE: '#9a9a9a',
  BLOCKED_BY_OCCLUDER: '#ff5a4a',
}

const REASON_TEXT: Record<VisionReason, string> = {
  VISIBLE: 'VISIBLE',
  NEAR_DETECTION: 'NEAR DETECTION',
  OUTSIDE_FOV: 'OUTSIDE FOV',
  OUT_OF_RANGE: 'OUT OF RANGE',
  BLOCKED_BY_OCCLUDER: 'BLOCKED',
}

function circle(radius: number): BufferGeometry {
  const pts = new Float32Array((CIRCLE_SEGMENTS + 1) * 3)
  for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
    const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2
    pts.set([Math.sin(a) * radius, 0, Math.cos(a) * radius], i * 3)
  }
  return new BufferGeometry().setAttribute('position', new BufferAttribute(pts, 3))
}

/**
 * DEBUG_PLAYER_VISION drawing (F4): vision distance and near radius rings, the two cone edges
 * (character facing ± FOV/2), this pass's LOS rays (green clear, red blocked) and a state label on
 * every zombie. Mounted only while enabled, so it costs nothing when off; it only reads state.
 */
export function PlayerVisionDebug() {
  const zombieIds = useWorldStore((s) => s.zombieIds)
  const rigRef = useRef<Group>(null)
  const coneRef = useRef<Group>(null)

  const objects = useMemo(() => {
    const ringMat = new LineBasicMaterial({ color: '#f0e68c', depthTest: false, transparent: true, opacity: 0.8 })
    const nearMat = new LineBasicMaterial({ color: '#5ec8ff', depthTest: false, transparent: true, opacity: 0.9 })
    const far = new Line(circle(CFG.visionDistance), ringMat)
    const near = new Line(circle(CFG.nearDetectionRadius), nearMat)
    // Cone edges in the character's local frame (+Z = facing), rotated with the facing.
    const half = ((CFG.fieldOfView / 2) * Math.PI) / 180
    const r = CFG.visionDistance
    const edgeGeo = new BufferGeometry().setAttribute(
      'position',
      new BufferAttribute(new Float32Array([0, 0, 0, Math.sin(-half) * r, 0, Math.cos(-half) * r, 0, 0, 0, Math.sin(half) * r, 0, Math.cos(half) * r]), 3),
    )
    const edges = new LineSegments(edgeGeo, ringMat)
    const rayGeo = new BufferGeometry()
    rayGeo.setAttribute('position', new BufferAttribute(new Float32Array(CFG.maxRaycastsPerUpdate * 6), 3))
    rayGeo.setAttribute('color', new BufferAttribute(new Float32Array(CFG.maxRaycastsPerUpdate * 6), 3))
    const rays = new LineSegments(rayGeo, new LineBasicMaterial({ vertexColors: true, depthTest: false }))
    rays.frustumCulled = false
    for (const o of [far, near, edges, rays]) o.renderOrder = 950
    return { far, near, edges, rays }
  }, [])

  useEffect(() => {
    runtime.vision.debug = true
    return () => {
      runtime.vision.debug = false
      for (const o of Object.values(objects)) {
        o.geometry.dispose()
        ;(o.material as LineBasicMaterial).dispose()
      }
    }
  }, [objects])

  useFrame(() => {
    const p = runtime.player
    const rig = rigRef.current
    rig?.position.set(p.position.x, Y, p.position.z)
    if (coneRef.current) coneRef.current.rotation.y = p.facing
    const rays = runtime.vision.debugRays
    const pos = objects.rays.geometry.getAttribute('position') as BufferAttribute
    const col = objects.rays.geometry.getAttribute('color') as BufferAttribute
    const n = Math.min(rays.length, CFG.maxRaycastsPerUpdate)
    for (let i = 0; i < n; i++) {
      const r = rays[i]
      pos.setXYZ(i * 2, r.from.x, r.from.y, r.from.z)
      pos.setXYZ(i * 2 + 1, r.to.x, r.to.y, r.to.z)
      const c = r.clear ? COLOR_CLEAR : COLOR_BLOCKED
      col.setXYZ(i * 2, c[0], c[1], c[2])
      col.setXYZ(i * 2 + 1, c[0], c[1], c[2])
    }
    pos.needsUpdate = true
    col.needsUpdate = true
    objects.rays.geometry.setDrawRange(0, n * 2)
  })

  return (
    <>
      <group ref={rigRef}>
        <primitive object={objects.far} />
        <primitive object={objects.near} />
        <group ref={coneRef}>
          <primitive object={objects.edges} />
        </group>
      </group>
      <primitive object={objects.rays} />
      {zombieIds.map((id) => (
        <ZombieVisionLabel key={id} id={id} />
      ))}
    </>
  )
}

/** Label above one zombie; text/colour mutated in place (no React state per frame). */
function ZombieVisionLabel({ id }: { id: EntityId }) {
  const groupRef = useRef<Group>(null)
  const textRef = useRef<HTMLDivElement>(null)

  useFrame(() => {
    const z = runtime.zombies.get(id)
    const g = groupRef.current
    const el = textRef.current
    if (!z || !g || !el) return
    g.position.set(z.position.x, runtime.config.zombie.height + 0.7, z.position.z)
    const v = runtime.vision.get(id)
    const reason = v?.reason ?? 'OUT_OF_RANGE'
    const text = `${REASON_TEXT[reason]} ${Math.round((v?.opacity ?? 0) * 100)}%`
    if (el.textContent !== text) el.textContent = text
    el.style.color = REASON_COLOR[reason]
  })

  return (
    <group ref={groupRef}>
      <Html center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={textRef} className="vision-debug-label" />
      </Html>
    </group>
  )
}
