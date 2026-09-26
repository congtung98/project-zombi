import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, type Group } from 'three'
import { runtime } from '../core/runtime'
import { OUTDOOR, doorTransmission, windowContribution } from '../lighting/buildingLighting'
import { mapWindows } from '../world/mapData'
import type { LightingEdge } from '../lighting/buildingLighting'
import { outlineCentre } from '../../map/polygon'
import { cutaway } from './cutaway'

const Y = 0.09
const CFG = runtime.config.buildingLighting

/** Debug colour of a room light level (green bright, yellow medium, red dark). Debug only. */
function levelColor(level: number): [number, number, number] {
  if (level >= 0.6) return [0.3, 0.95, 0.4]
  if (level >= 0.25) return [0.98, 0.85, 0.25]
  return [0.95, 0.3, 0.25]
}

/**
 * DEBUG_BUILDING_LIGHTING (F6): room bounds coloured by final light, a label per room (direct,
 * propagated, artificial, final), per door (transmission, rooms joined) and per window (exposure),
 * and the room graph (room centre → door → room centre / outdoors). Reads lighting only; mounted
 * only while enabled. Plain lines (no lights, no lit materials).
 * M11c-1A: only the storey the player looks at (the cutaway's; the ground floor of other buildings),
 * plus a label on the player with the cutaway state (building, storey, heights, pieces, room).
 */
