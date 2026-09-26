import { DataTexture, MeshStandardMaterial, NearestFilter, RGBAFormat, UnsignedByteType, Vector2, Vector4 } from 'three'
import { BUILDING_LIGHTING_CONFIG } from '../core/config'
import type { RoomPlacement } from '../world/buildings'

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
 *
 * M11c-1B: the interior mask. After the room light (never instead of it), an indoor fragment is
 * scaled by how much of it the character sees: seen cells unchanged, remembered cells dimmed and
 * greyed, never-seen cells near black (`InteriorMask` fills the mask texture and the levels). Rooms
 * of the character's storey read the texture (R = seen, eased; G = explored); others a constant
 * (explored at all or not). Outdoor fragments never enter this branch.
 */

/** GLSL array size; from config so the limit is not a magic number scattered around. */
export const INDOOR_MAX_ROOMS = BUILDING_LIGHTING_CONFIG.maxShaderRooms

/** Shared by every patched program: rooms as (minX, maxX, minZ, maxZ) and shade (rgb, ceiling y). */
export const indoorUniforms = {
  uRoomCount: { value: 0 },
  uRoomRect: { value: Array.from({ length: INDOOR_MAX_ROOMS }, () => new Vector4()) },
  uRoomShade: { value: Array.from({ length: INDOOR_MAX_ROOMS }, () => new Vector4(1, 1, 1, 0)) },
  /** M11b: floor height of each slot's room (fragments below it belong to the storey under it). */
  uRoomFloor: { value: Array.from({ length: INDOOR_MAX_ROOMS }, () => 0) },
  /** M11c-1B: per slot (1 = read the mask texture, known share when not on the texture's storey). */
  uRoomMask: { value: Array.from({ length: INDOOR_MAX_ROOMS }, () => new Vector2(0, 1)) },
  /** Mask texture: R seen (0..1), G explored, over a square of the world. */
  uVisMap: { value: new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType) },
  /** (minX, minZ, 1 / size, enabled). Disabled: every indoor fragment as before M11c-1B. */
  uVisWindow: { value: new Vector4(0, 0, 1, 0) },
  /** (never-seen level, remembered level, remembered desaturation, debug tint). */
  uVisLevels: { value: new Vector4(1, 1, 0, 0) },
}
indoorUniforms.uVisMap.value.magFilter = NearestFilter
indoorUniforms.uVisMap.value.minFilter = NearestFilter

/**
 * The room each shader slot holds (set by `IndoorLighting` when it re-picks; `version` bumps), for
 * `InteriorMask`'s per-slot flags.
 */
export const indoorSlots = { rooms: [] as RoomPlacement[], version: 0 }

const VERTEX_DECL = /* glsl */ `
#include <common>
varying vec3 vIndoorWorld;
`
/** World position like `project_vertex` builds it (R3b: batched and instanced meshes included). */
const VERTEX_APPLY = /* glsl */ `
#include <project_vertex>
vec4 indoorLocal = vec4(transformed, 1.0);
#ifdef USE_BATCHING
indoorLocal = batchingMatrix * indoorLocal;
#endif
#ifdef USE_INSTANCING
indoorLocal = instanceMatrix * indoorLocal;
#endif
vIndoorWorld = (modelMatrix * indoorLocal).xyz;
`

const FRAGMENT_DECL = /* glsl */ `
#include <common>
#define INDOOR_MAX_ROOMS ${INDOOR_MAX_ROOMS}
uniform int uRoomCount;
uniform vec4 uRoomRect[INDOOR_MAX_ROOMS];
uniform vec4 uRoomShade[INDOOR_MAX_ROOMS];
uniform float uRoomFloor[INDOOR_MAX_ROOMS];
uniform vec2 uRoomMask[INDOOR_MAX_ROOMS];
uniform sampler2D uVisMap;
uniform vec4 uVisWindow;
uniform vec4 uVisLevels;
varying vec3 vIndoorWorld;
`

/** Room light replaces the scene lights indoors; a fixed sky direction keeps some form on faces. */
const FRAGMENT_APPLY = /* glsl */ `
for (int i = 0; i < INDOOR_MAX_ROOMS; i++) {
  if (i >= uRoomCount) break;
  vec4 r = uRoomRect[i];
  if (vIndoorWorld.x >= r.x && vIndoorWorld.x <= r.y && vIndoorWorld.z >= r.z && vIndoorWorld.z <= r.w && vIndoorWorld.y < uRoomShade[i].w && vIndoorWorld.y >= uRoomFloor[i]) {
    vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
    float form = 0.7 + 0.3 * max(dot(worldNormal, normalize(vec3(0.35, 0.85, 0.4))), 0.0);
    outgoingLight = diffuseColor.rgb * uRoomShade[i].rgb * form + totalEmissiveRadiance;
    if (uVisWindow.w > 0.5) {
      // M11c-1B interior mask: a factor after the light (seen 1, remembered dim grey, never seen dark).
      float seen = 0.0;
      float known = uRoomMask[i].y;
      vec2 uv = (vIndoorWorld.xz - uVisWindow.xy) * uVisWindow.z;
      if (uRoomMask[i].x > 0.5 && uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
        vec4 m = texture2D(uVisMap, uv);
        seen = m.r;
        known = m.g;
      }
      vec3 grey = vec3(dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)));
      vec3 remembered = mix(outgoingLight, grey, uVisLevels.z) * uVisLevels.y;
      vec3 hidden = mix(outgoingLight * uVisLevels.x, remembered, known);
      vec3 masked = mix(hidden, outgoingLight, seen);
      // Debug (F4): seen green, remembered blue, never seen red.
      vec3 tint = seen > 0.5 ? vec3(0.2, 1.0, 0.3) : known > 0.5 ? vec3(0.3, 0.5, 1.0) : vec3(1.0, 0.2, 0.2);
      outgoingLight = uVisLevels.w > 0.5 ? mix(outgoingLight, tint, 0.35) : masked;
    }
    break;
  }
}
#include <opaque_fragment>
`

const PROGRAM_KEY = 'indoor-lighting-v4'

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
