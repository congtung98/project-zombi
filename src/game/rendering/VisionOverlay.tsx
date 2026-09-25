import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, DataTexture, LinearFilter, Matrix4, RepeatWrapping, RGBAFormat, ShaderMaterial, UnsignedByteType, Vector2, type Camera } from 'three'
import { runtime } from '../core/runtime'
import { dampAngle } from '../systems/movement'
import { daylightAt } from './daylight'
import { computeSectorDistances, overlayAlphaAt, overlayStrength, sectorRange, visionOverlayDebug } from '../systems/visionOverlay'

const VISION = runtime.config.playerVision
const CFG = runtime.config.visionOverlay

const VERTEX = /* glsl */ `
  varying vec2 vNdc;
  void main() {
    vNdc = position.xy;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/** Same formula as `overlayAlphaAt` in systems/visionOverlay.ts (keep in sync). */
const FRAGMENT = /* glsl */ `
  uniform mat4 uInvViewProj;
  uniform vec2 uPlayer;
  uniform vec2 uForward;
  uniform float uCosHalf;
  uniform float uSoftness;
  uniform float uNear;
  uniform float uFar;
  uniform float uInside;
  uniform float uOutside;
  uniform float uBlocked;
  uniform float uMax;
  uniform float uNearShare;
  uniform float uStrength;
  uniform float uLos;
  uniform sampler2D uSectors;
  uniform float uSectorRange;
  uniform float uDebug;
  uniform vec3 uDebugColor;
  varying vec2 vNdc;

  void main() {
    // The ground point under this pixel (world space, so zoom and resolution do not matter).
    vec4 a = uInvViewProj * vec4(vNdc, -1.0, 1.0);
    vec4 b = uInvViewProj * vec4(vNdc, 1.0, 1.0);
    a /= a.w;
    b /= b.w;
    vec2 p = mix(a.xz, b.xz, a.y / (a.y - b.y));
    vec2 off = p - uPlayer;
    float d = length(off);
    vec2 dir = d > 1e-4 ? off / d : uForward;

    float edge = smoothstep(uCosHalf - uSoftness, uCosHalf + uSoftness, dot(dir, uForward));
    float inRange = 1.0 - smoothstep(uFar * 0.85, uFar * 1.15, d);
    float seen = edge * inRange;
    float alpha = mix(uOutside, uInside, seen);
    if (uLos > 0.5) {
      float u = fract(atan(dir.x, dir.y) / 6.28318531 + 1.0);
      float clearDist = texture2D(uSectors, vec2(u, 0.5)).r * uSectorRange;
      float blocked = smoothstep(clearDist, clearDist + 1.5, d);
      alpha = mix(alpha, uBlocked, blocked * seen);
    }
    float nearFade = smoothstep(uNear * 0.8, uNear * 1.3, d);
    float distShape = mix(uNearShare, 1.0, smoothstep(uNear, uFar * 1.25, d));
    alpha = min(alpha * nearFade * distShape * uStrength, uMax);
    gl_FragColor = uDebug > 0.5 ? vec4(uDebugColor, min(alpha * 4.0, 0.6)) : vec4(0.0, 0.0, 0.0, alpha);
  }
