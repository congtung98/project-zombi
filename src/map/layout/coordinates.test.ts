import { describe, expect, it } from 'vitest'
import { rotateXZ } from '../transform'
import {
  controlResiduals,
  fitAffine,
  fitSimilarity,
  geoToWebMercator,
  haversine,
  imageToWorld,
  invertImageTransform,
  LocalTangentProjection,
  rotateDeg,
  sourceToWorld,
  webMercatorToGeo,
  worldToEditor,
  worldToSource,
  type ControlPoint,
} from './coordinates'

const A = 6378137
const E2 = (1 / 298.257223563) * (2 - 1 / 298.257223563)
const DEG = Math.PI / 180

describe('WG1 coordinates: geographic → local metres', () => {
  const origin = { lon: 105.8, lat: 21 }
  const ltp = new LocalTangentProjection(origin)

  it('puts the origin at 0, east on +X and north on −Z (like world/boundary-n)', () => {
    expect(ltp.toLocal(origin)).toEqual({ x: 0, z: 0 })
    const north = ltp.toLocal({ lon: 105.8, lat: 21.001 })
    const east = ltp.toLocal({ lon: 105.801, lat: 21 })
    expect(north.z).toBeLessThan(0)
    expect(Math.abs(north.x)).toBeLessThan(1e-6)
    expect(east.x).toBeGreaterThan(0)
  })

  it('matches the ellipsoid radii of curvature for small steps (mm)', () => {
    const s = Math.sin(21 * DEG)
    const w = 1 - E2 * s * s
    const M = (A * (1 - E2)) / Math.pow(w, 1.5)
    const N = A / Math.sqrt(w)
    // 0.0001° is ~11 m: the plane and the arc agree to well under a millimetre.
    expect(ltp.toLocal({ lon: 105.8, lat: 21.0001 }).z).toBeCloseTo(-M * 0.0001 * DEG, 3)
    expect(ltp.toLocal({ lon: 105.8001, lat: 21 }).x).toBeCloseTo(N * Math.cos(21 * DEG) * 0.0001 * DEG, 3)
  })

  it('keeps distances within the sphere/ellipsoid difference over a few km', () => {
    for (const [dLon, dLat] of [[0.01, 0], [0, 0.01], [0.02, -0.015], [-0.03, 0.02]]) {
      const p = { lon: 105.8 + dLon, lat: 21 + dLat }
      const local = ltp.toLocal(p)
      const d = Math.hypot(local.x, local.z)
      expect(Math.abs(d / haversine(origin, p) - 1)).toBeLessThan(0.006)
    }
  })

  it('round-trips local ↔ geographic to 0.1 mm within 5 km', () => {
    for (const [x, z] of [[0, 0], [123.4, -56.7], [-2500, 1800], [4000, 3000], [-3500, -3500]]) {
      const g = ltp.toGeo({ x, z })
      const back = ltp.toLocal(g)
      expect(Math.hypot(back.x - x, back.z - z)).toBeLessThan(1e-4)
    }
    for (const g of [{ lon: 105.81, lat: 21.02 }, { lon: 105.77, lat: 20.98 }]) {
      const back = ltp.toGeo(ltp.toLocal(g))
      expect(Math.abs(back.lon - g.lon)).toBeLessThan(1e-9)
      expect(Math.abs(back.lat - g.lat)).toBeLessThan(1e-9)
    }
  })

  it('works far from the equator and rejects an invalid origin', () => {
    const north = new LocalTangentProjection({ lon: -73.98, lat: 40.75 })
    const p = { lon: -73.97, lat: 40.76 }
    const back = north.toGeo(north.toLocal(p))
    expect(Math.abs(back.lat - p.lat)).toBeLessThan(1e-9)
    expect(() => new LocalTangentProjection({ lon: 200, lat: 0 })).toThrow()
  })

  it('unprojects Web Mercator (EPSG:3857)', () => {
    expect(webMercatorToGeo(0, 0)).toEqual({ lon: 0, lat: 0 })
    expect(geoToWebMercator({ lon: 180, lat: 0 }).x).toBeCloseTo(20037508.34, 1)
    const g = { lon: 105.8, lat: 21 }
    const m = geoToWebMercator(g)
    const back = webMercatorToGeo(m.x, m.y)
    expect(back.lon).toBeCloseTo(g.lon, 10)
    expect(back.lat).toBeCloseTo(g.lat, 10)
  })
})

