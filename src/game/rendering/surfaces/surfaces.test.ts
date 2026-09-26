import { describe, expect, it } from 'vitest'
import { MeshStandardMaterial, SRGBColorSpace } from 'three'
import { loadBundledWorld } from '../../../map/content'
import { GameRuntime } from '../../core/runtime'
import { collectStaticItems, type StaticItem } from '../staticBatchData'
import { hasIndoorShading, installIndoorShading } from '../indoorShading'
import { fadedVariant } from '../sharedResources'
import { FACE, packSurface, SURFACE_IDS, SURFACE_LAYER_MAX, SURFACES, unpackSurface } from './catalog'
import { encodeLayer, generatePattern, generateSurface, TEXTURE_SIZE } from './textureGen'
import { roadSurface } from './surfaceRules'
import { batchSurfaceMaterial, SurfaceMaterial, surfaceAtlas, surfaceAtlasStats, surfaceMaterial, surfaceUniforms } from './surfaceMaterial'

/** G1: the shared surface catalog, its generated textures, the material and the assignment rules. */

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])
const fromSrgb = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))

describe('surface catalog', () => {
  it('fits the per-instance code (≤ 16 layers, 14 bits exact in a float32)', () => {
    expect(SURFACE_IDS.length).toBeLessThanOrEqual(SURFACE_LAYER_MAX)
    for (const id of SURFACE_IDS) expect(SURFACES[id].id).toBe(id)
    const code = packSurface({ a: 'brick', b: 'plaster', faces: FACE.px | FACE.nz | FACE.py })
    expect(unpackSurface(code)).toEqual({ a: 'brick', b: 'plaster', faces: FACE.px | FACE.nz | FACE.py })
    const max = packSurface({ a: SURFACE_IDS[SURFACE_IDS.length - 1], b: SURFACE_IDS[SURFACE_IDS.length - 1], faces: 63 })
    expect(max).toBeLessThan(2 ** 14)
    expect(Math.fround(max)).toBe(max)
  })

  it('gives every surface a physical tile size and a sane look', () => {
    for (const id of SURFACE_IDS) {
      const s = SURFACES[id]
      expect(s.tile[0]).toBeGreaterThan(0)
      expect(s.tile[1]).toBeGreaterThan(0)
      expect(s.roughness).toBeGreaterThan(0.3)
      expect(s.strength).toBeGreaterThan(0)
      expect(s.strength).toBeLessThanOrEqual(1)
    }
  })
})

describe('procedural textures', () => {
  it('are deterministic per seed', () => {
    const a = generateSurface(SURFACES.brick)
    const b = generateSurface(SURFACES.brick)
    expect(same(a.data, b.data)).toBe(true)
    const other = encodeLayer(generatePattern('brick', SURFACES.brick.source.seed + 1))
    expect(same(a.data, other.data)).toBe(false)
  })

  it('tile without a visible seam and average to 1 after the gain', () => {
    const n = TEXTURE_SIZE
    for (const id of SURFACE_IDS) {
      const { data, gain } = generateSurface(SURFACES[id])
      const lum = (x: number, y: number) => {
        const i = (y * n + x) * 4
        return 0.2126 * fromSrgb(data[i] / 255) + 0.7152 * fromSrgb(data[i + 1] / 255) + 0.0722 * fromSrgb(data[i + 2] / 255)
      }
      // Wrap step (last column to the first, last row to the first) vs the ordinary step inside.
      // Each direction against the ordinary step in the same direction (planks differ across rows).
      let seamU = 0
      let seamV = 0
      let innerU = 0
      let innerV = 0
      let sum = 0
      for (let y = 0; y < n; y++) {
        seamU += Math.abs(lum(n - 1, y) - lum(0, y))
        seamV += Math.abs(lum(y, n - 1) - lum(y, 0))
        for (let x = 0; x < n - 1; x++) {
          innerU += Math.abs(lum(x + 1, y) - lum(x, y))
          innerV += Math.abs(lum(y, x + 1) - lum(y, x))
        }
        for (let x = 0; x < n; x++) sum += lum(x, y)
      }
      const steps = n * (n - 1)
      expect(seamU / n, `${id} u seam`).toBeLessThan((innerU / steps) * 3 + 0.01)
      expect(seamV / n, `${id} v seam`).toBeLessThan((innerV / steps) * 3 + 0.01)
      expect((sum / (n * n)) * gain, `${id} average`).toBeGreaterThan(0.97)
      expect((sum / (n * n)) * gain, `${id} average`).toBeLessThan(1.03)
    }
  })
})

