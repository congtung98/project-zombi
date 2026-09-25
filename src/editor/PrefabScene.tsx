import { useMemo } from 'react'
import { CircleGeometry, DoubleSide, LineBasicMaterial, MeshBasicMaterial, PlaneGeometry, RingGeometry, BoxGeometry } from 'three'
import type { ResolvedRecord } from '../map/resolve'
import type { PrefabDocument, Rect } from '../map/schema'
import { prefabItems, resolvePrefab } from '../map/editor/prefabCommands'
import { INTERACT_RANGE } from '../game/systems/interaction'
import { useEditorStore } from './editorStore'
import { RecordView } from './RecordView'
import { GRID_MAT, labelMaterial, lineGeometry, rectPoints, SELECT_MAT } from './sceneHelpers'

/**
 * Prefab editor scene (M5): the edited prefab in its own frame (local coordinates, pivot where it
 * is), drawn through the same resolver as the game at the view turn (0 = editable, 90/180/270 =
 * preview of how every rotated instance resolves). Overlays: footprint, pivot, rooms with names,
 * lamps and switches, door swings and the interaction reach the game uses.
 */

const FOOTPRINT_MAT = new LineBasicMaterial({ color: '#e05050' })
const SWING_MAT = new LineBasicMaterial({ color: '#d0a060' })
const REACH_MAT = new MeshBasicMaterial({ color: '#7fd4ff', transparent: true, opacity: 0.35, side: DoubleSide, depthWrite: false })
const LAMP_MAT = new MeshBasicMaterial({ color: '#ffd23f' })
const SWITCH_MAT = new MeshBasicMaterial({ color: '#ffb000' })
const PIVOT_MAT = new MeshBasicMaterial({ color: '#ff5fd2' })
const ROOM_COLORS = ['#4f8fd6', '#5fbf7f', '#c77fd6', '#d6a64f', '#4fc7c7', '#d65f5f']
const roomMats = ROOM_COLORS.map((c) => new MeshBasicMaterial({ color: c, transparent: true, opacity: 0.18, side: DoubleSide, depthWrite: false }))
const roomLines = ROOM_COLORS.map((c) => new LineBasicMaterial({ color: c }))

const PLANE = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
const DISC = new CircleGeometry(0.25, 20).rotateX(-Math.PI / 2)
const RING = new RingGeometry(0.97, 1, 64).rotateX(-Math.PI / 2)
const SWITCH = new BoxGeometry(0.2, 0.3, 0.2)

/** Interaction radii as `GameRuntime` builds its interactables (door, container, lamp switch). */
const reachOfContainer = (size: number[]) => INTERACT_RANGE + Math.max(size[0], size[2]) / 2 + 0.3
const reachOfDoor = (width: number) => INTERACT_RANGE + width / 2 + 0.4
const REACH_OF_SWITCH = INTERACT_RANGE + 0.25

function Grid({ rect }: { rect: Rect }) {
  const geometry = useMemo(() => {
    const pts: number[] = []
    for (let x = Math.floor(rect.minX); x <= Math.ceil(rect.maxX); x++) pts.push(x, 0.005, rect.minZ, x, 0.005, rect.maxZ)
    for (let z = Math.floor(rect.minZ); z <= Math.ceil(rect.maxZ); z++) pts.push(rect.minX, 0.005, z, rect.maxX, 0.005, z)
    return lineGeometry(pts)
  }, [rect])
  return (
    <group>
      <mesh geometry={PLANE} position={[(rect.minX + rect.maxX) / 2, -0.01, (rect.minZ + rect.maxZ) / 2]} scale={[rect.maxX - rect.minX, 1, rect.maxZ - rect.minZ]}>
        <meshStandardMaterial color="#6f7d5c" />
      </mesh>
      <lineSegments geometry={geometry} material={GRID_MAT} />
    </group>
  )
}