describe('WG1 coordinates: grid frame and editor', () => {
  it('rotates exactly by quarter turns (rotateXZ sense) and invertibly otherwise', () => {
    const [x, z] = rotateXZ(3, 4, 1)
    expect(rotateDeg({ x: 3, z: 4 }, 90)).toEqual({ x, z })
    expect(rotateDeg({ x: 3, z: 4 }, -270)).toEqual({ x, z })
    // Direction angle atan2(z, x) drops by the rotation: a street at −12° lands on the X axis.
    const r = rotateDeg({ x: Math.cos(-12 * DEG), z: Math.sin(-12 * DEG) }, -12)
    expect(r.z).toBeCloseTo(0, 12)
    const back = rotateDeg(rotateDeg({ x: 10, z: -7 }, 17.3), -17.3)
    expect(back.x).toBeCloseTo(10, 12)
    expect(back.z).toBeCloseTo(-7, 12)
  })

  it('round-trips source ↔ world through a frame', () => {
    const frame = { rotationDeg: -12.5, offset: { x: 3, z: -8 } }
    for (const p of [{ x: 0, z: 0 }, { x: 250, z: -180 }, { x: -33.3, z: 12.1 }]) {
      const w = sourceToWorld(frame, p)
      const s = worldToSource(frame, w)
      expect(s.x).toBeCloseTo(p.x, 5)
      expect(s.z).toBeCloseTo(p.z, 5)
    }
  })

  it('maps world points to the owning chunk like content records (half-open)', () => {
    expect(worldToEditor({ x: -0.5, z: 33 })).toEqual({ chunkId: 'c-1_1', cx: -1, cz: 1, local: { x: 31.5, z: 1 } })
    expect(worldToEditor({ x: 32, z: 0 }).chunkId).toBe('c1_0')
    expect(worldToEditor({ x: 31.999999, z: 0 }).chunkId).toBe('c0_0')
  })
})

describe('WG1 coordinates: reference image → world', () => {
  const truth = { a: 0.5 * Math.cos(0.3), b: -0.5 * Math.sin(0.3), c: 0.5 * Math.sin(0.3), d: 0.5 * Math.cos(0.3), tx: -120, tz: 40 }
  const cps = (pts: [number, number][], t = truth): ControlPoint[] => pts.map(([u, v]) => ({ image: { u, v }, world: imageToWorld(t, { u, v }) }))

  it('fits position, north and scale from two points', () => {
    const fit = fitSimilarity(cps([[10, 20], [800, 450]]))
    for (const k of ['a', 'b', 'c', 'd', 'tx', 'tz'] as const) expect(fit[k]).toBeCloseTo(truth[k], 9)
    expect(Math.hypot(fit.a, fit.c)).toBeCloseTo(0.5, 12)
  })

  it('least-squares fits noisy points with a small residual', () => {
    const points = cps([[0, 0], [1000, 0], [0, 800], [1000, 800], [500, 400]]).map((cp, i) => ({ ...cp, world: { x: cp.world.x + (i % 2 ? 0.3 : -0.3), z: cp.world.z + (i % 3 ? 0.2 : -0.2) } }))
    const r = controlResiduals(fitSimilarity(points), points)
    expect(r.max).toBeLessThan(1)
    expect(r.rms).toBeGreaterThan(0)
  })

  it('fits a skewed scan with the affine model and inverts it', () => {
    const skew = { a: 0.4, b: 0.05, c: -0.02, d: 0.55, tx: 7, tz: -3 }
    const points = cps([[0, 0], [900, 30], [40, 700], [850, 760]], skew)
    const fit = fitAffine(points)
    expect(controlResiduals(fit, points).max).toBeLessThan(1e-9)
    const inv = invertImageTransform(fit)
    const w = imageToWorld(fit, { u: 321, v: 123 })
    const back = imageToWorld(inv, { u: w.x, v: w.z })
    expect(back.x).toBeCloseTo(321, 9)
    expect(back.z).toBeCloseTo(123, 9)
  })

  it('refuses too few, coincident or collinear points', () => {
    expect(() => fitSimilarity(cps([[1, 1]]))).toThrow()
    expect(() => fitSimilarity(cps([[1, 1], [1, 1]]))).toThrow()
    expect(() => fitAffine(cps([[0, 0], [10, 10], [20, 20]]))).toThrow()
  })
})
