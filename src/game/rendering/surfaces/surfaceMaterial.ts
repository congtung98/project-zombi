import { Color, DataArrayTexture, Vector3, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Vector4, type MeshStandardMaterialParameters } from 'three'
import { applyIndoorShader, INDOOR_PROGRAM_KEY } from '../indoorShading'
import { CONTACT_GLSL, contactUniforms } from '../contactShade'
import { packSurface, SURFACE_IDS, SURFACES, type SurfaceSpec } from './catalog'
import { generateSurface, TEXTURE_SIZE } from './textureGen'

/**
 * G1: the surface materials. Every surface's detail texture is one layer of a single
 * `DataArrayTexture`, generated **once** (first compile of a surface material) and cached for the
 * whole app: chunk loads, scene remounts and new games reuse it. Materials only name layers.
 *
 * Which layer a fragment reads: batched static pieces carry a packed code (`catalog.packSurface`) in
 * the alpha of their per-instance colour (the batch keeps one material and one draw call; the shader
 * resets alpha to 1); plain meshes carry it as a material uniform. The code picks surface `a`, or `b`
 * on the faces of its face mask (outer walls: brick outside, plaster inside).
 *
 * Coordinates are physical (metres / the surface's tile size), so a texel covers the same area on a
 * 1 m and a 10 m wall: `world` from the world position, `local` from the object's box (unit batch
 * geometry: from its lower corner, scaled by the instance matrix, so a cut-down wall piece keeps its
 * pattern where it is), `triplanar` for round shapes. The material chains the indoor lighting patch
 * (room light, interior mask) first, so textured pieces are lit and masked like every other one.
 */

const MODE = { world: 0, local: 1, triplanar: 2 } as const

/** Shared by every surface program. */
export const surfaceUniforms = {
  /** A white 1 × 1 placeholder until the generated array is ready (flat colours, as before G1). */
  uSurfMaps: { value: null as DataArrayTexture | null },
  /** Per layer: tile u (m), tile v (m), gain (1 until the real array replaces the placeholder), mapping mode. */
  uSurfTile: { value: SURFACE_IDS.map((id) => new Vector4(SURFACES[id].tile[0], SURFACES[id].tile[1], 1, MODE[SURFACES[id].mapping])) },
  /** Per layer: roughness, strength. */
  uSurfOpt: { value: SURFACE_IDS.map((id) => new Vector4(SURFACES[id].roughness, SURFACES[id].strength, 0, 0)) },
}

export interface SurfaceAtlasStats {
  layers: number
  size: number
  /** Time spent generating every layer (ms), once per app, idle slices included. */
  buildMs: number
  /** Time a caller of `surfaceAtlas` waited (layers left to generate, texture set-up). */
  blockingMs: number
  /** Layers generated in idle slices. */
  warmedLayers: number
  /** Texture bytes on the GPU with mipmaps (RGBA8). */
  bytes: number
  builds: number
}

let atlas: DataArrayTexture | null = null
/** G6: anisotropic filtering of the texture array (graphics tier: 1 / 4 / 8). */
let anisotropy = 4

/** G6: set the texture filtering of the graphics tier (re-uploads the array once when it changes). */
export function setSurfaceAnisotropy(n: number): void {
  if (n === anisotropy) return
  anisotropy = n
  if (atlas) {
    atlas.anisotropy = n
    atlas.needsUpdate = true
  }
}
let placeholder: DataArrayTexture | null = null
let warming = false
const stats: SurfaceAtlasStats = { layers: SURFACE_IDS.length, size: TEXTURE_SIZE, buildMs: 0, blockingMs: 0, warmedLayers: 0, bytes: 0, builds: 0 }
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const LAYER_BYTES = TEXTURE_SIZE * TEXTURE_SIZE * 4
/** Pixels and gains of every layer, filled layer by layer. */
const pixels = { data: null as Uint8Array | null, gains: SURFACE_IDS.map(() => 1), done: 0 }