export function BuildingLightingDebug() {
  const buildings = useMemo(() => Array.from(runtime.lighting.allBuildings()), [])
  const rooms = runtime.lighting.roomsList()
  const windows = useMemo(() => mapWindows(runtime.map), [])
  const roomLabels = useRef<(HTMLDivElement | null)[]>([])
  const doorLabels = useRef<(HTMLDivElement | null)[]>([])
  const windowLabels = useRef<(HTMLDivElement | null)[]>([])
  const revision = useRef({ lighting: -1, cutaway: -1 })
  const edges = useMemo(() => buildings.flatMap((b) => b.edges), [buildings])
  const cutawayLabel = useRef<HTMLDivElement | null>(null)
  const cutawayAnchor = useRef<Group>(null)

  const lines = useMemo(() => {
    // Room outlines (4 segments each, M11a: one per outline edge) + graph (2 segments per edge).
    const segments = rooms.reduce((n, r) => n + (r.outline?.length ?? 4), 0) + edges.length * 2
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(segments * 6), 3))
    geo.setAttribute('color', new BufferAttribute(new Float32Array(segments * 6), 3))
    const mesh = new LineSegments(geo, new LineBasicMaterial({ vertexColors: true, depthTest: false }))
    mesh.renderOrder = 1002
    mesh.frustumCulled = false
    return mesh
  }, [rooms, edges])

  useEffect(() => () => {
    lines.geometry.dispose()
    ;(lines.material as LineBasicMaterial).dispose()
  }, [lines])

  const centerOf = (id: string) => {
    const r = rooms.find((x) => x.id === id)
    if (!r) return null
    return r.outline ? outlineCentre(r.outline) : { x: (r.bounds.minX + r.bounds.maxX) / 2, z: (r.bounds.minZ + r.bounds.maxZ) / 2 }
  }
  const floorOf = (id: string) => rooms.find((x) => x.id === id)?.floorY ?? 0
  /** Where an edge's opening is: a door, or (M11b) the middle of a stairwell. */
  const openingOf = (edge: LightingEdge) => {
    const door = runtime.map.doors.find((d) => d.id === edge.doorId)
    if (door) return { name: door.name, center: door.center, alongX: door.hinge.x !== door.center.x }
    const s = runtime.map.stairs!.find((x) => x.id === edge.doorId)!
    const center = { x: (s.rect.minX + s.rect.maxX) / 2, y: s.bottomY, z: (s.rect.minZ + s.rect.maxZ) / 2 }
    return { name: 'Cầu thang', center, alongX: s.axis === 'z' }
  }

  const roomShown = (id: string) => {
    const r = rooms.find((x) => x.id === id)
    return !r || cutaway.storeyShown(r.buildingId, r.floorY ?? 0)
  }

  useFrame(() => {
    const p = runtime.player.position
    cutawayAnchor.current?.position.set(p.x, p.y + 2.3, p.z)
    const rev = revision.current
    if (cutawayLabel.current) {
      const v = cutaway.view
      const room = runtime.lighting.getRoomAtPosition(p)
      const s = cutaway.stats
      const text = v
        ? `Cắt lớp: ${v.buildingId} · tầng ${v.level} (sàn ${v.floorY.toFixed(1)})\nẩn từ ${v.ceilingY.toFixed(1)} m · tường cắt ở ${v.wallTopY.toFixed(1)} m\nmảnh ẩn ${s.hidden} · cắt ${s.cut} · giữ bóng ${s.shadows} (${s.ms.toFixed(2)} ms)\nphòng: ${room?.name ?? '—'}`
        : `Cắt lớp: không (ngoài nhà)\nphòng: ${room?.name ?? '—'}`
      // M11c-1B: buildings seen into from outside (cut too).
      const peeks = cutaway.peekIds
      const full = peeks.length ? `${text}\nnhìn vào từ ngoài: ${peeks.join(', ')}` : text
      if (cutawayLabel.current.textContent !== full) cutawayLabel.current.textContent = full
    }
    if (runtime.lighting.revision === rev.lighting && cutaway.version === rev.cutaway) return
    rev.lighting = runtime.lighting.revision
    rev.cutaway = cutaway.version
    const pos = lines.geometry.getAttribute('position') as BufferAttribute
    const col = lines.geometry.getAttribute('color') as BufferAttribute
    let v = 0
    const seg = (ax: number, az: number, bx: number, bz: number, c: [number, number, number], y = 0) => {
      pos.setXYZ(v, ax, y + Y, az)
      col.setXYZ(v++, c[0], c[1], c[2])
      pos.setXYZ(v, bx, y + Y, bz)
      col.setXYZ(v++, c[0], c[1], c[2])
    }
    rooms.forEach((r, i) => {
      const light = runtime.lighting.getRoomLight(r.id)
      const shown = roomShown(r.id)
      const el = roomLabels.current[i]
      if (el) el.style.display = shown ? '' : 'none'
      if (!shown) {
        // Degenerate segments keep the buffer layout.
        for (let k = 0; k < (r.outline?.length ?? 4); k++) seg(0, 0, 0, 0, [0, 0, 0], -1000)
        return
      }
      const c = levelColor(light?.finalLightLevel ?? 0)
      const b = r.bounds
      const e = 0.12 // inset so neighbouring rooms stay distinct
      const y = r.floorY ?? 0
      if (r.outline) {
        const o = r.outline
        o.forEach((a, k) => seg(a.x, a.z, o[(k + 1) % o.length].x, o[(k + 1) % o.length].z, c, y))
      } else {
        seg(b.minX + e, b.minZ + e, b.maxX - e, b.minZ + e, c, y)
        seg(b.maxX - e, b.minZ + e, b.maxX - e, b.maxZ - e, c, y)
        seg(b.maxX - e, b.maxZ - e, b.minX + e, b.maxZ - e, c, y)
        seg(b.minX + e, b.maxZ - e, b.minX + e, b.minZ + e, c, y)
      }
      if (el && light) {
        el.textContent = `${r.name}\nDirect: ${light.directOutdoorLight.toFixed(2)}\nPropagated: ${light.propagatedLight.toFixed(2)}\nArtificial: ${light.artificialLight.toFixed(2)}\nFinal: ${light.finalLightLevel.toFixed(2)}`
      }
    })
    edges.forEach((edge, i) => {
      const door = openingOf(edge)
      // A stairwell joins two storeys: drawn from either.
      const shown = [edge.a, edge.b].filter((id) => id !== OUTDOOR).some(roomShown)
      const label = doorLabels.current[i]
      if (label) label.style.display = shown ? '' : 'none'
      if (!shown) {
        seg(0, 0, 0, 0, [0, 0, 0], -1000)
        seg(0, 0, 0, 0, [0, 0, 0], -1000)
        return
      }
      const state = runtime.world.doors.get(edge.doorId)?.state ?? 'open'
      const t = edge.transmission ?? doorTransmission(state, CFG)
      const c: [number, number, number] = t >= 0.5 ? [0.45, 0.8, 1] : [0.55, 0.55, 0.6]
      const alongX = door.alongX
      for (const side of [edge.a, edge.b]) {
        // The outdoor end is drawn 1.5 m out of the door, away from the room on the other side.
        const other = centerOf(side === edge.a ? edge.b : edge.a) ?? door.center
        const end = side !== OUTDOOR ? centerOf(side)! : alongX
          ? { x: door.center.x, z: door.center.z + 1.5 * Math.sign(door.center.z - other.z) }
          : { x: door.center.x + 1.5 * Math.sign(door.center.x - other.x), z: door.center.z }
        seg(door.center.x, door.center.z, end.x, end.z, c, side !== OUTDOOR ? floorOf(side) : door.center.y)
      }
      const el = doorLabels.current[i]
      if (el) el.textContent = `${door.name}: T ${t.toFixed(2)} (${state})\n${edge.a} ↔ ${edge.b}`
    })
    pos.needsUpdate = true
    col.needsUpdate = true
    const outdoor = runtime.lighting.outdoorLightLevel
    windows.forEach((w, i) => {
      const lw = buildings.flatMap((b) => b.windows).find((x) => x.id === w.id)
      const el = windowLabels.current[i]
      if (!el || !lw) return
      const shown = cutaway.storeyShown(w.buildingId, w.center.y - (w.sill + w.head) / 2)
      el.style.display = shown ? '' : 'none'
      if (!shown) return
      const closed = runtime.world.curtains.get(w.id) === true
      el.textContent = `${w.name}\nexposure ${windowContribution(outdoor, lw, closed, 1, CFG).toFixed(2)}${closed ? ' (rèm)' : ''}`
    })
  })

  return (
    <>
      <primitive object={lines} />
      <group ref={cutawayAnchor}>
        <Html center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <div ref={cutawayLabel} className="lighting-debug-label cutaway-debug-label" />
        </Html>
      </group>
      {rooms.map((r, i) => (
        <Html key={r.id} position={[centerOf(r.id)!.x, floorOf(r.id) + 2.6, centerOf(r.id)!.z]} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
          <div ref={(el) => { roomLabels.current[i] = el }} className="lighting-debug-label" />
        </Html>
      ))}
      {edges.map((edge, i) => {
        const door = openingOf(edge)
        return (
          <Html key={edge.doorId} position={[door.center.x, door.center.y + 2.4, door.center.z]} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
            <div ref={(el) => { doorLabels.current[i] = el }} className="lighting-debug-label small" />
          </Html>
        )
      })}
      {windows.map((w, i) => (
        <Html key={w.id} position={[w.center.x + w.inward.x * 0.6, w.center.y - (w.sill + w.head) / 2 + 2.2, w.center.z + w.inward.z * 0.6]} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
          <div ref={(el) => { windowLabels.current[i] = el }} className="lighting-debug-label small" />
        </Html>
      ))}
    </>
  )
}