describe('surface texture array and materials', () => {
  installIndoorShading()

  it('is generated once and cached (sRGB, one layer per surface, gains filled in)', () => {
    const t = surfaceAtlas()
    expect(surfaceAtlas()).toBe(t)
    expect(surfaceAtlasStats().builds).toBe(1)
    expect(t.image.depth).toBe(SURFACE_IDS.length)
    expect(t.image.width).toBe(TEXTURE_SIZE)
    expect(t.colorSpace).toBe(SRGBColorSpace)
    expect(surfaceUniforms.uSurfMaps.value).toBe(t)
    for (const v of surfaceUniforms.uSurfTile.value) expect(v.z).toBeGreaterThan(1)
    expect(surfaceAtlasStats().bytes).toBe(Math.round((TEXTURE_SIZE * TEXTURE_SIZE * 4 * SURFACE_IDS.length * 4) / 3))
  })

  it('chains the indoor lighting patch and injects the surface code', () => {
    const m = batchSurfaceMaterial()
    expect(batchSurfaceMaterial()).toBe(m)
    expect(hasIndoorShading(m)).toBe(true)
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <common>\n#include <project_vertex>\n#include <fog_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <opaque_fragment>',
    }
    m.onBeforeCompile(shader as never)
    expect(Object.keys(shader.uniforms)).toEqual(expect.arrayContaining(['uRoomCount', 'uVisMap', 'uSurfMaps', 'uSurfTile', 'uSurfOpt', 'uSurfCode', 'uSurfBox']))
    expect(shader.vertexShader).toContain('#define SURF_UNIT')
    expect(shader.vertexShader).toContain('vSurfCode = vColor.a')
    expect(shader.vertexShader).toContain('batchingMatrix * indoorLocal')
    expect(shader.fragmentShader).toContain('diffuseColor.rgb *= mix(')
    expect(shader.fragmentShader).toContain('uVisWindow.w > 0.5')
    expect(m.customProgramCacheKey()).toBe('indoor-lighting-v4|surface-v1|unit')
  })

  it('keeps its look through clone (the fader twin) and shares plain-mesh materials', () => {
    const road = surfaceMaterial(packSurface({ a: 'asphalt' }), '#3a3a3f')
    expect(surfaceMaterial(packSurface({ a: 'asphalt' }), '#3a3a3f')).toBe(road)
    expect(surfaceMaterial(packSurface({ a: 'concrete' }), '#3a3a3f')).not.toBe(road)
    const faded = fadedVariant(road, 0.3) as SurfaceMaterial
    expect(faded).toBeInstanceOf(SurfaceMaterial)
    expect(faded.surfaceCode).toBe(road.surfaceCode)
    expect(faded.transparent).toBe(true)
    expect(road.transparent).toBe(false)
    const door = new SurfaceMaterial({ color: '#6b4a2e' }, { surface: { a: 'wood' }, box: [1, 2.2, 0.08] })
    const copy = door.clone()
    expect(copy.box.toArray()).toEqual([1, 2.2, 0.08])
    expect(copy.surfaceCode).toBe(packSurface({ a: 'wood' }))
    expect(hasIndoorShading(copy)).toBe(true)
    expect(hasIndoorShading(new MeshStandardMaterial())).toBe(true)
  })
})

