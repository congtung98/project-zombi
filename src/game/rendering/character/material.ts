import { Color, MeshStandardMaterial } from 'three'
import { SLOT, SLOT_COUNT } from './body'

/**
 * C1 (character plan): one material per character, one shader program for all of them. The shared
 * body geometry carries a palette slot per vertex (`paint`); this material holds the colours of its
 * character (uniform array) and the eye glow, so tinting, flashing or fading one character never
 * touches another, and a crowd shares geometry and program.
 */
export class CharacterMaterial extends MeshStandardMaterial {
  readonly palette: Color[]
  readonly eyeGlow = new Color(0, 0, 0)

  constructor(colors: readonly string[]) {
    super({ color: '#ffffff', roughness: 0.88, metalness: 0 })
    if (colors.length !== SLOT_COUNT) throw new Error(`character palette needs ${SLOT_COUNT} colours`)
    this.palette = colors.map((c) => new Color(c))
    this.name = 'character'
    this.onBeforeCompile = (shader) => {
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
  }

  override customProgramCacheKey(): string {
    return 'character-palette-1'
  }
}
