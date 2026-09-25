import { MeshStandardMaterial, Vector4 } from 'three'
import { BUILDING_LIGHTING_CONFIG } from '../core/config'

/**
 * Indoor shading for building lighting: every MeshStandardMaterial shares a few uniforms. A fragment
 * inside a room rectangle and below its ceiling replaces the sun/ambient response by the room's light
 * (the roof keeps the sun out); every other fragment is untouched, so outdoor world lighting stays
 * exactly the day/night system's. Uniforms change only when room light changes (and ease briefly).
 *
 * R1: the patch is installed once on `MeshStandardMaterial.prototype` (`installIndoorShading`), so
 * every standard material gets it when it is created, wherever it is created (JSX, rigs, clones).
 * Before R1 a `scene.traverse` patched new materials every frame. A material that assigns its own
 * `onBeforeCompile` opts out.
 */

/** GLSL array size; from config so the limit is not a magic number scattered around. */
export const INDOOR_MAX_ROOMS = BUILDING_LIGHTING_CONFIG.maxShaderRooms

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

const PROGRAM_KEY = 'indoor-lighting-v1'

type Shader = Parameters<MeshStandardMaterial['onBeforeCompile']>[0]

function applyIndoorShader(shader: Shader): void {
  Object.assign(shader.uniforms, indoorUniforms)
  shader.vertexShader = shader.vertexShader.replace('#include <common>', VERTEX_DECL).replace('#include <project_vertex>', VERTEX_APPLY)
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', FRAGMENT_DECL).replace('#include <opaque_fragment>', FRAGMENT_APPLY)
}

let installed = false

/**
 * Install the indoor patch for every MeshStandardMaterial (idempotent; called at module load of the
 * game scene). Lines, basic materials, overlays and HTML are untouched. With no room uploaded
 * (`uRoomCount` 0, e.g. the character preview) the loop is a no-op and the output is unchanged.
 */
export function installIndoorShading(): void {
  if (installed) return
  installed = true
  const proto = MeshStandardMaterial.prototype
  proto.onBeforeCompile = applyIndoorShader
  proto.customProgramCacheKey = () => PROGRAM_KEY
}

/** True when this material compiles with the indoor patch (the prototype's, not its own hook). */
export function hasIndoorShading(material: MeshStandardMaterial): boolean {
  return installed && material.onBeforeCompile === applyIndoorShader
}
