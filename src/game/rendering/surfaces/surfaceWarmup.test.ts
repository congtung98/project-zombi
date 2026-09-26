import { afterEach, describe, expect, it, vi } from 'vitest'
import { SURFACE_IDS } from './catalog'
import { batchSurfaceMaterial, surfaceAtlasStats, surfaceUniforms } from './surfaceMaterial'

/**
 * G1: the first compile never waits for the textures (own file: a fresh module, nothing generated
 * yet). A white placeholder with gain 1 draws the flat colours; the layers are generated in idle
 * slices and the array then replaces the placeholder.
 */
describe('surface texture warm-up', () => {
  afterEach(() => vi.useRealTimers())

  it('compiles with a placeholder, then swaps in the generated array', () => {
    vi.useFakeTimers()
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: '#include <common>\n#include <fog_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <opaque_fragment>' }
    batchSurfaceMaterial().onBeforeCompile(shader as never)
    const first = surfaceUniforms.uSurfMaps.value!
    expect(first.image.width).toBe(1)
    expect(surfaceUniforms.uSurfTile.value.every((v) => v.z === 1)).toBe(true)
    expect(surfaceAtlasStats().builds).toBe(0)

    vi.runAllTimers()
    const stats = surfaceAtlasStats()
    expect(stats.builds).toBe(1)
    expect(stats.warmedLayers).toBe(SURFACE_IDS.length)
    const atlas = surfaceUniforms.uSurfMaps.value!
    expect(atlas).not.toBe(first)
    expect(atlas.image.depth).toBe(SURFACE_IDS.length)
    expect(surfaceUniforms.uSurfTile.value.every((v) => v.z > 1)).toBe(true)
    // Programs compiled before the swap read the same uniform object: they get the array too.
    expect(shader.uniforms.uSurfMaps).toBe(surfaceUniforms.uSurfMaps)
  })
})
