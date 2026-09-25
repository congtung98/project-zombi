import { MeshStandardMaterial, Vector4, type Material } from 'three'

/**
 * Indoor shading for building lighting: every MeshStandardMaterial in the game scene is patched
 * once (no clones) with a few shared uniforms. A fragment inside a room rectangle and below its
 * ceiling replaces the sun/ambient response by the room's light (the roof keeps the sun out);
 * every other fragment is untouched, so outdoor world lighting stays exactly the day/night system's.
 * Uniforms change only when room light changes (and ease for a short fade).
 */

export const INDOOR_MAX_ROOMS = 16

/** Shared by every patched program: rooms as (minX, maxX, minZ, maxZ) and shade (rgb, ceiling y). */
export const indoorUniforms = {
  uRoomCount: { value: 0 },
  uRoomRect: { value: Array.from({ length: INDOOR_MAX_ROOMS }, () => new Vector4()) },
  uRoomShade: { value: Array.from({ length: INDOOR_MAX_ROOMS }, () => new Vector4(1, 1, 1, 0)) },
}

const VERTEX_DECL = /* glsl */ `
#include <common>
varying vec3 vIndoorWorld;
`
const VERTEX_APPLY = /* glsl */ `
#include <project_vertex>
vIndoorWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`

const FRAGMENT_DECL = /* glsl */ `
#include <common>
#define INDOOR_MAX_ROOMS ${INDOOR_MAX_ROOMS}
uniform int uRoomCount;
uniform vec4 uRoomRect[INDOOR_MAX_ROOMS];
uniform vec4 uRoomShade[INDOOR_MAX_ROOMS];
varying vec3 vIndoorWorld;
`

/** Room light replaces the scene lights indoors; a fixed sky direction keeps some form on faces. */
const FRAGMENT_APPLY = /* glsl */ `
for (int i = 0; i < INDOOR_MAX_ROOMS; i++) {
  if (i >= uRoomCount) break;
  vec4 r = uRoomRect[i];
  if (vIndoorWorld.x >= r.x && vIndoorWorld.x <= r.y && vIndoorWorld.z >= r.z && vIndoorWorld.z <= r.w && vIndoorWorld.y < uRoomShade[i].w) {
    vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
    float form = 0.7 + 0.3 * max(dot(worldNormal, normalize(vec3(0.35, 0.85, 0.4))), 0.0);
    outgoingLight = diffuseColor.rgb * uRoomShade[i].rgb * form + totalEmissiveRadiance;
    break;
  }
}
#include <opaque_fragment>
`

/** Patch a material in place (idempotent). Only standard materials: lines, overlays, HTML untouched. */
export function patchIndoorMaterial(material: Material): boolean {
  if (!(material instanceof MeshStandardMaterial) || material.userData.indoorLit) return false
  material.userData.indoorLit = true
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, indoorUniforms)
    shader.vertexShader = shader.vertexShader.replace('#include <common>', VERTEX_DECL).replace('#include <project_vertex>', VERTEX_APPLY)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', FRAGMENT_DECL).replace('#include <opaque_fragment>', FRAGMENT_APPLY)
  }
  material.customProgramCacheKey = () => 'indoor-lighting-v1'
  material.needsUpdate = true
  return true
}
