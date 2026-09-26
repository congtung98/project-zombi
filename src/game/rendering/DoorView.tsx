import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { RigidBody } from '@react-three/rapier'
import { BoxGeometry, Color, type BufferGeometry, type Group, type Mesh } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { DoorPlacement } from '../world/buildings'
import { useWorldStore } from '../../stores/worldStore'
import { runtime } from '../core/runtime'
import { occluderRef } from './occlusionRegistry'
import { doorLeafTransform, DOOR_LEAF_THICKNESS as LEAF_THICKNESS, DOOR_MAX_HP } from '../world/doors'
import { cutaway, pieceShow } from './cutaway'
import { SurfaceMaterial } from './surfaces/surfaceMaterial'
import { doorwayBox } from './architecture'

/** The doorway (closed leaf plane, a wall's thickness deep) as a box, for the cutaway rules. */
interface DoorViewProps {
  door: DoorPlacement
}

const SHAKE_TIME = 0.18
const DAMAGED_COLOR = new Color('#2e2118')
/** G2: raised panels on both faces: border from the leaf's edges, thickness, shade of the leaf colour. */
const PANEL = { margin: 0.15, gap: 0.1, depth: 0.012, shade: 0.78 }

/** The panels look like the leaf: its colour, shaded, and its fade (the fader changes the leaf's material). */
function followLeaf(panel: SurfaceMaterial, leaf: SurfaceMaterial): void {
  panel.color.copy(leaf.color).multiplyScalar(PANEL.shade)
  if (panel.transparent !== leaf.transparent) {
    panel.transparent = leaf.transparent
    panel.depthWrite = leaf.depthWrite
    panel.needsUpdate = true
  }
  panel.opacity = leaf.opacity
}

const panelGeometries = new Map<string, BufferGeometry>()

/**
 * The four panels of a leaf `w` × `h` (upper and lower, both faces) as one geometry in the leaf's
 * hinge frame: one draw call per door, shared by every door of that size (never disposed).
 */
function panelGeometry(w: number, h: number): BufferGeometry {
  const key = `${w}x${h}`
  let g = panelGeometries.get(key)
  if (!g) {
    const boxes = panelRows(h).flatMap((row) =>
      [1, -1].map((side) => new BoxGeometry(w - 2 * PANEL.margin, row.h, PANEL.depth).translate(w / 2, h / 2 + row.y, side * (LEAF_THICKNESS / 2 + PANEL.depth / 2))),
    )
    g = mergeGeometries(boxes)
    for (const b of boxes) b.dispose()
    panelGeometries.set(key, g)
  }
  return g
}

/** Upper and lower panel of a leaf (centre y from the leaf's centre, height), on a leaf `h` tall. */
function panelRows(h: number): { y: number; h: number }[] {
  const top = h / 2 - PANEL.margin
  const bottom = -h / 2 + PANEL.margin
  const split = bottom + (top - bottom) * 0.45
  return [
    { y: (split + PANEL.gap / 2 + top) / 2, h: top - split - PANEL.gap / 2 },
    { y: (bottom + split - PANEL.gap / 2) / 2, h: split - PANEL.gap / 2 - bottom },
  ]
}

/**
 * Cánh cửa: body tĩnh quay quanh bản lề. Đổi trạng thái mở/đóng thì tạo lại
 * body (key) để collider khớp vị trí mới; cửa đóng chặn đường đi và raycast.
 * P2-S5: the leaf darkens as its HP drops and jolts on each zombie hit (visual only: the
 * collider was built from the rest pose and does not move).
 * M11c-1A: the cutaway hides the leaf above the observed storey and cuts it down with its wall
 * (drawing only: the body and the collider stay).
 * G1: wood surface in the leaf's own coordinates (the grain turns with the leaf and runs up it).
 * G2: two raised panels on each face, outside the body (no collider from them): a sibling group on
 * the same hinge copies the leaf's jolt, cut and visibility, and the panel material follows the
 * leaf's colour and fade.
 */
