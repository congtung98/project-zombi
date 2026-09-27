import { Color, MeshStandardMaterial } from 'three'
import { applyIndoorShader, INDOOR_PROGRAM_KEY } from '../indoorShading'
import { SLOT, SLOT_COUNT } from './body'

type Shader = Parameters<MeshStandardMaterial['onBeforeCompile']>[0]

/**
 * C1 (character plan): one material per character, one shader program for all of them. The shared
 * body geometry carries a palette slot per vertex (`paint`); this material holds the colours of its
 * character (uniform array) and the eye glow, so tinting, flashing or fading one character never
 * touches another, and a crowd shares geometry and program.
 *
 * C6: chains the indoor lighting patch first (like the surface materials), so characters inside a
 * building take the room light and the interior mask as every standard material does; a material
 * with its own `onBeforeCompile` would otherwise opt out of the prototype patch.
 */
export class CharacterMaterial extends MeshStandardMaterial {
  readonly chainsIndoorShading = true
  readonly palette: Color[]
  readonly eyeGlow = new Color(0, 0, 0)

  constructor(colors: readonly string[]) {
    super({ color: '#ffffff', roughness: 0.88, metalness: 0 })
    if (colors.length !== SLOT_COUNT) throw new Error(`character palette needs ${SLOT_COUNT} colours`)
    this.palette = colors.map((c) => new Color(c))
    this.name = 'character'
  }

  override onBeforeCompile(shader: Shader): void {
    applyIndoorShader(shader)
    shader.uniforms.uPalette = { value: this.palette }
    shader.uniforms.uEyeGlow = { value: this.eyeGlow }
    shader.vertexShader = `attribute float paint;\nuniform vec3 uPalette[${SLOT_COUNT}];\nvarying vec3 vPaint;\nvarying float vGlow;\n${shader.vertexShader}`.replace(
      '#include <color_vertex>',
      `#include <color_vertex>\n\tvPaint = uPalette[int(paint + 0.5)];\n\tvGlow = abs(paint - ${SLOT.eyes}.0) < 0.5 ? 1.0 : 0.0;`,
    )
    shader.fragmentShader = `uniform vec3 uEyeGlow;\nvarying vec3 vPaint;\nvarying float vGlow;\n${shader.fragmentShader}`
      .replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.rgb *= vPaint;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += uEyeGlow * vGlow;')
  }

  override customProgramCacheKey(): string {
    return `${INDOOR_PROGRAM_KEY}|character-palette-2`
  }
}
