import { BatchedMesh, BoxGeometry, Color, CylinderGeometry, DoubleSide, Euler, FrontSide, Matrix4, MeshStandardMaterial, PlaneGeometry, Quaternion, RingGeometry, Vector3, type BufferGeometry, type Material } from 'three'
import type { ResolvedRecord } from '../map/resolve'

/**
 * Editor draw data (M7): a resolved record as plain boxes and markers (`drawItems`), shared by the
 * per-record meshes of `RecordView` and the per-chunk batches of `ChunkBatch` (`buildBatches`).
 */

const BOX = new BoxGeometry(1, 1, 1)
const PLANE = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
const MARKER = new CylinderGeometry(0.35, 0.35, 1.2, 12)
const RING = new RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2)
/** Zone centre marker (zones are picked at their outline or centre). */
const DOT = new RingGeometry(0.35, 0.6, 24).rotateX(-Math.PI / 2)
const ZONE_LINE = 0.16
const DOOR_THICKNESS = 0.1

export const GEOMETRIES = { box: BOX, plane: PLANE, marker: MARKER, ring: RING, dot: DOT } as const
type GeometryKey = keyof typeof GEOMETRIES
/** solid: opaque; glass: window panes; zone: zone outlines (translucent, both sides). */
export type Pass = 'solid' | 'glass' | 'zone'
const PASSES: readonly Pass[] = ['solid', 'glass', 'zone']

export interface DrawItem {
  geometry: GeometryKey
  pass: Pass
  color: string
  position: [number, number, number]
  rotationY: number
  scale: [number, number, number]
}

const OPACITY: Record<Pass | 'ghost', number> = { solid: 1, glass: 0.5, zone: 0.8, ghost: 0.45 }

const materials = new Map<string, Material>()
/** Shared materials by colour and variant (ghost = translucent placement preview). */
export function mat(color: string, variant: Pass | 'ghost'): Material {
  const key = `${color}:${variant}`
  let m = materials.get(key)
  if (!m) {
    const transparent = variant !== 'solid'
    m = new MeshStandardMaterial({ color, transparent, opacity: OPACITY[variant], depthWrite: !transparent, side: variant === 'zone' ? DoubleSide : FrontSide })
    materials.set(key, m)
  }
  return m
}

/** One material per pass for batches: white, tinted by the per-instance colour. */
const BATCH_MATERIALS: Record<Pass, Material> = { solid: mat('#ffffff', 'solid'), glass: mat('#ffffff', 'glass'), zone: mat('#ffffff', 'zone') }

/** Road height in the editor: 1 mm per draw layer (M7), below building floors (0.02). */
const roadY = (layer: number | undefined) => 0.01 + (layer ?? 0) * 0.001

/** Draw data of one resolved record (world or prefab frame, whatever the record is in). */
export function drawItems(record: ResolvedRecord): DrawItem[] {
  const p = record.parts
  const out: DrawItem[] = []
  const add = (geometry: GeometryKey, pass: Pass, color: string, position: [number, number, number], scale: [number, number, number] = [1, 1, 1], rotationY = 0) =>
    out.push({ geometry, pass, color, position, rotationY, scale })
  for (const b of p.buildings ?? []) add('plane', 'solid', b.floorColor, [b.center.x, 0.02, b.center.z], [b.size.w, 1, b.size.d])
  for (const r of p.roads ?? []) add('plane', 'solid', r.color, [r.position.x, roadY(r.layer), r.position.z], [r.size[0], 1, r.size[1]])
  for (const w of p.walls ?? []) add('box', 'solid', w.color ?? '#8a8580', [w.position.x, w.position.y, w.position.z], [...w.size])
  for (const c of p.containers ?? []) add('box', 'solid', c.color ?? '#6b5a3a', [c.position.x, c.position.y, c.position.z], [...c.size])
  for (const d of p.doors ?? []) {
    // Leaf from the hinge along local +X, turned by the closed angle (Three.js rotation.y).
    const cx = d.hinge.x + (Math.cos(d.closedAngle) * d.width) / 2
    const cz = d.hinge.z - (Math.sin(d.closedAngle) * d.width) / 2
    add('box', 'solid', '#8b5a2b', [cx, d.height / 2, cz], [d.width, d.height, DOOR_THICKNESS], d.closedAngle)
  }
  for (const w of p.windows ?? []) {
    add('box', 'glass', '#9fd3ff', [w.center.x, w.center.y, w.center.z], w.alongX ? [w.width, w.head - w.sill, w.thickness] : [w.thickness, w.head - w.sill, w.width])
  }
  for (const z of p.zones ?? []) {
    if (z.halfSize) {
      // Rectangle outline: four 0.16 m strips on the zone edges.
      const h = z.halfSize
      for (const [dx, dz, sx, sz] of [
        [0, -h.z, 2 * h.x, ZONE_LINE],
        [0, h.z, 2 * h.x, ZONE_LINE],
        [-h.x, 0, ZONE_LINE, 2 * h.z],
        [h.x, 0, ZONE_LINE, 2 * h.z],
      ]) {
        add('plane', 'zone', '#e08a2c', [z.center.x + dx, 0.05, z.center.z + dz], [sx, 1, sz])
      }
    } else add('ring', 'zone', '#e08a2c', [z.center.x, 0.05, z.center.z], [z.radius, 1, z.radius])
    add('dot', 'zone', '#e08a2c', [z.center.x, 0.05, z.center.z])
  }
  for (const s of p.playerSpawns ?? []) add('marker', 'solid', '#3fbf5f', [s.position.x, 0.6, s.position.z])
  for (const s of p.zombieSpawns ?? []) add('marker', 'solid', '#c8403a', [s.x, 0.6, s.z])
  return out
}

const matrix = new Matrix4()
const quat = new Quaternion()
const euler = new Euler()
const pos = new Vector3()
const scl = new Vector3()
const tint = new Color()

/** One BatchedMesh per pass that has items (at most three per chunk). */
export function buildBatches(items: readonly DrawItem[]): BatchedMesh[] {
  const out: BatchedMesh[] = []
  for (const pass of PASSES) {
    const list = items.filter((it) => it.pass === pass)
    if (!list.length) continue
    const used = [...new Set(list.map((it) => it.geometry))]
    const count = (g: BufferGeometry) => g.attributes.position.count
    const indices = (g: BufferGeometry) => g.index?.count ?? 0
    const mesh = new BatchedMesh(
      list.length,
      used.reduce((n, k) => n + count(GEOMETRIES[k]), 0),
      used.reduce((n, k) => n + indices(GEOMETRIES[k]), 0),
      BATCH_MATERIALS[pass],
    )
    mesh.sortObjects = false
    const ids = new Map(used.map((k) => [k, mesh.addGeometry(GEOMETRIES[k])]))
    for (const it of list) {
      const instance = mesh.addInstance(ids.get(it.geometry)!)
      quat.setFromEuler(euler.set(0, it.rotationY, 0))
      mesh.setMatrixAt(instance, matrix.compose(pos.set(...it.position), quat, scl.set(...it.scale)))
      mesh.setColorAt(instance, tint.set(it.color))
    }
    out.push(mesh)
  }
  return out
}