export function DoorView({ door }: DoorViewProps) {
  const state = useWorldStore((s) => s.doorStates[door.id] ?? 'closed')
  const shakeRef = useRef<Group>(null)
  // One material per leaf (its colour follows the door's HP); freed with the view.
  const material = useMemo(() => new SurfaceMaterial({ color: '#6b4a2e' }, { surface: { a: 'wood' }, box: [door.width, door.height, LEAF_THICKNESS] }), [door.width, door.height])
  useEffect(() => () => material.dispose(), [material])
  const panelMaterial = useMemo(() => new SurfaceMaterial({ color: '#5a3e27' }, { surface: { a: 'wood' }, box: [door.width - 2 * PANEL.margin, door.height / 2, PANEL.depth] }), [door.width, door.height])
  useEffect(() => () => panelMaterial.dispose(), [panelMaterial])
  const panelsRef = useRef<Group>(null)
  const leafRef = useRef<Mesh>(null)
  const knobRef = useRef<Mesh>(null)
  const cutVersion = useRef(-1)
  const doorway = useMemo(() => doorwayBox(door), [door])
  // The leaf registers as an occluder and is re-limited by the cutaway whenever it (re)mounts.
  const leafCallback = useCallback((m: Mesh | null) => {
    leafRef.current = m
    cutVersion.current = -1
    return occluderRef(m)
  }, [])
  const shake = useRef(0)
  const leaf = doorLeafTransform(door, state)
  const open = state === 'open'
  const baseColor = useMemo(() => new Color(open ? '#8a6a45' : '#6b4a2e'), [open])

  useEffect(() => runtime.events.on('door:damaged', (e) => {
    if (e.id === door.id) shake.current = SHAKE_TIME
  }), [door.id])

  useFrame((_, delta) => {
    const group = shakeRef.current
    if (!group) return
    if (cutVersion.current !== cutaway.version && leafRef.current && knobRef.current) {
      cutVersion.current = cutaway.version
      const limit = cutaway.limit(door.buildingId, doorway, 'opening')
      const show = limit === Infinity ? 'full' : pieceShow(doorway, limit)
      leafRef.current.visible = show !== 'hidden'
      knobRef.current.visible = show === 'full'
      group.scale.y = show === 'cut' ? (limit - door.hinge.y) / door.height : 1
    }
    const hp = runtime.world.doors.get(door.id)?.hp ?? DOOR_MAX_HP
    material.color.copy(baseColor).lerp(DAMAGED_COLOR, 0.75 * (1 - hp / DOOR_MAX_HP))
    shake.current = Math.max(0, shake.current - delta)
    const k = shake.current / SHAKE_TIME
    group.rotation.y = Math.sin(shake.current * 90) * 0.05 * k
    group.position.z = -0.04 * k
    const panels = panelsRef.current
    if (panels) {
      panels.rotation.y = group.rotation.y
      panels.position.z = group.position.z
      panels.scale.y = group.scale.y
      panels.visible = leafRef.current?.visible ?? true
      followLeaf(panelMaterial, material)
    }
  })

  if (!leaf) return null
  const angle = leaf.angle

  return (
    <>
    <RigidBody
      key={`${door.id}-${open ? 'open' : 'closed'}`}
      type="fixed"
      colliders="cuboid"
      position={[door.hinge.x, door.hinge.y, door.hinge.z]}
      rotation={[0, angle, 0]}
    >
      <group ref={shakeRef}>
        <mesh castShadow position={[door.width / 2, door.height / 2, 0]} ref={leafCallback} material={material}>
          <boxGeometry args={[door.width, door.height, LEAF_THICKNESS]} />
        </mesh>
        {/* Tay nắm cửa, phía xa bản lề. */}
        <mesh ref={knobRef} position={[door.width - 0.18, door.height / 2, LEAF_THICKNESS / 2 + 0.03]}>
          <boxGeometry args={[0.12, 0.06, 0.06]} />
          <meshStandardMaterial color="#d9c27a" />
        </mesh>
      </group>
    </RigidBody>
    <group position={[door.hinge.x, door.hinge.y, door.hinge.z]} rotation={[0, angle, 0]}>
      <group ref={panelsRef}>
        <mesh geometry={panelGeometry(door.width, door.height)} material={panelMaterial} dispose={null} />
      </group>
    </group>
    </>
  )
}
