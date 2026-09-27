// Prefab library P2–P5: the deep check's reachability rules on one prefab, runnable in plain Node
// while a prefab is being built (the deep check itself needs Vite). Same numbers as the runtime:
// a 0.5 m navigation grid with obstacles grown by the agent radius 0.4, every door open (its leaf
// blocking where it swings, its corridor walkable), the storeys linked by their flights, and an
// interactable reached when a walkable, connected spot within the runtime's reach sees it past
// every collider. The real deep check (src/map/editor/libraryContent.test.ts) stays the judge.
import type { PrefabDocument } from '../../../src/map/schema.ts'
import { resolvePrefab } from '../../../src/map/editor/prefabCommands.ts'
import { DOOR_HEIGHT } from '../../../src/game/world/buildings.ts'
import { SLAB_THICKNESS, stairApproach } from '../../../src/game/world/floors.ts'

const CELL = 0.5
const R = 0.4
const OVERHEAD = 1.6
const MIN_TOP = 0.05
const LEAF = 0.12
const INTERACT_RANGE = 1
const BODY_Y = 0.9
const REACH_Y = 1.4
const SAMPLES = 16

interface Box3 {
  /** ID an interaction with it ignores (a door leaf: its door). */
  id: string
  min: [number, number, number]
  max: [number, number, number]
}

export interface AccessProblem {
  id: string
  kind: string
  message: string
}

function segmentHitsBox(a: number[], b: number[], box: Box3): boolean {
  let t0 = 0
  let t1 = 1
  for (let i = 0; i < 3; i++) {
    const d = b[i] - a[i]
    if (Math.abs(d) < 1e-9) {
      if (a[i] < box.min[i] || a[i] > box.max[i]) return false
      continue
    }
    let u0 = (box.min[i] - a[i]) / d
    let u1 = (box.max[i] - a[i]) / d
    if (u0 > u1) [u0, u1] = [u1, u0]
    t0 = Math.max(t0, u0)
    t1 = Math.min(t1, u1)
    if (t0 > t1) return false
  }
  // Grazing an edge or ending on a face (a door on its floor slab) is not a hit.
  return t1 - t0 > 1e-6
}

function distSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const l2 = dx * dx + dz * dz
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz))
}

