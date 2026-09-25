import { describe, expect, it } from 'vitest'
import { MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial } from 'three'
import { hasIndoorShading, INDOOR_MAX_ROOMS, installIndoorShading } from './indoorShading'
import { fadedVariant, sharedStandardMaterial } from './sharedResources'
import { BUILDING_LIGHTING_CONFIG } from '../core/config'

describe('indoor shading install (R1: no scene traversal)', () => {
  installIndoorShading()

  it('patches every standard material at creation, never basic ones', () => {
    expect(hasIndoorShading(new MeshStandardMaterial())).toBe(true)
    expect(hasIndoorShading(new MeshPhysicalMaterial())).toBe(true)
    expect(hasIndoorShading(sharedStandardMaterial('#123456'))).toBe(true)
    // Clones (the occlusion fader's faded twins) keep the patch.
    expect(hasIndoorShading(fadedVariant(sharedStandardMaterial('#123456'), 0.3) as MeshStandardMaterial)).toBe(true)
    expect(new MeshBasicMaterial().onBeforeCompile).not.toBe(new MeshStandardMaterial().onBeforeCompile)
  })

  it('injects the room uniforms and the indoor branch into the shader', () => {
    const m = new MeshStandardMaterial()
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <common>\n#include <project_vertex>',
      fragmentShader: '#include <common>\n#include <opaque_fragment>',
    }
    m.onBeforeCompile(shader as never, null as never)
    expect(Object.keys(shader.uniforms)).toEqual(['uRoomCount', 'uRoomRect', 'uRoomShade'])
    expect(shader.fragmentShader).toContain('uRoomShade[i].w')
    expect(m.customProgramCacheKey()).toBe('indoor-lighting-v1')
  })

  it('takes the room limit from config (no scattered magic number)', () => {
    expect(INDOOR_MAX_ROOMS).toBe(BUILDING_LIGHTING_CONFIG.maxShaderRooms)
  })

  it('shares one material per look and keeps faded twins separate', () => {
    const a = sharedStandardMaterial('#b9a78a')
    expect(sharedStandardMaterial('#b9a78a')).toBe(a)
    expect(sharedStandardMaterial('#b9a78a', { roughness: 0.2 })).not.toBe(a)
    const f = fadedVariant(a, 0.28)
    expect(f).not.toBe(a)
    expect(f.transparent).toBe(true)
    expect(a.transparent).toBe(false)
    expect(fadedVariant(a, 0.28)).toBe(f)
  })
})
