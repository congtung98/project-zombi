import { ClampToEdgeWrapping, DataTexture, LinearFilter, RGBAFormat, UnsignedByteType, Vector4 } from 'three'
import { mapBounds, type MapData } from '../world/mapData'

/**
 * G4 (graphics plan §8, contact and AO): a soft darkening where things stand on the floor, so
 * furniture, walls and fences sit on the ground instead of floating. Indoors the room light replaces
 * the sun, so there was no shadow at all under a bed or along a wall.
 *
 * One map for the whole world, built once per map in idle time (never per frame, never per chunk):
 * every static box that touches a storey floor (walls, props, containers, tree trunks; never doors,
 * they move) is drawn into the channel of its storey (R ground, G first floor, B, A), then blurred
 * about `REACH` metres. The surface shader samples it at each fragment of the static world and
 * darkens fragments lower than `HEIGHT` above their storey floor: floors next to objects, the foot of
 * walls and furniture. It multiplies the albedo before the lights and the interior mask, so it never
 * reveals anything (a dark floor stays dark) and never lights anything.
 *
 * The world is static (furniture never moves or breaks), so nothing is left behind. Storeys are
 * banded by `STOREY` metres (every building so far has 3 m storeys).
 */

/** Darkening at full occupancy (Medium and High tiers). */
const CONTACT_STRENGTH_DEFAULT = 0.4
export const CONTACT_STRENGTH = CONTACT_STRENGTH_DEFAULT

/** Cell of the map (m). */
export const CONTACT_CELL = 0.125
/** Largest side of the map in cells (bigger worlds get coarser cells). */
const MAX_CELLS = 2048
/** Blur radius per pass (cells); two passes of a box blur ≈ a soft falloff over ~0.5 m. */
const BLUR = 2
/** A box counts as standing on a floor when its bottom is this close to it (m). */
const FLOOR_TOLERANCE = 0.15
/**
 * Gain on the blurred occupancy: a thin wall (two or three cells) blurs to about half; doubled, the
 * floor right at its foot gets the full darkening and it still fades out within the reach.
 */
const GAIN = 2
/** Storey band height (m) of the shader and the build. */
export const STOREY = 3
/** Storeys the map holds (RGBA). */
const LEVELS = 4

export interface ContactMap {
  data: Uint8Array
  width: number
  height: number
  /** World x/z of the map's corner (cell 0, 0). */
  x0: number
  z0: number
  cell: number
}

interface Box {
  min: { x: number; y: number; z: number }
  max: { x: number; y: number; z: number }
}

/** Static boxes standing on a floor: walls and props (incl. tree trunks), containers. */
function standingBoxes(map: MapData): Box[] {
  const out: Box[] = []
  const add = (p: { x: number; y: number; z: number }, s: readonly number[]) =>
    out.push({ min: { x: p.x - s[0] / 2, y: p.y - s[1] / 2, z: p.z - s[2] / 2 }, max: { x: p.x + s[0] / 2, y: p.y + s[1] / 2, z: p.z + s[2] / 2 } })
  for (const w of map.walls) add(w.position, w.size)
  for (const c of map.containers) add(c.position, c.size)
  return out
}

/** The map area: the ground plane and a margin (boundary walls stand on its edge). */
function mapArea(map: MapData): { x0: number; z0: number; w: number; d: number } {
  const r = mapBounds(map)
  return { x0: r.minX - 2, z0: r.minZ - 2, w: r.maxX - r.minX + 4, d: r.maxZ - r.minZ + 4 }
}

/** Build the map (pure; tests and the idle builder). */
export function buildContactMap(map: MapData): ContactMap {
  const area = mapArea(map)
  const cell = Math.max(CONTACT_CELL, Math.max(area.w, area.d) / MAX_CELLS)
  const width = Math.ceil(area.w / cell)
  const height = Math.ceil(area.d / cell)
  const planes = Array.from({ length: LEVELS }, () => new Float32Array(width * height))
  for (const b of standingBoxes(map)) {
    const level = Math.round(b.min.y / STOREY)
    if (level < 0 || level >= LEVELS || Math.abs(b.min.y - level * STOREY) > FLOOR_TOLERANCE) continue
    // Cells whose centre is inside the footprint.
    const c0 = Math.max(0, Math.ceil((b.min.x - area.x0) / cell - 0.5))
    const c1 = Math.min(width - 1, Math.floor((b.max.x - area.x0) / cell - 0.5))
    const r0 = Math.max(0, Math.ceil((b.min.z - area.z0) / cell - 0.5))
    const r1 = Math.min(height - 1, Math.floor((b.max.z - area.z0) / cell - 0.5))
    const plane = planes[level]
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) plane[r * width + c] = 1
    // A box thinner than a cell (a fence, a thin post) still marks the cell it stands in.
    if (c0 > c1 || r0 > r1) {
      const c = Math.min(width - 1, Math.max(0, Math.floor(((b.min.x + b.max.x) / 2 - area.x0) / cell)))
      const r = Math.min(height - 1, Math.max(0, Math.floor(((b.min.z + b.max.z) / 2 - area.z0) / cell)))
      plane[r * width + c] = Math.max(plane[r * width + c], 0.6)
    }
  }
  const data = new Uint8Array(width * height * 4)
  const tmp = new Float32Array(width * height)
  planes.forEach((plane, k) => {
    if (!plane.some((v) => v > 0)) return
    for (let pass = 0; pass < 2; pass++) {
      boxBlur(plane, tmp, width, height, BLUR, true)
      boxBlur(tmp, plane, width, height, BLUR, false)
    }
    for (let i = 0; i < plane.length; i++) data[i * 4 + k] = Math.round(Math.min(1, plane[i] * GAIN) * 255)
  })
  return { data, width, height, x0: area.x0, z0: area.z0, cell }
}

