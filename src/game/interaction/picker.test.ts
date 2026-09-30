import { describe, expect, it } from 'vitest'
import { GAME_CONFIG } from '../core/config'
import { boxAround, pick, rayBox, rayPlane, type PickCandidate, type Ray } from './picker'

/** AX4: the game camera's ray (orthographic: every ray is parallel, looking down the camera offset). */
const o = GAME_CONFIG.camera.offset
const len = Math.hypot(o.x, o.y, o.z)
const DIR = { x: -o.x / len, y: -o.y / len, z: -o.z / len }
/** The ray through a ground point, starting 60 m back toward the camera. */
const rayThrough = (p: { x: number; y: number; z: number }): Ray => ({ origin: { x: p.x - DIR.x * 60, y: p.y - DIR.y * 60, z: p.z - DIR.z * 60 }, dir: DIR })

describe('world picker (AX4)', () => {
  const cabinet: PickCandidate = { kind: 'object', id: 'cabinet', box: boxAround({ x: 0, y: 0.5, z: 0 }, 0.5, 0.5, 0.3) }

  it('hits a box the ray passes through, misses one it passes by', () => {
    expect(rayBox(rayThrough({ x: 0, y: 0, z: 0 }), cabinet.box)).not.toBeNull()
    expect(rayBox(rayThrough({ x: 3, y: 0, z: 0 }), cabinet.box)).toBeNull()
  })

  it('the floor right under the cabinet picks the cabinet, not the ground (a floor never eats the click)', () => {
    expect(pick(rayThrough({ x: 0.2, y: 0, z: 0.1 }), [cabinet], 0)).toMatchObject({ kind: 'object', id: 'cabinet' })
    expect(pick(rayThrough({ x: 4, y: 0, z: 4 }), [cabinet], 0)).toMatchObject({ kind: 'ground', point: { x: 4, y: 0, z: 4 } })
  })

  it('the nearest along the ray wins: a cabinet hidden behind a wardrobe (seen from the camera) is not picked', () => {
    // The camera looks from +X/+Z: the wardrobe stands between it and the cabinet.
    const wardrobe: PickCandidate = { kind: 'object', id: 'wardrobe', box: boxAround({ x: 0.9, y: 1, z: 0.9 }, 0.4, 1, 0.4) }
    expect(pick(rayThrough({ x: 0, y: 0.5, z: 0 }), [cabinet, wardrobe], 0)).toMatchObject({ id: 'wardrobe' })
  })

  it('within 0.25 m of the nearest hit an object wins over a character (object > character); further in front the character wins', () => {
    // The zombie's box is the cabinet's, moved toward the camera along the ray: 0.1 m (a tie) or 1 m.
    const toward = (d: number): PickCandidate => {
      const m = (v: { x: number; y: number; z: number }) => ({ x: v.x - DIR.x * d, y: v.y - DIR.y * d, z: v.z - DIR.z * d })
      return { kind: 'character', id: 'z', box: { min: m(cabinet.box.min), max: m(cabinet.box.max) } }
    }
    const ray = rayThrough({ x: 0, y: 0.5, z: 0 })
    expect(rayBox(ray, toward(0.1).box)! - rayBox(ray, cabinet.box)!).toBeCloseTo(-0.1, 6)
    expect(pick(ray, [toward(0.1), cabinet], 0)).toMatchObject({ kind: 'object', id: 'cabinet' })
    expect(pick(ray, [toward(1), cabinet], 0)).toMatchObject({ kind: 'character', id: 'z' })
  })

  it('the ground point is on the storey asked for', () => {
    const upstairs = rayPlane(rayThrough({ x: 2, y: 3, z: 2 }), 3)!
    expect(upstairs.x).toBeCloseTo(2, 6)
    expect(upstairs.z).toBeCloseTo(2, 6)
  })
})