`

/** GPU side of the overlay: one shader material + the LOS sector texture, updated by uniforms only. */
class OverlayPass {
  readonly material: ShaderMaterial
  private readonly sectors: DataTexture
  private readonly sectorData = new Float32Array(CFG.losRays)
  private readonly invViewProj = new Matrix4()

  constructor() {
    this.sectors = new DataTexture(new Uint8Array(CFG.losRays * 4), CFG.losRays, 1, RGBAFormat, UnsignedByteType)
    this.sectors.wrapS = RepeatWrapping
    this.sectors.magFilter = LinearFilter
    this.sectors.minFilter = LinearFilter
    this.sectors.needsUpdate = true
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uInvViewProj: { value: new Matrix4() },
        uPlayer: { value: new Vector2() },
        uForward: { value: new Vector2(0, 1) },
        uCosHalf: { value: Math.cos(((VISION.fieldOfView / 2) * Math.PI) / 180) },
        uSoftness: { value: CFG.edgeSoftness },
        uNear: { value: VISION.nearDetectionRadius },
        uFar: { value: VISION.visionDistance },
        uInside: { value: CFG.insideOpacity },
        uOutside: { value: CFG.outsideOpacity },
        uBlocked: { value: CFG.blockedOpacity },
        uMax: { value: CFG.maxOpacity },
        uNearShare: { value: CFG.nearDistanceShare },
        uStrength: { value: 1 },
        uLos: { value: CFG.losAware ? 1 : 0 },
        uSectors: { value: this.sectors },
        uSectorRange: { value: sectorRange(VISION) },
        uDebug: { value: 0 },
        uDebugColor: { value: new Color('#ff2bd6') },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
  }

  /** Per frame: uniforms (camera, player, direction, strength) and the LOS sector mask. */
  update(camera: Camera, facing: number, daylight: number, debug: boolean): void {
    const start = performance.now()
    const p = runtime.player
    const strength = overlayStrength(daylight, CFG)
    camera.updateMatrixWorld()
    this.invViewProj.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse)
    const u = this.material.uniforms
    ;(u.uInvViewProj.value as Matrix4).copy(this.invViewProj)
    ;(u.uPlayer.value as Vector2).set(p.position.x, p.position.z)
    ;(u.uForward.value as Vector2).set(Math.sin(facing), Math.cos(facing))
    u.uStrength.value = strength
    u.uDebug.value = debug || CFG.debug ? 1 : 0

    if (CFG.losAware) {
      computeSectorDistances(p.position, runtime.visionOccluders, VISION, this.sectorData)
      const range = sectorRange(VISION)
      const texel = this.sectors.image.data as Uint8Array
      for (let i = 0; i < this.sectorData.length; i++) texel[i * 4] = Math.round(Math.min(1, this.sectorData[i] / range) * 255)
      this.sectors.needsUpdate = true
    }

    const view = { x: p.position.x, z: p.position.z, facing, strength }
    const sectors = CFG.losAware ? this.sectorData : undefined
    const probe = (ahead: number) =>
      overlayAlphaAt({ x: p.position.x + Math.sin(facing) * ahead, z: p.position.z + Math.cos(facing) * ahead }, view, VISION, CFG, sectors)
    visionOverlayDebug.facing = facing
    visionOverlayDebug.daylight = daylight
    visionOverlayDebug.strength = strength
    visionOverlayDebug.frontAlpha = probe(10)
    visionOverlayDebug.rearAlpha = probe(-10)
    visionOverlayDebug.frameMs = performance.now() - start
  }

  dispose(): void {
    this.material.dispose()
    this.sectors.dispose()
  }
}

/**
 * VisionOverlay: a subtle perception shade over the finished frame (one full-screen quad, drawn
 * last, no depth test). Inside the character's vision the world is untouched; outside it is ≈ 8 %
 * darker (12 % behind walls in the cone), never more than 15 %, half as strong at night. It is not
 * lighting: lights, exposure, background and every material stay exactly as the day/night system
 * set them; the daylight factor is only read to scale the shade. Zombie visibility stays with
 * `PlayerVisionSystem` (hidden zombies are not drawn at all). Toggle in Settings.
 */
export function VisionOverlay({ debug }: { debug: boolean }) {
  const smoothed = useRef(runtime.player.facing)
  const pass = useMemo(() => new OverlayPass(), [])

  useEffect(() => () => pass.dispose(), [pass])

  useFrame(({ camera }, delta) => {
    // Follows the character facing (not the camera) with a short trail: turns glide, no hard cut.
    smoothed.current = dampAngle(smoothed.current, runtime.player.facing, 1 / CFG.directionSmoothing, Math.min(delta, 0.1))
    pass.update(camera, smoothed.current, daylightAt(runtime.clock.timeOfDay), debug) // daylight: read only
  })

  return (
    <mesh material={pass.material} frustumCulled={false} renderOrder={1000} raycast={noRaycast}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  )
}

function noRaycast(): void {}