describe('surface rules', () => {
  const rt = new GameRuntime({ ...loadBundledWorld('graphics-lab').map, zombieSpawns: [] })
  const items = collectStaticItems(rt.map, rt.staticColliders)
  const A = 'c0_0/house-a'
  const B = 'c0_0/house-b'
  const side = FACE.px | FACE.nx | FACE.pz | FACE.nz
  const count = (faces: number) => [...(faces & side).toString(2)].filter((c) => c === '1').length
  /** Broad faces showing plaster: a partition is plaster all over (2), an outer wall one. */
  const inner = (w: StaticItem) => (unpackSurface(w.surface).a === 'plaster' ? 2 : count(unpackSurface(w.surface).faces))
  const walls = (id: string) => items.filter((i) => i.buildingId === id && i.role === 'wall' && !i.detail)
  const byId = (id: string) => items.find((i) => i.id === id)!

  it('outer walls: brick outside, plaster on the one side facing in; partitions plaster both sides', () => {
    // House A (not turned): the south wall faces the street (+Z outside), the middle wall is inside.
    const south = walls(A).filter((i) => i.id?.startsWith(`${A}/wall-s#`))
    expect(south.length).toBeGreaterThan(1)
    for (const w of south) expect(unpackSurface(w.surface)).toEqual({ a: 'brick', b: 'plaster', faces: FACE.nz | FACE.py | FACE.ny })
    for (const w of walls(A).filter((i) => i.id?.startsWith(`${A}/wall-mid#`))) expect(unpackSurface(w.surface)).toEqual({ a: 'plaster', b: 'plaster', faces: 0 })
    // Every wall of a building has at least one face inside it.
    for (const w of [...walls(A), ...walls(B)]) expect(inner(w), w.id).toBeGreaterThanOrEqual(1)
  })

  it('a turned copy of the prefab gets the same surfaces, turned with it', () => {
    const summary = (id: string) => walls(id).map((w) => `${w.id!.slice(id.length)}:${inner(w)}`).sort()
    expect(summary(B)).toEqual(summary(A))
    // B is turned 180°: its south wall (local) is on the north side of the world, facing in to +Z.
    for (const w of walls(B).filter((i) => i.id?.startsWith(`${B}/wall-s#`))) expect(unpackSurface(w.surface).faces & side).toBe(FACE.pz)
  })

  it('floors, slabs, roofs, stairs, furniture, trees and the boundary', () => {
    const pieces = (pred: (i: StaticItem) => boolean) => new Set(items.filter(pred).map((i) => i.surface))
    expect([...pieces((i) => i.role === 'floor' && !i.detail)].map(unpackSurface)).toEqual([{ a: 'woodFloor', b: 'woodFloor', faces: 0 }])
    // G2: shingles on the hipped roof, painted trim on the eaves board under it.
    expect([...pieces((i) => i.role === 'roof' && i.shape === 'hip')].map(unpackSurface)).toEqual([{ a: 'roof', b: 'roof', faces: 0 }])
    expect([...pieces((i) => i.role === 'roof' && i.shape === 'box')].map(unpackSurface)).toEqual([{ a: 'matte', b: 'matte', faces: 0 }])
    expect([...pieces((i) => i.role === 'slab')].map(unpackSurface)).toEqual([{ a: 'plaster', b: 'woodFloor', faces: FACE.py }])
    expect([...pieces((i) => i.role === 'stairs')].map(unpackSurface)).toEqual([{ a: 'plaster', b: 'woodFloor', faces: FACE.py }])
    // G3a: furniture assets pick a surface per part (upholstery, wood legs, painted metal fridge).
    const parts = (id: string) => new Set(items.filter((i) => i.id === id).map((i) => unpackSurface(i.surface).a))
    expect([...parts(`${A}/sofa`)].sort()).toEqual(['fabric', 'wood'])
    expect([...parts(`${A}/fridge`)].sort()).toEqual(['matte', 'paintedMetal'])
    expect(unpackSurface(byId('c0_0/objects/car').surface).a).toBe('matte')
    expect(unpackSurface(byId('world/boundary-n').surface).a).toBe('concrete')
    expect([...pieces((i) => i.shape === 'trunk')].map((c) => unpackSurface(c).a)).toEqual(['bark'])
    expect([...pieces((i) => i.shape === 'crown' || i.shape === 'cone')].map((c) => unpackSurface(c).a)).toEqual(['foliage'])
  })

  it('roads by colour: asphalt, concrete, dirt (editor presets and the lab)', () => {
    expect(roadSurface('#3a3a3f')).toBe('asphalt')
    expect(roadSurface('#55534f')).toBe('asphalt')
    expect(roadSurface('#6d6a62')).toBe('asphalt')
    expect(roadSurface('#8c8a84')).toBe('concrete')
    expect(roadSurface('#9b968c')).toBe('concrete')
    expect(roadSurface('#8f8a7e')).toBe('concrete')
    expect(roadSurface('#7a6246')).toBe('dirt')
  })
})
