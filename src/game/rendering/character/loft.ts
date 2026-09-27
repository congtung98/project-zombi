import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute } from 'three'

/**
 * C1 (character plan): low-poly shapes for the character mesh, built as lofts: a run of cross
 * sections (octagons: a w × d rectangle with chamfered corners, or plain rectangles) joined side to
 * side and capped. Each ring is bound to a bone (rigid weight) and can hand part of its weight to a
 * second bone, so joints bend without a gap. Each shape carries a palette slot: the colour comes from
 * the character's material, the geometry is shared by every character of the same shape.
 */
export interface Ring {
  /** Position along the loft axis (m, relative to the bone's rest position). */
  at: number
  /** Width (x) and depth (z for a 'y' loft, height y for a 'z' loft). */
  w: number
  d: number
  /** Chamfer as a share of the smaller side (0..0.5); default from the loft. */
  c?: number
  /** Ring centre offset: x, and z ('y' loft) or y ('z' loft). */
  x?: number
  o?: number
  /** Part of this ring's weight that follows another bone (joint blending). */
  blend?: readonly [bone: number, weight: number]
}

export interface LoftSpec {
  /** 'y': rings stacked vertically (torso, limbs, head); 'z': front to back (feet, mohawk). */
  axis: 'y' | 'z'
  rings: readonly Ring[]
  bone: number
  slot: number
  /** Rest position of the bone in model space: ring coordinates are relative to it. */
  origin: readonly [number, number, number]
  /** Default chamfer share (0 = rectangle with 4 corners). */
  c?: number
  /** Smooth normals around and along (heads, limbs); flat facets otherwise. */
  smooth?: boolean
  /** Cap the first / last ring (default both). */
  caps?: readonly [boolean, boolean]
}

type V3 = [number, number, number]

function ringPoints(r: Ring, chamfer: number, axis: 'y' | 'z', origin: readonly [number, number, number]): V3[] {
  const hw = r.w / 2
  const hd = r.d / 2
  const c = Math.min(r.w, r.d) * (r.c ?? chamfer)
  const pts2: [number, number][] = c > 0
    ? [[hw - c, hd], [hw, hd - c], [hw, -hd + c], [hw - c, -hd], [-hw + c, -hd], [-hw, -hd + c], [-hw, hd - c], [-hw + c, hd]]
    : [[hw, hd], [hw, -hd], [-hw, -hd], [-hw, hd]]
  const cx = r.x ?? 0
  const co = r.o ?? 0
  return pts2.map(([u, v]) => (axis === 'y'
    ? [origin[0] + cx + u, origin[1] + r.at, origin[2] + co + v]
    : [origin[0] + cx + u, origin[1] + co + v, origin[2] + r.at]))
}