function generateNextLayer(): void {
  const start = now()
  pixels.data ??= new Uint8Array(LAYER_BYTES * SURFACE_IDS.length)
  const i = pixels.done
  const layer = generateSurface(SURFACES[SURFACE_IDS[i]])
  pixels.data.set(layer.data, i * LAYER_BYTES)
  pixels.gains[i] = layer.gain
  pixels.done += 1
  stats.buildMs += now() - start
}

const idle = (cb: () => void) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(cb, { timeout: 500 }) : setTimeout(cb, 16))

/**
 * First compile of a surface material: no waiting. The placeholder goes in, the layers are generated
 * one per idle slice (≈ 10 ms each: the main menu is on screen behind which the world first renders),
 * then the array replaces the placeholder (a uniform change: no recompile).
 */
function requestSurfaceMaps(): void {
  if (atlas || warming) return
  warming = true
  if (!surfaceUniforms.uSurfMaps.value) {
    placeholder = new DataArrayTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, 1)
    placeholder.needsUpdate = true
    surfaceUniforms.uSurfMaps.value = placeholder
  }
  const step = () => {
    if (atlas) return
    if (pixels.done < SURFACE_IDS.length) {
      generateNextLayer()
      stats.warmedLayers += 1
      idle(step)
    } else {
      surfaceAtlas()
    }
  }
  idle(step)
}

/** The texture array, now: generates whatever is left (built once, then cached for the app). */
export function surfaceAtlas(): DataArrayTexture {
  if (atlas) return atlas
  const start = now()
  while (pixels.done < SURFACE_IDS.length) generateNextLayer()
  const data = pixels.data!
  const texture = new DataArrayTexture(data, TEXTURE_SIZE, TEXTURE_SIZE, SURFACE_IDS.length)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = true
  // Walls and ground are seen at a slant from the isometric camera.
  texture.anisotropy = anisotropy
  texture.needsUpdate = true
  atlas = texture
  pixels.gains.forEach((g, i) => (surfaceUniforms.uSurfTile.value[i].z = g))
  surfaceUniforms.uSurfMaps.value = texture
  placeholder?.dispose()
  placeholder = null
  stats.blockingMs = now() - start
  stats.bytes = Math.round((data.byteLength * 4) / 3)
  stats.builds += 1
  return texture
}

export function surfaceAtlasStats(): SurfaceAtlasStats {
  return { ...stats }
}

/** Dev/bench: what the surfaces hold now (the current texture: placeholder or array). */
export function surfaceDebug(): SurfaceAtlasStats & { materials: number; texture: DataArrayTexture | null } {
  return { ...stats, materials: cache.size, texture: surfaceUniforms.uSurfMaps.value }
}

const VERTEX_DECL = /* glsl */ `
#include <common>
flat varying float vSurfCode;
varying vec3 vSurfWorld;
varying vec3 vSurfLocal;
varying vec3 vSurfSize;
varying vec3 vSurfObjNormal;
varying vec3 vSurfWorldNormal;
uniform float uSurfCode;
uniform vec3 uSurfBox;
`

const VERTEX_APPLY = /* glsl */ `
mat4 surfModel = modelMatrix;
#ifdef USE_BATCHING
surfModel = surfModel * batchingMatrix;
#endif
#ifdef USE_INSTANCING
surfModel = surfModel * instanceMatrix;
#endif
vSurfWorld = (surfModel * vec4(transformed, 1.0)).xyz;
vSurfWorldNormal = mat3(surfModel) * objectNormal;
vSurfObjNormal = objectNormal;
#ifdef SURF_UNIT
vSurfSize = vec3(length(surfModel[0].xyz), length(surfModel[1].xyz), length(surfModel[2].xyz));
vSurfLocal = (transformed + 0.5) * vSurfSize;
#else
// A plain mesh centred on its own box (uSurfBox, zero when it has none): from its lower corner.
vSurfSize = uSurfBox;
vSurfLocal = transformed + 0.5 * uSurfBox;
#endif
#ifdef USE_BATCHING_COLOR
vSurfCode = vColor.a;
vColor.a = 1.0;
#else
vSurfCode = uSurfCode;
#endif
#include <fog_vertex>
`