/** Running-sum box blur along rows (`horizontal`) or columns, edges clamped. */
function boxBlur(src: Float32Array, dst: Float32Array, width: number, height: number, r: number, horizontal: boolean): void {
  const n = horizontal ? width : height
  const lines = horizontal ? height : width
  const at = (line: number, i: number) => (horizontal ? line * width + i : i * width + line)
  const span = 2 * r + 1
  for (let line = 0; line < lines; line++) {
    let sum = 0
    for (let i = -r; i <= r; i++) sum += src[at(line, Math.min(n - 1, Math.max(0, i)))]
    for (let i = 0; i < n; i++) {
      dst[at(line, i)] = sum / span
      sum += src[at(line, Math.min(n - 1, i + r + 1))] - src[at(line, Math.max(0, i - r))]
    }
  }
}

/**
 * Shader inputs (shared by every surface material): the map, its window (x0, z0, 1/width m,
 * 1/depth m; z = 0 means none: nothing darkens) and options (strength, storey band, reach height).
 */
export const contactUniforms = {
  uContactMap: { value: placeholderTexture() },
  uContactWindow: { value: new Vector4(0, 0, 0, 0) },
  uContactOpt: { value: new Vector4(CONTACT_STRENGTH_DEFAULT, STOREY, 0.45, 0) },
}

function placeholderTexture(): DataTexture {
  const t = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType)
  t.needsUpdate = true
  return t
}

/** Put a built map on the GPU (replacing the previous one); returns what to call to take it off. */
export function applyContactMap(m: ContactMap): () => void {
  const t = new DataTexture(m.data, m.width, m.height, RGBAFormat, UnsignedByteType)
  t.magFilter = LinearFilter
  t.minFilter = LinearFilter
  t.wrapS = ClampToEdgeWrapping
  t.wrapT = ClampToEdgeWrapping
  t.generateMipmaps = false
  t.needsUpdate = true
  const previous = contactUniforms.uContactMap.value
  contactUniforms.uContactMap.value = t
  contactUniforms.uContactWindow.value.set(m.x0, m.z0, 1 / (m.width * m.cell), 1 / (m.height * m.cell))
  if (previous.image.width > 1) previous.dispose()
  return () => {
    if (contactUniforms.uContactMap.value !== t) return
    contactUniforms.uContactWindow.value.set(0, 0, 0, 0)
    contactUniforms.uContactMap.value = placeholderTexture()
    t.dispose()
  }
}

/** Build time and size of the last contact map (dev hook and the baseline script). */
export const contactStats = { ms: 0, width: 0, height: 0 }

/** Strength of the darkening (0 = off; quality tiers, G6). */
export function setContactStrength(strength: number): void {
  contactUniforms.uContactOpt.value.x = strength
}

/** GLSL: the darkening factor at a world point with a world normal (1 = none). */
export const CONTACT_GLSL = /* glsl */ `
uniform sampler2D uContactMap;
uniform vec4 uContactWindow;
uniform vec4 uContactOpt;
float surfContact(vec3 p) {
  if (uContactWindow.z <= 0.0 || uContactOpt.x <= 0.0) return 1.0;
  vec2 uv = vec2((p.x - uContactWindow.x) * uContactWindow.z, (p.z - uContactWindow.y) * uContactWindow.w);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;
  float band = clamp(floor((p.y + 0.3) / uContactOpt.y), 0.0, 3.0);
  float h = p.y - band * uContactOpt.y;
  if (h < -0.05 || h > uContactOpt.z) return 1.0;
  vec4 o = texture2D(uContactMap, uv);
  float occ = band < 0.5 ? o.r : band < 1.5 ? o.g : band < 2.5 ? o.b : o.a;
  float fall = 1.0 - smoothstep(0.0, uContactOpt.z, max(h, 0.0));
  return 1.0 - uContactOpt.x * occ * fall;
}
`
