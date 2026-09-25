import { memo, useMemo } from 'react'
import { BoxGeometry, DoubleSide, FrontSide, MeshStandardMaterial, PlaneGeometry, RingGeometry, CylinderGeometry, type Material } from 'three'
import type { ResolvedRecord } from '../map/resolve'

/**
 * One resolved record drawn for authoring: the runtime descriptors (walls, doors, windows,
 * containers, floors, roads, zones, spawns) as plain boxes and markers. It reads the same
 * resolver output as the game, so placement matches; roofs, lighting and characters are not drawn.
 */

const BOX = new BoxGeometry(1, 1, 1)
const PLANE = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
const MARKER = new CylinderGeometry(0.35, 0.35, 1.2, 12)
const RING = new RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2)
/** Zone centre marker (zones are picked at their outline or centre). */
const DOT = new RingGeometry(0.35, 0.6, 24).rotateX(-Math.PI / 2)
const ZONE_LINE = 0.16

const materials = new Map<string, Material>()
/** Shared materials by colour and variant (ghost = translucent placement preview). */
function mat(color: string, variant: 'solid' | 'ghost' | 'glass' | 'zone' = 'solid'): Material {
  const key = `${color}:${variant}`
  let m = materials.get(key)
  if (!m) {
    const transparent = variant !== 'solid'
    const opacity = variant === 'ghost' ? 0.45 : variant === 'glass' ? 0.5 : variant === 'zone' ? 0.8 : 1
    m = new MeshStandardMaterial({ color, transparent, opacity, depthWrite: !transparent, side: variant === 'zone' ? DoubleSide : FrontSide })
    materials.set(key, m)
  }
  return m
}

const DOOR_THICKNESS = 0.1

export const RecordView = memo(function RecordView({ record, ghost }: { record: ResolvedRecord; ghost: boolean }) {
  const p = record.parts
  const v = (base: 'solid' | 'glass' | 'zone') => (ghost ? 'ghost' : base)
  const doors = useMemo(
    () =>
      (p.doors ?? []).map((d) => {
        // Leaf from the hinge along local +X, turned by the closed angle (Three.js rotation.y).
        const cx = d.hinge.x + (Math.cos(d.closedAngle) * d.width) / 2
        const cz = d.hinge.z - (Math.sin(d.closedAngle) * d.width) / 2
        return { id: d.id, position: [cx, d.height / 2, cz] as const, rotation: d.closedAngle, size: [d.width, d.height, DOOR_THICKNESS] as const }
      }),
    [p.doors],
  )
  return (
    <group>
      {p.buildings?.map((b) => (
        <mesh key={b.id} geometry={PLANE} material={mat(b.floorColor, v('solid'))} position={[b.center.x, 0.02, b.center.z]} scale={[b.size.w, 1, b.size.d]} />
      ))}
      {p.roads?.map((r) => (
        <mesh key={r.id} geometry={PLANE} material={mat(r.color, v('solid'))} position={[r.position.x, 0.01, r.position.z]} scale={[r.size[0], 1, r.size[1]]} />
      ))}
      {p.walls?.map((w) => (
        <mesh key={w.id} geometry={BOX} material={mat(w.color ?? '#8a8580', v('solid'))} position={[w.position.x, w.position.y, w.position.z]} scale={w.size} />
      ))}
      {p.containers?.map((c) => (
        <mesh key={c.id} geometry={BOX} material={mat(c.color ?? '#6b5a3a', v('solid'))} position={[c.position.x, c.position.y, c.position.z]} scale={c.size} />
      ))}
      {doors.map((d) => (
        <mesh key={d.id} geometry={BOX} material={mat('#8b5a2b', v('solid'))} position={[...d.position]} rotation={[0, d.rotation, 0]} scale={[...d.size]} />
      ))}
      {p.windows?.map((w) => (
        <mesh
          key={w.id}
          geometry={BOX}
          material={mat('#9fd3ff', v('glass'))}
          position={[w.center.x, w.center.y, w.center.z]}
          scale={w.alongX ? [w.width, w.head - w.sill, w.thickness] : [w.thickness, w.head - w.sill, w.width]}
        />
      ))}
      {p.zones?.map((z) => (
        <group key={z.id}>
          {z.halfSize ? (
            // Rectangle outline: four 0.16 m strips on the zone edges.
            [
              [0, -z.halfSize.z, 2 * z.halfSize.x, ZONE_LINE],
              [0, z.halfSize.z, 2 * z.halfSize.x, ZONE_LINE],
              [-z.halfSize.x, 0, ZONE_LINE, 2 * z.halfSize.z],
              [z.halfSize.x, 0, ZONE_LINE, 2 * z.halfSize.z],
            ].map(([dx, dz, sx, sz], i) => (
              <mesh key={i} geometry={PLANE} material={mat('#e08a2c', v('zone'))} position={[z.center.x + dx, 0.05, z.center.z + dz]} scale={[sx, 1, sz]} />
            ))
          ) : (
            <mesh geometry={RING} material={mat('#e08a2c', v('zone'))} position={[z.center.x, 0.05, z.center.z]} scale={[z.radius, 1, z.radius]} />
          )}
          <mesh geometry={DOT} material={mat('#e08a2c', v('zone'))} position={[z.center.x, 0.05, z.center.z]} />
        </group>
      ))}
      {p.playerSpawns?.map((s) => (
        <mesh key={s.id} geometry={MARKER} material={mat('#3fbf5f', v('solid'))} position={[s.position.x, 0.6, s.position.z]} />
      ))}
      {p.zombieSpawns?.map((s, i) => (
        <mesh key={i} geometry={MARKER} material={mat('#c8403a', v('solid'))} position={[s.x, 0.6, s.z]} />
      ))}
    </group>
  )
})
