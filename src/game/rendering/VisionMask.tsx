import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AlwaysStencilFunc,
  BufferAttribute,
  BufferGeometry,
  MeshBasicMaterial,
  NotEqualStencilFunc,
  ReplaceStencilOp,
  ShaderMaterial,
  Vector2,
} from 'three'
import { runtime } from '../core/runtime'
import { computeVisibilityOutline, visibilityPointCount } from '../systems/visionMask'

const CFG = runtime.config.playerVision
/** Above the grid (0.01), roads (0.015) and floors (0.02); below drops, containers and characters. */
const MASK_Y = 0.04
/** Covers the map, its boundary wall and a little of the void around it. */
const MARGIN = 6
const STENCIL_VISIBLE = 1

const DARKNESS_VERTEX = /* glsl */ `
  varying vec2 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

/** Darker with distance: just outside the visible area → `outsideOpacity`, far away → `farOpacity`. */
const DARKNESS_FRAGMENT = /* glsl */ `
  uniform vec2 uCenter;
  uniform float uFar;
  uniform float uOutside;
  uniform float uFarOpacity;
  varying vec2 vWorld;
  void main() {
    float d = distance(vWorld, uCenter);
    float a = mix(uOutside, uFarOpacity, smoothstep(uFar * 0.5, uFar, d));
    gl_FragColor = vec4(0.0, 0.0, 0.0, a);
  }
`

/**
 * VisionMask: ground darkening outside what the character can see. The visibility fan (cone to
 * `visionDistance`, near radius behind, cut at walls/closed doors) writes 1 into the stencil buffer
 * without drawing colour; a dark plane over the whole map is drawn only where the stencil is not 1.
 * Walls and props stand above the plane and keep their lighting; hidden zombies are handled by
 * `ZombieView`, so this layer is purely cosmetic and can be switched off in Settings.
 */
export function VisionMask() {
  const count = visibilityPointCount(CFG)
  const outline = useRef(new Float32Array(count * 2))

  const fan = useMemo(() => {
    // Non-indexed triangle fan around the player; one triangle per outline edge, closed loop.
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 9), 3))
    const material = new MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
      depthTest: false,
      stencilWrite: true,
      stencilRef: STENCIL_VISIBLE,
      stencilFunc: AlwaysStencilFunc,
      stencilZPass: ReplaceStencilOp,
      stencilZFail: ReplaceStencilOp,
    })
    return { geometry, material }
  }, [count])

  const darkness = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: DARKNESS_VERTEX,
        fragmentShader: DARKNESS_FRAGMENT,
        uniforms: {
          uCenter: { value: new Vector2() },
          uFar: { value: CFG.visionDistance },
          uOutside: { value: CFG.mask.outsideOpacity },
          uFarOpacity: { value: CFG.mask.farOpacity },
        },
        transparent: true,
        depthWrite: false,
        stencilWrite: true,
        stencilWriteMask: 0,
        stencilRef: STENCIL_VISIBLE,
        stencilFunc: NotEqualStencilFunc,
      }),
    [],
  )

  useEffect(() => () => {
    fan.geometry.dispose()
    fan.material.dispose()
    darkness.dispose()
  }, [fan, darkness])

  useFrame(() => {
    const p = runtime.player
    const pts = computeVisibilityOutline(p, CFG, runtime.visionOccluders, outline.current)
    const attr = fan.geometry.getAttribute('position') as BufferAttribute
    const v = attr.array as Float32Array
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count
      const o = i * 9
      v[o] = p.position.x
      v[o + 1] = MASK_Y
      v[o + 2] = p.position.z
      v[o + 3] = pts[i * 2]
      v[o + 4] = MASK_Y
      v[o + 5] = pts[i * 2 + 1]
      v[o + 6] = pts[j * 2]
      v[o + 7] = MASK_Y
      v[o + 8] = pts[j * 2 + 1]
    }
    attr.needsUpdate = true
    ;(darkness.uniforms.uCenter.value as Vector2).set(p.position.x, p.position.z)
  })

  const size = runtime.map.size + MARGIN * 2
  return (
    <>
      <mesh geometry={fan.geometry} material={fan.material} renderOrder={900} frustumCulled={false} raycast={noRaycast} />
      <mesh rotation-x={-Math.PI / 2} position-y={MASK_Y} material={darkness} renderOrder={901} raycast={noRaycast}>
        <planeGeometry args={[size, size]} />
      </mesh>
    </>
  )
}

function noRaycast(): void {}