function ringCentre(r: Ring, axis: 'y' | 'z', origin: readonly [number, number, number]): V3 {
  const cx = r.x ?? 0
  const co = r.o ?? 0
  return axis === 'y' ? [origin[0] + cx, origin[1] + r.at, origin[2] + co] : [origin[0] + cx, origin[1] + co, origin[2] + r.at]
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** Accumulates lofts into one non-indexed skinned geometry. */
export class MeshBuilder {
  private readonly position: number[] = []
  private readonly normal: number[] = []
  private readonly skinIndex: number[] = []
  private readonly skinWeight: number[] = []
  private readonly paint: number[] = []

  get triangles(): number {
    return this.position.length / 9
  }

  loft(spec: LoftSpec): void {
    const { rings, axis, origin } = spec
    if (rings.length < 2) throw new Error('a loft needs two rings')
    const chamfer = spec.c ?? 0.3
    const pts = rings.map((r) => ringPoints(r, chamfer, axis, origin))
    const n = pts[0].length
    const centres = rings.map((r) => ringCentre(r, axis, origin))
    const weights = rings.map((r) => r.blend ?? null)

    // Side triangles, each oriented away from the loft axis.
    const tris: { v: [V3, V3, V3]; ring: [number, number, number] }[] = []
    for (let k = 0; k + 1 < rings.length; k++) {
      const mid: V3 = [(centres[k][0] + centres[k + 1][0]) / 2, (centres[k][1] + centres[k + 1][1]) / 2, (centres[k][2] + centres[k + 1][2]) / 2]
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        const quad: [V3, number][] = [[pts[k][i], k], [pts[k][j], k], [pts[k + 1][j], k + 1], [pts[k + 1][i], k + 1]]
        for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]] as const) {
          let t: [[V3, number], [V3, number], [V3, number]] = [quad[a], quad[b], quad[c]]
          const nrm = cross(sub(t[1][0], t[0][0]), sub(t[2][0], t[0][0]))
          const centroid: V3 = [(t[0][0][0] + t[1][0][0] + t[2][0][0]) / 3, (t[0][0][1] + t[1][0][1] + t[2][0][1]) / 3, (t[0][0][2] + t[1][0][2] + t[2][0][2]) / 3]
          if (Math.hypot(...nrm) < 1e-10) continue
          if (dot(nrm, sub(centroid, mid)) < 0) t = [t[0], t[2], t[1]]
          tris.push({ v: [t[0][0], t[1][0], t[2][0]], ring: [t[0][1], t[1][1], t[2][1]] })
        }
      }
    }

    // Smooth: vertex normal = average of the face normals of that ring point (keyed by position).
    const smoothNormals = new Map<string, V3>()
    const key = (p: V3) => `${p[0].toFixed(5)},${p[1].toFixed(5)},${p[2].toFixed(5)}`
    if (spec.smooth) {
      for (const t of tris) {
        const f = cross(sub(t.v[1], t.v[0]), sub(t.v[2], t.v[0]))
        for (const p of t.v) {
          const s = smoothNormals.get(key(p)) ?? [0, 0, 0]
          smoothNormals.set(key(p), [s[0] + f[0], s[1] + f[1], s[2] + f[2]])
        }
      }
    }
    for (const t of tris) {
      const flat = norm(cross(sub(t.v[1], t.v[0]), sub(t.v[2], t.v[0])))
      for (let q = 0; q < 3; q++) this.vertex(t.v[q], spec.smooth ? norm(smoothNormals.get(key(t.v[q]))!) : flat, spec, weights[t.ring[q]])
    }

    // Caps: flat fans facing out along the axis.
    const caps = spec.caps ?? [true, true]
    for (const end of [0, rings.length - 1]) {
      if (!caps[end === 0 ? 0 : 1]) continue
      const other = end === 0 ? 1 : rings.length - 2
      const out = norm(sub(centres[end], centres[other]))
      const c = centres[end]
      for (let i = 0; i < n; i++) {
        let a = pts[end][i]
        let b = pts[end][(i + 1) % n]
        const f = cross(sub(a, c), sub(b, c))
        if (Math.hypot(...f) < 1e-10) continue
        if (dot(f, out) < 0) [a, b] = [b, a]
        for (const p of [c, a, b]) this.vertex(p, out, spec, weights[end])
      }
    }
  }

  /** Axis-aligned box (a two-ring rectangle loft), for small flat details. */
  box(bone: number, slot: number, origin: readonly [number, number, number], centre: V3, size: V3, blend?: Ring['blend']): void {
    this.loft({
      axis: 'y', bone, slot, origin, c: 0,
      rings: [
        { at: centre[1] - size[1] / 2, w: size[0], d: size[2], x: centre[0], o: centre[2], blend },
        { at: centre[1] + size[1] / 2, w: size[0], d: size[2], x: centre[0], o: centre[2], blend },
      ],
    })
  }

  private vertex(p: V3, n: V3, spec: LoftSpec, blend: Ring['blend'] | null): void {
    this.position.push(p[0], p[1], p[2])
    this.normal.push(n[0], n[1], n[2])
    if (blend && blend[1] > 0) {
      this.skinIndex.push(spec.bone, blend[0], 0, 0)
      this.skinWeight.push(1 - blend[1], blend[1], 0, 0)
    } else {
      this.skinIndex.push(spec.bone, 0, 0, 0)
      this.skinWeight.push(1, 0, 0, 0)
    }
    this.paint.push(spec.slot)
  }

  build(): BufferGeometry {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(this.position, 3))
    g.setAttribute('normal', new Float32BufferAttribute(this.normal, 3))
    g.setAttribute('skinIndex', new Uint16BufferAttribute(this.skinIndex, 4))
    g.setAttribute('skinWeight', new Float32BufferAttribute(this.skinWeight, 4))
    g.setAttribute('paint', new Float32BufferAttribute(this.paint, 1))
    g.computeBoundingBox()
    g.computeBoundingSphere()
    return g
  }
}