const FRAGMENT_DECL = /* glsl */ `
#include <common>
${CONTACT_GLSL}
#define SURF_LAYERS ${SURFACE_IDS.length}
uniform sampler2DArray uSurfMaps;
uniform vec4 uSurfTile[SURF_LAYERS];
uniform vec4 uSurfOpt[SURF_LAYERS];
flat varying float vSurfCode;
varying vec3 vSurfWorld;
varying vec3 vSurfLocal;
varying vec3 vSurfSize;
varying vec3 vSurfObjNormal;
varying vec3 vSurfWorldNormal;

/** Face bit of an axis-aligned normal: +X 0, -X 1, +Y 2, -Y 3, +Z 4, -Z 5. */
int surfFace(vec3 n) {
  vec3 a = abs(n);
  if (a.x >= a.y && a.x >= a.z) return n.x > 0.0 ? 0 : 1;
  if (a.y >= a.z) return n.y > 0.0 ? 2 : 3;
  return n.z > 0.0 ? 4 : 5;
}

vec3 surfSample(int layer, vec2 p, vec4 tile) {
  return texture(uSurfMaps, vec3(p / tile.xy, float(layer))).rgb;
}
`

const FRAGMENT_APPLY = /* glsl */ `
#include <color_fragment>
int surfLayer = 0;
{
  int code = int(vSurfCode + 0.5);
  vec3 wn = normalize(vSurfWorldNormal);
  surfLayer = ((code >> (8 + surfFace(wn))) & 1) == 1 ? (code >> 4) & 15 : code & 15;
  vec4 tile = uSurfTile[surfLayer];
  int mode = int(tile.w + 0.5);
  vec3 detail;
  if (mode == 2) {
    vec3 w = pow(abs(wn), vec3(4.0));
    w /= (w.x + w.y + w.z);
    detail = surfSample(surfLayer, vSurfWorld.zy, tile) * w.x + surfSample(surfLayer, vSurfWorld.xz, tile) * w.y + surfSample(surfLayer, vSurfWorld.xy, tile) * w.z;
  } else {
    vec3 p = mode == 1 ? vSurfLocal : vSurfWorld;
    vec3 n = mode == 1 ? abs(normalize(vSurfObjNormal)) : abs(wn);
    // A local box runs u along the longer side of each face (grain up a door, along a table top).
    bool isLocal = mode == 1;
    vec2 uv;
    if (n.x >= n.y && n.x >= n.z) uv = (isLocal && vSurfSize.y > vSurfSize.z) ? p.yz : p.zy;
    else if (n.z >= n.y) uv = (isLocal && vSurfSize.y > vSurfSize.x) ? p.yx : p.xy;
    // Top faces: a local box along its longer side; a world slope (G2 roofs) with u along its eaves.
    else if (isLocal) uv = vSurfSize.z > vSurfSize.x ? p.zx : p.xz;
    else uv = abs(wn.x) > abs(wn.z) + 0.01 ? p.zx : p.xz;
    detail = surfSample(surfLayer, uv, tile);
  }
  diffuseColor.rgb *= mix(vec3(1.0), detail * tile.z, uSurfOpt[surfLayer].y);
  // G4: contact darkening near things standing on the floor (contactShade.ts).
  diffuseColor.rgb *= surfContact(vSurfWorld);
}
`