function Overlays({ record, showReach }: { record: ResolvedRecord; showReach: boolean }) {
  const p = record.parts
  const geometry = useMemo(() => {
    const footprint: number[] = []
    for (const b of p.buildings ?? []) {
      footprint.push(...rectPoints({ minX: b.center.x - b.size.w / 2, minZ: b.center.z - b.size.d / 2, maxX: b.center.x + b.size.w / 2, maxZ: b.center.z + b.size.d / 2 }, 0.06))
    }
    // Door swing: the leaf end sweeping from closed to open around the hinge.
    const swing: number[] = []
    for (const d of p.doors ?? []) {
      const steps = 12
      for (let i = 0; i < steps; i++) {
        const a0 = d.closedAngle + ((d.openAngle - d.closedAngle) * i) / steps
        const a1 = d.closedAngle + ((d.openAngle - d.closedAngle) * (i + 1)) / steps
        swing.push(d.hinge.x + Math.cos(a0) * d.width, 0.07, d.hinge.z - Math.sin(a0) * d.width, d.hinge.x + Math.cos(a1) * d.width, 0.07, d.hinge.z - Math.sin(a1) * d.width)
      }
      swing.push(d.hinge.x, 0.07, d.hinge.z, d.hinge.x + Math.cos(d.openAngle) * d.width, 0.07, d.hinge.z - Math.sin(d.openAngle) * d.width)
    }
    return { footprint: lineGeometry(footprint), swing: lineGeometry(swing) }
  }, [p])
  const rooms = p.rooms ?? []
  return (
    <group>
      <lineSegments geometry={geometry.footprint} material={FOOTPRINT_MAT} />
      <lineSegments geometry={geometry.swing} material={SWING_MAT} />
      {rooms.map((r, i) => {
        const b = r.bounds
        const w = b.maxX - b.minX
        const d = b.maxZ - b.minZ
        const labelW = Math.min(w - 0.4, 4)
        return (
          <group key={r.id}>
            <mesh geometry={PLANE} material={roomMats[i % roomMats.length]} position={[(b.minX + b.maxX) / 2, 0.04, (b.minZ + b.maxZ) / 2]} scale={[w, 1, d]} />
            <lineSegments geometry={lineGeometry(rectPoints({ minX: b.minX + 0.08, minZ: b.minZ + 0.08, maxX: b.maxX - 0.08, maxZ: b.maxZ - 0.08 }, 0.05))} material={roomLines[i % roomLines.length]} />
            {labelW > 0.5 && (
              <mesh position={[b.minX + 0.2 + labelW / 2, 0.08, b.maxZ - 0.25 - labelW / 8]} rotation={[-Math.PI / 2, 0, 0]} material={labelMaterial(r.name, '#ffffff')}>
                <planeGeometry args={[labelW, labelW / 4]} />
              </mesh>
            )}
            {r.lamp && (
              <>
                <mesh geometry={DISC} material={LAMP_MAT} position={[r.lamp.position.x, 0.09, r.lamp.position.z]} />
                <mesh geometry={SWITCH} material={SWITCH_MAT} position={[r.lamp.switchAt.x, 1.2, r.lamp.switchAt.z]} />
                {showReach && <mesh geometry={RING} material={REACH_MAT} position={[r.lamp.switchAt.x, 0.1, r.lamp.switchAt.z]} scale={[REACH_OF_SWITCH, 1, REACH_OF_SWITCH]} />}
              </>
            )}
          </group>
        )
      })}
      {showReach &&
        (p.containers ?? []).map((c) => {
          const r = reachOfContainer(c.size)
          return <mesh key={c.id} geometry={RING} material={REACH_MAT} position={[c.position.x, 0.1, c.position.z]} scale={[r, 1, r]} />
        })}
      {showReach &&
        (p.doors ?? []).map((d) => {
          const r = reachOfDoor(d.width)
          return <mesh key={d.id} geometry={RING} material={REACH_MAT} position={[d.center.x, 0.1, d.center.z]} scale={[r, 1, r]} />
        })}
    </group>
  )
}

function Selection({ prefab, keys }: { prefab: PrefabDocument; keys: string[] }) {
  const geometry = useMemo(() => {
    const wanted = new Set(keys)
    const pts = prefabItems(prefab)
      .filter((it) => wanted.has(it.key))
      .flatMap((it) => rectPoints({ minX: it.bounds.minX - 0.08, minZ: it.bounds.minZ - 0.08, maxX: it.bounds.maxX + 0.08, maxZ: it.bounds.maxZ + 0.08 }, 3.2))
    return pts.length ? lineGeometry(pts) : null
  }, [prefab, keys])
  return geometry ? <lineSegments geometry={geometry} material={SELECT_MAT} renderOrder={10} /> : null
}

export function PrefabScene({ prefabId }: { prefabId: string }) {
  const edit = useEditorStore((s) => s.edit)
  const preview = useEditorStore((s) => s.preview)
  const view = useEditorStore((s) => s.prefabView)
  const showReach = useEditorStore((s) => s.showReach)
  const doc = preview?.doc ?? edit?.doc
  const prefab = doc?.prefabs.get(prefabId)
  const record = useMemo(() => (prefab ? resolvePrefab(prefab, view) : null), [prefab, view])
  if (!edit || !prefab || !record) return null
  const f = prefab.footprint
  const around = Math.max(f.maxX - f.minX, f.maxZ - f.minZ) / 2 + 6
  const cx = Math.round((f.minX + f.maxX) / 2)
  const cz = Math.round((f.minZ + f.maxZ) / 2)
  const grid = { minX: cx - Math.ceil(around), minZ: cz - Math.ceil(around), maxX: cx + Math.ceil(around), maxZ: cz + Math.ceil(around) }
  const keys = preview?.ghostIds.length ? preview.ghostIds : edit.selection
  return (
    <group>
      <Grid rect={grid} />
      <RecordView record={record} ghost={false} />
      <Overlays record={record} showReach={showReach} />
      <mesh geometry={DISC} material={PIVOT_MAT} position={[prefab.pivot.x, 0.12, prefab.pivot.z]} scale={[0.6, 1, 0.6]} />
      {view === 0 && <Selection prefab={prefab} keys={keys} />}
    </group>
  )
}