/** Problems a deep check would report for this prefab alone (unreachable interactables, unusable flights). */
export function checkAccess(p: PrefabDocument, debug?: (text: string) => void): AccessProblem[] {
  const parts = resolvePrefab(p, 0).parts
  const H = p.building?.height ?? 3
  const storeys = p.building?.storeys ?? 1
  const t = p.building?.wallThickness ?? 0.2
  const f = p.footprint
  const x0 = Math.floor(f.minX) - 3
  const z0 = Math.floor(f.minZ) - 3
  const cols = Math.ceil((f.maxX + 3 - x0) / CELL)
  const rows = Math.ceil((f.maxZ + 3 - z0) / CELL)
  const cx = (i: number) => x0 + (i + 0.5) * CELL
  const cz = (j: number) => z0 + (j + 0.5) * CELL
  const cellOf = (x: number, z: number) => ({ i: Math.floor((x - x0) / CELL), j: Math.floor((z - z0) / CELL) })
  const walls = parts.walls
  const windows = parts.windows
  const doors = parts.doors

  // Blocked cells per storey.
  const grids: Uint8Array[] = []
  for (let level = 0; level < storeys; level++) {
    const fy = level * H
    const g = new Uint8Array(cols * rows)
    const fill = (minX: number, minZ: number, maxX: number, maxZ: number, v: number) => {
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (cx(i) >= minX && cx(i) <= maxX && cz(j) >= minZ && cz(j) <= maxZ) g[j * cols + i] = v
    }
    for (const w of walls) {
      const bottom = w.position.y - w.size[1] / 2
      const top = w.position.y + w.size[1] / 2
      if (!(bottom < fy + OVERHEAD && top > fy + MIN_TOP)) continue
      fill(w.position.x - w.size[0] / 2 - R, w.position.z - w.size[2] / 2 - R, w.position.x + w.size[0] / 2 + R, w.position.z + w.size[2] / 2 + R, 1)
    }
    for (const w of windows) {
      if (Math.abs(w.center.y - (w.sill + w.head) / 2 - fy) > 0.5) continue
      const hx = (w.alongX ? w.width : w.thickness) / 2 + R
      const hz = (w.alongX ? w.thickness : w.width) / 2 + R
      fill(w.center.x - hx, w.center.z - hz, w.center.x + hx, w.center.z + hz, 1)
    }
    const corridor = new Set<number>()
    for (const d of doors) {
      if (Math.abs(d.center.y - fy) > 0.5) continue
      const alongX = d.hinge.x !== d.center.x
      const ha = Math.max(d.width / 2 - R, CELL * 0.55)
      const hc = t / 2 + R + CELL * 0.25
      const [mx, mz, Mx, Mz] = alongX ? [d.center.x - ha, d.center.z - hc, d.center.x + ha, d.center.z + hc] : [d.center.x - hc, d.center.z - ha, d.center.x + hc, d.center.z + ha]
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (cx(i) >= mx && cx(i) <= Mx && cz(j) >= mz && cz(j) <= Mz) corridor.add(j * cols + i)
    }
    for (const idx of corridor) g[idx] = 0
    for (const d of doors) {
      if (Math.abs(d.center.y - fy) > 0.5) continue
      const bx = d.hinge.x + Math.cos(d.openAngle) * d.width
      const bz = d.hinge.z - Math.sin(d.openAngle) * d.width
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const idx = j * cols + i
        if (!corridor.has(idx) && distSeg(cx(i), cz(j), d.hinge.x, d.hinge.z, bx, bz) <= LEAF / 2 + R) g[idx] = 1
      }
    }
    // Over a flight a body stands on the ramp, not on this storey: the flight links the storeys instead.
    for (const st of parts.stairs ?? []) if (st.level === level) fill(st.rect.minX, st.rect.minZ, st.rect.maxX, st.rect.maxZ, 1)
    // Upper storeys: only where there is a slab.
    if (level > 0) {
      const slabs = (parts.floors ?? []).filter((s) => s.level === level)
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (!slabs.some((s) => cx(i) >= s.rect.minX && cx(i) <= s.rect.maxX && cz(j) >= s.rect.minZ && cz(j) <= s.rect.maxZ)) g[j * cols + i] = 1
    }
    grids.push(g)
  }

  // Reachability: from outside on the ground, up and down the usable flights.
  const reach = grids.map(() => new Uint8Array(cols * rows))
  const walkable = (level: number, x: number, z: number) => {
    const c = cellOf(x, z)
    return c.i >= 0 && c.j >= 0 && c.i < cols && c.j < rows && !grids[level][c.j * cols + c.i]
  }
  const flood = (level: number, seeds: number[]) => {
    const g = grids[level]
    const r = reach[level]
    const stack = seeds.filter((s) => !g[s] && !r[s])
    for (const s of stack) r[s] = 1
    while (stack.length) {
      const k = stack.pop()!
      const i = k % cols
      const j = (k - i) / cols
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di
        const nj = j + dj
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue
        const n = nj * cols + ni
        if (g[n] || r[n]) continue
        r[n] = 1
        stack.push(n)
      }
    }
  }
  const border: number[] = []
  for (let i = 0; i < cols; i++) border.push(i, (rows - 1) * cols + i)
  for (let j = 0; j < rows; j++) border.push(j * cols, j * cols + cols - 1)
  flood(0, border)
  const problems: AccessProblem[] = []
  const flights = parts.stairs ?? []
  const approach = CELL + R
  const usable = flights.filter((s) => {
    const a = stairApproach(s, 0, approach)
    const b = stairApproach(s, 1, approach)
    const ok = s.level + 1 < storeys && walkable(s.level, a.x, a.z) && walkable(s.level + 1, b.x, b.z)
    if (!ok) problems.push({ id: s.id, kind: 'stairs', message: `stairs ${s.id} unusable (an end has no free floor)` })
    return ok
  })
  for (let pass = 0; pass < storeys * 2; pass++) {
    for (const s of usable) {
      const a = stairApproach(s, 0, approach)
      const b = stairApproach(s, 1, approach)
      const ca = cellOf(a.x, a.z)
      const cb = cellOf(b.x, b.z)
      const ia = ca.j * cols + ca.i
      const ib = cb.j * cols + cb.i
      if (reach[s.level][ia] && !reach[s.level + 1][ib]) flood(s.level + 1, [ib])
      if (reach[s.level + 1][ib] && !reach[s.level][ia]) flood(s.level, [ia])
    }
  }

  // Colliders for the line of sight.
  const boxes: Box3[] = []
  const box = (id: string, c: { x: number; y: number; z: number }, s: readonly number[]) => boxes.push({ id, min: [c.x - s[0] / 2, c.y - s[1] / 2, c.z - s[2] / 2], max: [c.x + s[0] / 2, c.y + s[1] / 2, c.z + s[2] / 2] })
  for (const w of walls) box(w.id, w.position, w.size)
  for (const c of parts.containers) box(c.id, c.position, c.size)
  for (const w of windows) box(`${w.id}:pane`, w.center, w.alongX ? [w.width, w.head - w.sill, w.thickness] : [w.thickness, w.head - w.sill, w.width])
  for (const d of doors) {
    const dx = Math.cos(d.openAngle)
    const dz = -Math.sin(d.openAngle)
    const mid = { x: d.hinge.x + (dx * d.width) / 2, y: d.hinge.y + DOOR_HEIGHT / 2, z: d.hinge.z + (dz * d.width) / 2 }
    box(d.id, mid, [Math.abs(dx) * d.width + Math.abs(dz) * LEAF, DOOR_HEIGHT, Math.abs(dz) * d.width + Math.abs(dx) * LEAF])
  }
  for (const s of parts.floors ?? []) boxes.push({ id: s.id, min: [s.rect.minX, s.y - SLAB_THICKNESS, s.rect.minZ], max: [s.rect.maxX, s.y, s.rect.maxZ] })

  const items: { id: string; kind: string; x: number; y: number; z: number; radius: number }[] = []
  for (const d of doors) items.push({ id: d.id, kind: 'door', x: d.center.x, y: d.center.y, z: d.center.z, radius: d.width / 2 + 0.4 })
  for (const c of parts.containers) items.push({ id: c.id, kind: 'container', x: c.position.x, y: c.position.y, z: c.position.z, radius: Math.max(c.size[0], c.size[2]) / 2 + 0.3 })
  for (const r of parts.rooms) if (r.lamp) items.push({ id: r.lamp.id, kind: 'lamp', x: r.lamp.switchAt.x, y: (r.floorY ?? 0) + 1.3, z: r.lamp.switchAt.z, radius: 0.25 })
  for (const w of windows) {
    const floor = w.center.y - (w.sill + w.head) / 2
    items.push({ id: w.id, kind: 'window', x: w.center.x + w.inward.x * 0.35, y: floor + 1.3, z: w.center.z + w.inward.z * 0.35, radius: 0.3 })
  }
  if (debug) {
    for (let level = 0; level < storeys; level++) {
      const lines: string[] = []
      for (let j = 0; j < rows; j++) {
        let line = ''
        for (let i = 0; i < cols; i++) {
          const k = j * cols + i
          const it = items.find((x) => Math.abs(x.y - level * H) < H && cellOf(x.x, x.z).i === i && cellOf(x.x, x.z).j === j)
          line += it ? it.kind[0].toUpperCase() : grids[level][k] ? '#' : reach[level][k] ? '.' : ' '
        }
        lines.push(line)
      }
      debug(`${p.prefabId} level ${level} (x from ${x0}, z from ${z0}, 0.5 m cells):\n${lines.join('\n')}`)
    }
  }
  for (const it of items) {
    let ok = false
    for (const rr of [it.radius + 0.3, it.radius + INTERACT_RANGE * 0.5, it.radius + INTERACT_RANGE * 0.95]) {
      for (let k = 0; k < SAMPLES && !ok; k++) {
        const a = (k / SAMPLES) * Math.PI * 2
        const x = it.x + Math.cos(a) * rr
        const z = it.z + Math.sin(a) * rr
        for (let level = 0; level < storeys && !ok; level++) {
          const fy = level * H
          if (Math.abs(it.y - fy - BODY_Y) > REACH_Y || fy > it.y + 0.05) continue
          const c = cellOf(x, z)
          if (c.i < 0 || c.j < 0 || c.i >= cols || c.j >= rows || !reach[level][c.j * cols + c.i]) continue
          const from = [x, fy + BODY_Y, z]
          const to = [it.x, it.y, it.z]
          if (!boxes.some((b) => b.id !== it.id && segmentHitsBox(from, to, b))) ok = true
        }
      }
      if (ok) break
    }
    if (!ok) problems.push({ id: it.id, kind: it.kind, message: `${it.kind} ${it.id} unreachable` })
  }
  return problems
}