const ROUGHNESS_APPLY = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = uSurfOpt[surfLayer].x;
`

type Shader = Parameters<MeshStandardMaterial['onBeforeCompile']>[0]

export interface SurfaceMaterialOptions {
  /** Surfaces of a plain mesh (batched pieces carry theirs per instance). */
  surface?: SurfaceSpec
  /** Unit geometry scaled by the instance/model matrix (batch pieces, fade overlays). */
  unitGeometry?: boolean
  /** Size of a plain mesh's box for `local` surfaces (a door leaf); none = centred coordinates. */
  box?: readonly [number, number, number]
}

/**
 * MeshStandardMaterial with the surface detail (and, first, the indoor lighting patch). A subclass
 * so `clone()` (the occlusion fader's faded twin) keeps the look.
 */
export class SurfaceMaterial extends MeshStandardMaterial {
  readonly chainsIndoorShading = true
  surfaceCode = 0
  unitGeometry = false
  readonly box = new Vector3()

  constructor(parameters: MeshStandardMaterialParameters = {}, options: SurfaceMaterialOptions = {}) {
    super(parameters)
    this.surfaceCode = options.surface ? packSurface(options.surface) : 0
    this.unitGeometry = options.unitGeometry ?? false
    if (options.box) this.box.set(...options.box)
  }

  override onBeforeCompile(shader: Shader): void {
    applyIndoorShader(shader)
    shader.uniforms.uSurfMaps = surfaceUniforms.uSurfMaps
    shader.uniforms.uSurfTile = surfaceUniforms.uSurfTile
    shader.uniforms.uSurfOpt = surfaceUniforms.uSurfOpt
    shader.uniforms.uSurfCode = { value: this.surfaceCode }
    shader.uniforms.uSurfBox = { value: this.box }
    shader.uniforms.uContactMap = contactUniforms.uContactMap
    shader.uniforms.uContactWindow = contactUniforms.uContactWindow
    shader.uniforms.uContactOpt = contactUniforms.uContactOpt
    requestSurfaceMaps()
    const unit = this.unitGeometry ? '#define SURF_UNIT\n' : ''
    shader.vertexShader = unit + shader.vertexShader.replace('#include <common>', VERTEX_DECL).replace('#include <fog_vertex>', VERTEX_APPLY)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FRAGMENT_DECL)
      .replace('#include <color_fragment>', FRAGMENT_APPLY)
      .replace('#include <roughnessmap_fragment>', ROUGHNESS_APPLY)
  }

  override customProgramCacheKey(): string {
    return `${INDOOR_PROGRAM_KEY}|surface-v2|${this.unitGeometry ? 'unit' : 'mesh'}`
  }

  override copy(source: SurfaceMaterial): this {
    super.copy(source)
    this.surfaceCode = source.surfaceCode
    this.unitGeometry = source.unitGeometry
    this.box.copy(source.box)
    return this
  }
}

const cache = new Map<string, SurfaceMaterial>()

function shared(key: string, make: () => SurfaceMaterial): SurfaceMaterial {
  let m = cache.get(key)
  if (!m) {
    m = make()
    m.userData.shared = true
    cache.set(key, m)
  }
  return m
}

/** The one material of every static batch (white: the per-instance colour tints it). */
export function batchSurfaceMaterial(): SurfaceMaterial {
  return shared('batch', () => new SurfaceMaterial({ color: '#ffffff' }, { unitGeometry: true }))
}

/**
 * Shared material of a plain mesh with a fixed surface and colour (roads, ground, fade overlays of
 * batch pieces with `unitGeometry`). Never mutated per object.
 */
export function surfaceMaterial(code: number, color: string, unitGeometry = false): SurfaceMaterial {
  return shared(`${code}|${new Color(color).getHexString()}|${unitGeometry ? 'u' : 'm'}`, () => {
    const m = new SurfaceMaterial({ color }, { unitGeometry })
    m.surfaceCode = code
    return m
  })
}

/** Counts for the perf audit (materials made; the texture is built once whatever this says). */
export function surfaceMaterialCount(): number {
  return cache.size
}
